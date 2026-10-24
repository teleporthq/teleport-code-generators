import * as crypto from 'crypto'
import {
  AccountDeleteRouteOptions,
  generateAccountDeleteRoute,
} from '../../src/account-delete-route-generator'

/**
 * Runs the generated `pages/api/account/delete-current.js` for a signed-in
 * visitor against a stubbed `pg` client: the user row and the
 * `information_schema` column lists come from `tables`, every statement is
 * recorded, and the project's own-table discovery answers no tables.
 */

export interface DeleteRouteRun {
  status: number
  body: any
  statements: Array<{ sql: string; params: unknown[] }>
}

export interface DeleteRouteSetup {
  userRow: Record<string, unknown>
  /** Platform table name -> its columns. A table not listed does not exist. */
  tables: Record<string, string[]>
  requestBody?: unknown
  env?: Record<string, string>
  options?: AccountDeleteRouteOptions
}

// bcryptjs is not installed in this repository; this stand-in keeps bcrypt's
// contract (compare a password against the hash it produced) deterministically.
export const fakeBcrypt = {
  hashSync: (text: string): string =>
    '$2a$12$' + crypto.createHash('sha256').update(text).digest('hex').slice(0, 53),
  compareSync: (text: string, hash: string): boolean => fakeBcrypt.hashSync(text) === hash,
}

/** What the sign-up stores for a password: bcrypt over SHA-256(password + pepper), base64. */
export const storedHashOf = (password: string, pepper = ''): string =>
  fakeBcrypt.hashSync(
    crypto
      .createHash('sha256')
      .update(password + pepper)
      .digest('base64')
  )

const USER_ROW_SQL = /^SELECT \* FROM \S+ WHERE id = \$1$/
const COLUMNS_OF_ONE_TABLE =
  "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1"

export const runAccountDeleteRoute = async (setup: DeleteRouteSetup): Promise<DeleteRouteRun> => {
  const run: DeleteRouteRun = { status: 0, body: undefined, statements: [] }

  class Client {
    public async connect() {
      return
    }
    public async query(sql: string, params: unknown[] = []) {
      run.statements.push({ sql, params })
      if (USER_ROW_SQL.test(sql)) {
        return { rows: [setup.userRow] }
      }
      if (sql === COLUMNS_OF_ONE_TABLE) {
        const columns = setup.tables[String(params[0])]
        return { rows: (columns || []).map((column_name) => ({ column_name })) }
      }
      return { rows: [] }
    }
    public async end() {
      return
    }
  }

  const fakeRequire = (name: string): unknown => {
    if (name === 'pg') {
      return { Client }
    }
    if (name === 'bcryptjs') {
      return fakeBcrypt
    }
    if (name === 'crypto') {
      return crypto
    }
    if (name === 'next-auth/jwt') {
      return { getToken: async () => ({ id: setup.userRow.id }) }
    }
    if (name.endsWith('/utils/email/email-locale')) {
      return { pickLocalizedTemplate: (base: unknown) => base, resolveRequestLocale: () => 'en' }
    }
    throw new Error(`unexpected require: ${name}`)
  }
  const moduleObj: { exports: any } = { exports: {} }
  // tslint:disable-next-line:function-constructor
  new Function(
    'require',
    'module',
    'exports',
    'process',
    'console',
    generateAccountDeleteRoute({ authUsersTableName: 'users', ...(setup.options || {}) })
  )(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    {
      env: {
        TELEPORT_DB_CONNECTION_STRING: 'postgresql://user:pw@db.test/site',
        NEXTAUTH_SECRET: 'secret',
        ...(setup.env || {}),
      },
    },
    { error: () => undefined, warn: () => undefined, info: () => undefined }
  )
  const handler = moduleObj.exports as (req: unknown, res: unknown) => Promise<unknown>
  const res = {
    status(code: number) {
      run.status = code
      return res
    },
    json(body: unknown) {
      run.body = body
      return res
    },
  }
  await handler(
    {
      method: 'POST',
      headers: {},
      ...(setup.requestBody === undefined ? {} : { body: setup.requestBody }),
    },
    res
  )
  return run
}

export const sqlOf = (run: DeleteRouteRun): string[] => run.statements.map((s) => s.sql)
