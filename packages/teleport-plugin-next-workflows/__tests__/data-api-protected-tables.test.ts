/* tslint:disable:function-constructor */
import { parse } from '@babel/parser'
import { generateDataAPIRoute } from '../src/data-api-route-generator'
import { dataSelect } from '../src/nodes/data/data-select'
import { dataCount } from '../src/nodes/data/data-count'
import { dataCreateItem } from '../src/nodes/data/data-create-item'
import { dataRawQuery } from '../src/nodes/data/data-raw-query'
import { dataUpdateItem } from '../src/nodes/data/data-update-item'
import { dataDeleteItem } from '../src/nodes/data/data-delete-item'
import { accountSignup } from '../src/nodes/account/account-signup'
import { generateSignupRouteFile } from '../src/auth-generator'
import { resolveAuthUsersTableName } from '../src/workflow-project-plugin'

/**
 * The generated `/api/data/<ds>/<op>` route is reachable from any browser, so
 * the tables that ARE money (gift cards and their ledger) are refused to it
 * outright, and the tables that decide how much money is given away
 * (vouchers, automatic discounts, the redemption ledger) are refused every
 * write — unless the request carries the app's internal secret, which only a
 * server-side workflow node can read. Executed against a fake pg client: the
 * verdict is a status code, not a substring.
 */

const SECRET = 'server-secret'

interface RouteResult {
  status: number
  body: any
  queries: string[]
}

type RouteRunner = (
  operation: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>
) => Promise<RouteResult>

function bootRoute(
  secret: string | undefined,
  options: { authUsersTableName?: string; rows?: any[] } = {}
): RouteRunner {
  const code = generateDataAPIRoute(options)
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
  const moduleObj: { exports: any } = { exports: {} }
  const fakeRequire = (name: string): any => {
    if (name === 'pg') {
      return { Client: FakeClient }
    }
    // The users-row guard resolves the caller's session; nobody is signed in
    // in these tests.
    if (name === 'next-auth/jwt') {
      return { getToken: async () => null }
    }
    throw new Error('unexpected require: ' + name)
  }
  new Function('require', 'module', 'exports', 'process', 'console', code)(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    { env: { NEXTAUTH_SECRET: secret, TELEPORT_DB_CONNECTION_STRING: 'postgresql://x' } },
    { error: () => undefined, warn: () => undefined, log: () => undefined }
  )
  const handler = moduleObj.exports
  return async (operation, body, headers = {}) => {
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
    await handler({ method: 'POST', query: { params: ['ds-1', operation] }, headers, body }, res)
    return { status, body: responseBody, queries: queries.slice() }
  }
}

const internal = { 'x-internal-data-secret': SECRET }
// The AI data-query node: server-side, so it may run raw SQL, but the SQL is a
// model's answer to a visitor — the statement scan still applies to it.
const restricted = { 'x-internal-data-secret': SECRET, 'x-tq-restricted-sql': '1' }

