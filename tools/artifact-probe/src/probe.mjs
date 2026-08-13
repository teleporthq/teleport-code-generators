import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { chromium } from 'playwright-core'

import {
  BROWSER_LAUNCH_ARGS,
  resolveBrowserExecutable,
  runCommand,
  startServer,
} from './process.mjs'
import { discoverRoutes, findUnusedDependencies, parseBuildOutput } from './routes.mjs'
import { auditVisibility } from './visibility-audit.mjs'
import { establishSession, isAuthPath, resolveCredentials } from './auth.mjs'

/**
 * Build → boot → drive a browser → report. See ../README.md for what and why.
 *
 * The output shape is `ARTIFACT-REPORT.json` (schemaVersion 1); consumers are
 * the janitor's ARTIFACT stream and the admin panel's "Generated app" view, so
 * treat the field names as an interface and bump the version when they change.
 */

/** Error pages are SUPPOSED to answer with their status code. */
const EXPECTED_ERROR_ROUTES = new Map([
  ['/404', 404],
  ['/500', 500],
])

const isUnexpectedStatus = (route) =>
  route.status !== null &&
  route.status >= 400 &&
  EXPECTED_ERROR_ROUTES.get(route.path) !== route.status

const HYDRATION_MARKERS = [
  'Hydration failed',
  'Text content does not match',
  'did not match',
  'Minified React error #418',
  'Minified React error #423',
  'Minified React error #425',
]

const emptyRouteReport = (route, extra = {}) => ({
  path: route.path,
  file: route.file,
  status: null,
  loadMs: null,
  firstLoadKb: null,
  domNodes: null,
  bodyTextLength: null,
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  hydrationErrors: [],
  hiddenContent: [],
  hiddenOnLoad: 0,
  revealedByScroll: 0,
  screenshot: null,
  finalUrl: null,
  /* Set when the browser ended up somewhere else — an auth guard, a locale
     rewrite, any redirect. Such a route was NOT observed and must never be
     reported as clean. */
  redirectedTo: null,
  ...extra,
})

/* A locale prefix is a rewrite of the same page, not a redirect away from it. */
const LOCALE_PREFIX = /^\/[a-z]{2}(-[A-Z]{2})?(?=\/|$)/

const normalizePath = (pathname) => {
  const withoutLocale = pathname.replace(LOCALE_PREFIX, '') || '/'
  return withoutLocale.length > 1 ? withoutLocale.replace(/\/+$/, '') : withoutLocale
}

const AUTH_PATHS = ['/sign-in', '/signin', '/login', '/auth']

const describeRedirect = (finalPath) =>
  AUTH_PATHS.some((authPath) => normalizePath(finalPath).startsWith(authPath))
    ? `requires authentication — served ${finalPath}`
    : `redirected to ${finalPath}`

/**
 * Next's build log ends with the error block when it fails; the useful part is
 * from "Failed to compile" / "Build error occurred" onwards, not 400 lines of
 * progress.
 */
const extractBuildErrors = (stdout, stderr) => {
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/)
  const startIndex = lines.findIndex(
    (line) =>
      line.includes('Failed to compile') ||
      line.includes('Build error occurred') ||
      /^\s*Error:/.test(line)
  )
  if (startIndex < 0) {
    return lines
      .filter((line) => /error/i.test(line))
      .slice(-10)
      .map((line) => line.trim())
      .filter(Boolean)
  }
  return lines
    .slice(startIndex, startIndex + 30)
    .map((line) => line.trim())
    .filter(Boolean)
}

