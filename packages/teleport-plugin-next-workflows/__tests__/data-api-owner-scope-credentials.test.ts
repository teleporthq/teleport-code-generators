/* tslint:disable:function-constructor no-any */
import * as crypto from 'crypto'
import { TableAccess } from '@teleporthq/teleport-shared'
import { generateDataAPIRoute } from '../src/data-api-route-generator'
import {
  generateCronAPIRoute,
  generateHandlerFunction,
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
  generateWebhookWorkflowAPIRoute,
} from '../src/api-route-generator'
import { dataSelect } from '../src/nodes/data/data-select'
import { loadServerRuntime } from './_helpers/load-server-runtime'
import { withEnv, withFetch } from './_helpers/fake-fetch'

/**
 * The data API is what a server segment reads with the app secret, for a
 * visitor whose session reaches it only as the forwarded cookie and whose
 * filter values arrive as the context the browser sent (A1-01, A1-02, A1-07,
 * A6-04). The verdict is the SQL that reached a fake database and the rows
 * served.
 */

const SECRET = 'server-secret-abc'

interface Session {
  id?: string
  email?: string
  role?: string
}

interface Db {
  queries: string[]
  params: unknown[][]
  rows: any[]
  /** Column types the schema lookup answers with. */
  columnTypes?: Record<string, string>
  /** Column types per table, where tables differ (wins over `columnTypes`). */
  tableColumns?: Record<string, Record<string, string>>
  /** The ids of registered accounts (users rows with an email). */
  registered?: string[]
  /**
   * The `users` rows themselves: when given, the "is it a registered account"
   * check is answered by the predicate the statement writes, over these rows.
   */
  users?: Array<{ id: string; email: string | null }>
}

const quiet = {
  log: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
}

function bootDataApi(db: Db, extra: Record<string, unknown> = {}) {
  // The project's staff: the admin panel's `manager` role and the explicit admin;
  // its TeleportHQ data source: ds1.
  const code = generateDataAPIRoute({
    authUsersTableName: 'users',
    staffRoles: ['admin', 'manager'],
    managedDataSourceIds: ['ds1'],
    ...extra,
  })
  let session: Session | null = null
  class FakeClient {
    public async connect(): Promise<void> {
      return
    }
    public async end(): Promise<void> {
      return
    }
    public async query(
      sql: string,
      values?: unknown[]
    ): Promise<{ rows: any[]; rowCount: number }> {
      db.queries.push(sql)
      db.params.push(values || [])
      if (/information_schema/i.test(sql)) {
        const table = String((values || [])[1])
        const types = (db.tableColumns && db.tableColumns[table]) || db.columnTypes || {}
        const rows = Object.keys(types).map((name) => ({
          column_name: name,
          data_type: types[name],
        }))
        return { rows, rowCount: rows.length }
      }
      if (/^SELECT 1 FROM users WHERE id::text = \$1/.test(sql) && db.users) {
        const row = db.users.find((user) => user.id === String((values || [])[0]))
        const email = row ? String(row.email == null ? '' : row.email) : ''
        let registered: boolean
        if (sql.indexOf("COALESCE(LOWER(email), '') NOT LIKE '%@anonymous.local'") !== -1) {
          registered = !!row && !email.toLowerCase().endsWith('@anonymous.local')
        } else if (sql.indexOf("COALESCE(email, '') <> ''") !== -1) {
          registered = !!row && email !== ''
        } else {
          throw new Error('unexpected registered-account check: ' + sql)
        }
        return { rows: registered ? [{ '?column?': 1 }] : [], rowCount: registered ? 1 : 0 }
      }
      if (/^SELECT 1 FROM users WHERE id::text = \$1/.test(sql)) {
        const known = (db.registered || []).indexOf(String((values || [])[0])) !== -1
        return { rows: known ? [{ '?column?': 1 }] : [], rowCount: known ? 1 : 0 }
      }
      if (/^SELECT COUNT/i.test(sql)) {
        return { rows: [{ count: String(db.rows.length) }], rowCount: 1 }
      }
      return { rows: db.rows.map((row) => ({ ...row })), rowCount: db.rows.length }
    }
  }
  const moduleObj: { exports: any } = { exports: {} }
  const fakeRequire = (name: string): any => {
    if (name === 'pg') {
      return { Client: FakeClient }
    }
    if (name === 'next-auth/jwt') {
      return { getToken: async () => (session ? { sub: session.id, ...session } : null) }
    }
    if (name === 'crypto') {
      return require('crypto')
    }
    if (/\/utils\/security-runtime$/.test(name)) {
      // The shared security runtime's constant-time compare, which the guard
      // requires for the app secret.
      return {
        safeEqual: (given: unknown, expected: unknown) =>
          typeof given === 'string' &&
          typeof expected === 'string' &&
          given !== '' &&
          given === expected,
      }
    }
    throw new Error('unexpected require: ' + name)
  }
  new Function('require', 'module', 'exports', 'process', 'console', code)(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    { env: { NEXTAUTH_SECRET: SECRET } },
    quiet
  )
  return async (
    operation: string,
    body: any,
    options: {
      internal?: boolean
      session?: Session | null
      secret?: string
      authLayer?: boolean
      dataSourceId?: string
      /** A server job (cron, webhook, automation): no visitor's request behind the call. */
      job?: boolean
    } = {}
  ) => {
    session = options.session || null
    const reply: any = { status: 0, body: null }
    const headers: Record<string, string> = { cookie: 'next-auth.session-token=x' }
    if (options.internal) {
      headers['x-internal-data-secret'] = options.secret || SECRET
    }
    if (options.job) {
      // A cron, a webhook or an automation run flags its calls (the runners put
      // the flag in the run's internal headers).
      headers['x-tq-server-job'] = '1'
    }
    const req: any = {
      method: 'POST',
      query: { params: [options.dataSourceId || 'ds1', operation] },
      headers,
      body,
    }
    if (options.authLayer) {
      // The auth layer's own in-process call.
      req.__tqServerCall = true
      req.__tqAuthLayerCall = true
    }
    await moduleObj.exports(req, {
      status(c: number) {
        reply.status = c
        return this
      },
      json(p: any) {
        reply.body = p
        return this
      },
    })
    return reply
  }
}

