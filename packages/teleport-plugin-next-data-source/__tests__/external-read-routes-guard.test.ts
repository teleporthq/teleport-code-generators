/* tslint:disable:function-constructor no-any */
import { UIDLDataSource } from '@teleporthq/teleport-types'
import {
  generateDataSourceFetcherWithCore,
  generateRawQueryFetcher,
} from '../src/data-source-fetchers'
import { publicExposure, publicRead } from './_helpers/exposure'

/**
 * Read routes over an external database (A1-03, A1-07, A1-08) and the
 * raw-query state routes (A5-H4) carry the same guard as the TeleportHQ ones:
 * the table's exposure, whole-number row counts (a browser's capped), safe
 * request fields, no credential column, a generic error.
 */

const MYSQL: UIDLDataSource = {
  id: 'ds-mysql-1',
  name: 'Shop',
  type: 'mysql',
  config: { host: 'h', port: 3306, user: 'u', password: 'p', database: 'shop' },
}

interface Reply {
  status: number
  body: any
  sqls: string[]
}

interface Call {
  handler?: 'handler' | 'getCount'
  query?: Record<string, string>
  session?: { role?: string; id?: string } | null
  headers?: Record<string, string>
}

const toScript = (esm: string, exportsLine: string): string =>
  esm
    .replace(/^import .*$/gm, '')
    .replace(/^export default async function handler/m, 'async function handler')
    .replace(/^export \{[^}]*\}\s*$/m, '')
    .replace(/^export default \{[^}]*\}\s*$/m, '')
    .replace(/^export default \w+\s*$/m, '')
    .concat('\n' + exportsLine)

const quiet = {
  log: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
}

