import { existsSync, readFileSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { createInterface } from 'readline'

/**
 * Giving the probe a signed-in session.
 *
 * Without one it sees the sign-in page instead of every protected route — and
 * worse, it USED to score that as a clean pass. A 37-route sweep reported full
 * coverage while two thirds of it was the same login screen. So the rule here
 * is: prove the session works, and if it does not, say so loudly. A silent
 * fallback to "unauthenticated" is exactly the failure mode that made the
 * earlier reports lie.
 *
 * Credentials are resolved from, in order: explicit flags/env, a gitignored
 * file beside the project, then a freshly generated test identity. They are
 * never baked into source — this repo is public, and the probe CREATES the
 * account it is given, so a hardcoded default would mean every generated
 * project shipping a known login on a live domain.
 */

const AUTH_PATHS = ['/sign-in', '/signin', '/login', '/auth']

export const isAuthPath = (pathname) =>
  AUTH_PATHS.some((authPath) => pathname === authPath || pathname.startsWith(`${authPath}/`))

const credentialsPath = (projectDir) => `${projectDir}.artifact-auth.json`

const ask = (question, fallback) =>
  new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    rl.question(`${question}${fallback ? ` [${fallback}]` : ''}: `, (answer) => {
      rl.close()
      resolve(answer.trim() || fallback)
    })
  })

/**
 * A password the probe invents is per-project and random. A shared weak one
 * would end up on every generated site the probe ever touches, several of which
 * are published to real domains.
 */
const generatedIdentity = () => ({
  email: 'artifact-probe@teleporthq.test',
  password: `Ap-${randomBytes(12).toString('base64url')}`,
  note:
    'Created by tools/artifact-probe so protected routes can be checked. Gitignored. ' +
    'Sign-up gives this account role "user"; promote it to "admin" in the database ' +
    'to let the probe reach /admin/* routes.',
})

export const resolveCredentials = async ({ projectDir, email, password, interactive }) => {
  if (email && password) {
    return { email, password, source: 'flags' }
  }
  if (process.env.ARTIFACT_PROBE_EMAIL && process.env.ARTIFACT_PROBE_PASSWORD) {
    return {
      email: process.env.ARTIFACT_PROBE_EMAIL,
      password: process.env.ARTIFACT_PROBE_PASSWORD,
      source: 'environment',
    }
  }

  const filePath = credentialsPath(projectDir)
  if (existsSync(filePath)) {
    try {
      const stored = JSON.parse(readFileSync(filePath, 'utf8'))
      if (stored.email && stored.password) {
        return { email: stored.email, password: stored.password, source: filePath }
      }
    } catch {
      /* unreadable file falls through to a fresh identity */
    }
  }

  const identity = generatedIdentity()
  if (interactive && process.stdin.isTTY) {
    identity.email = await ask('Email for probing protected routes', identity.email)
    identity.password = await ask('Password', identity.password)
  }

  writeFileSync(filePath, `${JSON.stringify(identity, null, 2)}\n`, 'utf8')
  return { email: identity.email, password: identity.password, source: `${filePath} (new)` }
}

const currentPath = (page) => {
  try {
    return new URL(page.url()).pathname
  } catch {
    return '/'
  }
}

const readFormError = async (page) => {
  try {
    const error = await page
      .locator('[class*="thq-error-text-elm"]')
      .first()
      .textContent({ timeout: 1500 })
    return (error || '').trim()
  } catch {
    return ''
  }
}

/** Submit and wait for either a navigation away or an inline error to appear. */
const submitAndSettle = async (page, startPath) => {
  await page.click('button[type="submit"]')
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    await page.waitForTimeout(400)
    if (currentPath(page) !== startPath) {
      // Give the destination a moment to establish its session cookie.
      await page.waitForTimeout(1200)
      return { movedAway: true, error: '' }
    }
    const error = await readFormError(page)
    if (error) {
      return { movedAway: false, error }
    }
  }
  return { movedAway: false, error: await readFormError(page) }
}

const attemptSignIn = async (page, baseUrl, credentials) => {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'load', timeout: 45000 })
  await page.fill('input[name="email"]', credentials.email)
  await page.fill('input[name="password"]', credentials.password)
  return submitAndSettle(page, currentPath(page))
}

const attemptSignUp = async (page, baseUrl, credentials) => {
  await page.goto(`${baseUrl}/sign-up`, { waitUntil: 'load', timeout: 45000 })
  const fill = async (selector, value) => {
    if (await page.locator(selector).count()) {
      await page.fill(selector, value)
    }
  }
  // Name is optional in the generated form; email/password/confirm are not.
  await fill('input[name="name"]', 'Artifact Probe')
  await fill('input[name="email"]', credentials.email)
  await fill('input[name="password"]', credentials.password)
  await fill('input[name="confirmPassword"]', credentials.password)
  return submitAndSettle(page, currentPath(page))
}

/**
 * Sign in, creating the account first if it does not exist yet.
 *
 * The generated app deliberately returns ONE error for both "unknown email" and
 * "wrong password", so the two cannot be told apart from the sign-in response.
 * The sequence resolves it: if sign-in fails, try sign-up — a sign-up that
 * reports the account already exists means the password is wrong, and that is
 * reported rather than quietly continuing without a session.
 */
export const establishSession = async (browser, { baseUrl, credentials, onProgress }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const result = { ok: false, method: null, identity: credentials.email, error: null }

  try {
    onProgress(`Signing in as ${credentials.email}…`)
    const signIn = await attemptSignIn(page, baseUrl, credentials)
    if (signIn.movedAway) {
      result.ok = true
      result.method = 'signed-in'
    } else {
      onProgress('Sign-in failed — creating the account…')
      const signUp = await attemptSignUp(page, baseUrl, credentials)
      if (signUp.movedAway) {
        const retry = await attemptSignIn(page, baseUrl, credentials)
        if (retry.movedAway) {
          result.ok = true
          result.method = 'signed-up'
        } else {
          result.error = `account created but sign-in still failed: ${
            retry.error || 'no error shown'
          }`
        }
      } else if (/exist|already|taken|registered/i.test(signUp.error || '')) {
        result.error = `account ${credentials.email} exists but the password was rejected (${signUp.error})`
      } else {
        result.error = `could not sign in (${
          signIn.error || 'no error shown'
        }) and could not sign up (${signUp.error || 'no error shown'})`
      }
    }

    if (result.ok) {
      // Prove it: land on a page and confirm we are not bounced to sign-in.
      const landedOn = currentPath(page)
      if (isAuthPath(landedOn)) {
        result.ok = false
        result.error = `submitted successfully but stayed on ${landedOn} — no session was established`
      } else {
        result.storageState = await context.storageState()
      }
    }
  } catch (error) {
    result.error = `authentication threw: ${error.message}`
  } finally {
    await context.close()
  }

  return result
}
