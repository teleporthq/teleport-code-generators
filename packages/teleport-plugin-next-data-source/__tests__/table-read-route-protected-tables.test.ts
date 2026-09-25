/* tslint:disable:function-constructor */
import type { UIDLAuthentication } from '@teleporthq/teleport-types'
import { TableAccess } from '@teleporthq/teleport-shared'
import { generateDataSourceFetcherWithCore } from '../src/data-source-fetchers'
import { buildProductTransformOptions } from '../src/transformations'

/**
 * Every table a page binds gets a read route (`/api/teleport-<table>-<source>`
 * plus a `-count` twin) that serves the whole table, and any single SELECT
 * through `?rawQuery=`, to whoever asks. For gift cards and voucher codes that
 * is a list of cash. The route now refuses those tables to anyone but a server
 * segment carrying the app secret or a signed-in member of a trusted role —
 * the generated admin — and the verdict is a status code from the executed
 * route, not a substring of its source.
 */

const SECRET = 'server-secret'
const ADMIN_ROLES = ['admin']

interface RouteResult {
  status: number
  body: any
  queries: string[]
}

interface FakeSession {
  role?: string
}

type RouteRunner = (params: {
  handler: 'handler' | 'getCount'
  query?: Record<string, string>
  headers?: Record<string, string>
  session?: FakeSession | null
}) => Promise<RouteResult>

type BootedRoute = RouteRunner & {
  serverCall: (name: 'fetchData' | 'fetchCount') => Promise<unknown>
}

function bootTableRoute(
  tableName: string,
  trustedReaderRoles: string[],
  options: { appSecret?: string | null; rows?: any[] } = {}
): BootedRoute {
  const appSecret = options.appSecret === undefined ? SECRET : options.appSecret
  const dataSource = {
    id: 'ds-1',
    name: 'db',
    type: 'teleport' as const,
    config: {
      host: 'teleporthq.secrets.TELEPORT_DB_HOST',
      port: 5432,
      user: 'teleporthq.secrets.TELEPORT_DB_USER',
      password: 'teleporthq.secrets.TELEPORT_DB_PASSWORD',
      database: 'teleporthq.secrets.TELEPORT_DB_NAME',
      selectedTables: { [tableName]: { columns: [{ name: 'id', type: 'uuid' }] } },
    },
  }
  const esm = generateDataSourceFetcherWithCore(dataSource as never, tableName, false, {
    trustedReaderRoles,
  })
  // The route is an ES module; run it as a script with the same bindings.
  const code = esm
    .replace("import { Client } from 'pg'", "const { Client } = require('pg')")
    .replace(/^export default async function handler/m, 'async function handler')
    .replace(/^export \{[^}]*\}\s*$/m, '')
    .replace(/^export default \{[^}]*\}\s*$/m, '')
    .concat(
      '\nmodule.exports = { handler: handler, getCount: getCount, fetchData: fetchData, fetchCount: fetchCount }'
    )
  expect(code).not.toMatch(/^export /m)

  const queries: string[] = []
  let session: FakeSession | null = null
  class FakeClient {
    public async connect(): Promise<void> {
      return
    }
    public async end(): Promise<void> {
      return
    }
    public async query(sql: string): Promise<{ rows: any[]; rowCount: number }> {
      queries.push(sql)
      if (/information_schema/i.test(sql)) {
        return { rows: [], rowCount: 0 }
      }
      if (/^SELECT COUNT/i.test(sql)) {
        return { rows: [{ count: '0' }], rowCount: 1 }
      }
      const rows = options.rows || []
      return { rows, rowCount: rows.length }
    }
  }
  const fakeRequire = (name: string): any => {
    if (name === 'pg') {
      return { Client: FakeClient }
    }
    if (name === 'next-auth/jwt') {
      return { getToken: async () => (session ? { sub: 'u1', role: session.role } : null) }
    }
    throw new Error('unexpected require: ' + name)
  }
  const moduleObj: { exports: any } = { exports: {} }
  new Function('require', 'module', 'exports', 'process', 'console', code)(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    {
      env: {
        ...(appSecret ? { NEXTAUTH_SECRET: appSecret } : {}),
        TELEPORT_DB_HOST: 'h',
        TELEPORT_DB_USER: 'u',
        TELEPORT_DB_PASSWORD: 'p',
        TELEPORT_DB_NAME: 'd',
      },
    },
    { error: () => undefined, warn: () => undefined, log: () => undefined }
  )

  const serverCall = async (name: 'fetchData' | 'fetchCount'): Promise<unknown> => {
    queries.length = 0
    session = null
    return moduleObj.exports[name]({})
  }

  const run: RouteRunner = async ({
    handler,
    query = {},
    headers = {},
    session: requestSession = null,
  }) => {
    queries.length = 0
    session = requestSession
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
    const req = {
      method: 'GET',
      query,
      headers: {
        cookie: requestSession ? 'next-auth.session-token=signed' : '',
        ...headers,
      },
    }
    await moduleObj.exports[handler](req, res)
    return { status, body: responseBody, queries: queries.slice() }
  }
  const booted = run as BootedRoute
  booted.serverCall = serverCall
  return booted
}