describe('data API — money tables are server-only', () => {
  const run = bootRoute(SECRET)

  it('still emits the whole route — a stray backtick would cut the file off', () => {
    const code = generateDataAPIRoute()
    expect(code).toContain('module.exports = async function handler(req, res)')
    expect(() => parse(code, { sourceType: 'script' })).not.toThrow()
  })

  it('refuses a browser every operation on the gift-card, voucher and customer-record tables', async () => {
    for (const tableName of [
      'teleport_gift_cards',
      'teleport_gift_card_transactions',
      'teleport_vouchers',
      'teleport_voucher_redemptions',
      // A customer's own records reach a browser only through a server
      // segment (their order page) or the admin's session — the list is
      // every buyer's name, address and email.
      'users',
      'teleport_orders',
      'teleport_order_items',
      'teleport_invoices',
      'teleport_events',
      'teleport_shipments',
      'teleport_withdrawal_requests',
      'teleport_abandoned_carts',
      'teleport_cart',
      'teleport_favourites',
      'teleport_product_reviews',
    ]) {
      for (const [operation, body] of [
        ['select', { tableName }],
        ['count', { tableName }],
        ['create', { tableName, columnMappings: { balance: 1 } }],
        ['update', { tableName, columnMappings: { balance: 1 }, filters: [] }],
        ['delete', { tableName, filters: [] }],
      ] as Array<[string, Record<string, unknown>]>) {
        const result = await run(operation, body)
        expect(result.status).toBe(403)
        if (operation === 'select' || operation === 'count') {
          expect(result.body.error).toContain(tableName)
        }
        // Refused BEFORE the database is touched.
        expect(result.queries).toEqual([])
      }
    }
  })

  it('refuses the same however the table is spelled', async () => {
    for (const tableName of [
      '"teleport_gift_cards"',
      'public.teleport_gift_cards',
      'TELEPORT_GIFT_CARDS',
    ]) {
      expect((await run('select', { tableName })).status).toBe(403)
    }
  })

  it('lets a server-side node through with the internal secret', async () => {
    const result = await run('select', { tableName: 'teleport_gift_cards' }, internal)
    expect(result.status).toBe(200)
    expect(result.queries[0]).toContain('FROM teleport_gift_cards')
    expect(
      (
        await run(
          'update',
          {
            tableName: 'teleport_vouchers',
            columnMappings: { usage_count: 1 },
            filters: [{ field: 'id', value: 'v1' }],
          },
          internal
        )
      ).status
    ).toBe(200)
  })

  it('does not take a wrong secret, nor an empty one when none is configured', async () => {
    expect(
      (
        await run(
          'select',
          { tableName: 'teleport_gift_cards' },
          { 'x-internal-data-secret': 'nope' }
        )
      ).status
    ).toBe(403)
    const unconfigured = bootRoute(undefined)
    expect(
      (
        await unconfigured(
          'select',
          { tableName: 'teleport_gift_cards' },
          { 'x-internal-data-secret': '' }
        )
      ).status
    ).toBe(403)
  })

  it('refuses a browser every write on the automatic-discount table, but not a read', async () => {
    const tableName = 'teleport_discounts'
    expect((await run('create', { tableName, columnMappings: { name: 'X' } })).status).toBe(403)
    expect(
      (await run('update', { tableName, columnMappings: { name: 'X' }, filters: [] })).status
    ).toBe(403)
    expect((await run('delete', { tableName, filters: [] })).status).toBe(403)
    // The storefront provider reads the active rules from the browser.
    expect((await run('select', { tableName })).status).toBe(200)
    expect((await run('count', { tableName })).status).toBe(200)
  })

  it('serves the discount table to a browser only as the live-rule feed', async () => {
    const tableName = 'teleport_discounts'
    const live =
      "status = 'active' AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at > NOW())"

    // What the storefront provider sends: the merchant's campaign plan is
    // narrowed to the rules that price an order right now.
    const feed = await run('select', {
      tableName,
      filters: [{ field: 'status', value: 'active', operator: '=' }],
      limit: 500,
    })
    expect(feed.status).toBe(200)
    const select = feed.queries.find((sql) => /^SELECT /.test(sql) && !/^SELECT COUNT/i.test(sql))
    expect(select).toContain('SELECT id, name, status, priority, discount_type')
    // The window is the database's judgement, and when a campaign ends is the
    // merchant's business.
    expect(select).not.toContain('starts_at,')
    expect(select).not.toContain('ends_at,')
    expect(select).toContain(' AND ' + live)
    // Drafts, paused rules, how often a campaign ran: none of it is the
    // shopper's business.
    expect(select).not.toContain('*')
    expect(select).not.toContain('description')
    expect(select).not.toContain('usage_count')
    // The count beside the rows counts the same rows.
    expect(feed.queries.find((sql) => /^SELECT COUNT/i.test(sql))).toContain(' AND ' + live)

    // No filters at all: the window is still the database's.
    const unfiltered = await run('select', { tableName })
    expect(unfiltered.queries[0]).toContain(' WHERE ' + live)
    expect((await run('count', { tableName })).queries[0]).toContain(' WHERE ' + live)

    // A caller cannot ask for the columns back, nor widen the window.
    const asked = await run('select', {
      tableName,
      selectedColumns: ['id', 'description', 'usage_count'],
      filters: [{ field: 'status', value: 'draft', operator: '=' }],
    })
    expect(asked.queries[0]).not.toContain('description')
    expect(asked.queries[0]).toContain(' AND ' + live)

    // A server segment prices the order from the whole table.
    const server = await run('select', { tableName }, internal)
    expect(server.queries[0]).toBe('SELECT * FROM teleport_discounts')
  })

  it('refuses a feed filter or sort on a column the feed does not serve — a filter is an oracle', async () => {
    const tableName = 'teleport_discounts'
    for (const [operation, body] of [
      ['select', { tableName, filters: [{ field: 'usage_count', operator: '>', value: 100 }] }],
      [
        'select',
        {
          tableName,
          filters: [{ source: 'description', operand: 'contains', destination: 'launch' }],
        },
      ],
      [
        'select',
        { tableName, filters: [{ field: 'length(description)', operator: '>', value: 3 }] },
      ],
      ['select', { tableName, sorts: [{ field: 'usage_count', order: 'desc' }] }],
      ['select', { tableName, sorts: [{ field: 'ends_at', order: 'asc' }] }],
      ['count', { tableName, filters: [{ field: 'usage_count', operator: '>', value: 100 }] }],
    ] as Array<[string, Record<string, unknown>]>) {
      const result = await run(operation, body)
      expect(result.status).toBe(403)
      expect(result.queries).toEqual([])
    }
    // The storefront's own read, and any filter or sort over served columns.
    expect(
      (
        await run('select', {
          tableName,
          filters: [{ field: '"status"', value: 'active', operator: '=' }],
          sorts: [{ field: 'priority', order: 'asc' }],
        })
      ).status
    ).toBe(200)
    // A server segment filters however it likes.
    expect(
      (
        await run(
          'select',
          { tableName, filters: [{ field: 'usage_count', operator: '>', value: 1 }] },
          internal
        )
      ).status
    ).toBe(200)
  })

  it('serves a browser every other table to READ, and nothing more', async () => {
    // Generated browser code only reads here (the storefront feeds); every
    // write and every raw statement comes from a server segment presenting
    // the secret. So a browser that writes is not the store: it could mark
    // its own order paid.
    expect((await run('select', { tableName: 'teleport_products' })).status).toBe(200)
    expect((await run('count', { tableName: 'teleport_products' })).status).toBe(200)
    expect((await run('select', { tableName: 'teleport_gift_cards_archive' })).status).toBe(200)
    for (const [operation, body] of [
      ['create', { tableName: 'teleport_orders', columnMappings: { status: 'pending' } }],
      [
        'update',
        {
          tableName: 'teleport_orders',
          columnMappings: { payment_status: 'paid' },
          filters: [{ field: 'id', value: 'o1' }],
        },
      ],
      ['delete', { tableName: 'teleport_orders', filters: [{ field: 'id', value: 'o1' }] }],
      ['raw-query', { query: 'SELECT 1 FROM teleport_products', params: [] }],
      [
        'select',
        { tableName: 'teleport_products', rawQueryUserPart: 'SELECT * FROM teleport_products' },
      ],
    ] as Array<[string, Record<string, unknown>]>) {
      const result = await run(operation, body)
      expect(result.status).toBe(403)
      expect(result.queries).toEqual([])
    }
    expect(
      (
        await run(
          'create',
          { tableName: 'teleport_orders', columnMappings: { status: 'pending' } },
          internal
        )
      ).status
    ).toBe(200)
  })

  it('keeps the old scan for an app with no secret to tell its own calls apart', async () => {
    // No authentication, hence no store: nothing identifies a server call, so
    // writes and raw statements stay open and only the money tables are held back.
    const open = bootRoute(undefined)
    expect(
      (await open('create', { tableName: 'teleport_posts', columnMappings: { status: 'draft' } }))
        .status
    ).toBe(200)
    expect(
      (await open('raw-query', { query: 'SELECT 1 FROM teleport_products', params: [] })).status
    ).toBe(200)
    expect(
      (await open('raw-query', { query: 'SELECT code FROM teleport_gift_cards', params: [] }))
        .status
    ).toBe(403)
    expect((await open('select', { tableName: 'teleport_orders' })).status).toBe(403)
  })

  it('refuses a raw query that mentions the ledger, quoted or schema-qualified', async () => {
    for (const query of [
      'SELECT balance FROM teleport_gift_cards WHERE code = $1',
      'SELECT * FROM "teleport_gift_card_transactions"',
      'SELECT 1 FROM public.teleport_gift_cards',
      'WITH c AS (SELECT id FROM Teleport_Gift_Cards) SELECT * FROM c',
      "SELECT 1 /* teleport_products */ FROM teleport_gift_cards -- 'x'",
    ]) {
      const result = await run('raw-query', { query, params: [] }, restricted)
      expect(result.status).toBe(403)
      expect(result.queries).toEqual([])
    }
    // A table name inside a string literal is data, not a reference.
    expect(
      (
        await run(
          'raw-query',
          { query: "SELECT 1 FROM teleport_products WHERE name = 'teleport_gift_cards'" },
          restricted
        )
      ).status
    ).toBe(200)
  })

  it('refuses a raw write on the discount table, a raw read of the voucher tables, and lets a discount read through', async () => {
    expect(
      (
        await run(
          'raw-query',
          {
            query: 'UPDATE teleport_vouchers SET usage_count = usage_count + 1 WHERE id = $1',
            params: ['v1'],
          },
          restricted
        )
      ).status
    ).toBe(403)
    expect(
      (
        await run(
          'raw-query',
          {
            query:
              'WITH bump AS (SELECT 1) INSERT INTO teleport_voucher_redemptions (voucher_id) SELECT 1',
          },
          restricted
        )
      ).status
    ).toBe(403)
    expect(
      (await run('raw-query', { query: 'DELETE FROM teleport_discounts' }, restricted)).status
    ).toBe(403)
    expect(
      (await run('raw-query', { query: 'TRUNCATE teleport_discounts' }, restricted)).status
    ).toBe(403)
    // A generated batch is a list of single-use coupons: no browser lists it.
    expect(
      (
        await run(
          'raw-query',
          {
            query: "SELECT * FROM teleport_vouchers WHERE code = $1 AND status = 'active'",
            params: ['X'],
          },
          restricted
        )
      ).status
    ).toBe(403)
    // The feed is the ONE shape a browser reads the rule table in, and a
    // statement the caller wrote is not it.
    expect(
      (
        await run(
          'raw-query',
          { query: "SELECT * FROM teleport_discounts WHERE status = 'active'", params: [] },
          restricted
        )
      ).status
    ).toBe(403)
    expect(
      (
        await run(
          'select',
          { tableName: 'teleport_products', rawQueryUserPart: 'SELECT * FROM teleport_discounts' },
          restricted
        )
      ).status
    ).toBe(403)
    expect(
      (
        await run(
          'raw-query',
          { query: "SELECT * FROM teleport_discounts WHERE status = 'active'", params: [] },
          internal
        )
      ).status
    ).toBe(200)
    // Deliberately coarse: a statement that writes AND mentions a protected
    // table is refused without working out which table the write lands on —
    // parsing that is exactly the kind of guard that can be talked around.
    expect(
      (
        await run(
          'raw-query',
          {
            query:
              'UPDATE teleport_orders SET discount_details = (SELECT name FROM teleport_discounts WHERE id = $1)',
            params: ['d1'],
          },
          restricted
        )
      ).status
    ).toBe(403)
    expect(
      (
        await run(
          'raw-query',
          { query: 'UPDATE teleport_vouchers SET usage_count = 1', params: [] },
          internal
        )
      ).status
    ).toBe(200)
  })

  it("checks a select's raw override like a raw query", async () => {
    expect(
      (
        await run(
          'select',
          {
            tableName: 'teleport_products',
            rawQueryUserPart: 'SELECT code FROM teleport_gift_cards',
          },
          restricted
        )
      ).status
    ).toBe(403)
  })

  it('refuses a statement that can reach a protected table without spelling its name', async () => {
    for (const query of [
      // A Unicode-escaped identifier: \005f is the underscore.
      'SELECT * FROM U&"teleport\\005fgift_cards"',
      'select code from u&"teleport\\005fvouchers"',
      'SELECT * FROM U&"teleport\\005fdiscounts"',
      // Quote and comment markers inside a quoted identifier, `$` and `E`
      // inside an identifier: the scan lexes them as Postgres does.
      'SELECT code AS "x\'", balance FROM teleport_gift_cards -- \'',
      'SELECT 1 AS "--", code, balance FROM teleport_gift_cards',
      'SELECT code AS a$b$, balance FROM teleport_gift_cards AS g$b$',
      "SELECT CASE WHEN true THEN 'a' ELSE'\\' END, code FROM teleport_vouchers -- '",
      // The planner statistics hold sampled values of every column.
      "SELECT histogram_bounds::text FROM pg_stats WHERE tablename = 'teleport_vouchers'",
      // Functions that run SQL text, or dump whole tables and schemas.
      "SELECT query_to_xml('select code from teleport_gift_cards', true, false, '')",
      "SELECT table_to_xml('teleport_' || 'gift_cards', true, false, '')",
      "SELECT pg_catalog.schema_to_xml('public', true, false, '')",
      "SELECT database_to_xml(true, false, '')",
      "SELECT * FROM ts_stat('select to_tsvector(code) from teleport_gift_cards')",
    ]) {
      const raw = await run('raw-query', { query, params: [] }, restricted)
      expect(raw.status).toBe(403)
      expect(raw.queries).toEqual([])
      const override = await run(
        'select',
        { tableName: 'teleport_products', rawQueryUserPart: query },
        restricted
      )
      expect(override.status).toBe(403)
      expect(override.queries).toEqual([])
    }
    // The server keeps every spelling it writes.
    expect(
      (
        await run(
          'raw-query',
          { query: 'SELECT * FROM U&"teleport\\005fgift_cards"', params: [] },
          internal
        )
      ).status
    ).toBe(200)
  })

  it('keeps password reset tokens server-only — reading one is taking the account', async () => {
    expect((await run('select', { tableName: 'password_reset_tokens' })).status).toBe(403)
    for (const headers of [{}, restricted]) {
      expect(
        (
          await run(
            'raw-query',
            {
              query: 'SELECT token FROM password_reset_tokens WHERE email = $1',
              params: ['a@b.c'],
            },
            headers
          )
        ).status
      ).toBe(403)
    }
    expect((await run('select', { tableName: 'password_reset_tokens' }, internal)).status).toBe(200)
  })
})

