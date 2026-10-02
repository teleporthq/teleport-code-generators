/* tslint:disable:function-constructor max-classes-per-file */
import type { UIDLAuthentication } from '@teleporthq/teleport-types'
import { generateDataSourceFetcherWithCore } from '../src/data-source-fetchers'
import { buildProductTransformOptions, type EntityTransformOptions } from '../src/transformations'

/**
 * An internal tool's tables (`UIDLAuthentication.restrictedTables`) are read
 * from a browser only by the staff and the administrators it lists. Every table
 * a page binds gets a read route (`/api/teleport-<table>-<source>` plus its
 * `-count` twin) that used to serve it whole, and any single SELECT through
 * `?rawQuery=`, to whoever asked. The verdicts below are status codes and the
 * SQL that reached the database, from the executed route module.
 */

const SECRET = 'server-secret'

const TOOL_AUTH: UIDLAuthentication = {
  enabled: true,
  dataSourceId: 'ds-1',
  dataSourceType: 'teleport',
  passwordAuthEnabled: true,
  providers: [],
  roles: ['admin', 'staff', 'user'],
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
  restrictedTables: { tasks: ['admin', 'staff'] },
}

interface FakeSession {
  role?: string
}

interface RouteResult {
  status: number
  body: any
  queries: string[]
}