const probeRoute = async (
  browser,
  { baseUrl, route, firstLoadKb, screenshotDir, storageState }
) => {
  const report = emptyRouteReport(route, { firstLoadKb })

  // Opening the context/page has to be inside the guarded section too. A browser
  // that dies mid-sweep throws HERE, and when this sat outside the try it took
  // the whole process down — no report written at all, so 30 completed routes
  // were lost along with the one that failed. One bad route should cost one bad
  // route.
  let context
  let page
  try {
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ...(storageState ? { storageState } : {}),
    })
    page = await context.newPage()
  } catch (error) {
    report.error = `could not open a browser page: ${error.message}`
    return report
  }

  page.on('console', (message) => {
    const type = message.type()
    if (type !== 'error' && type !== 'warning') {
      return
    }
    const text = message.text()
    if (HYDRATION_MARKERS.some((marker) => text.includes(marker))) {
      report.hydrationErrors.push(text)
    } else if (type === 'error') {
      report.consoleErrors.push(text)
    }
  })
  page.on('pageerror', (error) => {
    const text = error.message
    if (HYDRATION_MARKERS.some((marker) => text.includes(marker))) {
      report.hydrationErrors.push(text)
    } else {
      report.pageErrors.push(text)
    }
  })
  page.on('requestfailed', (request) => {
    report.failedRequests.push({
      url: request.url(),
      failure: request.failure()?.errorText ?? 'unknown',
    })
  })

  try {
    const startedAt = Date.now()
    const response = await page.goto(`${baseUrl}${route.path}`, {
      waitUntil: 'load',
      timeout: 45000,
    })
    report.status = response?.status() ?? null
    report.loadMs = Date.now() - startedAt

    // Where the browser ACTUALLY ended up. `page.goto` follows redirects
    // silently and reports the final 200, so without this an auth-guarded route
    // looked indistinguishable from a healthy one: the probe measured the
    // sign-in page — its DOM, its visibility, its screenshot — and called the
    // admin route clean. A whole sweep read as full coverage while a third of it
    // was the same login screen over and over.
    report.finalUrl = page.url()
    const finalPath = new URL(report.finalUrl).pathname
    if (normalizePath(finalPath) !== normalizePath(route.path)) {
      report.redirectedTo = finalPath
    }

    // Long enough for a reveal animation AND its failsafe to have run. The
    // generated TqMotion in-view failsafe fires at duration * 1000 + 600ms.
    await page.waitForTimeout(2500)

    const audit = await page.evaluate(auditVisibility, { minArea: 2500, dwellMs: 700 })
    // A silent `undefined` here once made every route report "nothing hidden".
    // Never let a missing audit read as a clean one.
    if (!audit || typeof audit.domNodes !== 'number') {
      throw new Error('visibility audit returned nothing — the page could not be inspected')
    }
    report.domNodes = audit.domNodes
    report.bodyTextLength = audit.bodyText
    report.hiddenContent = audit.stillHidden
    report.revealedByScroll = audit.revealedByScroll
    report.hiddenOnLoad = audit.hiddenOnLoad

    if (screenshotDir) {
      const name = `${route.path.replace(/[^a-z0-9]+/gi, '_') || 'index'}.png`
      const screenshotPath = join(screenshotDir, name)
      await page.screenshot({ path: screenshotPath, fullPage: true })
      report.screenshot = screenshotPath
    }
  } catch (error) {
    report.error = error.message
  } finally {
    await context.close()
  }

  return report
}