describe('data API — a browser cannot grant itself a role', () => {
  // The money-table guard admits a browser whose session token says `admin`,
  // and that role is a column of the user's OWN row. The same route exposes an
  // update of that row, so without a column check the trust boundary is
  // self-service.
  const run = bootRoute(SECRET, { authUsersTableName: 'users' })

  it('refuses an update that writes a role column, before the database is touched', async () => {
    for (const columnMappings of [
      { role: 'admin' },
      { Role: 'admin' },
      { role_name: 'admin' },
      { roles: ['admin'] },
      { name: 'Mallory', role: 'admin' },
    ] as Array<Record<string, unknown>>) {
      const result = await run('update', {
        tableName: 'users',
        columnMappings,
        filters: [{ field: 'id', value: 'u1' }],
      })
      expect(result.status).toBe(403)
      expect(result.queries).toEqual([])
    }
    // The column-mapping list shape the update node also sends.
    const mapped = await run('update', {
      tableName: 'users',
      columnMappings: [{ source: 'role', destination: 'admin' }],
      filters: [{ field: 'id', value: 'u1' }],
    })
    expect(mapped.status).toBe(403)
  })

  it('refuses it however the table is spelled, and leaves profile columns alone', async () => {
    for (const tableName of ['public.users', '"users"', 'USERS']) {
      expect(
        (
          await run('update', {
            tableName,
            columnMappings: { role: 'admin' },
            filters: [{ field: 'id', value: 'u1' }],
          })
        ).status
      ).toBe(403)
    }
    // A browser writes no row at all: a profile edit runs in a server segment,
    // which presents the secret.
    const profile = await run('update', {
      tableName: 'users',
      columnMappings: { name: 'Mallory' },
      filters: [{ field: 'id', value: 'u1' }],
    })
    expect(profile.status).toBe(403)
    expect(profile.queries).toEqual([])
  })

  it('refuses a create that writes a role column — a new row with a known password is a new admin', async () => {
    for (const columnMappings of [
      { email: 'm@x.io', password: 'hash', role: 'admin' },
      [
        { column: 'email', value: 'm@x.io' },
        { column: '"role"', value: 'admin' },
      ],
      { email: 'm@x.io', 'users.roles': ['admin'] },
      { email: 'm@x.io', roleName: 'admin' },
    ] as unknown[]) {
      const result = await run('create', { tableName: 'users', columnMappings })
      expect(result.status).toBe(403)
      expect(result.queries).toEqual([])
    }
    // The anonymous-visitor row the resolve-user node ensures — from its
    // server segment, which presents the secret.
    expect(
      (
        await run(
          'create',
          {
            tableName: 'users',
            onConflictDoNothing: true,
            columnMappings: [
              { column: 'id', value: '0b8e9f1e-0000-4000-8000-000000000000' },
              { column: 'email', value: 'anon@x.io' },
              { column: 'name', value: '' },
              { column: 'image', value: '' },
            ],
          },
          internal
        )
      ).status
    ).toBe(200)
  })

  it('refuses an update that spells the role column quoted or table-qualified', async () => {
    for (const column of ['"role"', 'users.role', '"ROLES"', 'public.users.rolename']) {
      const result = await run('update', {
        tableName: 'users',
        columnMappings: { [column]: 'admin' },
        filters: [{ field: 'id', value: 'u1' }],
      })
      expect(result.status).toBe(403)
      expect(result.queries).toEqual([])
    }
  })

  it('refuses a browser raw statement that writes the users table, whatever it names', async () => {
    for (const query of [
      // (`SET role` right after SET is the validator's SET ROLE refusal, so
      // these lead with another column to reach the role guard itself.)
      "UPDATE users SET name = name, role = 'admin' WHERE id = $1",
      'UPDATE "users" SET (name, "role") = ROW(name, $1) WHERE id = $2',
      "INSERT INTO public.users VALUES (gen_random_uuid(), 'm@x.io', 'hash', 'admin')",
      'WITH promoted AS (UPDATE users SET name = name RETURNING id) SELECT * FROM promoted',
      // \0075 is the u: the same table, spelled where a name scan cannot see it.
      'UPDATE U&"\\0075sers" SET name = name, role = \'admin\' WHERE id = $1',
      // `$` inside identifiers opens no dollar quote.
      "UPDATE users AS a$z$ SET email = email, role = 'admin' WHERE id = $1 AND 1 = (SELECT 1 AS b$z$)",
    ]) {
      for (const headers of [{}, restricted]) {
        const result = await run('raw-query', { query, params: ['u1', 'u1'] }, headers)
        expect(result.status).toBe(403)
        expect(result.queries).toEqual([])
      }
    }
    expect(
      (
        await run('select', {
          tableName: 'teleport_products',
          rawQueryUserPart: "UPDATE users SET name = name, role = 'admin' RETURNING id",
        })
      ).status
    ).toBe(403)
    // The one caller allowed raw SQL at all never reaches the users table — a
    // statement can hand back a whole row without naming a credential column —
    // nor the customers' orders (its statement is a model's answer to a
    // visitor), while writing a catalogue table is not a role grant.
    expect(
      (
        await run(
          'raw-query',
          { query: 'SELECT id, name FROM users WHERE id = $1', params: ['u1'] },
          restricted
        )
      ).status
    ).toBe(403)
    expect(
      (
        await run(
          'raw-query',
          { query: 'SELECT shipping_address FROM teleport_orders WHERE id = $1', params: ['o1'] },
          restricted
        )
      ).status
    ).toBe(403)
    expect(
      (
        await run(
          'raw-query',
          { query: 'UPDATE teleport_products SET status = $1 WHERE id = $2', params: ['x', 'p1'] },
          restricted
        )
      ).status
    ).toBe(200)
    // The server may.
    expect(
      (
        await run(
          'raw-query',
          { query: "UPDATE users SET name = name, role = 'admin' WHERE id = $1", params: ['u1'] },
          internal
        )
      ).status
    ).toBe(200)
  })

  it('guards the users table the session role is read from even when the identity table has another name', async () => {
    const customers = bootRoute(SECRET, { authUsersTableName: 'customers' })
    for (const tableName of ['customers', 'users']) {
      expect(
        (
          await customers('update', {
            tableName,
            columnMappings: { role: 'admin' },
            filters: [{ field: 'id', value: 'u1' }],
          })
        ).status
      ).toBe(403)
    }
    expect(
      (
        await customers('raw-query', {
          query: "UPDATE users SET name = name, role = 'admin'",
          params: [],
        })
      ).status
    ).toBe(403)
  })

  it('lets a server-side segment set a role, and leaves other tables untouched', async () => {
    expect(
      (
        await run(
          'update',
          {
            tableName: 'users',
            columnMappings: { role: 'admin' },
            filters: [{ field: 'id', value: 'u1' }],
          },
          internal
        )
      ).status
    ).toBe(200)
    expect(
      (
        await run(
          'update',
          {
            tableName: 'teleport_product_reviews',
            columnMappings: { role: 'admin' },
            filters: [{ field: 'id', value: 'r1' }],
          },
          internal
        )
      ).status
    ).toBe(200)
  })
})