const freshDb = (rows: any[] = []): Db => ({ queries: [], params: [], rows })
const selects = (db: Db): string[] =>
  db.queries.filter((sql) => /^SELECT (?!COUNT)/i.test(sql) && !/information_schema/i.test(sql))

describe('owner-scoped reads of customer tables (A1-01)', () => {
  it('an "all" or empty owner never widens a guest read to every customer', async () => {
    for (const forged of ['all', '__all__', '']) {
      const db = freshDb([{ id: 'o1', user_id: 'victim' }])
      const api = bootDataApi(db)
      const reply = await api(
        'select',
        {
          tableName: 'teleport_orders',
          filters: [{ field: 'user_id', operator: '=', value: forged }],
        },
        { internal: true }
      )
      expect(reply.status).toBe(200)
      expect(selects(db)[0]).toBe('SELECT * FROM teleport_orders WHERE FALSE')
    }
  })

  it('the data-select node keeps an empty owner filter, so the read stays scoped end to end', async () => {
    const db = freshDb([{ id: 'o1', user_id: 'victim' }])
    const api = bootDataApi(db)
    const source = dataSelect.generateHandler()
    const fetchShim = async (url: string, init: any) => {
      const reply = await api(url.split('/').pop() as string, JSON.parse(init.body), {
        internal: true,
      })
      return { ok: reply.status < 400, status: reply.status, json: async () => reply.body }
    }
    const handler = new Function('fetch', `return (${source})`)(fetchShim)
    await handler(
      {
        dataSourceId: 'ds1',
        tableName: 'teleport_orders',
        filters: [{ field: 'user_id', operator: '=', value: 'all' }],
      },
      { __baseUrl: 'http://localhost', __internalHeaders: {}, __sessionUserId: null }
    )
    expect(selects(db)[0]).toBe('SELECT * FROM teleport_orders WHERE FALSE')

    // On any other table the node's old rule stands: the empty filter is left out.
    const other = freshDb([{ id: 'n1' }])
    const otherApi = bootDataApi(other)
    const otherHandler = new Function('fetch', `return (${source})`)(
      async (url: string, init: any) => {
        const reply = await otherApi(url.split('/').pop() as string, JSON.parse(init.body), {
          internal: true,
        })
        return { ok: reply.status < 400, status: reply.status, json: async () => reply.body }
      }
    )
    await otherHandler(
      {
        dataSourceId: 'ds1',
        tableName: 'notes',
        filters: [{ field: 'user_id', operator: '=', value: '' }],
      },
      { __baseUrl: 'http://localhost', __internalHeaders: {}, __sessionUserId: null }
    )
    expect(selects(other)[0]).toBe('SELECT * FROM notes')
  })

  it("a signed-in customer reads only the session's own rows, whatever id or email the context names", async () => {
    const db = freshDb([{ id: 'u2', email: 'victim@x.com' }])
    const api = bootDataApi(db)
    const me = { id: 'u1', email: 'me@x.com', role: 'user' }

    await api(
      'select',
      { tableName: 'users', filters: [{ field: 'email', operator: '=', value: 'victim@x.com' }] },
      { internal: true, session: me }
    )
    expect(selects(db)[0]).toBe('SELECT * FROM users WHERE FALSE')

    db.queries.length = 0
    db.params.length = 0
    await api(
      'select',
      { tableName: 'users', filters: [{ field: 'email', operator: '=', value: 'ME@x.com' }] },
      { internal: true, session: me }
    )
    expect(selects(db)[0]).toBe('SELECT * FROM users WHERE email = $1')

    db.queries.length = 0
    await api(
      'select',
      {
        tableName: 'teleport_orders',
        filters: [{ field: 'user_id', operator: '=', value: ['u1', 'u2'] }],
      },
      { internal: true, session: me }
    )
    expect(selects(db)[0]).toBe('SELECT * FROM teleport_orders WHERE FALSE')

    db.queries.length = 0
    await api(
      'count',
      {
        tableName: 'teleport_orders',
        filters: [{ field: 'user_id', operator: '!=', value: 'u1' }],
      },
      { internal: true, session: me }
    )
    expect(db.queries[0]).toBe('SELECT COUNT(*) FROM teleport_orders WHERE FALSE')
  })

  it("a guest's own rows are the ones no account owns, by the guest key the read names", async () => {
    const db = freshDb([])
    const api = bootDataApi(db)
    await api(
      'select',
      {
        tableName: 'teleport_favourites',
        filters: [
          { field: 'user_id', operator: '=', value: '', __skippable: true },
          { field: 'session_id', operator: '=', value: 'guest-session' },
        ],
      },
      { internal: true }
    )
    expect(selects(db)[0]).toBe(
      'SELECT * FROM teleport_favourites WHERE user_id IS NULL AND session_id = $1'
    )
  })

  it('a staff role reads every customer record as before', async () => {
    for (const role of ['admin', 'manager']) {
      const db = freshDb([])
      const api = bootDataApi(db)
      await api(
        'select',
        {
          tableName: 'teleport_orders',
          filters: [{ field: 'customer_email', operator: '=', value: 'someone@x.com' }],
        },
        { internal: true, session: { id: 'a1', role } }
      )
      expect(selects(db)[0]).toBe('SELECT * FROM teleport_orders WHERE customer_email = $1')
    }
  })

  it("a customer role a sign-up or a subscription gives (member) reads only the member's own rows", async () => {
    const db = freshDb([])
    const api = bootDataApi(db)
    const member = { id: 'm1', email: 'm@x.com', role: 'member' }
    await api(
      'select',
      {
        tableName: 'teleport_orders',
        filters: [{ field: 'customer_email', operator: '=', value: 'someone@x.com' }],
      },
      { internal: true, session: member }
    )
    expect(selects(db)[0]).toBe('SELECT * FROM teleport_orders WHERE FALSE')
    db.queries.length = 0
    await api(
      'select',
      { tableName: 'teleport_orders', filters: [{ field: 'user_id', operator: '=', value: 'm1' }] },
      { internal: true, session: member }
    )
    expect(selects(db)[0]).toBe('SELECT * FROM teleport_orders WHERE user_id = $1')
    // Nor may a member grant itself a staff role.
    const write = await api(
      'update',
      {
        tableName: 'users',
        filters: [{ field: 'id', operator: '=', value: 'm1' }],
        columnMappings: [{ column: 'role', value: 'manager' }],
      },
      { internal: true, session: member }
    )
    expect(write.status).toBe(403)
  })

  it('without the staff roles, only the explicit admin role is staff', () => {
    const code = generateDataAPIRoute({})
    expect(code).toContain('var STAFF_ROLES = ["admin"];')
  })
})

