/* tslint:disable:function-constructor max-classes-per-file */
import { generateDataSourceFetcherWithCore } from '../src/data-source-fetchers'
import { generateRawQueryFetcher } from '../src/fetchers/raw-query'

/**
 * The per-table read routes served whole tables to anyone: every draft,
 * scheduled and archived blog post with its author's email address, every draft
 * product, and the AI assistant's conversations. A visitor is now served the
 * published rows without a hidden column, the store (its server code, its
 * administrators) everything — and the verdicts below come from the executed
 * route, not from its source text.
 */

const SECRET = 'server-secret'
const ADMIN_ROLES = ['admin']

interface FakeSession {
  role?: string
  sub?: string
  id?: string
}

interface RouteResult {
  status: number
  body: any
  queries: Array<{ sql: string; params: unknown[] }>
}

interface BootOptions {
  type?: 'teleport' | 'postgresql'
  appSecret?: string | null
  rows?: any[]
  columns?: string[]
  cache?: { scope: string; ttlSeconds: number; sMaxAge?: number }
  failWith?: Error
}

interface CacheCall {
  scope: string
  sMaxAge: number
}

function bootTableRoute(tableName: string, options: BootOptions = {}) {
  const appSecret = options.appSecret === undefined ? SECRET : options.appSecret
  const type = options.type || 'teleport'
  const dataSource = {
    id: 'ds-1',
    name: 'db',
    type,
    config:
      type === 'teleport'
        ? {
            host: 'teleporthq.secrets.TELEPORT_DB_HOST',
            port: 5432,
            user: 'teleporthq.secrets.TELEPORT_DB_USER',
            password: 'teleporthq.secrets.TELEPORT_DB_PASSWORD',
            database: 'teleporthq.secrets.TELEPORT_DB_NAME',
            selectedTables: { [tableName]: { columns: [{ name: 'id', type: 'uuid' }] } },
          }
        : { host: 'h', port: 5432, user: 'u', password: 'p', database: 'd' },
  }
  const esm = generateDataSourceFetcherWithCore(
    dataSource as never,
    tableName,
    false,
    { trustedReaderRoles: ADMIN_ROLES },
    options.cache
  )
  const code = esm
    .replace("import { Client } from 'pg'", "const { Client } = require('pg')")
    .replace(
      "import { tqWithCache } from '../tq-cache/server'",
      "const { tqWithCache } = require('tq-cache')"
    )
    .replace(/^export default async function handler/m, 'async function handler')
    .replace(/^export \{[^}]*\}\s*$/m, '')
    .replace(/^export default \{[^}]*\}\s*$/m, '')
    .concat(
      options.cache
        ? '\nmodule.exports = { handler: cachedHandler, getCount: cachedGetCount, fetchData: fetchData, fetchCount: fetchCount }'
        : '\nmodule.exports = { handler: handler, getCount: getCount, fetchData: fetchData, fetchCount: fetchCount }'
    )
  expect(code).not.toMatch(/^export /m)
  expect(code).not.toMatch(/^import /m)

  const queries: Array<{ sql: string; params: unknown[] }> = []
  const cacheCalls: CacheCall[] = []
  let session: FakeSession | null = null
  class FakeClient {
    public async connect(): Promise<void> {
      return
    }
    public async end(): Promise<void> {
      return
    }
    public async query(sql: string, params: unknown[] = []): Promise<any> {
      queries.push({ sql, params })
      if (options.failWith) {
        throw options.failWith
      }
      if (/information_schema/i.test(sql)) {
        const columnRows = (options.columns || []).map((name) => ({ column_name: name }))
        return { rows: columnRows, rowCount: columnRows.length }
      }
      if (/^SELECT COUNT/i.test(sql)) {
        return { rows: [{ count: String((options.rows || []).length) }], rowCount: 1 }
      }
      if (new RegExp(`FROM "?${tableName}"?`).test(sql)) {
        const rows = options.rows || []
        return { rows, rowCount: rows.length }
      }
      return { rows: [], rowCount: 0 }
    }
  }
  // Records the scope and CDN window each cached view is wrapped with, and
  // serves every request straight through — the split is what is under test.
  const tqWithCache = (fn: any, opts: any) => async (req: any, res: any) => {
    cacheCalls.push({ scope: opts.scope, sMaxAge: opts.sMaxAge })
    return fn(req, res)
  }
  const fakeRequire = (name: string): any => {
    if (name === 'pg') {
      return { Client: FakeClient }
    }
    if (name === 'tq-cache') {
      return { tqWithCache }
    }
    if (name === 'next-auth/jwt') {
      return {
        getToken: async () => (session ? { sub: session.sub || 'u1', role: session.role } : null),
      }
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

  const run = async (params: {
    handler?: 'handler' | 'getCount'
    query?: Record<string, string>
    headers?: Record<string, string>
    session?: FakeSession | null
  }): Promise<RouteResult> => {
    queries.length = 0
    session = params.session || null
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
      setHeader() {
        return this
      },
    }
    const req = {
      method: 'GET',
      query: params.query || {},
      headers: {
        cookie: params.session ? 'next-auth.session-token=signed' : '',
        ...(params.headers || {}),
      },
    }
    await moduleObj.exports[params.handler || 'handler'](req, res)
    return { status, body: responseBody, queries: queries.slice() }
  }

  const serverFetch = async (): Promise<unknown> => {
    queries.length = 0
    session = null
    return moduleObj.exports.fetchData({})
  }

  return { run, serverFetch, queries, cacheCalls }
}