const internal = { 'x-internal-data-secret': SECRET }

describe('per-table read routes — money and customer tables are read only by the admin or the server', () => {
  const giftCards = bootTableRoute('teleport_gift_cards', ADMIN_ROLES)
  const vouchers = bootTableRoute('teleport_vouchers', ADMIN_ROLES)
  const products = bootTableRoute('teleport_products', ADMIN_ROLES)
  // The customers' own records: only the generated admin lists them from a
  // browser; a buyer's order page reads through a server segment.
  const orders = bootTableRoute('teleport_orders', ADMIN_ROLES)
  const users = bootTableRoute('users', ADMIN_ROLES)
  const reviews = bootTableRoute('teleport_product_reviews', ADMIN_ROLES)

  it('refuses a guest before the database is touched, on the list and the count', async () => {
    for (const route of [giftCards, vouchers, orders, users, reviews]) {
      const list = await route({ handler: 'handler' })
      expect(list.status).toBe(401)
      expect(list.queries).toEqual([])
      const count = await route({ handler: 'getCount' })
      expect(count.status).toBe(401)
      expect(count.queries).toEqual([])
    }
  })

  it('refuses a signed-in shopper, and serves a signed-in administrator', async () => {
    for (const route of [giftCards, orders, users]) {
      expect((await route({ handler: 'handler', session: { role: 'user' } })).status).toBe(403)
      expect((await route({ handler: 'getCount', session: { role: 'user' } })).status).toBe(403)
    }

    const admin = await giftCards({ handler: 'handler', session: { role: 'admin' } })
    expect(admin.status).toBe(200)
    expect(admin.queries.some((sql) => /FROM teleport_gift_cards/i.test(sql))).toBe(true)
    expect((await giftCards({ handler: 'getCount', session: { role: 'admin' } })).status).toBe(200)
    expect((await orders({ handler: 'handler', session: { role: 'admin' } })).status).toBe(200)
    expect((await users({ handler: 'getCount', session: { role: 'admin' } })).status).toBe(200)
  })

  it('serves a server segment that presents the app secret', async () => {
    expect((await giftCards({ handler: 'handler', headers: internal })).status).toBe(200)
    expect((await vouchers({ handler: 'getCount', headers: internal })).status).toBe(200)
  })

  it("serves the module's own server-side fetchData, which getStaticProps and page-load workflows call", async () => {
    await expect(giftCards.serverCall('fetchData')).resolves.toEqual([])
    await expect(vouchers.serverCall('fetchCount')).resolves.toBe(0)
  })

  it('refuses a browser every raw statement, whatever it names, once the app has a secret', async () => {
    // Generated pages never send one: their raw queries run in getStaticProps
    // (the module's own fetchData) or in server segments. So no statement scan
    // has to be right about what a browser sends — admin sessions included.
    for (const rawQuery of [
      'SELECT code FROM teleport_gift_cards',
      "SELECT 1 FROM teleport_products WHERE name = 'teleport_gift_cards'",
      'SELECT code AS "x\'", balance FROM teleport_gift_cards -- \'',
    ]) {
      for (const session of [null, { role: 'user' }, { role: 'admin' }]) {
        const result = await products({ handler: 'handler', query: { rawQuery }, session })
        expect(result.status).toBe(403)
        expect(result.queries).toEqual([])
      }
      expect(
        (await products({ handler: 'handler', query: { rawQuery }, headers: internal })).status
      ).toBe(200)
    }
  })

  it('refuses a column the query string made up, before the database is touched', async () => {
    // Filter and sort columns are spliced into the statement (values are
    // bound): a sub-select there would read any table, and the error message
    // Postgres returns would carry what it read.
    const smuggled = "CAST((SELECT string_agg(code, ',') FROM teleport_gift_cards) AS int)"
    for (const query of [
      { filters: JSON.stringify([{ source: smuggled, operand: '=', destination: 1 }]) },
      { sorts: JSON.stringify([{ field: smuggled, order: 'asc' }]) },
      { sortBy: smuggled },
    ]) {
      const result = await products({ handler: 'handler', query })
      expect(result.status).toBe(400)
      expect(result.queries).toEqual([])
    }
    // A row count is a number or nothing: the sub-select never reaches SQL.
    const limited = await products({
      handler: 'handler',
      query: { limit: '(SELECT 1 FROM teleport_vouchers)' },
    })
    expect(limited.status).toBe(200)
    expect(limited.queries.join('\n')).not.toMatch(/teleport_vouchers|LIMIT/)
    const count = await products({
      handler: 'getCount',
      query: { filters: JSON.stringify([{ source: smuggled, operand: '=', destination: 1 }]) },
    })
    expect(count.status).toBe(400)
    expect(count.queries).toEqual([])
    // Real columns still filter and sort.
    const plain = await products({
      handler: 'handler',
      query: {
        filters: JSON.stringify([{ source: 'status', operand: '=', destination: 'active' }]),
        sorts: JSON.stringify([{ field: 'created_at', order: 'desc' }]),
        limit: '12',
      },
    })
    expect(plain.status).toBe(200)
    expect(plain.queries.join('\n')).toMatch(/WHERE status = \$1/)
    expect(plain.queries.join('\n')).toMatch(/LIMIT 12/)
  })

  it('keeps scanning a raw statement in an app with no secret to tell callers apart', async () => {
    // No authentication, hence no store and no admin: the old scan still
    // stands between a raw statement and any protected table.
    const open = bootTableRoute('teleport_products', ADMIN_ROLES, { appSecret: null })
    for (const rawQuery of [
      'SELECT code FROM teleport_gift_cards',
      'SELECT * FROM "teleport_vouchers"',
      'WITH c AS (SELECT id FROM public.teleport_voucher_redemptions) SELECT * FROM c',
      "SELECT 1 /* teleport_products */ FROM Teleport_Gift_Card_Transactions -- 'x'",
      // The rendered gift-card email carries the full code.
      'SELECT body_html FROM teleport_sent_emails',
      // ⛔ A dollar-quoted body holding a lone apostrophe used to open a
      // "literal" that swallowed the rest of the statement, table name
      // included — Postgres runs it happily.
      "SELECT $$it's$$, code FROM teleport_gift_cards",
      "SELECT $tag$don't$tag$ AS a, balance FROM teleport_gift_cards",
      // An escape string, and an unterminated literal (unreadable ⇒ refused).
      "SELECT E'\\'' AS a, code FROM teleport_gift_cards",
      "SELECT 'unterminated, code FROM teleport_products",
      // Spellings a name scan cannot see: a Unicode-escaped identifier (\\005f
      // is the underscore), and functions that run SQL text or dump tables.
      'SELECT code FROM U&"teleport\\005fgift_cards"',
      "SELECT query_to_xml('select code from teleport_gift_cards', true, false, '')",
      "SELECT database_to_xml(true, false, '')",
      // Quote and comment markers inside a quoted identifier, `$` and `E`
      // inside an identifier, and the planner statistics.
      'SELECT code AS "x\'", balance FROM teleport_gift_cards -- \'',
      'SELECT 1 AS "--", code, balance FROM teleport_gift_cards',
      'SELECT code AS a$b$, balance FROM teleport_gift_cards AS g$b$',
      "SELECT CASE WHEN true THEN 'a' ELSE'\\' END, code FROM teleport_vouchers -- '",
      "SELECT histogram_bounds::text FROM pg_stats WHERE tablename = 'teleport_vouchers'",
    ]) {
      const guest = await open({ handler: 'handler', query: { rawQuery } })
      expect(guest.status).toBe(401)
      expect(guest.queries).toEqual([])
    }
    // A readable statement that names nothing protected still passes, dollar
    // quotes and nested comments included.
    for (const rawQuery of [
      "SELECT 1 FROM teleport_products WHERE name = 'teleport_gift_cards'",
      "SELECT $$it's fine$$ /* a /* nested */ note */ FROM teleport_products",
    ]) {
      expect((await open({ handler: 'handler', query: { rawQuery } })).status).toBe(200)
    }
  })

  it('leaves every other read exactly as it was', async () => {
    expect((await products({ handler: 'handler' })).status).toBe(200)
    expect((await products({ handler: 'getCount' })).status).toBe(200)
  })

  it('serves the automatic-discount table to no browser but the admin — its one public shape is the data API feed', async () => {
    const discounts = bootTableRoute('teleport_discounts', ADMIN_ROLES)
    const guest = await discounts({ handler: 'handler' })
    expect(guest.status).toBe(401)
    expect(guest.queries).toEqual([])
    expect((await discounts({ handler: 'getCount', session: { role: 'user' } })).status).toBe(403)
    expect((await discounts({ handler: 'handler', session: { role: 'admin' } })).status).toBe(200)
    // Nor through another table's raw statement.
    const rawQuery = "SELECT name, usage_count FROM teleport_discounts WHERE status = 'draft'"
    expect((await products({ handler: 'handler', query: { rawQuery } })).status).toBe(403)
    expect(
      (await products({ handler: 'handler', query: { rawQuery }, session: { role: 'user' } }))
        .status
    ).toBe(403)
  })

  it('admits nobody from a browser when the project has no admin panel', async () => {
    const noAdmin = bootTableRoute('teleport_gift_cards', [])
    expect((await noAdmin({ handler: 'handler', session: { role: 'admin' } })).status).toBe(403)
    expect((await noAdmin({ handler: 'handler', headers: internal })).status).toBe(200)
  })
})