describe('credential columns never leave in a row (A1-02)', () => {
  const USER = {
    id: 'u1',
    email: 'v@x.com',
    password: '$2b$10$hash',
    access_token: 'oauth',
    role: 'admin',
  }

  it('a server-side SELECT * on users serves no hash and no OAuth token', async () => {
    const db = freshDb([USER])
    const api = bootDataApi(db)
    const reply = await api(
      'select',
      { tableName: 'users', filters: [], limit: 1 },
      { internal: true }
    )
    expect(reply.body.rows).toEqual([{ id: 'u1', email: 'v@x.com', role: 'admin' }])
  })

  it('a server segment that names the hash in its projection still never gets it (I1)', async () => {
    const db = freshDb([{ id: 'u1', email: 'v@x.com', password: '$2b$10$hash' }])
    const api = bootDataApi(db)
    const reply = await api(
      'select',
      {
        tableName: 'users',
        selectedColumns: ['email', 'password'],
        filters: [{ field: 'email', operator: '=', value: 'v@x.com' }],
      },
      { internal: true }
    )
    expect(reply.body.rows[0]).not.toHaveProperty('password')
  })

  it("only the auth layer's own in-process call gets a credential it names", async () => {
    const db = freshDb([{ id: 'u1', password: '$2b$10$hash' }])
    const api = bootDataApi(db)
    const reply = await api(
      'select',
      { tableName: 'users', selectedColumns: ['id', 'password'] },
      { authLayer: true }
    )
    expect(reply.body.rows[0].password).toBe('$2b$10$hash')
  })

  it('a write never hands back the row with its credentials (I1)', async () => {
    const db = freshDb([
      { id: 'u1', email: 'me@x.com', name: 'New', password: '$2b$hash', refresh_token: 'rt' },
    ])
    const api = bootDataApi(db)
    const me = { id: 'u1', email: 'me@x.com', role: 'user' }
    const updated = await api(
      'update',
      {
        tableName: 'users',
        filters: [{ field: 'email', operator: '=', value: 'me@x.com' }],
        columnMappings: [{ column: 'name', value: 'New' }],
      },
      { internal: true, session: me }
    )
    expect(updated.status).toBe(200)
    expect(updated.body.item).toEqual({ id: 'u1', email: 'me@x.com', name: 'New' })
    const created = await api(
      'create',
      { tableName: 'users', columnMappings: [{ column: 'name', value: 'New' }] },
      { internal: true }
    )
    expect(created.body.item).not.toHaveProperty('password')
    expect(created.body.item).not.toHaveProperty('refresh_token')
  })

  it("a server job's raw statement brings back only the credential columns it names", async () => {
    const db = freshDb([{ id: 'u1', password: 'h', reset_token: 't', name: 'Ada' }])
    const api = bootDataApi(db)
    const all = await api(
      'raw-query',
      { query: 'SELECT * FROM users u JOIN profiles p ON p.user_id = u.id' },
      { internal: true, job: true }
    )
    expect(all.body.rows).toEqual([{ id: 'u1', name: 'Ada' }])
    const named = await api(
      'raw-query',
      { query: 'SELECT id, password FROM users WHERE email = $1', params: ['a'] },
      { internal: true, job: true }
    )
    expect(named.body.rows[0]).toHaveProperty('password', 'h')
    expect(named.body.rows[0]).not.toHaveProperty('reset_token')
  })
})