export const probeArtifact = async ({
  projectDir,
  port = 4321,
  screenshotDir,
  skipInstall = false,
  installTimeoutMs = 900000,
  buildTimeoutMs = 900000,
  bootTimeoutMs = 120000,
  maxRoutes = 25,
  auth = null,
  onProgress = () => undefined,
}) => {
  const report = {
    schemaVersion: 2,
    projectDir,
    generatedAt: new Date().toISOString(),
    ok: false,
    verdicts: [],
    install: { ran: false, ok: true, durationMs: 0 },
    build: { ok: false, durationMs: 0, errors: [], sharedJsKb: null, routeBundles: [] },
    boot: { ok: false, port },
    auth: { attempted: false, ok: false, method: null, identity: null, error: null },
    routes: [],
    unusedDependencies: [],
    totals: {
      routesProbed: 0,
      routesRedirected: 0,
      routesNotVerified: 0,
      routesWithErrors: 0,
      routesWithHiddenContent: 0,
      hiddenRegions: 0,
    },
  }

  if (!existsSync(join(projectDir, 'package.json'))) {
    report.verdicts.push(`No package.json at ${projectDir} — nothing to probe.`)
    return report
  }

  const discovered = discoverRoutes(projectDir)

  if (!skipInstall && !existsSync(join(projectDir, 'node_modules'))) {
    onProgress('Installing dependencies…')
    const install = await runCommand({
      command: 'npm',
      args: ['install', '--no-audit', '--no-fund'],
      cwd: projectDir,
      timeoutMs: installTimeoutMs,
    })
    report.install = {
      ran: true,
      ok: install.code === 0,
      durationMs: install.durationMs,
      error: install.code === 0 ? undefined : extractBuildErrors('', install.stderr).join('\n'),
    }
    if (!report.install.ok) {
      report.verdicts.push('`npm install` failed — the generated package.json is not installable.')
      return report
    }
  }

  // Build from scratch. `.next` survives regeneration (it is deliberately
  // preserved so a dev server keeps its cache), so it can hold artifacts from a
  // previous `next dev` — and a production build over that mixture silently
  // emitted NO stylesheet at all: the CSS asset 500'd and every page rendered
  // unstyled. A probe that reports a broken site because of its own leftovers is
  // worse than no probe, and the few seconds this costs buy a verdict that means
  // something.
  onProgress('Clearing the previous build…')
  rmSync(join(projectDir, '.next'), { recursive: true, force: true })

  onProgress('Building…')
  const build = await runCommand({
    command: 'npm',
    args: ['run', 'build'],
    cwd: projectDir,
    timeoutMs: buildTimeoutMs,
  })
  report.build.durationMs = build.durationMs
  report.build.ok = build.code === 0
  const { routes: routeBundles, sharedKb } = parseBuildOutput(build.stdout)
  report.build.routeBundles = routeBundles
  report.build.sharedJsKb = sharedKb

  if (!report.build.ok) {
    report.build.errors = extractBuildErrors(build.stdout, build.stderr)
    report.verdicts.push(
      build.timedOut
        ? `\`next build\` timed out after ${Math.round(buildTimeoutMs / 1000)}s.`
        : '`next build` failed — the generated code does not compile.'
    )
    report.routes = discovered.map((route) =>
      emptyRouteReport(route, { error: 'not probed — build failed' })
    )
    return report
  }

  onProgress('Booting the production server…')
  const { handle, output } = await startServer({
    command: 'npm',
    args: ['run', 'start'],
    cwd: projectDir,
    port,
    timeoutMs: bootTimeoutMs,
  })

  if (!handle) {
    report.boot = {
      ok: false,
      port,
      error: output.split(/\r?\n/).filter(Boolean).slice(-8).join('\n'),
    }
    report.verdicts.push('The built app does not boot — `next start` never served the port.')
    return report
  }
  report.boot.ok = true

  const executablePath = resolveBrowserExecutable()
  let browser = null
  try {
    if (!executablePath) {
      report.verdicts.push(
        'No Chrome/Chromium found — build facts only. Set ARTIFACT_PROBE_BROWSER to an executable to enable runtime probing.'
      )
    } else {
      if (screenshotDir) {
        mkdirSync(screenshotDir, { recursive: true })
      }
      browser = await chromium.launch({
        executablePath,
        headless: true,
        args: BROWSER_LAUNCH_ARGS,
        timeout: 60000,
      })
      const bundleByPath = new Map(routeBundles.map((entry) => [entry.path, entry.firstLoadKb]))

      // Establish a session BEFORE probing, so protected routes are seen rather
      // than measured as the sign-in page.
      let storageState
      if (auth) {
        report.auth.attempted = true
        report.auth.identity = auth.email
        const session = await establishSession(browser, {
          baseUrl: `http://127.0.0.1:${port}`,
          credentials: auth,
          onProgress,
        })
        report.auth.ok = session.ok
        report.auth.method = session.method
        report.auth.error = session.error
        storageState = session.storageState
        if (!session.ok) {
          // Loud, because the consequence is silent otherwise: every protected
          // route would come back "not verified" looking entirely normal.
          report.verdicts.push(
            `Authentication FAILED for ${auth.email} — ${session.error}. Every protected route below is unchecked for that reason, not because it is healthy.`
          )
        }
      }

      const probeable = discovered.filter((route) => !route.dynamic).slice(0, maxRoutes)
      const staticTotal = discovered.filter((route) => !route.dynamic).length
      if (staticTotal > probeable.length) {
        report.verdicts.push(
          `Only ${probeable.length} of ${staticTotal} static routes probed — the --max-routes cap (${maxRoutes}) was hit, so the rest are unchecked.`
        )
      }

      for (const route of probeable) {
        onProgress(`Probing ${route.path}…`)
        report.routes.push(
          await probeRoute(browser, {
            baseUrl: `http://127.0.0.1:${port}`,
            route,
            firstLoadKb: bundleByPath.get(route.path) ?? null,
            screenshotDir,
            storageState,
          })
        )
      }

      for (const route of discovered) {
        if (route.dynamic) {
          report.routes.push(
            emptyRouteReport(route, {
              skipped: 'dynamic',
              firstLoadKb: bundleByPath.get(route.path) ?? null,
            })
          )
        }
      }
    }
  } finally {
    if (browser) {
      // A branded Chrome can refuse to exit; without this race the probed
      // server stayed alive for half an hour behind a hanging close().
      await Promise.race([
        browser.close(),
        new Promise((resolve) => setTimeout(resolve, 15000)),
      ]).catch(() => undefined)
    }
    handle.stop()
  }

  report.unusedDependencies = findUnusedDependencies(projectDir)

  const loaded = report.routes.filter((route) => !route.skipped && !route.error)
  // Only routes that rendered THEMSELVES count as observed. A redirected route
  // was loaded but never seen, and folding it into the clean tally is how a
  // sweep comes to claim coverage it does not have.
  const redirected = loaded.filter((route) => route.redirectedTo)
  const probed = loaded.filter((route) => !route.redirectedTo)
  report.totals.routesProbed = probed.length
  report.totals.routesRedirected = redirected.length
  report.totals.routesNotVerified =
    redirected.length + report.routes.filter((route) => route.skipped).length
  report.totals.routesWithErrors = probed.filter(
    (route) =>
      isUnexpectedStatus(route) || route.pageErrors.length > 0 || route.hydrationErrors.length > 0
  ).length
  report.totals.routesWithHiddenContent = probed.filter(
    (route) => route.hiddenContent.length > 0
  ).length
  report.totals.hiddenRegions = probed.reduce(
    (total, route) => total + route.hiddenContent.length,
    0
  )

  if (redirected.length > 0) {
    // Being bounced WHILE HOLDING a valid session is a different fact from being
    // bounced without one: the account authenticated fine and was refused
    // anyway, so the gate is permission, not identity. Note the destination is
    // NOT the tell — the generated middleware sends an authenticated user who
    // lacks the role to `/`, not back to /sign-in, so keying on "redirected to
    // an auth page" missed every one of these. Having a session is the tell.
    const forbidden = report.auth.ok ? redirected : []
    forbidden.forEach((route) => {
      route.forbidden = true
    })

    if (forbidden.length > 0) {
      report.verdicts.push(
        `${forbidden.length} route(s) refused the signed-in account ${
          report.auth.identity
        } — it authenticated fine and was still turned away, so this is a permission gate, not a login problem. The generated middleware gates routes by role and sign-up creates role "user"; promote that account to "admin" in the database to check them: ${forbidden
          .map((route) => `${route.path} → ${route.redirectedTo}`)
          .join(', ')}.`
      )
    }

    const plainlyUnverified = redirected.filter((route) => !route.forbidden)
    if (plainlyUnverified.length > 0) {
      report.verdicts.push(
        `${plainlyUnverified.length} route(s) never rendered themselves and are NOT verified` +
          (!report.auth.ok && plainlyUnverified.some((route) => isAuthPath(route.redirectedTo))
            ? ' — they need a signed-in session (the probe has none, so it measured the sign-in page instead)'
            : '') +
          `: ${plainlyUnverified
            .map((route) => `${route.path} → ${route.redirectedTo}`)
            .join(', ')}.`
      )
    }
  }

  for (const route of probed) {
    if (isUnexpectedStatus(route)) {
      report.verdicts.push(`${route.path} returned HTTP ${route.status}.`)
    }
    if (route.hydrationErrors.length > 0) {
      report.verdicts.push(
        `${route.path} fails React hydration — everything the client was supposed to do (animations, handlers, state) is dead: ${route.hydrationErrors[0]}`
      )
    }
    if (route.hiddenContent.length > 0) {
      const first = route.hiddenContent[0]
      report.verdicts.push(
        `${route.path} has ${
          route.hiddenContent.length
        } region(s) invisible even after scrolling — e.g. ${
          first.dataThq ? `[data-thq="${first.dataThq}"] ` : ''
        }${first.selector} at opacity ${first.opacity}.`
      )
    }
    if (route.pageErrors.length > 0) {
      report.verdicts.push(`${route.path} throws at runtime: ${route.pageErrors[0]}`)
    }
  }

  if (report.unusedDependencies.length > 0) {
    report.verdicts.push(
      `${
        report.unusedDependencies.length
      } declared dependency(ies) nothing imports: ${report.unusedDependencies.join(', ')}.`
    )
  }

  report.ok =
    report.build.ok &&
    report.boot.ok &&
    report.totals.routesWithErrors === 0 &&
    report.totals.routesWithHiddenContent === 0

  return report
}