const internal = { 'x-internal-data-secret': SECRET }

const mainQuery = (result: RouteResult): string =>
  (result.queries.find((q) => /^\s*SELECT \* FROM/i.test(q.sql)) || { sql: '' }).sql

const POSTS = [
  {
    id: 'p1',
    title: 'Hello',
    slug: 'hello',
    status: 'published',
    author_name: 'Ana',
    author_email: 'ana@example.com',
  },
]

describe('blog posts: a visitor reads the published posts, never an author email', () => {
  const posts = bootTableRoute('teleport_blog_posts', {
    rows: POSTS,
    columns: ['id', 'title', 'author_email'],
  })

  it('narrows a visitor to the published posts and drops the email from every row', async () => {
    const guest = await posts.run({})
    expect(guest.status).toBe(200)
    expect(mainQuery(guest)).toContain("(status = 'published')")
    expect(JSON.stringify(guest.body.data)).not.toContain('ana@example.com')
    expect(guest.body.data[0].author_email).toBeUndefined()
    expect(guest.body.data[0].authorEmail).toBeUndefined()
    expect(guest.body.data[0].title).toBe('Hello')

    // A signed-in shopper is still a visitor.
    const shopper = await posts.run({ session: { role: 'user' } })
    expect(mainQuery(shopper)).toContain("(status = 'published')")
    expect(JSON.stringify(shopper.body.data)).not.toContain('ana@example.com')
  })

  it('serves the store everything: the admin, a server segment and getStaticProps', async () => {
    const admin = await posts.run({ session: { role: 'admin' } })
    expect(mainQuery(admin)).not.toContain("status = 'published'")
    expect(JSON.stringify(admin.body.data)).toContain('ana@example.com')

    const server = await posts.run({ headers: internal })
    expect(mainQuery(server)).not.toContain("status = 'published'")

    // (The transform's own related/adjacent-post lookups ask for published
    // posts themselves; the read of the table is what must stay whole.)
    await posts.serverFetch()
    const serverRead = posts.queries.find((q) => /^\s*SELECT \* FROM/i.test(q.sql))
    expect(serverRead && serverRead.sql).not.toContain("(status = 'published')")
  })

  it('narrows the count the same way', async () => {
    const guest = await posts.run({ handler: 'getCount' })
    expect(guest.status).toBe(200)
    expect(guest.queries.some((q) => /COUNT\(\*\).*\(status = 'published'\)/.test(q.sql))).toBe(
      true
    )
  })

  it('refuses a visitor who filters or sorts by the hidden column, before the database is touched', async () => {
    const filters = JSON.stringify([
      { source: 'author_email', operand: '=', destination: 'ana@example.com' },
    ])
    for (const query of [
      { filters },
      { sorts: JSON.stringify([{ field: 'author_email', order: 'asc' }]) },
      { sortBy: 'author_email' },
      { query: 'ana', queryColumns: JSON.stringify(['author_email']) },
    ]) {
      const refused = await posts.run({ query })
      expect(refused.status).toBe(403)
      expect(refused.queries).toEqual([])
      const count = await posts.run({ handler: 'getCount', query })
      expect(count.status).toBe(403)
    }
    // The admin may.
    expect((await posts.run({ query: { filters }, session: { role: 'admin' } })).status).toBe(200)
  })

  it('searches a visitor only through the columns it is served', async () => {
    const guest = await posts.run({ query: { query: 'ana' } })
    expect(guest.status).toBe(200)
    const sql = mainQuery(guest)
    expect(sql).toContain('"title"::text ILIKE')
    expect(sql).not.toContain('"author_email"')

    const admin = await posts.run({ query: { query: 'ana' }, session: { role: 'admin' } })
    expect(mainQuery(admin)).toContain('"author_email"::text ILIKE')
  })

  it('applies to the generic Postgres route too', async () => {
    const pgPosts = bootTableRoute('teleport_blog_posts', { type: 'postgresql', rows: POSTS })
    const guest = await pgPosts.run({})
    expect(guest.status).toBe(200)
    expect(mainQuery(guest)).toContain("(status = 'published')")
    expect(JSON.stringify(guest.body.data)).not.toContain('ana@example.com')
    const admin = await pgPosts.run({ session: { role: 'admin' } })
    expect(JSON.stringify(admin.body.data)).toContain('ana@example.com')
  })
})

