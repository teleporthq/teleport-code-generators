/* tslint:disable:function-constructor */
import { generateDataAPIRoute } from '../src/data-api-route-generator'
import { isSecurityRuntimeSpecifier, loadSecurityRuntime } from './_helpers/load-security-runtime'

// The data routes compare the app secret with the shared runtime's safeEqual.
const securityRuntime = loadSecurityRuntime()

/**
 * The generated `/api/data/<ds>/<op>` route answers a request whose body is
 * empty or is not a JSON object with 400, without opening a database
 * connection; it used to fail with a 500 parsing it.
 */

const SECRET = 'server-secret'

interface RouteResult {
  status: number
  body: any
  connections: number
  queries: string[]
}

function bootRoute() {
  const queries: string[] = []
  let connections = 0
  class FakeClient {
    public async connect(): Promise<void> {
      connections++
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
      return { getToken: async () => null }
    }
    if (isSecurityRuntimeSpecifier(name)) {
      return securityRuntime
    }
    throw new Error('unexpected require: ' + name)
  }
  new Function('require', 'module', 'exports', 'process', 'console', generateDataAPIRoute())(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    { env: { NEXTAUTH_SECRET: SECRET, TELEPORT_DB_CONNECTION_STRING: 'postgresql://x' } },
    { error: () => undefined, warn: () => undefined, log: () => undefined }
  )
  const handler = moduleObj.exports
  return async (body: unknown): Promise<RouteResult> => {
    queries.length = 0
    connections = 0
    const result: RouteResult = { status: 0, body: null, connections: 0, queries: [] }
    const res = {
      status(statusCode: number) {
        result.status = statusCode
        return this
      },
      json(payload: any) {
        result.body = payload
        return this
      },
    }
    await handler(
      {
        method: 'POST',
        query: { params: ['ds-1', 'select'] },
        headers: { 'x-internal-data-secret': SECRET },
        body,
      },
      res
    )
    result.connections = connections
    result.queries = queries.slice()
    return result
  }
}

describe('data API — a request body that is not a JSON object', () => {
  const run = bootRoute()

  it.each([
    ['an empty body', ''],
    ['text that is not JSON', 'tableName=products'],
    ['truncated JSON', '{"tableName": "prod'],
    ['no body', undefined],
    ['a JSON null', 'null'],
    ['a JSON array', '[{"tableName":"products"}]'],
    ['a parsed array', [{ tableName: 'products' }]],
  ])('answers 400 to %s, without touching the database', async (_label, body) => {
    const result = await run(body)

    expect(result.status).toBe(400)
    expect(result.body).toEqual({ error: 'Invalid request body. Expected a JSON object.' })
    expect(result.connections).toBe(0)
    expect(result.queries).toEqual([])
  })

  it('still reads a JSON object sent as a string', async () => {
    const result = await run(JSON.stringify({ tableName: 'products' }))

    expect(result.status).toBe(200)
    expect(result.queries.some((sql) => /FROM "?products"?/i.test(sql))).toBe(true)
  })
})
