/* tslint:disable:function-constructor */
import { generateDataAPIRoute } from '../src/data-api-route-generator'

/**
 * An internal tool's tables (`UIDLAuthentication.restrictedTables`) through
 * `/api/data/<ds>/<op>`. Like the protected tables, no caller but the app's own
 * server code reaches them here: the staff read them through the per-table
 * routes with their session. Executed against a fake pg client — the verdict
 * is the status and the SQL that reached the database.
 */

const SECRET = 'server-secret'
const RESTRICTED = { tasks: ['admin', 'staff'] }

interface RouteResult {
  status: number
  queries: string[]
}

function bootRoute(secret: string | undefined, restrictedTables?: Record<string, string[]>) {
  const code = generateDataAPIRoute({ restrictedTables })
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
      if (/^SELECT COUNT/i.test(sql)) {
        return { rows: [{ count: '0' }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }
  }
  const moduleObj: { exports: any } = { exports: {} }
  const fakeRequire = (name: string): any => {
    if (name === 'pg') {
      return { Client: FakeClient }
    }
    if (name === 'next-auth/jwt') {
      return { getToken: async (): Promise<null> => null }
    }
    throw new Error('unexpected require: ' + name)
  }
  new Function('require', 'module', 'exports', 'process', 'console', code)(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    { env: { NEXTAUTH_SECRET: secret, TELEPORT_DB_CONNECTION_STRING: 'postgresql://x' } },
    { error: (): void => undefined, warn: (): void => undefined, log: (): void => undefined }
  )
  const handler = moduleObj.exports
  return async (
    operation: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {}
  ): Promise<RouteResult> => {
    queries.length = 0
    let status = 0
    const res = {
      status(statusCode: number) {
        status = statusCode
        return this
      },
      json() {
        return this
      },
    }
    await handler({ method: 'POST', query: { params: ['ds-1', operation] }, headers, body }, res)
    return { status, queries: queries.slice() }
  }
}

const internal = { 'x-internal-data-secret': SECRET }
// The AI data-query node: the secret, but SQL it did not write.
const restrictedSql = { 'x-internal-data-secret': SECRET, 'x-tq-restricted-sql': '1' }

describe('data API — restricted tables', () => {
  const run = bootRoute(SECRET, RESTRICTED)

  it('refuses a browser every operation on one', async () => {
    for (const operation of ['select', 'count', 'update', 'delete']) {
      const result = await run(operation, { tableName: 'tasks', filters: [] })
      expect(result.status).toBe(403)
      expect(result.queries).toEqual([])
    }
  })

  it('refuses the restricted-SQL node a statement or a structured read that reaches one', async () => {
    for (const query of [
      'SELECT * FROM tasks',
      'SELECT m.name FROM team_members m JOIN public."tasks" t ON t.owner_id = m.id',
    ]) {
      const raw = await run('raw-query', { query }, restrictedSql)
      expect(raw.status).toBe(403)
      expect(raw.queries).toEqual([])
    }
    expect((await run('select', { tableName: 'tasks' }, restrictedSql)).status).toBe(403)
    expect((await run('count', { tableName: 'public.tasks' }, restrictedSql)).status).toBe(403)
    expect(
      (await run('raw-query', { query: 'SELECT name FROM team_members' }, restrictedSql)).status
    ).toBe(200)
  })

  it("serves the app's own server code", async () => {
    expect((await run('select', { tableName: 'tasks' }, internal)).status).toBe(200)
    expect((await run('raw-query', { query: 'SELECT * FROM tasks' }, internal)).status).toBe(200)
  })

  it('refuses them where the app cannot tell its callers apart, and nothing else new', async () => {
    const open = bootRoute(undefined, RESTRICTED)
    expect((await open('select', { tableName: 'tasks' })).status).toBe(403)
    expect((await open('raw-query', { query: 'SELECT * FROM "tasks"' })).status).toBe(403)
    expect((await open('select', { tableName: 'team_members' })).status).toBe(200)
  })
})

describe('data API — projects without restricted tables are untouched', () => {
  it('emits the same route with the field absent or empty', () => {
    const absent = generateDataAPIRoute({})
    expect(generateDataAPIRoute({ restrictedTables: {} })).toBe(absent)
    expect(generateDataAPIRoute()).toBe(absent)
    expect(absent).not.toMatch(/__TA_RESTRICTED|__taRestricted|ReadRestricted/)
    expect(generateDataAPIRoute({ restrictedTables: RESTRICTED })).not.toBe(absent)
  })

  it('still serves a table a tool would list, to a caller the old rules admit', async () => {
    const open = bootRoute(undefined)
    expect((await open('select', { tableName: 'tasks' })).status).toBe(200)
  })
})