describe('products: a visitor reads the active products', () => {
  const products = bootTableRoute('teleport_products', {
    rows: [{ id: 'x', name: 'Mug', slug: 'mug', status: 'active', price: 1 }],
  })

  it('narrows a visitor, not the store', async () => {
    expect(mainQuery(await products.run({}))).toContain("(LOWER(TRIM(status)) = 'active')")
    expect(mainQuery(await products.run({ session: { role: 'admin' } }))).not.toContain(
      "= 'active'"
    )
    expect(mainQuery(await products.run({ headers: internal }))).not.toContain("= 'active'")
  })
})

describe('the AI assistant tables are read by the store only', () => {
  it('refuses a guest and a shopper, serves the admin and the server', async () => {
    const messages = bootTableRoute('teleport_ai_chat_messages')
    const guest = await messages.run({})
    expect(guest.status).toBe(401)
    expect(guest.queries).toEqual([])
    const shopper = await messages.run({ handler: 'getCount', session: { role: 'user' } })
    expect(shopper.status).toBe(403)
    expect(shopper.queries).toEqual([])
    expect((await messages.run({ session: { role: 'admin' } })).status).toBe(200)
    expect((await messages.run({ headers: internal })).status).toBe(200)
  })

  it('refuses a raw statement over them from another route, even without an app secret', async () => {
    const open = bootTableRoute('team_members', { appSecret: null })
    const guest = await open.run({
      query: { rawQuery: 'SELECT message FROM teleport_ai_chat_messages' },
    })
    expect(guest.status).toBe(401)
    expect(guest.queries).toEqual([])
  })
})

describe('database errors stay in the server log', () => {
  it('answers a failed read with a generic message', async () => {
    const failing = bootTableRoute('team_members', {
      failWith: Object.assign(new Error('relation "secret_table" does not exist'), {
        code: '42P01',
      }),
    })
    const list = await failing.run({})
    expect(list.status).toBe(500)
    expect(JSON.stringify(list.body)).not.toContain('secret_table')
    const count = await failing.run({ handler: 'getCount' })
    expect(count.status).toBe(500)
    expect(JSON.stringify(count.body)).not.toContain('secret_table')
  })
})

describe('the response cache never hands one view to the other', () => {
  const CACHE = { scope: 'ds-1:teleport_blog_posts', ttlSeconds: 60, sMaxAge: 30 }

  it('keeps the store and a visitor in separate cache scopes, and the store out of the CDN', async () => {
    const posts = bootTableRoute('teleport_blog_posts', { rows: POSTS, cache: CACHE })

    posts.cacheCalls.length = 0
    await posts.run({})
    expect(posts.cacheCalls).toEqual([{ scope: 'ds-1:teleport_blog_posts', sMaxAge: 30 }])

    posts.cacheCalls.length = 0
    await posts.serverFetch()
    expect(posts.cacheCalls).toEqual([{ scope: 'ds-1:teleport_blog_posts:trusted', sMaxAge: 0 }])

    posts.cacheCalls.length = 0
    await posts.run({ session: { role: 'admin' } })
    expect(posts.cacheCalls).toEqual([{ scope: 'ds-1:teleport_blog_posts:trusted', sMaxAge: 0 }])

    posts.cacheCalls.length = 0
    await posts.run({ handler: 'getCount' })
    expect(posts.cacheCalls).toEqual([{ scope: 'ds-1:teleport_blog_posts:count', sMaxAge: 30 }])
  })

  it('lets every caller share one view of a table that answers everyone alike', async () => {
    const members = bootTableRoute('team_members', {
      cache: { scope: 'ds-1:team_members', ttlSeconds: 60 },
    })
    members.cacheCalls.length = 0
    await members.serverFetch()
    await members.run({})
    expect(members.cacheCalls.map((call) => call.scope)).toEqual([
      'ds-1:team_members',
      'ds-1:team_members',
    ])
  })
})

