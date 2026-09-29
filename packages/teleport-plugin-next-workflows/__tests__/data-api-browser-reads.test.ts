/* tslint:disable:function-constructor */
import { TableAccess } from '@teleporthq/teleport-shared'
import { BROWSER_READABLE_TABLES, generateDataAPIRoute } from '../src/data-api-route-generator'

/**
 * What a BROWSER may read through `/api/data/<ds>/<op>`, and what it is told
 * when the database fails. Executed against a fake pg client: the verdict is
 * the status, the SQL that reached the database and the body served.
 *
 * - In an app whose server code presents the app secret, a browser reads only
 *   the catalogue tables the storefront itself reads here. A merchant's own
 *   table, the AI assistant's conversations and knowledge base, the system
 *   catalogs and the planner statistics are refused before the database is
 *   touched.
 * - The blog's drafts and the catalogue's inactive products are not served to
 *   a browser, nor a post's author email — not as a column, a filter or a sort.
 * - No caller but the app's own server code reads a system catalog, in an app
 *   without a secret too.
 * - A database error's text stays in the server log.
 */

const SECRET = 'server-secret'

interface RouteResult {
  status: number
  body: any
  queries: string[]
  params: unknown[][]
  logged: unknown[][]
}

interface BootOptions {
  rows?: any[]
  failWith?: Error
}

function bootRoute(secret: string | undefined, options: BootOptions = {}) {
  const code = generateDataAPIRoute({})
  const queries: string[] = []
  const params: unknown[][] = []
  const logged: unknown[][] = []
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
      queries.push(sql)
      params.push(values || [])
      if (/information_schema/i.test(sql)) {
        return { rows: [], rowCount: 0 }
      }
      if (options.failWith) {
        throw options.failWith
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
    {
      error: (...args: unknown[]) => logged.push(args),
      warn: () => undefined,
      log: () => undefined,
    }
  )
  const handler = moduleObj.exports
  return async (
    operation: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {}
  ): Promise<RouteResult> => {
    queries.length = 0
    params.length = 0
    logged.length = 0
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
    return {
      status,
      body: responseBody,
      queries: queries.slice(),
      params: params.slice(),
      logged: logged.slice(),
    }
  }
}

const internal = { 'x-internal-data-secret': SECRET }

/** What visitors told the AI assistant, and the merchant's knowledge base. */
const AI_CHAT_TABLES = [
  'teleport_ai_chat_knowledge_sources',
  'teleport_ai_chat_documents',
  'teleport_ai_chat_conversations',
  'teleport_ai_chat_messages',
]
const restricted = { 'x-internal-data-secret': SECRET, 'x-tq-restricted-sql': '1' }

describe('data API — what a browser reads', () => {
  const run = bootRoute(SECRET)

  it('serves the storefront its catalogue tables', async () => {
    for (const tableName of BROWSER_READABLE_TABLES) {
      expect((await run('select', { tableName })).status).toBe(200)
      expect((await run('count', { tableName })).status).toBe(200)
    }
    expect((await run('select', { tableName: 'public.teleport_tax_rates' })).status).toBe(200)
  })

  it("refuses a merchant's own table, the assistant's tables and the catalogs, before the database", async () => {
    for (const tableName of [
      'team_members',
      'contact_submissions',
      ...AI_CHAT_TABLES,
      'information_schema.tables',
      'information_schema.columns',
      'pg_catalog.pg_user',
      'pg_user',
      'pg_stats',
      'pg_settings',
    ]) {
      for (const operation of ['select', 'count']) {
        const result = await run(operation, { tableName })
        expect(result.status).toBe(403)
        expect(result.queries).toEqual([])
      }
    }
  })

  it("still serves every table to the app's own server code", async () => {
    for (const tableName of ['team_members', 'teleport_ai_chat_messages']) {
      expect((await run('select', { tableName }, internal)).status).toBe(200)
    }
  })

  it("keeps the assistant's tables from an AI-written statement too", async () => {
    for (const query of [
      'SELECT message FROM teleport_ai_chat_messages',
      'SELECT * FROM "teleport_ai_chat_conversations"',
      'SELECT content FROM public.teleport_ai_chat_documents',
    ]) {
      const result = await run('raw-query', { query, params: [] }, restricted)
      expect(result.status).toBe(403)
      expect(result.queries).toEqual([])
    }
    // The model may still read the catalogue.
    expect(
      (
        await run(
          'raw-query',
          { query: 'SELECT name FROM teleport_products', params: [] },
          restricted
        )
      ).status
    ).toBe(200)
  })

  it("keeps the assistant's tables in the shared protected set, refused in an app with no secret too", async () => {
    for (const table of AI_CHAT_TABLES) {
      expect(TableAccess.PROTECTED_TABLES).toContain(table)
    }
    const open = bootRoute(undefined)
    for (const tableName of AI_CHAT_TABLES) {
      for (const operation of ['select', 'count', 'create', 'update', 'delete']) {
        const result = await open(operation, {
          tableName,
          columnMappings: { message: 'hi' },
          filters: [{ source: 'id', destination: 'x' }],
        })
        expect(result.status).toBe(403)
        expect(result.queries).toEqual([])
      }
      const raw = await open('raw-query', { query: `SELECT * FROM ${tableName}`, params: [] })
      expect(raw.status).toBe(403)
      expect(raw.queries).toEqual([])
    }
  })
})

