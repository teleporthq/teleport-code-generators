/* tslint:disable:function-constructor */
import { generateDataAPIRoute } from '../src/data-api-route-generator'
import { isSecurityRuntimeSpecifier, loadSecurityRuntime } from './_helpers/load-security-runtime'

// The data routes compare the app secret with the shared runtime's safeEqual.
const securityRuntime = loadSecurityRuntime()

/**
 * A statement a server step runs FOR a visitor from SQL it did not write — the
 * AI data step, which marks its call `x-tq-restricted-sql` — is answered with
 * what that visitor's browser is served of each table: the published posts
 * without the author's email, the active products. Executed against a fake pg
 * client: the verdict is the status, the SQL that reached the database and the
 * rows served back.
 */

const SECRET = 'server-secret'

interface RouteResult {
  status: number
  body: any
  queries: string[]
  alerts: string[]
}

function bootRoute(
  secret: string | undefined,
  rows: any[],
  options: Parameters<typeof generateDataAPIRoute>[0] = {}
) {
  const code = generateDataAPIRoute(options)
  const queries: string[] = []
  const alerts: string[] = []
  class FakeClient {
    public async connect(): Promise<void> {
      return
    }
    public async end(): Promise<void> {
      return
    }
    public async query(sql: string): Promise<{ rows: any[]; rowCount: number }> {
      queries.push(sql)
      return { rows: rows.map((row) => ({ ...row })), rowCount: rows.length }
    }
  }
  const moduleObj: { exports: any } = { exports: {} }
  const fakeRequire = (name: string): any => {
    if (name === 'pg') {
      return { Client: FakeClient }
    }
    if (name === 'next-auth/jwt') {
      return { getToken: async () => null }
    }
    if (isSecurityRuntimeSpecifier(name)) {
      return securityRuntime
    }
    throw new Error('unexpected require: ' + name)
  }
  const fakeFetch = async (url: string) => {
    alerts.push(url)
    return { ok: true, json: async () => ({}) }
  }
  new Function('require', 'module', 'exports', 'process', 'console', 'fetch', code)(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    { env: { NEXTAUTH_SECRET: secret, TELEPORT_DB_CONNECTION_STRING: 'postgresql://x' } },
    { error: () => undefined, warn: () => undefined, log: () => undefined },
    fakeFetch
  )
  const handler = moduleObj.exports
  return async (query: string, headers: Record<string, string>): Promise<RouteResult> => {
    queries.length = 0
    alerts.length = 0
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
    await handler(
      {
        method: 'POST',
        query: { params: ['ds-1', 'raw-query'] },
        headers: { host: 'store.test', ...headers },
        body: { query, params: [] },
      },
      res
    )
    await new Promise((resolve) => setImmediate(resolve))
    return { status, body: responseBody, queries: queries.slice(), alerts: alerts.slice() }
  }
}

const internal = { 'x-internal-data-secret': SECRET }
const forVisitor = { 'x-internal-data-secret': SECRET, 'x-tq-restricted-sql': '1' }

const POSTS = [{ id: 'p1', title: 'Live', status: 'published', author_email: 'writer@store.test' }]

