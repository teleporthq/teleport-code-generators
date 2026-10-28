/* tslint:disable:function-constructor */
import { AccountFields } from '@teleporthq/teleport-shared'
import { generateDataAPIRoute } from '../src/data-api-route-generator'
import { isPrivilegedUserField } from '../src/auth-generator'
import { accountSignup } from '../src/nodes/account/account-signup'
import { isSecurityRuntimeSpecifier, loadSecurityRuntime } from './_helpers/load-security-runtime'

/**
 * Review fix round 1 of the 2026-10-25 security round, executed against the
 * generated `/api/data/<ds>/<op>` route over a fake pg client.
 *
 * A3: the old reset-token table (`password_reset_tokens`) held live reset
 * tokens in clear. The dedicated reset routes replaced it, and the data API
 * refuses it to EVERY caller — the app's own server code and its jobs too —
 * by the table a request names and by any mention in a raw statement.
 *
 * m1: one privileged-field rule (`AccountFields.isPrivilegedAccountField`) for
 * the sign-up route, the sign-up node and the data API's account-table net. A
 * server segment acting for a signed-in customer cannot write a verified flag
 * or a plan onto an account; the same column of any other table is ordinary.
 */

const SECRET = 'server-secret'
const securityRuntime = loadSecurityRuntime()

interface Answer {
  status: number
  body: any
  queries: string[]
}

const bootRoute = (session: Record<string, unknown> | null = null) => {
  const code = generateDataAPIRoute({ authUsersTableName: 'users' })
  const queries: string[] = []
  class FakeClient {
    public async connect(): Promise<void> {
      return
    }
    public async end(): Promise<void> {
      return
    }
    public async query(sql: string): Promise<{ rows: any[]; rowCount: number }> {
      queries.push(sql)
      return { rows: [], rowCount: 0 }
    }
  }
  const moduleObj: { exports: any } = { exports: {} }
  new Function('require', 'module', 'exports', 'process', 'console', code)(
    (name: string): any => {
      if (name === 'pg') {
        return { Client: FakeClient }
      }
      if (name === 'next-auth/jwt') {
        return { getToken: async () => session }
      }
      if (isSecurityRuntimeSpecifier(name)) {
        return securityRuntime
      }
      throw new Error('unexpected require: ' + name)
    },
    moduleObj,
    moduleObj.exports,
    { env: { NEXTAUTH_SECRET: SECRET, TELEPORT_DB_CONNECTION_STRING: 'postgresql://x' } },
    { error: () => undefined, warn: () => undefined, log: () => undefined }
  )
  return async (
    operation: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {}
  ): Promise<Answer> => {
    queries.length = 0
    let status = 0
    let responseBody: any = null
    const res = {
      status(statusCode: number) {
        status = statusCode
        return this
      },
      json(payload: any) {
        responseBody = payload
        return this
      },
    }
    await moduleObj.exports(
      {
        method: 'POST',
        query: { params: ['ds-1', operation] },
        headers: { host: 'shop.example', ...headers },
        body,
      },
      res
    )
    return { status, body: responseBody, queries: queries.slice() }
  }
}

const internal = { 'x-internal-data-secret': SECRET }
const customerCookie = { cookie: '__Host-next-auth.session-token=signed' }

describe('A3: the old reset-token table is closed to every caller', () => {
  const run = bootRoute()

  it('refuses an internal-secret insert into and a select from password_reset_tokens', async () => {
    const insert = await run(
      'create',
      {
        tableName: 'password_reset_tokens',
        columnMappings: { email: 'victim@site.test', token: 'mine' },
      },
      internal
    )
    expect(insert.status).toBe(403)
    expect(insert.queries).toEqual([])
    for (const tableName of ['password_reset_tokens', 'public.password_reset_tokens']) {
      const select = await run('select', { tableName }, internal)
      expect(select.status).toBe(403)
      expect(select.queries).toEqual([])
    }
  })

  it('refuses a raw statement naming it — quoted or not, any case, schema-qualified — to the server too', async () => {
    for (const query of [
      'SELECT * FROM password_reset_tokens WHERE token = $1',
      'select email from "password_reset_tokens"',
      'DELETE FROM PUBLIC.PASSWORD_RESET_TOKENS',
      'SELECT u.id FROM users u JOIN "public"."password_reset_tokens" t ON t.email = u.email',
    ]) {
      const answer = await run('raw-query', { query }, internal)
      expect([query, answer.status]).toEqual([query, 403])
      expect(answer.queries).toEqual([])
    }
    // A select whose raw override names it is refused the same way.
    const override = await run(
      'select',
      { tableName: 'teleport_products', rawQueryUserPart: 'SELECT * FROM password_reset_tokens' },
      internal
    )
    expect(override.status).toBe(403)
  })

  it('leaves a statement that only resembles the name alone', async () => {
    const answer = await run(
      'raw-query',
      { query: 'SELECT id FROM password_reset_tokens_archive' },
      internal
    )
    expect(answer.status).not.toBe(403)
  })
})

describe('m1: one privileged-field rule, for the account table only', () => {
  // A server segment acting for a signed-in customer (it forwards their cookie).
  const run = bootRoute({ id: 'u-2', sub: 'u-2', role: 'user' })
  const asCustomer = { ...internal, ...customerCookie }

  it('refuses a customer a verified flag or a plan on their account', async () => {
    for (const column of ['email_verified', 'emailVerified', 'plan', 'credits', 'is_admin']) {
      const answer = await run(
        'update',
        {
          tableName: 'users',
          columnMappings: { [column]: true },
          filters: [{ source: 'id', operand: '=', destination: 'u-2' }],
        },
        asCustomer
      )
      expect([column, answer.status]).toEqual([column, 403])
    }
    const raw = await run(
      'raw-query',
      { query: "UPDATE users SET plan = 'pro' WHERE id = $1", params: ['u-2'] },
      asCustomer
    )
    expect(raw.status).toBe(403)
  })

  it('leaves the same column of any other table, and the account’s ordinary columns, as they were', async () => {
    const other = await run(
      'update',
      {
        tableName: 'teleport_subscriptions',
        columnMappings: { plan: 'pro', credits: 3 },
        filters: [{ source: 'id', operand: '=', destination: 's-1' }],
      },
      asCustomer
    )
    expect(other.status).not.toBe(403)
    const profile = await run(
      'update',
      {
        tableName: 'users',
        columnMappings: { name: 'Ana', company: 'Acme' },
        filters: [{ source: 'id', operand: '=', destination: 'u-2' }],
      },
      asCustomer
    )
    expect(profile.status).not.toBe(403)
  })

  it('is the same rule in the sign-up route and the sign-up node', () => {
    for (const key of ['email_verified', 'Plan', 'subscription_tier', 'role_name', 'company']) {
      expect(isPrivilegedUserField(key)).toBe(AccountFields.isPrivilegedAccountField(key))
    }
    expect(accountSignup.generateServerHandler!({} as never)).toContain(
      `const privilegedKey = ${AccountFields.PRIVILEGED_ACCOUNT_FIELD_PATTERN.toString()};`
    )
  })
})
