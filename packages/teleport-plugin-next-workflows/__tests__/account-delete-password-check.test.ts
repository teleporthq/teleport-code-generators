import { runAccountDeleteRoute, sqlOf, storedHashOf } from './_helpers/run-account-delete-route'

/**
 * The editor's delete-account form asks the visitor for their password. The
 * site's delete route checks a password the request carries against the
 * account's stored hash, the way sign-in does, and deletes nothing when it is
 * not theirs. A request without a password deletes as before.
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
  it.each([
    ['no body', undefined],
    ['an empty object', {}],
    ['the node’s "{}" string', '{}'],
    ['a null password', { password: null }],
  ])('deletes as before with %s', async (_label, requestBody) => {
    const run = await runAccountDeleteRoute({ userRow: userRow(), tables: TABLES, requestBody })

    expect(run.status).toBe(200)
    expect(deletedTheAccount(sqlOf(run))).toBe(true)
  })
})