const bootMySQLRoute = (
  table: string,
  options: { exposure?: object; rows?: any[]; fail?: string } = {}
): ((call?: Call) => Promise<Reply>) => {
  const esm = generateDataSourceFetcherWithCore(
    MYSQL,
    table,
    false,
    (options.exposure || {}) as any
  )
  const code = toScript(esm, 'module.exports = { handler: handler, getCount: getCount }')
  const sqls: string[] = []
  let session: Call['session'] = null
  const mysql = {
    escapeId: (name: string) => '`' + String(name).replace(/`/g, '``') + '`',
    createConnection: async () => ({
      query: async (sql: string) => {
        sqls.push(sql)
        if (options.fail) {
          throw new Error(options.fail)
        }
        if (/COUNT\(\*\)/i.test(sql)) {
          return [[{ count: (options.rows || []).length }]]
        }
        return [(options.rows || []).map((row) => ({ ...row }))]
      },
      execute: async (sql: string): Promise<any[][]> => {
        sqls.push(sql)
        return [[]]
      },
      end: async (): Promise<void> => undefined,
    }),
  }
  const fakeRequire = (name: string): any => {
    if (name === 'next-auth/jwt') {
      return {
        getToken: async () => (session ? { sub: session.id || 'u1', role: session.role } : null),
      }
    }
    if (name === 'crypto') {
      return require('crypto')
    }
    throw new Error('unexpected require: ' + name)
  }
  const moduleObj: { exports: any } = { exports: {} }
  new Function('require', 'module', 'exports', 'process', 'console', 'mysql', code)(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    { env: { NEXTAUTH_SECRET: 'server-secret' } },
    quiet,
    mysql
  )
  return async (call: Call = {}) => {
    session = call.session || null
    sqls.length = 0
    const reply: Reply = { status: 0, body: null, sqls }
    const res: any = {
      status(statusCode: number) {
        reply.status = statusCode
        return res
      },
      json(payload: any) {
        reply.body = payload
        return res
      },
      setHeader: (): void => undefined,
    }
    // A signed-in local request carries the plain session cookie (the only name
    // read on http; see teleport-shared session-cookie-resolver).
    const headers = {
      ...(session ? { cookie: 'next-auth.session-token=signed' } : {}),
      ...(call.headers || {}),
    }
    await moduleObj.exports[call.handler || 'handler'](
      { method: 'GET', query: call.query || {}, headers },
      res
    )
    return { ...reply, sqls: [...sqls] }
  }
}

describe('external database read routes', () => {
  const ROWS = [{ id: 1, name: 'Ada', password: 'hash', api_token: 'tok', token_count: 3 }]

  it('refuses a table no page binds — to a visitor and to any session', async () => {
    const route = bootMySQLRoute('customers', { rows: ROWS })
    expect((await route({})).status).toBe(403)
    expect((await route({ session: { role: 'user' } })).status).toBe(403)
    expect((await route({ handler: 'getCount' })).status).toBe(403)
  })

  it('serves a publicly bound table to the server-side caller and to the visitor', async () => {
    const route = bootMySQLRoute('customers', {
      rows: ROWS,
      exposure: publicExposure(['customers']),
    })
    const reply = await route({})
    expect(reply.status).toBe(200)
    expect(reply.body.data).toEqual([{ id: 1, name: 'Ada', token_count: 3 }])
  })

  it('a table only signed-in pages bind needs a session one of them admits', async () => {
    const exposure = {
      dataExposure: {
        tables: { '*:customers': publicRead({ public: false, roles: ['staff'] }) },
        dataSources: {},
      },
    }
    const route = bootMySQLRoute('customers', { rows: ROWS, exposure })
    expect((await route({})).status).toBe(401)
    expect((await route({ session: { role: 'user' } })).status).toBe(403)
    expect((await route({ session: { role: 'staff' } })).status).toBe(200)
  })

  it('never splices a row count it cannot read as a whole number into the SQL', async () => {
    const route = bootMySQLRoute('customers', {
      rows: ROWS,
      exposure: publicExposure(['customers']),
    })
    for (const limit of ['1;--', '1 /*SPLICED-MARKER*/', '1 OR 1=1', '-5']) {
      const reply = await route({ query: { limit } })
      expect(reply.status).toBe(400)
      expect(reply.sqls).toEqual([])
    }
    const offset = await route({ query: { offset: '0; DROP TABLE customers' } })
    expect(offset.status).toBe(400)
    expect(offset.sqls).toEqual([])
  })

  it('caps a browser read and gives one that names no count the default', async () => {
    const route = bootMySQLRoute('customers', {
      rows: ROWS,
      exposure: publicExposure(['customers']),
    })
    const huge = await route({ query: { limit: '100000000' } })
    expect(huge.sqls[huge.sqls.length - 1]).toMatch(/ LIMIT 500$/)
    const unnamed = await route({})
    expect(unnamed.sqls[unnamed.sqls.length - 1]).toMatch(/ LIMIT 100$/)
    const page = await route({ query: { perPage: '12', page: '3' } })
    expect(page.sqls[page.sqls.length - 1]).toMatch(/ LIMIT 12 OFFSET 24$/)
  })

  it('refuses a request field that is not a column name', async () => {
    const route = bootMySQLRoute('customers', {
      rows: ROWS,
      exposure: publicExposure(['customers']),
    })
    const sorted = await route({ query: { sortBy: 'name`; DROP TABLE x; --' } })
    expect(sorted.status).toBe(400)
    const filtered = await route({
      query: {
        filters: JSON.stringify([{ source: '(SELECT 1)', operand: '=', destination: 'x' }]),
      },
    })
    expect(filtered.status).toBe(400)
    expect(filtered.sqls).toEqual([])
  })

  it('keeps the driver error in the server log and answers a generic one', async () => {
    const route = bootMySQLRoute('customers', {
      exposure: publicExposure(['customers']),
      fail: "Unknown column 'secret_col' in table shop.customers",
    })
    const reply = await route({})
    expect(reply.status).toBe(500)
    expect(reply.body.error).toBe('Failed to fetch data')
    expect(typeof reply.body.id).toBe('string')
    expect(JSON.stringify(reply.body)).not.toMatch(/secret_col|shop\.customers/)
  })
})

describe('raw-query state routes (page-state / global-state)', () => {
  interface StateCall {
    query?: Record<string, string>
    session?: { role?: string; id?: string; email?: string } | null
    entitled?: boolean
    /** The app's own in-process call (getStaticProps, a page-load workflow). */
    serverCall?: boolean
  }

  const bootStateRoute = (
    sql: string,
    paramFields: string[],
    access: Parameters<typeof generateRawQueryFetcher>[3] = {},
    rows: any[] = [{ id: 'b1', customer_email: 'a@b.c', password: 'hash' }]
  ) => {
    const esm = generateRawQueryFetcher({}, sql, paramFields, access)
    const code = esm
      .replace(
        /^import \{ Client, types as pgTypes \} from 'pg'$/m,
        "const { Client, types: pgTypes } = require('pg')"
      )
      .replace(/^export default async function handler/m, 'module.exports = async function handler')
    const queries: Array<{ sql: string; params: unknown[] }> = []
    let session: StateCall['session'] = null
    let entitled = false
    class FakeClient {
      public async connect(): Promise<void> {
        return
      }
      public async end(): Promise<void> {
        return
      }
      public async query(text: string, params: unknown[] = []): Promise<{ rows: any[] }> {
        queries.push({ sql: text, params })
        if (/FROM teleport_subscriptions/.test(text)) {
          return { rows: entitled ? [{ ok: 1 }] : [] }
        }
        return { rows: rows.map((row) => ({ ...row })) }
      }
    }
    const fakeRequire = (name: string): any => {
      if (name === 'pg') {
        return { Client: FakeClient, types: { setTypeParser: (): void => undefined } }
      }
      if (name === 'next-auth/jwt') {
        return { getToken: async () => (session ? { sub: session.id || 'u1', ...session } : null) }
      }
      if (name === 'crypto') {
        return require('crypto')
      }
      throw new Error('unexpected require: ' + name)
    }
    const moduleObj: { exports: any } = { exports: {} }
    new Function('require', 'module', 'exports', 'process', 'console', code)(
      fakeRequire,
      moduleObj,
      moduleObj.exports,
      { env: { NEXTAUTH_SECRET: 'server-secret', TELEPORT_DB_HOST: 'h' } },
      quiet
    )
    return async (call: StateCall = {}) => {
      session = call.session || null
      entitled = call.entitled === true
      queries.length = 0
      const reply: any = { status: 0, body: null }
      const res: any = {
        status(c: number) {
          reply.status = c
          return res
        },
        json(p: any) {
          reply.body = p
          return res
        },
      }
      const headers = { ...(session ? { cookie: 'next-auth.session-token=signed' } : {}) }
      await moduleObj.exports(
        {
          method: 'GET',
          query: call.query || {},
          headers,
          __tqServerCall: call.serverCall === true,
        },
        res
      )
      return { ...reply, queries: [...queries] }
    }
  }

  // The A5-H4 probe: a booking item's bookings, by the item id in the URL.
  const BOOKINGS_BY_ITEM = 'SELECT * FROM teleport_bookings WHERE item_id::text = $1'

  it('refuses a customer table to a visitor, whatever entity the query string names', async () => {
    const route = bootStateRoute(BOOKINGS_BY_ITEM, ['currentPageEntityId'])
    const anonymous = await route({ query: { currentPageEntityId: 'item-1' } })
    expect(anonymous.status).toBe(401)
    expect(anonymous.queries).toEqual([])
    const customer = await route({
      query: { currentPageEntityId: 'item-1' },
      session: { role: 'user' },
    })
    expect(customer.status).toBe(403)
  })

  it('serves the customer table to the admin, without its credential columns', async () => {
    const route = bootStateRoute(BOOKINGS_BY_ITEM, ['currentPageEntityId'], {
      trustedReaderRoles: ['admin'],
    })
    const reply = await route({
      query: { currentPageEntityId: 'item-1' },
      session: { role: 'admin' },
    })
    expect(reply.status).toBe(200)
    expect(reply.body.data).toEqual([{ id: 'b1', customer_email: 'a@b.c' }])
  })

  it("serves a statement scoped to the session's own user, bound from the session", async () => {
    const route = bootStateRoute(
      'SELECT * FROM teleport_favourites WHERE user_id = $1',
      ['currentUserId'],
      {}
    )
    const reply = await route({
      query: { currentUserId: 'victim' },
      session: { id: 'me', role: 'user' },
    })
    expect(reply.status).toBe(200)
    expect(reply.queries[0].params).toEqual(['me'])
    const anonymous = await route({ query: { currentUserId: 'victim' } })
    expect(anonymous.status).toBe(200)
    expect(anonymous.queries).toEqual([])
  })

  it("runs behind the page's own protection", async () => {
    const route = bootStateRoute(
      'SELECT id, title FROM team_notes WHERE team_id = $1',
      ['currentPageEntityId'],
      {
        pageAccess: { requiresAuth: true, allowedRoles: ['staff'] },
      }
    )
    expect((await route({ query: { currentPageEntityId: 't1' } })).status).toBe(401)
    expect(
      (await route({ query: { currentPageEntityId: 't1' }, session: { role: 'user' } })).status
    ).toBe(403)
    expect(
      (await route({ query: { currentPageEntityId: 't1' }, session: { role: 'staff' } })).status
    ).toBe(200)
  })

  it("a subscriber-only page's states need the entitlement too", async () => {
    const route = bootStateRoute(
      'SELECT id, title FROM premium_lessons WHERE course_id = $1',
      ['currentPageEntityId'],
      {
        pageAccess: {
          requiresAuth: true,
          allowedRoles: [],
          requiresSubscription: true,
          subscriptionProductIds: ['plan-pro'],
        },
      }
    )
    expect((await route({ query: { currentPageEntityId: 'c1' } })).status).toBe(401)
    const without = await route({ query: { currentPageEntityId: 'c1' }, session: { id: 'u1' } })
    expect(without.status).toBe(403)
    expect(without.queries[0].params[2]).toEqual(['plan-pro'])
    const entitled = await route({
      query: { currentPageEntityId: 'c1' },
      session: { id: 'u1' },
      entitled: true,
    })
    expect(entitled.status).toBe(200)
  })

  it('A3: refuses a statement naming the retired reset-token table, to the app itself too', async () => {
    const route = bootStateRoute(
      'SELECT email FROM PUBLIC."password_reset_tokens" WHERE token = $1',
      ['currentPageEntityId']
    )
    for (const call of [
      { query: { currentPageEntityId: 't' }, serverCall: true },
      { query: { currentPageEntityId: 't' }, session: { role: 'admin' } },
    ]) {
      const answer = await route(call)
      expect(answer.status).toBe(403)
      expect(answer.queries).toEqual([])
    }
    // The app's own call reads any other statement as before.
    const other = bootStateRoute('SELECT id FROM team_notes WHERE team_id = $1', [
      'currentPageEntityId',
    ])
    expect((await other({ query: { currentPageEntityId: 't' }, serverCall: true })).status).toBe(
      200
    )
  })

  it('binds a route param as one short string, never a list', async () => {
    const route = bootStateRoute('SELECT id FROM team_notes WHERE team_id = $1', [
      'currentPageEntityId',
    ])
    const listed = await route({ query: { currentPageEntityId: ['a', 'b'] as any } })
    expect(listed.queries[0].params).toEqual(['a'])
    const long = await route({ query: { currentPageEntityId: 'x'.repeat(1000) } })
    expect(long.queries).toEqual([])
  })
})

describe('no read waits on the database for long (A5-L5)', () => {
  it('bounds every query of the Postgres-family read routes on the client, and every external read', () => {
    const teleport: UIDLDataSource = { id: 'ds-t', name: 'db', type: 'teleport', config: {} }
    const postgres: UIDLDataSource = {
      id: 'ds-p',
      name: 'db',
      type: 'postgresql',
      config: { host: 'h', port: 5432, user: 'u', password: 'p', database: 'd' },
    }
    expect(generateDataSourceFetcherWithCore(teleport, 'posts', false, {})).toContain(
      'query_timeout: 10000'
    )
    expect(generateDataSourceFetcherWithCore(postgres, 'posts', false, {})).toContain(
      'query_timeout: 10000'
    )
    expect(generateRawQueryFetcher({}, 'SELECT 1', [])).toContain('var QUERY_TIMEOUT_MS = 10000')
    expect(generateDataSourceFetcherWithCore(MYSQL, 'customers', false, {})).toContain(
      'var __TQ_DRIVER_TIMEOUT_MS = 10000'
    )
  })
})

describe('fix round 1: every field a request names is a known column (C1, I2)', () => {
  const SCHEMA = {
    selectedTables: {
      customers: {
        columns: [{ name: 'id' }, { name: 'name' }, { name: 'email' }, { name: 'password' }],
      },
    },
  }
  const PUBLIC = publicExposure(['customers'])
  const toModule = (esm: string): string =>
    esm
      .replace(/^import .*$/gm, '')
      .replace(/^export \{[^}]*\}\s*$/m, '')
      .replace(/^export default \{[^}]*\}\s*$/m, '')
      .concat('\nmodule.exports = { handler: handler }')
  const call = async (m: any, query: any) => {
    const out: any = {}
    const res: any = {
      status(c: number) {
        out.status = c
        return res
      },
      json(p: any) {
        out.body = p
        return res
      },
      setHeader: (): any => res,
    }
    await m.exports.handler({ method: 'GET', headers: {}, query }, res)
    return out
  }
  const fakeRequire = (name: string): any => (name === 'crypto' ? require('crypto') : {})

  const bootMariaDb = () => {
    const MARIA: UIDLDataSource = {
      id: 'ds-maria',
      name: 'Shop',
      type: 'mariadb',
      config: { host: 'h', port: 3306, user: 'u', password: 'p', database: 'shop', ...SCHEMA },
    }
    const sqls: string[] = []
    const mariadb = {
      createConnection: async (): Promise<any> => ({
        query: async (sql: string): Promise<any[]> => {
          sqls.push(sql)
          return []
        },
        end: async (): Promise<void> => undefined,
      }),
    }
    const m: any = { exports: {} }
    new Function(
      'require',
      'module',
      'exports',
      'process',
      'console',
      'mariadb',
      toModule(generateDataSourceFetcherWithCore(MARIA, 'customers', false, PUBLIC))
    )(fakeRequire, m, m.exports, { env: { NEXTAUTH_SECRET: 'server-secret' } }, quiet, mariadb)
    return { m, sqls }
  }

  it('refuses a repeated sortBy and a sort that is not one field with asc|desc (MariaDB)', async () => {
    const { m, sqls } = bootMariaDb()
    for (const query of [
      { sortBy: ['name', 'name` , (SELECT SLEEP(5)) -- '] },
      { sortBy: 'name` , (SELECT SLEEP(5)) -- ' },
      { sortBy: 'name', sortOrder: 'desc; DROP TABLE x' },
      { sorts: JSON.stringify([{ field: 'name' }, { field: 'email' }]) },
    ]) {
      expect((await call(m, query)).status).toBe(400)
    }
    expect(sqls).toEqual([])
    expect((await call(m, { sortBy: 'name', sortOrder: 'desc' })).status).toBe(200)
  })

  it('refuses a filter OBJECT whose key is not a known column (MariaDB)', async () => {
    const { m, sqls } = bootMariaDb()
    const out = await call(m, { filters: JSON.stringify({ 'id` = 1 OR SLEEP(5) OR `id': 'x' }) })
    expect(out.status).toBe(400)
    expect((await call(m, { filters: JSON.stringify({ nickname: 'x' }) })).status).toBe(400)
    expect(sqls).toEqual([])
    expect((await call(m, { filters: JSON.stringify({ name: 'Ada' }) })).status).toBe(200)
  })

  it('refuses a browser filter, sort or search on a credential column (I2)', async () => {
    const { m, sqls } = bootMariaDb()
    for (const query of [
      { filters: JSON.stringify([{ source: 'password', operand: '>', destination: '$2b$10$a' }]) },
      { sortBy: 'password' },
      { query: 'abc', queryColumns: JSON.stringify(['name', 'password']) },
    ]) {
      expect((await call(m, query)).status).toBe(400)
    }
    expect(sqls).toEqual([])
  })

  it('refuses a MongoDB operator or a dotted path a request names as a field', async () => {
    const MONGO: UIDLDataSource = {
      id: 'ds-mongo',
      name: 'M',
      type: 'mongodb',
      config: { connectionString: 'mongodb://h/db', database: 'db', ...SCHEMA },
    }
    const finds: any[] = []
    class MongoClient {
      public async connect(): Promise<void> {
        return
      }
      public async close(): Promise<void> {
        return
      }
      public db() {
        return {
          collection: () => ({
            find: (filter: any) => {
              finds.push(filter)
              const cursor: any = {
                sort: () => cursor,
                skip: () => cursor,
                limit: () => cursor,
                project: () => cursor,
                toArray: async (): Promise<any[]> => [],
              }
              return cursor
            },
            countDocuments: async () => 0,
          }),
        }
      }
    }
    const m: any = { exports: {} }
    new Function(
      'require',
      'module',
      'exports',
      'process',
      'console',
      'MongoClient',
      'ObjectId',
      toModule(generateDataSourceFetcherWithCore(MONGO, 'customers', false, PUBLIC))
    )(
      fakeRequire,
      m,
      m.exports,
      { env: { NEXTAUTH_SECRET: 'server-secret' } },
      quiet,
      MongoClient,
      class {}
    )
    for (const filters of [
      { $where: 'sleep(5000) || true' },
      { 'name.first': 'x' },
      { nickname: 'x' },
    ]) {
      expect((await call(m, { filters: JSON.stringify(filters) })).status).toBe(400)
    }
    expect(finds).toEqual([])
  })

  it('a public table never answers a filter or a search on its credential column (TeleportHQ route)', async () => {
    const TQ: UIDLDataSource = {
      id: 'ds-tq',
      name: 'TQ',
      type: 'teleport',
      config: {
        selectedTables: {
          members: { columns: [{ name: 'id' }, { name: 'name' }, { name: 'password' }] },
        },
      },
    }
    const sqls: string[] = []
    class Client {
      public async connect(): Promise<void> {
        return
      }
      public async end(): Promise<void> {
        return
      }
      public async query(sql: string) {
        sqls.push(sql)
        if (/information_schema/i.test(sql)) {
          return { rows: [{ column_name: 'name' }, { column_name: 'password' }] }
        }
        return { rows: [{ id: 1, name: 'Ada', password: '$2b$10$abc' }] }
      }
    }
    const m: any = { exports: {} }
    new Function(
      'require',
      'module',
      'exports',
      'process',
      'console',
      'Client',
      'pgTypes',
      toModule(generateDataSourceFetcherWithCore(TQ, 'members', false, publicExposure(['members'])))
    )(
      fakeRequire,
      m,
      m.exports,
      { env: { NEXTAUTH_SECRET: 'server-secret', TELEPORT_DB_HOST: 'h' } },
      quiet,
      Client,
      null
    )
    const filtered = await call(m, {
      filters: JSON.stringify([{ source: 'password', operand: '>', destination: '$2b$10$a' }]),
    })
    expect(filtered.status).toBe(400)
    sqls.length = 0
    const searched = await call(m, { query: '$2b$10$ab' })
    expect(searched.status).toBe(200)
    const read = sqls.filter((sql) => /FROM "?members"?/i.test(sql)).pop() as string
    expect(read).toContain('"name"::text ILIKE')
    expect(read).not.toContain('password')
    expect(searched.body.data[0]).not.toHaveProperty('password')
  })
})