const ADMIN_PANEL_AUTH: UIDLAuthentication = {
  enabled: true,
  dataSourceId: 'ds-1',
  dataSourceType: 'teleport',
  passwordAuthEnabled: true,
  providers: [],
  roles: ['admin', 'user'],
  tables: {},
  pageProtection: {},
  folderProtection: {
    f1: {
      requiresAuth: true,
      allowedRoles: ['admin'],
      folderName: 'admin-panel',
      parentId: null,
      children: {},
    },
  },
  authPages: {},
  callbackBaseUrl: '',
  envKeys: {},
  customUserProperties: [],
}

describe('per-table read routes — the users table never serves its credentials', () => {
  const userRow = {
    id: 'u1',
    name: 'Ada',
    password: '$2b$10$hash',
    access_token: 'ya29.token',
    refresh_token: '1//refresh',
    id_token: 'eyJ.id',
    session_state: 's',
    token_type: 'Bearer',
    scope: 'email',
    expires_at: 1790000000,
  }

  it("keeps the profile and drops the password and tokens, for a browser and for a page's props", async () => {
    // Whatever fetchData returns is serialized into the page, so the server
    // path strips them too.
    const users = bootTableRoute('users', ADMIN_ROLES, { rows: [userRow] })
    const read = await users({ handler: 'handler', session: { role: 'admin' } })
    expect(read.status).toBe(200)
    expect(read.body.data).toEqual([{ id: 'u1', name: 'Ada', __rowNumber: 1 }])
    const props = (await users.serverCall('fetchData')) as Array<Record<string, unknown>>
    expect(props.map((row) => Object.keys(row).sort())).toEqual([['__rowNumber', 'id', 'name']])
  })

  it('drops the unambiguous credential names from a raw statement, whatever table it read', async () => {
    const products = bootTableRoute('teleport_products', ADMIN_ROLES, {
      rows: [{ id: 'p1', expires_at: '2026-12-31', password: 'x', access_token: 'y' }],
    })
    const result = await products({
      handler: 'handler',
      query: { rawQuery: 'SELECT p.*, u.password FROM teleport_products p' },
      headers: internal,
    })
    expect(result.body.data).toEqual([{ id: 'p1', expires_at: '2026-12-31' }])
  })
})