describe('the other ways a browser could write its own role', () => {
  const signupWith = async (
    body: Record<string, unknown>,
    customUserProperties: Array<{ key: string }> = []
  ): Promise<Record<string, unknown>> => {
    const code = generateSignupRouteFile({
      enabled: true,
      dataSourceType: 'postgresql',
      customUserProperties,
    } as any)
    let created: Record<string, unknown> = {}
    const fakeRequire = (name: string): any => {
      if (name.endsWith('/hash-password')) {
        return (password: string) => 'hashed:' + password
      }
      if (name.endsWith('/auth-options')) {
        return {
          userExistsByEmail: async () => false,
          createUser: async (userData: Record<string, unknown>) => {
            created = userData
            return { id: 'u1', ...userData }
          },
          sanitizeUser: (user: unknown) => user,
        }
      }
      return { resolveRequestLocale: () => 'en' }
    }
    const moduleObj: { exports: any } = { exports: {} }
    new Function('require', 'module', 'exports', 'console', code)(
      fakeRequire,
      moduleObj,
      moduleObj.exports,
      { error: () => undefined, warn: () => undefined, log: () => undefined }
    )
    const res = {
      status() {
        return this
      },
      json() {
        return this
      },
    }
    await moduleObj.exports({ method: 'POST', headers: {}, body }, res)
    return created
  }

  it('signs a new account up as a plain user whatever role-bearing property the body names', async () => {
    const created = await signupWith(
      {
        email: 'm@x.io',
        password: 'secret1',
        role: 'admin',
        roles: ['admin'],
        Role: 'admin',
        company: 'ACME',
      },
      [{ key: 'roles' }, { key: 'Role' }, { key: 'company' }]
    )
    expect(created.role).toBe('user')
    expect(created.roles).toBeUndefined()
    expect(created.Role).toBeUndefined()
    // An ordinary custom property still lands.
    expect(created.company).toBe('ACME')
  })

  it('keeps the server signup node from copying a role-bearing config key onto the new row', () => {
    const source = accountSignup.generateServerHandler!()
    expect(source).toContain('const roleBearingKey = /^(roles?|role_?name)$/i;')
    expect(source).toContain(
      'if (!reservedKeys[configKeys[i]] && !roleBearingKey.test(configKeys[i])) {'
    )
  })

  it('guards the users table on an auth config that declares no tables', () => {
    expect(resolveAuthUsersTableName({ enabled: true })).toBe('users')
    expect(resolveAuthUsersTableName({ enabled: true, tables: {} })).toBe('users')
    expect(resolveAuthUsersTableName({ enabled: false })).toBeUndefined()
    expect(resolveAuthUsersTableName(undefined)).toBeUndefined()
  })
})