describe('fix round 3: projections, searches, document values and request bodies (N2, N3, N7, N8)', () => {
  const SCHEMA = {
    selectedTables: {
      customers: {
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'name', type: 'text' },
          { name: 'email', type: 'varchar(255)' },
          { name: 'password', type: 'text' },
        ],
      },
    },
  }
  const PUBLIC = publicExposure(['customers'])
  const toModule = (esm: string): string =>
    esm
      .replace(/^import .*$/gm, '')
      .replace(/^export \{[^}]*\}\s*$/m, '')
      .replace(/^export default \{[^}]*\}\s*$/m, '')
      .concat('\nmodule.exports = { handler: handler }')
  const call = async (m: any, query: any, extra: { method?: string; body?: any } = {}) => {
    const out: any = {}
    const res: any = {
      status(c: number) {
        out.status = c
        return res
      },
      json(p: any) {
        out.body = p
        return res
      },
      setHeader: (): any => res,
    }
    await m.exports.handler(
      { method: extra.method || 'GET', headers: {}, query, body: extra.body },
      res
    )
    return out
  }
  const fakeRequire = (name: string): any => (name === 'crypto' ? require('crypto') : {})
  const ENV = { env: { NEXTAUTH_SECRET: 'server-secret' } }

  const bootSupabase = () => {
    const SUPA: UIDLDataSource = {
      id: 'ds-supa',
      name: 'S',
      type: 'supabase',
      config: { supabaseUrl: 'https://x.supabase.co', serviceRoleKey: 'k', ...SCHEMA },
    }
    const projections: string[] = []
    const ors: string[] = []
    const builder = (): any => {
      const b: any = {
        select(projection: string) {
          projections.push(projection)
          return b
        },
        or(expression: string) {
          ors.push(expression)
          return b
        },
        eq: () => b,
        neq: () => b,
        order: () => b,
        limit: () => b,
        range: () => b,
        in: () => b,
        single: () => b,
        then(resolve: any) {
          resolve({ data: [{ id: 1, name: 'Ada', email: 'a@x', password: '$2b$h' }], error: null })
        },
      }
      return b
    }
    const createClient = () => ({ from: () => builder() })
    const m: any = { exports: {} }
    new Function(
      'require',
      'module',
      'exports',
      'process',
      'console',
      'createClient',
      toModule(generateDataSourceFetcherWithCore(SUPA, 'customers', false, PUBLIC))
    )(fakeRequire, m, m.exports, ENV, quiet, createClient)
    return { m, projections, ors }
  }

  it('Supabase: a projection is the bare star or plain known columns — no alias, no embedded table (N2)', async () => {
    const { m, projections } = bootSupabase()
    for (const select of [
      'alias:password',
      'name:password',
      '*,users(email,password)',
      'users!inner(email)',
      'name::text',
      'nickname',
      'password',
    ]) {
      expect({ select, status: (await call(m, { select })).status }).toEqual({
        select,
        status: 400,
      })
    }
    expect(projections).toEqual([])
    const plain = await call(m, { select: 'id, name' })
    expect(plain.status).toBe(200)
    expect(projections).toContain('id, name')
    expect(plain.body.data[0]).not.toHaveProperty('password')
  })

  it("Supabase: a search naming no columns runs over the schema's text columns, never a credential (N3)", async () => {
    const { m, ors } = bootSupabase()
    const out = await call(m, { query: 'abc' })
    expect(out.status).toBe(200)
    const expression = ors.pop() as string
    expect(expression).toMatch(/\bname\.ilike\./)
    expect(expression).toMatch(/\bemail\.ilike\./)
    expect(expression).not.toMatch(/password|\bid\.ilike/)
  })

  it('MariaDB: a search naming no columns runs over the schema, never a credential (N3)', async () => {
    const MARIA: UIDLDataSource = {
      id: 'ds-maria',
      name: 'Shop',
      type: 'mariadb',
      config: { host: 'h', port: 3306, user: 'u', password: 'p', database: 'shop', ...SCHEMA },
    }
    const sqls: string[] = []
    const mariadb = {
      createConnection: async (): Promise<any> => ({
        query: async (sql: string): Promise<any[]> => {
          sqls.push(sql)
          if (/information_schema/i.test(sql)) {
            return ['id', 'name', 'email', 'password'].map((name) => ({ COLUMN_NAME: name }))
          }
          return []
        },
        end: async (): Promise<void> => undefined,
      }),
    }
    const m: any = { exports: {} }
    new Function(
      'require',
      'module',
      'exports',
      'process',
      'console',
      'mariadb',
      toModule(generateDataSourceFetcherWithCore(MARIA, 'customers', false, PUBLIC))
    )(fakeRequire, m, m.exports, ENV, quiet, mariadb)
    expect((await call(m, { query: '$2b$10$' })).status).toBe(200)
    const search = sqls.filter((sql) => /LIKE/i.test(sql)).pop() as string
    expect(search).toContain('`name`')
    expect(search).not.toContain('password')
    expect(sqls.some((sql) => /information_schema/i.test(sql))).toBe(false)
  })

  const bootMongo = () => {
    const MONGO: UIDLDataSource = {
      id: 'ds-mongo',
      name: 'M',
      type: 'mongodb',
      config: { connectionString: 'mongodb://h/db', database: 'db', ...SCHEMA },
    }
    const finds: any[] = []
    class MongoClient {
      public async connect(): Promise<void> {
        return
      }
      public async close(): Promise<void> {
        return
      }
      public db() {
        return {
          collection: () => ({
            find: (filter: any) => {
              finds.push(filter)
              const cursor: any = {
                sort: () => cursor,
                skip: () => cursor,
                limit: () => cursor,
                project: () => cursor,
                toArray: async (): Promise<any[]> => [],
              }
              return cursor
            },
            countDocuments: async () => 0,
            findOne: async (): Promise<any> => ({ _id: 'x', name: 'Ada', password: '$2b$h' }),
          }),
        }
      }
    }
    const m: any = { exports: {} }
    new Function(
      'require',
      'module',
      'exports',
      'process',
      'console',
      'MongoClient',
      'ObjectId',
      toModule(generateDataSourceFetcherWithCore(MONGO, 'customers', false, PUBLIC))
    )(fakeRequire, m, m.exports, ENV, quiet, MongoClient, class {})
    return { m, finds }
  }

  it('MongoDB: a search is matched as text over non-credential fields (N3)', async () => {
    const { m, finds } = bootMongo()
    expect((await call(m, { query: '^\\$2b.*(a+)+$' })).status).toBe(200)
    const filter = finds.pop()
    const fields = filter.$or.map((condition: any) => Object.keys(condition)[0])
    expect(fields).toEqual(expect.arrayContaining(['name', 'email']))
    expect(fields).not.toContain('password')
    const pattern = filter.$or[0][fields[0]].$regex
    expect(pattern).toBe('\\^\\\\\\$2b\\.\\*\\(a\\+\\)\\+\\$')
    expect(new RegExp(pattern).test('x^\\$2b.*(a+)+$y')).toBe(true)
  })

  it('MongoDB: a filter value is a plain value or a list of them, never an operator object (N8)', async () => {
    const { m, finds } = bootMongo()
    for (const filters of [
      [{ source: 'name', destination: { $ne: null as string | null } }],
      [{ source: 'name', destination: [{ $gt: '' }] }],
      { name: { $regex: '^A' } },
      [
        {
          type: 'group',
          operator: 'or',
          children: [{ source: 'email', destination: { $exists: true } }],
        },
      ],
    ]) {
      expect((await call(m, { filters: JSON.stringify(filters) })).status).toBe(400)
    }
    expect(finds).toEqual([])
    expect(
      (await call(m, { filters: JSON.stringify([{ source: 'name', destination: ['Ada', 'Bo'] }]) }))
        .status
    ).toBe(200)
    expect((await call(m, { filters: JSON.stringify({ name: 'Ada' }) })).status).toBe(200)
  })

  it('CSV without a schema: a search naming no columns reads the bound fields only, else it is refused (N3)', async () => {
    const CSV: UIDLDataSource = {
      id: 'ds-csv',
      name: 'C',
      type: 'csv-file',
      config: {
        parsedData: [
          { name: 'Ada', password: 'hash-ada' },
          { name: 'Bo', password: 'hash-bo' },
        ],
      },
    }
    const boot = (fields?: string[]) => {
      const exposure = publicExposure([], ['ds-csv'])
      if (fields) {
        exposure.dataExposure.dataSources['ds-csv'] = publicRead({ fields })
      }
      const m: any = { exports: {} }
      new Function(
        'require',
        'module',
        'exports',
        'process',
        'console',
        toModule(generateDataSourceFetcherWithCore(CSV, '', false, exposure))
      )(fakeRequire, m, m.exports, ENV, quiet)
      return m
    }
    const bound = await call(boot(['name']), { query: 'hash' })
    expect(bound.status).toBe(200)
    expect(bound.body.data).toEqual([])
    expect((await call(boot(['name']), { query: 'ada' })).body.data).toHaveLength(1)
    expect((await call(boot(), { query: 'hash' })).status).toBe(400)
  })

  it("REST configured for POST: a browser's body never goes upstream, the configured one does (N7)", async () => {
    const REST: UIDLDataSource = {
      id: 'ds-rest',
      name: 'R',
      type: 'rest-api',
      config: {
        url: 'https://api.example.test/graphql',
        method: 'POST',
        bodyType: 'json',
        // The editor stores the configured body as its text.
        body: JSON.stringify({ query: '{ products { id name } }' }),
        authorization: { type: 'bearer', credentials: { token: 'SERVER-TOKEN' } },
      },
    }
    const sent: any[] = []
    const fetch = async (url: string, options: any) => {
      sent.push({ url, options })
      return { ok: true, status: 200, json: async (): Promise<any[]> => [] }
    }
    const m: any = { exports: {} }
    new Function(
      'require',
      'module',
      'exports',
      'process',
      'console',
      'fetch',
      toModule(generateDataSourceFetcherWithCore(REST, '', false, publicExposure([], ['ds-rest'])))
    )(fakeRequire, m, m.exports, ENV, quiet, fetch)
    const out = await call(
      m,
      {},
      { method: 'POST', body: { query: '{ users { email password } }' } }
    )
    expect(out.status).toBe(200)
    expect(sent).toHaveLength(1)
    expect(String(sent[0].options.body)).toContain('products')
    expect(String(sent[0].options.body)).not.toContain('users')
  })
})