describe('buildProductTransformOptions — the roles reach the emitted module', () => {
  it("reads the project's auth under BOTH names, because a ProjectUIDL spells it `authentication`", () => {
    // The project plugins (data-source utility, global-state API routes, page
    // state fetchers) hand this the UIDL itself.
    expect(buildProductTransformOptions({ authentication: ADMIN_PANEL_AUTH })).toMatchObject({
      trustedReaderRoles: ['admin'],
    })
    expect(buildProductTransformOptions({ auth: ADMIN_PANEL_AUTH })).toMatchObject({
      trustedReaderRoles: ['admin'],
    })
    expect(buildProductTransformOptions({})).toMatchObject({ trustedReaderRoles: [] })
  })

  it("emits a money table's route with a role list its admin panel can pass", async () => {
    const options = buildProductTransformOptions({ authentication: ADMIN_PANEL_AUTH })
    const giftCards = bootTableRoute('teleport_gift_cards', options.trustedReaderRoles || [])
    expect((await giftCards({ handler: 'handler', session: { role: 'admin' } })).status).toBe(200)
    expect((await giftCards({ handler: 'handler', session: { role: 'user' } })).status).toBe(403)
  })
})

describe('resolveTrustedReaderRoles', () => {
  it('reads the roles off the admin folder and the admin pages, and nothing else', () => {
    const roles = TableAccess.resolveTrustedReaderRoles({
      enabled: true,
      dataSourceId: 'ds-1',
      dataSourceType: 'teleport',
      passwordAuthEnabled: true,
      providers: [],
      roles: ['admin', 'staff', 'user'],
      tables: {},
      pageProtection: {
        p1: {
          requiresAuth: true,
          allowedRoles: ['admin'],
          pageName: 'dashboard',
          route: '/admin/dashboard',
        },
        p2: {
          requiresAuth: true,
          allowedRoles: ['staff'],
          pageName: 'orders',
          route: '/admin/orders',
        },
        p3: { requiresAuth: true, allowedRoles: ['user'], pageName: 'profile', route: '/profile' },
        p4: {
          requiresAuth: true,
          allowedRoles: ['user'],
          pageName: 'administration',
          route: '/administration',
        },
      },
      folderProtection: {
        f1: {
          requiresAuth: true,
          allowedRoles: ['admin'],
          folderName: 'admin-panel',
          parentId: null,
          children: {},
        },
        f2: {
          requiresAuth: true,
          allowedRoles: ['user'],
          folderName: 'members',
          parentId: null,
          children: {},
        },
      },
      authPages: {},
      callbackBaseUrl: '',
      envKeys: {},
      customUserProperties: [],
    })
    expect(roles).toEqual(['admin', 'staff'])
    expect(TableAccess.resolveTrustedReaderRoles(undefined)).toEqual([])
  })
})