describe('raw-query state routes bind {{Current User.*}} to the session', () => {
  const boot = (paramFields: string[]) => {
    const esm = generateRawQueryFetcher(
      {},
      'SELECT f.entity_id FROM teleport_favourites f WHERE f.user_id::text = $1',
      paramFields
    )
    const code = esm
      .replace("import { Client } from 'pg'", "const { Client } = require('pg')")
      .replace(/^export default async function handler/m, 'async function handler')
      .concat('\nmodule.exports = { handler: handler }')
    const queries: Array<{ sql: string; params: unknown[] }> = []
    let session: FakeSession | null = null
    let fail: Error | null = null
    class FakeClient {
      public async connect(): Promise<void> {
        return
      }
      public async end(): Promise<void> {
        return
      }
      public async query(sql: string, params: unknown[]): Promise<any> {
        queries.push({ sql, params })
        if (fail) {
          throw fail
        }
        return { rows: [{ entity_id: 'p1' }] }
      }
    }
    const fakeRequire = (name: string): any => {
      if (name === 'pg') {
        return { Client: FakeClient }
      }
      if (name === 'next-auth/jwt') {
        return { getToken: async () => session }
      }
      throw new Error('unexpected require: ' + name)
    }
    const moduleObj: { exports: any } = { exports: {} }
    new Function('require', 'module', 'exports', 'process', 'console', code)(
      fakeRequire,
      moduleObj,
      moduleObj.exports,
      { env: { NEXTAUTH_SECRET: SECRET, TELEPORT_DB_CONNECTION_STRING: 'postgresql://x' } },
      { error: () => undefined, warn: () => undefined, log: () => undefined }
    )
    return async (params: {
      query?: Record<string, string>
      session?: FakeSession | null
      failWith?: Error
    }) => {
      queries.length = 0
      session = params.session || null
      fail = params.failWith || null
      let status = 0
      let body: any = null
      const res = {
        status(statusCode: number) {
          status = statusCode
          return this
        },
        json(payload: any) {
          body = payload
          return this
        },
      }
      await moduleObj.exports.handler(
        {
          method: 'GET',
          query: params.query || {},
          headers: { cookie: params.session ? 'next-auth.session-token=signed' : '' },
        },
        res
      )
      return { status, body, queries: queries.slice() }
    }
  }

  it("reads the signed-in user's id from the session, never from the query string", async () => {
    const route = boot(['currentUserId'])
    const result = await route({
      query: { currentUserId: 'victim-id' },
      session: { sub: 'me-id', id: 'me-id' },
    })
    expect(result.status).toBe(200)
    expect(result.queries).toHaveLength(1)
    expect(result.queries[0].params).toEqual(['me-id'])
  })

  it('answers no rows, without a query, when there is no session', async () => {
    const route = boot(['currentUserId'])
    const result = await route({ query: { currentUserId: 'victim-id' } })
    expect(result.status).toBe(200)
    expect(result.body.data).toEqual([])
    expect(result.queries).toEqual([])
  })

  it("keeps the details page's route param a request value", async () => {
    const route = boot(['currentUserId', 'currentPageEntityId'])
    const result = await route({
      query: { currentUserId: 'victim-id', currentPageEntityId: 'post-7' },
      session: { sub: 'me-id' },
    })
    expect(result.queries[0].params).toEqual(['me-id', 'post-7'])
  })

  it('keeps the database error out of the response', async () => {
    const route = boot(['currentUserId'])
    const result = await route({
      session: { sub: 'me-id' },
      failWith: new Error('column "secret_col" does not exist'),
    })
    expect(result.status).toBe(500)
    expect(JSON.stringify(result.body)).not.toContain('secret_col')
  })
})