describe('data API — a statement run for a visitor reads what a visitor is served', () => {
  it('reads the blog through its published posts, without the author email', async () => {
    const run = bootRoute(SECRET, POSTS)
    const statement = 'SELECT "id", "title", "author_email" FROM "teleport_blog_posts" LIMIT 50'
    const result = await run(statement, forVisitor)

    expect(result.status).toBe(200)
    expect(result.queries).toEqual([
      'WITH "teleport_blog_posts" AS (SELECT (jsonb_populate_record(__dv_rows, \'{"author_email":null,"authorEmail":null}\'::jsonb)).* FROM "teleport_blog_posts" AS __dv_rows WHERE (status = \'published\')) ' +
        statement,
    ])
    expect(result.body.rows).toEqual([{ id: 'p1', title: 'Live', status: 'published' }])
  })

  it('reads the catalogue through its active products', async () => {
    const run = bootRoute(SECRET, [{ id: 'a', name: 'Shirt' }])
    const statement =
      'SELECT "id", "name" FROM "teleport_products" WHERE "price" = (SELECT MIN("price") FROM "teleport_products") LIMIT 50'
    const result = await run(statement, forVisitor)

    expect(result.status).toBe(200)
    expect(result.queries).toEqual([
      'WITH "teleport_products" AS (SELECT * FROM "teleport_products" AS __dv_rows WHERE (LOWER(TRIM(status)) = \'active\')) ' +
        statement,
    ])
    expect(result.body.rows).toEqual([{ id: 'a', name: 'Shirt' }])
  })

  it("puts the statement's own WITH list after the tables it narrows", async () => {
    const run = bootRoute(SECRET, [])
    const result = await run(
      'WITH cheapest AS (SELECT MIN("price") AS p FROM "teleport_products") SELECT "id" FROM "teleport_products", cheapest WHERE "price" = cheapest.p;',
      forVisitor
    )

    expect(result.status).toBe(200)
    expect(result.queries).toEqual([
      'WITH "teleport_products" AS (SELECT * FROM "teleport_products" AS __dv_rows WHERE (LOWER(TRIM(status)) = \'active\')), cheapest AS (SELECT MIN("price") AS p FROM "teleport_products") SELECT "id" FROM "teleport_products", cheapest WHERE "price" = cheapest.p',
    ])
  })

  it('refuses, before the database, a statement it cannot narrow', async () => {
    const run = bootRoute(SECRET, POSTS)
    for (const statement of [
      'SELECT * FROM public.teleport_blog_posts',
      'SELECT * FROM "public"."teleport_products"',
      'WITH RECURSIVE r AS (SELECT * FROM teleport_products) SELECT * FROM r',
      "SELECT * FROM teleport_blog_posts WHERE title = 'unterminated",
    ]) {
      const result = await run(statement, forVisitor)
      expect(result.status).toBe(403)
      expect(result.queries).toEqual([])
    }
  })

  it("never reads a customer's records", async () => {
    const run = bootRoute(SECRET, [])
    for (const statement of [
      'SELECT * FROM teleport_orders',
      'SELECT email FROM users',
      'SELECT * FROM teleport_bookings',
    ]) {
      const result = await run(statement, forVisitor)
      expect(result.status).toBe(403)
      expect(result.queries).toEqual([])
    }
  })

  it('reads a table that has no visitor policy as the statement names it', async () => {
    const run = bootRoute(SECRET, [{ name: 'Ada' }])
    const result = await run('SELECT name FROM team_members', forVisitor)
    expect(result.status).toBe(200)
    expect(result.queries).toEqual(['SELECT name FROM team_members'])
  })

  it('is asked for by the step itself, so it holds in an app without a secret too', async () => {
    const run = bootRoute(undefined, POSTS)
    const result = await run('SELECT * FROM teleport_blog_posts', { 'x-tq-restricted-sql': '1' })
    expect(result.status).toBe(200)
    expect(result.queries[0]).toContain("WHERE (status = 'published')")
    expect(result.body.rows[0]).not.toHaveProperty('author_email')
  })

  it("leaves the server's own statements whole: drafts and the author email included", async () => {
    const run = bootRoute(SECRET, POSTS)
    const result = await run('SELECT * FROM teleport_blog_posts', internal)
    expect(result.status).toBe(200)
    expect(result.queries).toEqual(['SELECT * FROM teleport_blog_posts'])
    expect(result.body.rows[0].author_email).toBe('writer@store.test')
  })

  it('answers a stock question without raising the low-stock alert, which stays the server’s', async () => {
    const run = bootRoute(SECRET, [{ id: 'a', name: 'Shirt', quantity: 2 }], {
      lowStockAlertsEnabled: true,
    })
    const statement = 'SELECT id, name, quantity FROM teleport_products WHERE quantity <= 5'

    const asked = await run(statement, forVisitor)
    expect(asked.status).toBe(200)
    expect(asked.alerts).toEqual([])

    const afterOrder = await run(statement, internal)
    expect(afterOrder.status).toBe(200)
    expect(afterOrder.alerts).toEqual(['https://store.test/api/ecommerce/low-stock-alert'])
  })
})
