import { runAccountDeleteRoute, sqlOf, storedHashOf } from './_helpers/run-account-delete-route'
import {
  ACCOUNT_DELETE_SIGN_IN_AGAIN_MESSAGE,
  RECENT_SIGN_IN_MINUTES,
} from '../src/account-delete-route-generator'
import { SIGNED_IN_AT_KEY } from '../src/auth-generator'

/**
 * The editor's delete-account form asks the visitor for their password. The
 * site's delete route checks a password the request carries against the
 * account's stored hash, the way sign-in does, and deletes nothing when it is
 * not theirs. A request without a password (the account settings' Delete
 * Account button, an account with no password) deletes only for a recent
 * sign-in. Only the site's own pages are answered.
 */

const USER_ID = 'user-1'
const PASSWORD = 'correct horse battery staple'

const userRow = (password: string | null = storedHashOf(PASSWORD)) => ({
  id: USER_ID,
  email: 'ana@example.com',
  name: 'Ana',
  password,
})

const TABLES = {
  users: ['id', 'email', 'name', 'password'],
  teleport_cart: ['id', 'user_id'],
}

const deletedTheAccount = (sql: string[]) =>
  sql.includes('DELETE FROM users WHERE id = $1') && sql.includes('COMMIT')

const changedAnything = (sql: string[]) =>
  sql.some((statement) => /^(BEGIN|UPDATE|DELETE|INSERT)/.test(statement))

describe('deleting an account with a password', () => {
  it('deletes the account when the password is the account’s own', async () => {
    const run = await runAccountDeleteRoute({
      userRow: userRow(),
      tables: TABLES,
      requestBody: { password: PASSWORD },
    })

    expect(run.status).toBe(200)
    expect(deletedTheAccount(sqlOf(run))).toBe(true)
  })

  it('answers 403 and changes nothing when the password is not', async () => {
    const run = await runAccountDeleteRoute({
      userRow: userRow(),
      tables: TABLES,
      requestBody: { password: 'not it' },
    })

    expect(run.status).toBe(403)
    expect(run.body).toEqual({ error: 'Incorrect password' })
    expect(changedAnything(sqlOf(run))).toBe(false)
  })

  it('reads a body that arrives as a JSON string', async () => {
    const refused = await runAccountDeleteRoute({
      userRow: userRow(),
      tables: TABLES,
      requestBody: JSON.stringify({ password: 'not it' }),
    })
    expect(refused.status).toBe(403)

    const accepted = await runAccountDeleteRoute({
      userRow: userRow(),
      tables: TABLES,
      requestBody: JSON.stringify({ password: PASSWORD }),
    })
    expect(accepted.status).toBe(200)
  })

  it('checks with the project’s pepper, as sign-in does', async () => {
    const peppered = userRow(storedHashOf(PASSWORD, 'pepper-1'))
    const withPepper = await runAccountDeleteRoute({
      userRow: peppered,
      tables: TABLES,
      requestBody: { password: PASSWORD },
      env: { AUTH_PEPPER: 'pepper-1' },
    })
    expect(withPepper.status).toBe(200)

    const withoutPepper = await runAccountDeleteRoute({
      userRow: peppered,
      tables: TABLES,
      requestBody: { password: PASSWORD },
    })
    expect(withoutPepper.status).toBe(403)
  })

  it('checks with the project’s own pepper first, and still with the old one, as sign-in does', async () => {
    const env = { AUTH_PEPPER: 'pepper-1', AUTH_PEPPER_SECRET: 'secret-1' }
    // Signed up, or signed in (rehashed), after the deploy provisioned the secret.
    const current = await runAccountDeleteRoute({
      userRow: userRow(storedHashOf(PASSWORD, 'secret-1')),
      tables: TABLES,
      requestBody: { password: PASSWORD },
      env,
    })
    expect(current.status).toBe(200)

    // Not signed in since: the hash is still on the old pepper.
    const earlier = await runAccountDeleteRoute({
      userRow: userRow(storedHashOf(PASSWORD, 'pepper-1')),
      tables: TABLES,
      requestBody: { password: PASSWORD },
      env,
    })
    expect(earlier.status).toBe(200)

    const wrong = await runAccountDeleteRoute({
      userRow: userRow(storedHashOf(PASSWORD, 'secret-1')),
      tables: TABLES,
      requestBody: { password: 'not it' },
      env,
    })
    expect(wrong.status).toBe(403)
  })

  it('takes an unresolved secret placeholder for no secret', async () => {
    const run = await runAccountDeleteRoute({
      userRow: userRow(storedHashOf(PASSWORD, 'pepper-1')),
      tables: TABLES,
      requestBody: { password: PASSWORD },
      env: { AUTH_PEPPER: 'pepper-1', AUTH_PEPPER_SECRET: 'teleporthq.secrets.AUTH_PEPPER_SECRET' },
    })
    expect(run.status).toBe(200)
  })

  it('refuses any password for an account that has none stored (a social sign-in)', async () => {
    const run = await runAccountDeleteRoute({
      userRow: userRow(null),
      tables: TABLES,
      requestBody: { password: '' },
    })

    expect(run.status).toBe(403)
    expect(changedAnything(sqlOf(run))).toBe(false)
  })
})