interface BootOptions {
  type?: 'teleport' | 'postgresql'
  appSecret?: string | null
  cache?: { scope: string; ttlSeconds: number; sMaxAge?: number }
  transformOptions?: EntityTransformOptions
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
            selectedTables: { [tableName]: { columns: [{ name: 'id', type: 'uuid' }] } },
          }
        : { host: 'h', port: 5432, user: 'u', password: 'p', database: 'd' },
  }
  const esm = generateDataSourceFetcherWithCore(
    dataSource as never,
    tableName,
    false,
    options.transformOptions || buildProductTransformOptions({ authentication: TOOL_AUTH }),
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
        return { rows: [{ count: '1' }], rowCount: 1 }
      }
      return { rows: [{ id: 't1', title: 'Payroll run' }], rowCount: 1 }
    }
  }
  // A working cache: a 200 is kept per scope and query string and served to
  // whoever asks that scope next — the way a cache entry leaks if a reader's
  // view lands in the wrong scope.
  const store = new Map<string, any>()
  const scopesUsed: string[] = []
  const tqWithCache = (fn: any, opts: any) => async (req: any, res: any) => {
    scopesUsed.push(opts.scope)
    const key = opts.scope + '|' + JSON.stringify(req.query || {})
    if (store.has(key)) {
      return res.status(200).json(store.get(key))
    }
    let status = 200
    let payload: any
    const proxy = {
      status(statusCode: number) {
        status = statusCode
        return proxy
      },
      json(data: any) {
        payload = data
        return proxy
      },
    }
    await fn(req, proxy)
    if (status === 200 && payload && payload.success) {
      store.set(key, payload)
    }
    return res.status(status).json(payload)
  }
  const fakeRequire = (name: string): any => {
    if (name === 'pg') {
      return { Client: FakeClient }
    }
    if (name === 'tq-cache') {
      return { tqWithCache }
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
    { error: (): void => undefined, warn: (): void => undefined, log: (): void => undefined }
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

  const serverCall = async (name: 'fetchData' | 'fetchCount'): Promise<unknown> => {
    queries.length = 0
    session = null
    return moduleObj.exports[name]({})
  }

  return { run, serverCall, scopesUsed, code }
}

const internal = { 'x-internal-data-secret': SECRET }
const guest: FakeSession | null = null
const shopper = { role: 'user' }
const staff = { role: 'staff' }
const admin = { role: 'admin' }

describe.each(['teleport', 'postgresql'] as const)(
  'per-table read routes (%s) — a restricted table is read by its staff only',
  (type) => {
    const tasks = bootTableRoute('tasks', { type })
    const members = bootTableRoute('team_members', { type })

    it('refuses a guest (401) and a shopper (403) before the database is touched, list and count', async () => {
      for (const handler of ['handler', 'getCount'] as const) {
        const anonymous = await tasks.run({ handler, session: guest })
        expect(anonymous.status).toBe(401)
        expect(anonymous.queries).toEqual([])
        const user = await tasks.run({ handler, session: shopper })
        expect(user.status).toBe(403)
        expect(user.queries).toEqual([])
      }
    })

    it('serves the staff and the administrators, list and count', async () => {
      for (const session of [staff, admin]) {
        const list = await tasks.run({ session })
        expect(list.status).toBe(200)
        expect(list.queries.some((sql) => /FROM "?tasks"?/i.test(sql))).toBe(true)
        expect((await tasks.run({ handler: 'getCount', session })).status).toBe(200)
      }
    })

    it("serves the app's own server code: the secret, and the module's fetchData / fetchCount", async () => {
      expect((await tasks.run({ headers: internal })).status).toBe(200)
      expect((await tasks.run({ handler: 'getCount', headers: internal })).status).toBe(200)
      await expect(tasks.serverCall('fetchData')).resolves.toHaveLength(1)
      await expect(tasks.serverCall('fetchCount')).resolves.toBe(1)
    })

    it('leaves a table the tool does not list readable as before', async () => {
      expect((await members.run({ session: guest })).status).toBe(200)
      expect((await members.run({ handler: 'getCount', session: guest })).status).toBe(200)
    })
  }
)

describe('per-table read routes — raw statements that mention a restricted table', () => {
  it('refuses a browser any raw statement in an app with a secret, staff included', async () => {
    const teleport = bootTableRoute('team_members')
    for (const session of [guest, shopper, staff, admin]) {
      const result = await teleport.run({ query: { rawQuery: 'SELECT * FROM tasks' }, session })
      expect(result.status).toBe(403)
      expect(result.queries).toEqual([])
    }
    const server = await teleport.run({
      query: { rawQuery: 'SELECT * FROM tasks' },
      headers: internal,
    })
    expect(server.status).toBe(200)
  })

  it('refuses a statement that names one where the app cannot tell its callers apart', async () => {
    // No secret: no browser is refused raw SQL outright, so the statement scan
    // decides — and without a secret no session decodes, so nobody passes it.
    const open = bootTableRoute('team_members', { appSecret: null })
    for (const rawQuery of [
      'SELECT * FROM tasks',
      'SELECT m.name, t.title FROM team_members m JOIN public."tasks" t ON t.owner_id = m.id',
    ]) {
      for (const session of [guest, shopper, staff]) {
        const refused = await open.run({ query: { rawQuery }, session })
        expect(refused.status).toBe(401)
        expect(refused.queries).toEqual([])
      }
    }
    expect(
      (await open.run({ query: { rawQuery: "SELECT 1 FROM team_members WHERE n = 'tasks'" } }))
        .status
    ).toBe(200)
  })
})

describe('per-table read routes — the response cache never serves a restricted read to a guest', () => {
  const CACHE = { scope: 'ds-1:tasks', ttlSeconds: 60, sMaxAge: 30 }

  it('answers a staff read uncached and an admin read from the private scope; a guest is still refused', async () => {
    const tasks = bootTableRoute('tasks', { cache: CACHE })

    tasks.scopesUsed.length = 0
    expect((await tasks.run({ session: staff })).status).toBe(200)
    // The staff role is admitted by the table but not trusted by the row policy
    // (the admin folder admits only `admin` here): never cached.
    expect(tasks.scopesUsed).toEqual([])

    tasks.scopesUsed.length = 0
    expect((await tasks.run({ session: admin })).status).toBe(200)
    expect(tasks.scopesUsed).toEqual(['ds-1:tasks:trusted'])

    // The same URL, asked by a guest and a shopper after both reads were served.
    tasks.scopesUsed.length = 0
    const anonymous = await tasks.run({ session: guest })
    expect(anonymous.status).toBe(401)
    expect(anonymous.body.data).toBeUndefined()
    expect((await tasks.run({ session: shopper })).status).toBe(403)
    expect(tasks.scopesUsed).toEqual([])

    tasks.scopesUsed.length = 0
    expect((await tasks.run({ handler: 'getCount', session: guest })).status).toBe(401)
    expect((await tasks.run({ handler: 'getCount', session: admin })).status).toBe(200)
    expect(tasks.scopesUsed).toEqual(['ds-1:tasks:count:trusted'])
  })

  it('caches the staff privately once the admin folder trusts them too', async () => {
    const tasks = bootTableRoute('tasks', {
      cache: CACHE,
      transformOptions: {
        trustedReaderRoles: ['admin', 'staff'],
        restrictedTables: { tasks: ['admin', 'staff'] },
      },
    })
    expect((await tasks.run({ session: staff })).status).toBe(200)
    expect(tasks.scopesUsed).toEqual(['ds-1:tasks:trusted'])
    expect((await tasks.run({ session: guest })).status).toBe(401)
  })

  it('keeps an unrestricted table of the same project in the shared view', async () => {
    const members = bootTableRoute('team_members', {
      cache: { scope: 'ds-1:team_members', ttlSeconds: 60 },
    })
    await members.run({ session: guest })
    expect(members.scopesUsed).toEqual(['ds-1:team_members'])
  })
})

describe('per-table read routes — projects without restricted tables are untouched', () => {
  const NO_TOOL_AUTH: UIDLAuthentication = { ...TOOL_AUTH }
  delete NO_TOOL_AUTH.restrictedTables

  it('adds no option and emits the same module with the field absent or empty', () => {
    const absent = buildProductTransformOptions({ authentication: NO_TOOL_AUTH })
    const empty = buildProductTransformOptions({
      authentication: { ...NO_TOOL_AUTH, restrictedTables: {} },
    })
    expect(absent).not.toHaveProperty('restrictedTables')
    expect(empty).toEqual(absent)
    for (const type of ['teleport', 'postgresql'] as const) {
      for (const cache of [undefined, { scope: 'ds-1:tasks', ttlSeconds: 60, sMaxAge: 30 }]) {
        const code = bootTableRoute('tasks', { type, cache, transformOptions: absent }).code
        expect(code).toBe(bootTableRoute('tasks', { type, cache, transformOptions: empty }).code)
        expect(code).not.toMatch(/__TA_RESTRICTED|__taRestricted|ReadRestricted/)
      }
    }
  })

  it('serves a guest the table it served before', async () => {
    const tasks = bootTableRoute('tasks', {
      transformOptions: buildProductTransformOptions({ authentication: NO_TOOL_AUTH }),
    })
    expect((await tasks.run({ session: guest })).status).toBe(200)
  })
})