describe('browser reads are bounded (A1-07) and the secret is compared in constant time (A6-04)', () => {
  it('a browser read without a count gets the default, a huge one the cap, a malformed one a 400', async () => {
    const db = freshDb([])
    const api = bootDataApi(db)
    await api('select', { tableName: 'teleport_products' })
    expect(selects(db)[0]).toMatch(/ LIMIT 100$/)
    db.queries.length = 0
    await api('select', { tableName: 'teleport_products', limit: 1000000000 })
    expect(selects(db)[0]).toMatch(/ LIMIT 1000$/)
    db.queries.length = 0
    const bad = await api('select', { tableName: 'teleport_products', limit: '1;--' })
    expect(bad.status).toBe(400)
    expect(db.queries).toEqual([])
  })

  it('a server-side read is not capped', async () => {
    const db = freshDb([])
    const api = bootDataApi(db)
    await api('select', { tableName: 'teleport_products' }, { internal: true })
    expect(selects(db)[0]).toBe('SELECT * FROM teleport_products')
  })

  it('only the exact secret makes a request internal', async () => {
    const db = freshDb([])
    const api = bootDataApi(db)
    const wrong = await api(
      'select',
      { tableName: 'users' },
      { internal: true, secret: SECRET.slice(0, -1) + 'x' }
    )
    expect(wrong.status).toBe(403)
    const short = await api(
      'select',
      { tableName: 'users' },
      { internal: true, secret: SECRET.slice(0, 4) }
    )
    expect(short.status).toBe(403)
    // Constant-time: Node's own compare, or the shared security runtime's
    // (Task 3a moved the guard onto it).
    expect(TableAccess.generateTableAccessHelperCode({ trustedReaderRoles: [] })).toMatch(
      /timingSafeEqual|security\.safeEqual\(/
    )
  })
})

describe('the data-select node hands every filter to the data API', () => {
  it('keeps a filter it would leave out, marked, so the data API decides', async () => {
    const sent: any[] = []
    const handler = new Function('fetch', `return (${dataSelect.generateHandler()})`)(
      async (_url: string, init: any) => {
        sent.push(JSON.parse(init.body))
        return { ok: true, status: 200, json: async () => ({ rows: [] as any[], count: 0 }) }
      }
    )
    await handler(
      {
        dataSourceId: 'ds1',
        tableName: 'teleport_orders',
        filters: [
          { field: 'id', operator: '=', value: 'all' },
          { field: 'status', operator: '=', value: 'paid' },
        ],
      },
      { __baseUrl: 'http://localhost', __internalHeaders: {}, __sessionUserId: null }
    )
    expect(sent[0].filters).toEqual([
      { field: 'id', operator: '=', value: 'all', __skippable: true },
      { field: 'status', operator: '=', value: 'paid' },
    ])
  })
})

describe('a server segment never writes a privilege onto an ordinary account (A1-06)', () => {
  const update = (columns: Record<string, unknown>) => ({
    tableName: 'users',
    filters: [{ field: 'id', operator: '=', value: 'u1' }],
    columnMappings: Object.keys(columns).map((column) => ({ column, value: columns[column] })),
  })

  it('refuses a role or an admin flag for a signed-in customer, by any spelling', async () => {
    const db = freshDb([])
    const api = bootDataApi(db)
    const me = { id: 'u1', email: 'me@x.com', role: 'user' }
    for (const columns of [
      { role: 'admin' },
      { is_admin: true },
      { name: 'Ada', roles: ['admin'] },
    ]) {
      const reply = await api('update', update(columns), { internal: true, session: me })
      expect(reply.status).toBe(403)
    }
    const raw = await api(
      'raw-query',
      { query: 'UPDATE users SET is_staff = TRUE WHERE id = $1', params: ['u1'] },
      { internal: true, session: me }
    )
    expect(raw.status).toBe(403)
    expect(db.queries.filter((sql) => /^UPDATE/.test(sql))).toEqual([])
  })

  it('lets a customer update their profile, the admin grant a role, and a server job write without a visitor', async () => {
    const db = freshDb([{ id: 'u1' }])
    const api = bootDataApi(db)
    expect(
      (
        await api('update', update({ name: 'Ada' }), {
          internal: true,
          session: { id: 'u1', role: 'user' },
        })
      ).status
    ).toBe(200)
    expect(
      (
        await api('update', update({ role: 'staff' }), {
          internal: true,
          session: { id: 'a1', role: 'admin' },
        })
      ).status
    ).toBe(200)
    expect((await api('update', update({ is_admin: false }), { internal: true })).status).toBe(200)
  })
})

describe('no data API query waits on the database for long (A5-L5)', () => {
  it('creates every client with a 10 s query timeout', () => {
    const code = generateDataAPIRoute({})
    expect(code.match(/query_timeout: 10000/g)).toHaveLength(2)
  })
})

describe('fix round 1: customer tables never widen, guests never name an owner', () => {
  it('an "all", empty or wildcard value on ANY key of a customer table matches nothing (I4)', async () => {
    for (const forged of ['all', '', '__all__', '*']) {
      const forgedDb = freshDb([{ id: 'o1' }, { id: 'o2' }])
      const forgedApi = bootDataApi(forgedDb)
      await forgedApi(
        'select',
        { tableName: 'teleport_orders', filters: [{ field: 'id', operator: '=', value: forged }] },
        { internal: true }
      )
      expect(selects(forgedDb)[0]).toBe('SELECT * FROM teleport_orders WHERE FALSE')
    }
    // Any other table keeps the optional filter's old meaning.
    const db = freshDb([])
    const api = bootDataApi(db)
    await api(
      'select',
      { tableName: 'notes', filters: [{ field: 'id', operator: '=', value: 'all' }] },
      { internal: true }
    )
    expect(selects(db)[0]).toBe('SELECT * FROM notes')
  })

  it("a guest naming an account's email or id reads nothing, unless the read is bound to the guest's own key (I5)", async () => {
    const db = freshDb([{ id: 'o1', customer_email: 'victim@x.com' }])
    const api = bootDataApi(db)
    await api(
      'select',
      {
        tableName: 'teleport_orders',
        filters: [{ field: 'customer_email', operator: '=', value: 'victim@x.com' }],
      },
      { internal: true }
    )
    expect(selects(db)[0]).toBe('SELECT * FROM teleport_orders WHERE FALSE')

    db.queries.length = 0
    db.params.length = 0
    await api(
      'select',
      {
        tableName: 'teleport_favourites',
        filters: [
          { field: 'user_id', operator: '=', value: '5a1f0b9e-1111-4c4c-9a9a-000000000001' },
          { field: 'session_id', operator: '=', value: 'guest-session' },
        ],
      },
      { internal: true }
    )
    expect(selects(db)[0]).toBe(
      'SELECT * FROM teleport_favourites WHERE user_id = $1 AND session_id = $2'
    )
  })

  it("files a guest's row under an anonymous id only, never a registered account's id (Task 2a)", async () => {
    const REGISTERED = '5a1f0b9e-1111-4c4c-9a9a-00000000aaaa'
    const ANONYMOUS = '5a1f0b9e-1111-4c4c-9a9a-00000000bbbb'
    const insertParams = async (fallback: string): Promise<unknown[]> => {
      const db = freshDb([])
      db.columnTypes = { user_id: 'uuid', session_id: 'text' }
      db.registered = [REGISTERED]
      const api = bootDataApi(db)
      await api(
        'create',
        {
          tableName: 'teleport_favourites',
          columnMappings: [{ column: 'user_id', value: 'anonymous' }],
          __anonymousUserId: fallback,
        },
        { internal: true }
      )
      return db.params[db.queries.findIndex((sql) => /^INSERT/.test(sql))]
    }
    // A registered account's id is never taken: the row is filed under no one.
    expect(await insertParams(REGISTERED)).toEqual([null])
    // An anonymous id is.
    expect(await insertParams(ANONYMOUS)).toEqual([ANONYMOUS])
  })

  it('keeps the guest checkout confirmation and the guest booking page working through their server segments', async () => {
    // The order-details lookup the editor builds: the order's number, the
    // session's id ('' for a guest) and the guest's anonymous id, all bound.
    const ORDER_LOOKUP =
      'SELECT o.id, o.order_number, o.total_amount FROM teleport_orders o ' +
      "WHERE o.order_number = $1 AND ((o.user_id::text = $2 AND $2 <> '') OR o.user_id::text = $3)"
    const db = freshDb([{ id: 'o1', order_number: 'ORD-7', total_amount: 12 }])
    const api = bootDataApi(db)
    const order = await api(
      'raw-query',
      { query: ORDER_LOOKUP, params: ['ORD-7', '', '5a1f0b9e-1111-4c4c-9a9a-00000000bbbb'] },
      { internal: true }
    )
    expect(order.status).toBe(200)
    expect(order.body.rows).toEqual([{ id: 'o1', order_number: 'ORD-7', total_amount: 12 }])

    // The booking page a guest opens from the link in their email: the
    // booking's reference and its manage key.
    const BOOKING_LOOKUP =
      'SELECT b.id, b.status, b.starts_at FROM teleport_bookings b WHERE b.reference = $1 AND b.manage_key = $2'
    const bookingDb = freshDb([
      { id: 'b1', status: 'confirmed', starts_at: '2026-11-01T10:00:00Z' },
    ])
    const bookingApi = bootDataApi(bookingDb)
    const booking = await bookingApi(
      'raw-query',
      { query: BOOKING_LOOKUP, params: ['BK-1', 'key-123'] },
      { internal: true }
    )
    expect(booking.status).toBe(200)
    expect(booking.body.rows).toHaveLength(1)
  })

  it('an owner filter written as a one-value "in" list still reads the session\'s own rows (M3)', async () => {
    const db = freshDb([])
    const api = bootDataApi(db)
    await api(
      'select',
      {
        tableName: 'teleport_orders',
        filters: [{ field: 'user_id', operator: 'in', value: ['u1'] }],
      },
      { internal: true, session: { id: 'u1', role: 'user' } }
    )
    expect(selects(db)[0]).toBe('SELECT * FROM teleport_orders WHERE user_id IN ($1)')
  })
})

describe('fix round 1: browser reads through the data API', () => {
  const EXPOSURE = {
    tables: {
      'ds1:team_members': {
        public: true,
        anySession: false,
        roles: [] as string[],
        defaultLimit: 100,
        maxLimit: 500,
      },
      'ds1:member_notes': {
        public: false,
        anySession: true,
        roles: [] as string[],
        defaultLimit: 100,
        maxLimit: 500,
      },
    },
    dataSources: {},
  }

  it('admits a table the way its per-table route does (I6)', async () => {
    const db = freshDb([])
    const api = bootDataApi(db, { dataExposure: EXPOSURE })
    expect((await api('select', { tableName: 'team_members' })).status).toBe(200)
    expect((await api('select', { tableName: 'member_notes' })).status).toBe(403)
    expect(
      (await api('select', { tableName: 'member_notes' }, { session: { id: 'u1', role: 'user' } }))
        .status
    ).toBe(200)
    // Another data source's table of the same name is not this one.
    expect(
      (await api('select', { tableName: 'team_members' }, { dataSourceId: 'ds2' })).status
    ).toBe(403)
    // A table no page binds stays the server's.
    expect((await api('select', { tableName: 'contacts' })).status).toBe(403)
  })

  it('never lets a browser filter, sort or select by a credential column (I2)', async () => {
    const db = freshDb([])
    const api = bootDataApi(db, { dataExposure: EXPOSURE })
    for (const body of [
      { tableName: 'team_members', filters: [{ field: 'password', operator: '>', value: '$2b' }] },
      { tableName: 'team_members', sorts: [{ field: 'api_key', order: 'asc' }] },
      { tableName: 'team_members', selectedColumns: ['name', 'reset_token'] },
    ]) {
      const reply = await api('select', body)
      expect(reply.status).toBe(400)
    }
    expect(db.queries.filter((sql) => /team_members/.test(sql))).toEqual([])
  })

  it('a browser read naming only an offset still gets the default count (M1)', async () => {
    const db = freshDb([])
    const api = bootDataApi(db)
    await api('select', { tableName: 'teleport_products', skip: 40 })
    expect(selects(db)[0]).toMatch(/ LIMIT 100 OFFSET 40$/)
  })
})

describe("fix round 2: a visitor's own list, and the server's own jobs", () => {
  const ME = { id: 'u1', email: 'me@x.com', role: 'user' }

  it('"all statuses" on My Orders lists the customer\'s own orders', async () => {
    const db = freshDb([])
    const api = bootDataApi(db)
    await api(
      'select',
      {
        tableName: 'teleport_orders',
        filters: [
          { field: 'user_id', operator: '=', value: 'u1' },
          { field: 'status', operator: '=', value: 'all' },
        ],
      },
      { internal: true, session: ME }
    )
    expect(selects(db)[0]).toBe('SELECT * FROM teleport_orders WHERE user_id = $1')
    expect(db.params[0]).toEqual(['u1'])
  })

  it('an "all" never reaches another customer\'s rows (I4 still holds)', async () => {
    for (const filters of [
      [{ field: 'id', operator: '=', value: 'all' }],
      [
        { field: 'user_id', operator: '=', value: 'victim' },
        { field: 'status', operator: '=', value: 'all' },
      ],
    ]) {
      const db = freshDb([])
      const api = bootDataApi(db)
      await api(
        'select',
        { tableName: 'teleport_orders', filters },
        { internal: true, session: ME }
      )
      expect(selects(db)[0]).toMatch(/WHERE FALSE/)
      expect(selects(db)[0]).not.toMatch(/user_id = \$1/)
    }
  })

  it('a cron, a webhook or an automation reads customer records by owner exactly as before', async () => {
    const db = freshDb([])
    const api = bootDataApi(db)
    await api(
      'select',
      {
        tableName: 'teleport_orders',
        filters: [
          { field: 'customer_email', operator: '=', value: 'buyer@x.com' },
          { field: 'status', operator: '=', value: 'all' },
        ],
      },
      { internal: true, job: true }
    )
    expect(selects(db)[0]).toBe('SELECT * FROM teleport_orders WHERE customer_email = $1')
    expect(db.params[0]).toEqual(['buyer@x.com'])
  })
})

describe('fix round 3: scoped by default, the guest key, raw results, the source id (N4, N5, N6, N9)', () => {
  const VICTIM = 'victim@x.com'

  it("an internal call that flags no server job is a visitor's: its customer reads are scoped (N9)", async () => {
    const db = freshDb([{ id: 'o1' }])
    const api = bootDataApi(db)
    // No data node marker of any kind: the default is the visitor's.
    await api(
      'select',
      {
        tableName: 'teleport_orders',
        filters: [{ field: 'customer_email', operator: '=', value: VICTIM }],
      },
      { internal: true }
    )
    expect(selects(db)[0]).toBe('SELECT * FROM teleport_orders WHERE FALSE')
    db.queries.length = 0
    await api(
      'count',
      {
        tableName: 'teleport_orders',
        filters: [{ field: 'user_id', operator: '=', value: 'all' }],
      },
      { internal: true }
    )
    expect(db.queries.filter((sql) => /^SELECT COUNT/.test(sql))[0]).toBe(
      'SELECT COUNT(*) FROM teleport_orders WHERE FALSE'
    )
  })

  it('the server-job flag counts only with the app secret (N9)', async () => {
    for (const options of [{ job: true }, { job: true, internal: true, secret: 'wrong-secret' }]) {
      const db = freshDb([{ id: 'o1' }])
      const api = bootDataApi(db)
      const reply = await api(
        'select',
        {
          tableName: 'teleport_orders',
          filters: [{ field: 'customer_email', operator: '=', value: VICTIM }],
        },
        options
      )
      expect(reply.status).toBe(403)
      expect(selects(db)).toEqual([])
    }
  })

  it('the data nodes send no marker of their own: the run flags its jobs in its internal headers (N9)', async () => {
    const sent: any[] = []
    const handler = new Function('fetch', `return (${dataSelect.generateHandler()})`)(
      async (_url: string, init: any) => {
        sent.push(init.headers)
        return { ok: true, status: 200, json: async () => ({ rows: [] as any[], count: 0 }) }
      }
    )
    const config = { dataSourceId: 'ds1', tableName: 'teleport_orders', filters: [] as any[] }
    await handler(config, { __baseUrl: 'http://x', __internalHeaders: {}, __sessionUserId: null })
    await handler(config, { __baseUrl: 'http://x', __internalHeaders: {} })
    await handler(config, { __baseUrl: 'http://x', __internalHeaders: { 'x-tq-server-job': '1' } })
    expect(sent.map((headers) => headers['x-tq-server-job'])).toEqual([undefined, undefined, '1'])
    expect(sent.some((headers) => 'x-tq-visitor-request' in headers)).toBe(false)
  })

  it('a cron run flags its data calls as a server job; a segment route a visitor calls never does (N9)', async () => {
    const workflow: any = {
      id: 'wf-cron',
      name: 'Nightly',
      trigger: {
        type: 'event-cron-triggered',
        nodeId: 't',
        scope: 'global',
        config: { schedule: '0 * * * *', urlPath: 'cron_nightly' },
      },
      nodes: [
        {
          id: 'count',
          type: 'data-count',
          config: { dataSourceId: 'ds-1', tableName: 'teleport_orders', filters: [] },
          stepNumber: 1,
          label: 'Count orders',
        },
      ],
      edges: [{ id: 'e1', source: 't', target: 'count' }],
    }
    const runtime = { exports: loadServerRuntime() }
    const route = { exports: null as any }
    new Function('module', 'exports', 'require', generateCronAPIRoute(workflow))(
      route,
      {},
      (id: string) =>
        id.endsWith('/utils/workflows/server-runtime') ? runtime.exports : require(id)
    )
    const key = 'k'.repeat(64)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const path = '/api/workflows/cron_nightly'
    const headers = {
      host: 'shop.test',
      'x-forwarded-proto': 'https',
      'x-teleport-cron-id': 'cron-1',
      'x-teleport-project-id': 'project-1',
      'x-teleport-cron-execution-id': 'exec-1',
      'x-teleport-cron-timestamp': timestamp,
      'x-teleport-cron-signature':
        'v1=' +
        crypto
          .createHmac('sha256', key)
          .update(`v1:${timestamp}:project-1:cron-1:exec-1:${path}`)
          .digest('hex'),
    }
    const res = { status: () => ({ json: (): void => undefined }) }
    const calls = await withEnv({ TELEPORT_CRON_SECRET: key, NEXTAUTH_SECRET: SECRET }, () =>
      withFetch(
        () => ({ status: 200, body: { count: 3 } }),
        async (recorded) => {
          await route.exports({ method: 'POST', url: path, headers, body: {} }, res)
          return recorded
        }
      )
    )
    const dataCall = calls.find((call) => /\/api\/data\//.test(call.url))
    expect(dataCall).toBeDefined()
    expect(dataCall!.headers['x-tq-server-job']).toBe('1')
    expect(dataCall!.headers['x-internal-data-secret']).toBe(SECRET)

    // The webhook route and the automation run flag theirs the same way.
    const flag = "context.__internalHeaders['x-tq-server-job'] = '1'"
    const webhook = generateWebhookWorkflowAPIRoute({
      ...workflow,
      trigger: { type: 'event-webhook-triggered', nodeId: 't', scope: 'global', config: {} },
      webhookConfig: { urlPath: 'hooks/x', httpMethod: 'POST', signatureSecret: '' },
    })
    expect(webhook).toContain(flag)
    expect(
      generateHandlerFunction({
        ...workflow,
        trigger: { ...workflow.trigger, type: 'event-business-event' },
      })
    ).toContain(flag)
    // A segment route sets the flag only when this deployment's own server code
    // called it with the flag (the internal-call token); a browser never can.
    // server-job-hops-real-data-api.test.ts runs both sides end to end.
    const segment: any = {
      id: 'seg-1',
      workflowId: 'wf-1',
      executionEnv: 'server',
      nodes: [
        {
          id: 'n1',
          type: 'data-select',
          config: { dataSourceId: 'ds1', tableName: 'teleport_orders' },
          stepNumber: 1,
          label: 'Read',
        },
      ],
      edges: [],
    }
    for (const segmentRoute of [
      generateServerSegmentAPIRoute(segment),
      generateStreamingServerSegmentAPIRoute(segment),
    ]) {
      expect(segmentRoute).toContain(
        "if (utils.isInternalCall(req) && req.headers && req.headers['x-tq-server-job'] === '1') {"
      )
      expect(segmentRoute.split("context.__internalHeaders['x-tq-server-job'] = '1'")).toHaveLength(
        2
      )
    }
  })

  it('only "=" with one concrete value on a guest key binds a guest\'s read (N4)', async () => {
    for (const [operator, value] of [
      ['LIKE', '%'],
      ['!=', 'g-own'],
      ['contains', 'a'],
      ['=', '*'],
      ['=', 'all'],
      ['in', ['g-1', 'g-2']],
    ] as Array<[string, unknown]>) {
      const probeDb = freshDb([{ id: 'o1', customer_email: VICTIM }])
      const probeApi = bootDataApi(probeDb)
      await probeApi(
        'select',
        {
          tableName: 'teleport_orders',
          filters: [
            { field: 'customer_email', operator: '=', value: VICTIM },
            { field: 'session_id', operator, value },
          ],
        },
        { internal: true }
      )
      expect({ operator, value, sql: selects(probeDb)[0] }).toEqual({
        operator,
        value,
        sql: expect.stringMatching(/^SELECT \* FROM teleport_orders WHERE FALSE\b/),
      })
    }
    // The guest's own key, with "=", still binds (the guest checkout lookup).
    const db = freshDb([{ id: 'o1' }])
    const api = bootDataApi(db)
    await api(
      'select',
      {
        tableName: 'teleport_orders',
        filters: [
          { field: 'customer_email', operator: '=', value: VICTIM },
          { field: 'session_id', operator: '=', value: 'g-own' },
        ],
      },
      { internal: true }
    )
    expect(selects(db)[0]).toBe(
      'SELECT * FROM teleport_orders WHERE customer_email = $1 AND session_id = $2'
    )
  })

  it("a visitor segment's raw statement never brings back a credential, even one it names (N5)", async () => {
    const rows = [{ email: 'a@x.com', password: '$2b$hash', reset_token: 't' }]
    const statement = {
      query: 'SELECT email, password, reset_token FROM users WHERE id = $1',
      params: ['u1'],
    }
    const visitor = await bootDataApi(freshDb(rows))('raw-query', statement, {
      internal: true,
      session: { id: 'u1', role: 'user' },
    })
    expect(visitor.status).toBe(200)
    expect(visitor.body.rows).toEqual([{ email: 'a@x.com' }])
    // A staff session is still a visitor's segment: its results go to a browser.
    const staff = await bootDataApi(freshDb(rows))('raw-query', statement, {
      internal: true,
      session: { id: 'a1', role: 'admin' },
    })
    expect(staff.body.rows).toEqual([{ email: 'a@x.com' }])
    // A server job (a cron's calendar sync) and the auth layer keep what they name.
    const job = await bootDataApi(freshDb(rows))('raw-query', statement, {
      internal: true,
      job: true,
    })
    expect(job.body.rows[0]).toHaveProperty('password', '$2b$hash')
    const auth = await bootDataApi(freshDb(rows))('raw-query', statement, { authLayer: true })
    expect(auth.body.rows[0]).toHaveProperty('reset_token', 't')
  })

  it("a browser read names the managed database's own source, never another source's same-named table (N6)", async () => {
    const dataExposure = {
      tables: {
        'ds-mysql:customers': {
          public: true,
          anySession: false,
          roles: [] as string[],
          defaultLimit: 100,
          maxLimit: 500,
        },
        '*:team_members': {
          public: true,
          anySession: false,
          roles: [] as string[],
          defaultLimit: 100,
          maxLimit: 500,
        },
      },
      dataSources: {},
    }
    const db = freshDb([{ id: 'c1', name: 'managed-db-row' }])
    const api = bootDataApi(db, { dataExposure })
    expect(
      (await api('select', { tableName: 'customers' }, { dataSourceId: 'ds-mysql' })).status
    ).toBe(403)
    expect((await api('select', { tableName: 'customers' }, { dataSourceId: 'ds1' })).status).toBe(
      403
    )
    expect(db.queries.filter((sql) => /FROM customers/.test(sql))).toEqual([])
    // A binding naming no source admits the managed source's table, under its id only.
    expect(
      (await api('select', { tableName: 'team_members' }, { dataSourceId: 'ds1' })).status
    ).toBe(200)
    expect(
      (await api('select', { tableName: 'team_members' }, { dataSourceId: 'ds-other' })).status
    ).toBe(403)
    // The route never even carries another source's entries.
    expect(generateDataAPIRoute({ dataExposure, managedDataSourceIds: ['ds1'] })).not.toContain(
      'ds-mysql'
    )
  })
})

describe("final wave: a private record is always the visitor's own (M2)", () => {
  const ME = { id: 'u1', email: 'Me@X.com', role: 'user' }
  const ORDERS = { id: 'uuid', user_id: 'uuid', customer_email: 'text', status: 'text' }
  const withOrders = (db: Db): Db => {
    db.tableColumns = {
      teleport_orders: ORDERS,
      teleport_order_items: { id: 'uuid', order_id: 'uuid', product_name: 'text' },
      teleport_bookings: { id: 'uuid', reference: 'text', starts_at: 'timestamp' },
    }
    return db
  }
  const countsOf = (db: Db): string[] => db.queries.filter((sql) => /^SELECT COUNT/i.test(sql))

  it("a page's list of orders with no owner filter shows a signed-in visitor only their own", async () => {
    const db = withOrders(freshDb([{ id: 'o1' }]))
    const api = bootDataApi(db)
    await api('select', { tableName: 'teleport_orders' }, { internal: true, session: ME })
    const read = selects(db)[0]
    expect(read).toBe(
      'SELECT * FROM teleport_orders WHERE (user_id::text = $1 OR LOWER(customer_email::text) = $2)'
    )
    expect(db.params[db.queries.indexOf(read)]).toEqual(['u1', 'me@x.com'])
    // Its count, and a filter on another key, are narrowed the same way.
    expect(countsOf(db)[0]).toBe(
      'SELECT COUNT(*) FROM teleport_orders WHERE (user_id::text = $1 OR LOWER(customer_email::text) = $2)'
    )
    const filtered = withOrders(freshDb([]))
    await bootDataApi(filtered)(
      'count',
      {
        tableName: 'teleport_orders',
        filters: [{ field: 'status', operator: '=', value: 'paid' }],
      },
      { internal: true, session: ME }
    )
    expect(countsOf(filtered)[0]).toBe(
      'SELECT COUNT(*) FROM teleport_orders WHERE status = $1 AND (user_id::text = $2 OR LOWER(customer_email::text) = $3)'
    )
    expect(filtered.params[filtered.queries.indexOf(countsOf(filtered)[0])]).toEqual([
      'paid',
      'u1',
      'me@x.com',
    ])
  })

  it('a guest gets none of them without its own guest key', async () => {
    const db = withOrders(freshDb([{ id: 'o1' }]))
    await bootDataApi(db)(
      'select',
      {
        tableName: 'teleport_orders',
        filters: [{ field: 'status', operator: '=', value: 'paid' }],
      },
      { internal: true }
    )
    expect(selects(db)[0]).toBe('SELECT * FROM teleport_orders WHERE status = $1 AND FALSE')
    // A guest's own cart, by its guest key, reads as before.
    const cart = freshDb([])
    await bootDataApi(cart)(
      'select',
      {
        tableName: 'teleport_cart',
        filters: [{ field: 'session_id', operator: '=', value: 'g-own' }],
      },
      { internal: true }
    )
    expect(selects(cart)[0]).toBe('SELECT * FROM teleport_cart WHERE session_id = $1')
  })

  it("an order's lines are the order's buyer's: narrowed through the order", async () => {
    const db = withOrders(freshDb([]))
    await bootDataApi(db)(
      'select',
      {
        tableName: 'teleport_order_items',
        filters: [{ field: 'order_id', operator: '=', value: 'o-9' }],
      },
      { internal: true, session: ME }
    )
    const read = selects(db)[0]
    expect(read).toBe(
      'SELECT * FROM teleport_order_items WHERE order_id = $1 AND order_id IN (SELECT id FROM teleport_orders WHERE (user_id::text = $2 OR LOWER(customer_email::text) = $3))'
    )
    expect(db.params[db.queries.indexOf(read)]).toEqual(['o-9', 'u1', 'me@x.com'])
    // A private table with no owner column and no parent to own it through finds nothing.
    const bookings = withOrders(freshDb([]))
    await bootDataApi(bookings)(
      'select',
      { tableName: 'teleport_bookings' },
      { internal: true, session: ME }
    )
    expect(selects(bookings)[0]).toBe('SELECT * FROM teleport_bookings WHERE FALSE')
  })

  it("My Orders reads as before, and the visitor's own owner filter needs no extra condition", async () => {
    const db = withOrders(freshDb([{ id: 'o1' }]))
    await bootDataApi(db)(
      'select',
      {
        tableName: 'teleport_orders',
        filters: [
          { field: 'user_id', operator: '=', value: 'u1' },
          { field: 'status', operator: '=', value: 'all', __skippable: true },
        ],
      },
      { internal: true, session: ME }
    )
    expect(selects(db)[0]).toBe('SELECT * FROM teleport_orders WHERE user_id = $1')
    expect(db.queries.some((sql) => /information_schema/i.test(sql))).toBe(false)
  })

  it('product reviews still list for everyone; a staff session and a server job read orders whole', async () => {
    const reviews = freshDb([{ id: 'r1', rating: 5 }])
    const listed = await bootDataApi(reviews)(
      'select',
      {
        tableName: 'teleport_product_reviews',
        filters: [{ field: 'product_id', operator: '=', value: 'p1' }],
      },
      { internal: true }
    )
    expect(listed.body.rows).toHaveLength(1)
    expect(selects(reviews)[0]).toBe('SELECT * FROM teleport_product_reviews WHERE product_id = $1')

    for (const options of [
      { internal: true, session: { id: 'a1', role: 'admin' } },
      { internal: true, job: true },
    ]) {
      const db = withOrders(freshDb([]))
      await bootDataApi(db)('select', { tableName: 'teleport_orders' }, options)
      expect(selects(db)[0]).toBe('SELECT * FROM teleport_orders')
    }
  })
})

describe("C1 re-review: a guest's own anonymous account row is no registered account (B1)", () => {
  const GUEST = '5a1f0b9e-1111-4c4c-9a9a-00000000cccc'
  const MEMBER = '5a1f0b9e-1111-4c4c-9a9a-00000000dddd'
  const NO_EMAIL = '5a1f0b9e-1111-4c4c-9a9a-00000000eeee'
  // "Resolve Current User" writes the guest's own row before the checkout's
  // INSERT: <uuid>@anonymous.local. A real account has a real address — or,
  // signed in some other way, none at all.
  const USERS = [
    { id: GUEST, email: `${GUEST}@anonymous.local` },
    { id: MEMBER, email: 'member@x.com' },
    { id: NO_EMAIL, email: null as string | null },
  ]
  const stored = async (operation: 'create' | 'update', fallback: string): Promise<unknown> => {
    const db = freshDb([])
    db.columnTypes = { id: 'uuid', user_id: 'uuid', status: 'text' }
    db.users = USERS
    const api = bootDataApi(db)
    // The checkout's server segment: the owner bound to '' for a signed-out
    // visitor, the guest's id as the hint.
    const body =
      operation === 'create'
        ? {
            tableName: 'teleport_orders',
            columnMappings: [
              { column: 'user_id', value: '' },
              { column: 'status', value: 'pending' },
            ],
            __anonymousUserId: fallback,
          }
        : {
            tableName: 'teleport_orders',
            filters: [
              { field: 'id', operator: '=', value: '5a1f0b9e-1111-4c4c-9a9a-0000000000ff' },
            ],
            columnMappings: [{ column: 'user_id', value: '' }],
            __anonymousUserId: fallback,
          }
    const reply = await api(operation, body, { internal: true })
    expect(reply.status).toBe(200)
    const write = db.queries.findIndex((sql) =>
      (operation === 'create' ? /^INSERT/ : /^UPDATE/).test(sql)
    )
    expect(write).toBeGreaterThan(-1)
    // user_id is the first column either statement writes.
    return db.params[write][0]
  }

  it.each(['create', 'update'] as const)(
    "%s files the order under the guest's id when its users row is the guest's anonymous one",
    async (operation) => {
      expect(await stored(operation, GUEST)).toBe(GUEST)
    }
  )

  it.each(['create', 'update'] as const)(
    '%s never files it under a registered account, with or without an address',
    async (operation) => {
      expect(await stored(operation, MEMBER)).toBeNull()
      expect(await stored(operation, NO_EMAIL)).toBeNull()
    }
  )
})