describe('deleting an account without a password', () => {
  const MINUTE = 60 * 1000
  const signedIn = (minutesAgo: number) => ({
    id: USER_ID,
    [SIGNED_IN_AT_KEY]: Date.now() - minutesAgo * MINUTE,
  })

  it.each([
    ['no body', undefined],
    ['an empty object', {}],
    ['the node’s "{}" string', '{}'],
    ['a null password', { password: null }],
  ])('deletes for a session signed in just now, with %s', async (_label, requestBody) => {
    const run = await runAccountDeleteRoute({ userRow: userRow(), tables: TABLES, requestBody })

    expect(run.status).toBe(200)
    expect(deletedTheAccount(sqlOf(run))).toBe(true)
  })

  it(`deletes for a sign-in within the last ${RECENT_SIGN_IN_MINUTES} minutes, for an account with or without a password`, async () => {
    for (const password of [storedHashOf(PASSWORD), null]) {
      const run = await runAccountDeleteRoute({
        userRow: userRow(password),
        tables: TABLES,
        session: signedIn(RECENT_SIGN_IN_MINUTES - 1),
      })
      expect(run.status).toBe(200)
      expect(deletedTheAccount(sqlOf(run))).toBe(true)
    }
  })

  it('asks an older sign-in to sign in again, and reads or changes nothing', async () => {
    for (const session of [signedIn(RECENT_SIGN_IN_MINUTES + 1), { id: USER_ID }]) {
      for (const password of [storedHashOf(PASSWORD), null]) {
        const run = await runAccountDeleteRoute({
          userRow: userRow(password),
          tables: TABLES,
          session,
        })
        expect(run.status).toBe(403)
        expect(run.body).toEqual({ error: ACCOUNT_DELETE_SIGN_IN_AGAIN_MESSAGE })
        expect(run.statements).toEqual([])
      }
    }
  })

  it('takes the account’s own password from an older sign-in', async () => {
    const run = await runAccountDeleteRoute({
      userRow: userRow(),
      tables: TABLES,
      session: signedIn(RECENT_SIGN_IN_MINUTES * 10),
      requestBody: { password: PASSWORD },
    })
    expect(run.status).toBe(200)
    expect(deletedTheAccount(sqlOf(run))).toBe(true)
  })
})

describe('deleting an account from a page', () => {
  const OWN_PAGE = {
    host: 'shop.example',
    origin: 'https://shop.example',
    'sec-fetch-site': 'same-origin',
    cookie: '__Host-next-auth.session-token=signed',
  }

  it.each([
    ['another site’s page', { 'sec-fetch-site': 'same-site', origin: 'https://other.example' }],
    ['a cross-site page', { 'sec-fetch-site': 'cross-site', origin: 'https://elsewhere.example' }],
    ['an older browser on another site', { host: 'shop.example', origin: 'https://other.example' }],
  ])(
    'answers 403 to %s and reads or changes nothing, even with the password',
    async (_label, headers) => {
      const run = await runAccountDeleteRoute({
        userRow: userRow(),
        tables: TABLES,
        requestBody: { password: PASSWORD },
        headers,
      })
      expect(run.status).toBe(403)
      expect(run.statements).toEqual([])
    }
  )

  it('deletes from the site’s own page', async () => {
    const run = await runAccountDeleteRoute({
      userRow: userRow(),
      tables: TABLES,
      requestBody: { password: PASSWORD },
      headers: OWN_PAGE,
    })
    expect(run.status).toBe(200)
    expect(deletedTheAccount(sqlOf(run))).toBe(true)
  })
})