describe('data API — no caller but the server reads a system catalog', () => {
  it('refuses the catalogs and planner statistics to a restricted statement', async () => {
    const run = bootRoute(SECRET)
    for (const query of [
      'SELECT table_name FROM information_schema.tables',
      'SELECT usename FROM pg_catalog.pg_user',
      "SELECT histogram_bounds FROM pg_stats WHERE tablename = 'users'",
      'SELECT pg_sleep(30)',
    ]) {
      const result = await run('raw-query', { query, params: [] }, restricted)
      expect(result.status).toBe(403)
      expect(result.queries).toEqual([])
    }
  })

  it('refuses them in an app without a secret, where every caller counts as a browser', async () => {
    const run = bootRoute(undefined)
    for (const query of [
      'SELECT column_name FROM information_schema.columns',
      'SELECT * FROM pg_catalog.pg_class',
      'SELECT rolname FROM pg_roles',
    ]) {
      const result = await run('raw-query', { query, params: [] })
      expect(result.status).toBe(403)
      expect(result.queries).toEqual([])
    }
    for (const tableName of ['information_schema.tables', 'pg_stats', 'pg_catalog.pg_user']) {
      expect((await run('select', { tableName })).status).toBe(403)
    }
    // Its ordinary reads and statements are untouched.
    expect((await run('select', { tableName: 'team_members' })).status).toBe(200)
    expect(
      (await run('raw-query', { query: 'SELECT id FROM team_members', params: [] })).status
    ).toBe(200)
  })
})

describe('data API — unpublished rows and private columns', () => {
  const POSTS = [
    { id: 'p1', title: 'Live', status: 'published', author_email: 'writer@store.test' },
  ]

  it('narrows a browser to the published posts and drops the author email', async () => {
    const run = bootRoute(SECRET, { rows: POSTS })
    const result = await run('select', {
      tableName: 'teleport_blog_posts',
      filters: [{ field: 'slug', value: 'live', operator: '=' }],
    })
    expect(result.status).toBe(200)
    expect(result.queries[0]).toContain("(status = 'published')")
    expect(result.queries[0]).toMatch(/WHERE slug = \$1 AND \(status = 'published'\)/)
    expect(result.queries[1]).toContain("(status = 'published')")
    expect(result.body.rows).toEqual([{ id: 'p1', title: 'Live', status: 'published' }])

    const count = await run('count', { tableName: 'teleport_blog_posts' })
    expect(count.queries[0]).toContain("WHERE (status = 'published')")
  })

  it('narrows a browser to the active products', async () => {
    const run = bootRoute(SECRET)
    const result = await run('select', {
      tableName: 'teleport_products',
      filters: [{ field: 'id', value: ['a', 'b'], operator: '=' }],
    })
    expect(result.status).toBe(200)
    expect(result.queries[0]).toContain("AND (LOWER(TRIM(status)) = 'active')")
  })

  it('refuses a browser the author email as a column, a filter or a sort', async () => {
    const run = bootRoute(SECRET, { rows: POSTS })
    for (const body of [
      { tableName: 'teleport_blog_posts', selectedColumns: ['author_email'] },
      {
        tableName: 'teleport_blog_posts',
        filters: [{ field: 'author_email', value: 'writer@store.test', operator: '=' }],
      },
      { tableName: 'teleport_blog_posts', sorts: [{ field: '"author_email"', order: 'asc' }] },
    ]) {
      const result = await run('select', body)
      expect(result.status).toBe(403)
      expect(result.queries).toEqual([])
    }
  })

  it('reads every row, email included, for the server — the admin, the scheduled publisher', async () => {
    const run = bootRoute(SECRET, { rows: POSTS })
    const result = await run('select', { tableName: 'teleport_blog_posts' }, internal)
    expect(result.status).toBe(200)
    expect(result.queries[0]).not.toContain('published')
    expect(result.body.rows[0].author_email).toBe('writer@store.test')
  })

  it('leaves an app without a secret alone, where its server calls look like a browser', async () => {
    const run = bootRoute(undefined, { rows: POSTS })
    const result = await run('select', { tableName: 'teleport_blog_posts' })
    expect(result.status).toBe(200)
    expect(result.queries[0]).not.toContain('published')
  })
})

describe('data API — a database error stays in the server log', () => {
  it('answers a generic message with the SQLSTATE, and logs the database words', async () => {
    const failure = Object.assign(
      new Error('duplicate key value violates unique constraint "users_email_key"'),
      { code: '23505' }
    )
    const run = bootRoute(SECRET, { failWith: failure })
    const result = await run(
      'raw-query',
      { query: 'INSERT INTO users (email) VALUES ($1)', params: ['a@b.test'] },
      internal
    )
    expect(result.status).toBe(500)
    expect(result.body).toEqual({ error: 'Internal server error', code: '23505' })
    expect(JSON.stringify(result.body)).not.toContain('users_email_key')
    expect(result.logged.length).toBeGreaterThan(0)
  })

  it('keeps the messages it writes for the caller, and the structured codes', async () => {
    const run = bootRoute(SECRET)
    const refused = await run('select', { tableName: 'teleport_gift_cards' })
    expect(refused.status).toBe(403)
    expect(refused.body.error).toContain('teleport_gift_cards')

    const invalid = await run('select', { tableName: 'teleport_products; DROP TABLE x' }, internal)
    expect(invalid.status).toBe(400)
    expect(invalid.body.error).toBe('INVALID_SQL_IDENTIFIER')
  })
})