describe('server-side data nodes present the internal secret', () => {
  it('is sent by every node that reaches the route from a server segment', () => {
    for (const node of [
      dataSelect,
      dataCount,
      dataCreateItem,
      dataRawQuery,
      dataUpdateItem,
      dataDeleteItem,
    ]) {
      const source = node.generateHandler()
      expect(source).toContain("'x-internal-data-secret': (__env && __env.NEXTAUTH_SECRET) || ''")
      // Read off the process, which only exists server-side.
      expect(source).toContain('const __env = globalThis.process && globalThis.process.env')
    }
  })
})

describe('data API — the users table never serves its credentials to a browser', () => {
  const userRow = {
    id: 'u1',
    name: 'Ada',
    email: 'ada@shop.test',
    role: 'user',
    password: '$2b$10$hash',
    access_token: 'ya29.token',
    refresh_token: '1//refresh',
    id_token: 'eyJ.id',
    session_state: 's',
    token_type: 'Bearer',
    scope: 'email',
    expires_at: 1790000000,
  }
  const run = bootRoute(SECRET, { authUsersTableName: 'users', rows: [userRow] })

  it('refuses a browser the users table outright — the list is every customer', async () => {
    for (const body of [
      { tableName: 'users' },
      { tableName: 'users', selectedColumns: ['id', 'password'] },
    ]) {
      const result = await run('select', body)
      expect(result.status).toBe(403)
      expect(result.queries).toEqual([])
    }
  })

  it('serves the whole row to a server segment, which checks a password or refreshes a token', async () => {
    const result = await run('select', { tableName: 'users' }, internal)
    expect(result.body.rows).toEqual([userRow])
  })
})
