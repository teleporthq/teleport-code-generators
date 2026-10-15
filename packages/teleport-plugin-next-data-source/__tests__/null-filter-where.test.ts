/* tslint:disable:function-constructor */
import { generateDataSourceFetcherWithCore } from '../src/data-source-fetchers'

/**
 * A board's "No status" column lists the rows whose status is empty. The GUI
 * sends that condition as `{ operand: '=', destination: null }` (and "has a
 * status" as `'!='` + null), the one null shape every fetcher answers with
 * `IS NULL` / `IS NOT NULL`. An operand the fetchers do not know is dropped
 * with its null value — and a list whose only condition was dropped reads the
 * whole table: every row in "No status", whose move button then overwrote the
 * real statuses. Verdicts come from the SQL the executed route sends.
 */

interface Captured {
  sql: string
  params: unknown[]
}

const bootRoute = (type: 'teleport' | 'postgresql') => {
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
            selectedTables: {
              team_events: { columns: [{ name: 'id' }, { name: 'priority' }] },
            },
          }
        : { host: 'h', port: 5432, user: 'u', password: 'p', database: 'd' },
  }
  const code = generateDataSourceFetcherWithCore(dataSource as never, 'team_events', false, {})
    .replace("import { Client } from 'pg'", "const { Client } = require('pg')")
    .replace(/^export default async function handler/m, 'async function handler')
    .replace(/^export \{[^}]*\}\s*$/m, '')
    .replace(/^export default \{[^}]*\}\s*$/m, '')
    .concat('\nmodule.exports = { handler: handler }')

  const captured: Captured[] = []
  class FakeClient {
    public async connect(): Promise<void> {
      return
    }
    public async end(): Promise<void> {
      return
    }
    public async query(sql: string, params: unknown[] = []): Promise<{ rows: any[] }> {
      captured.push({ sql, params })
      return { rows: [] }
    }
  }
  const moduleObj: { exports: any } = { exports: {} }
  new Function('require', 'module', 'exports', 'process', 'console', code)(
    (name: string) => {
      if (name === 'pg') {
        return { Client: FakeClient }
      }
      throw new Error('unexpected require: ' + name)
    },
    moduleObj,
    moduleObj.exports,
    { env: {} },
    { error: () => undefined, warn: () => undefined, log: () => undefined }
  )

  return async (filters: unknown): Promise<Captured> => {
    captured.length = 0
    let status = 0
    const res = {
      status(statusCode: number) {
        status = statusCode
        return this
      },
      json() {
        return this
      },
      setHeader() {
        return this
      },
    }
    await moduleObj.exports.handler(
      { method: 'GET', query: { filters: JSON.stringify(filters) }, headers: {} },
      res
    )
    expect(status).toBe(200)
    const select = captured.find((entry) => /FROM\s+"?team_events"?/i.test(entry.sql))
    if (!select) {
      throw new Error('the route never read team_events')
    }
    return select
  }
}

// The domain → UIDL mapper's output for one condition in the inspector's group.
const condition = (operand: string, destination: unknown = null) => [
  {
    type: 'group',
    operator: 'and',
    children: [{ type: 'condition', source: 'priority', destination, operand }],
  },
]

describe.each(['teleport', 'postgresql'] as const)('the %s read route', (type) => {
  const read = bootRoute(type)

  it('answers "is empty" (= null) with IS NULL', async () => {
    expect((await read(condition('='))).sql).toMatch(/WHERE\s+priority IS NULL/)
  })

  it('answers "is not empty" (!= null) with IS NOT NULL', async () => {
    expect((await read(condition('!='))).sql).toMatch(/WHERE\s+priority IS NOT NULL/)
  })

  it('still binds a plain value as a parameter', async () => {
    const select = await read(condition('=', 'high'))
    expect(select.sql).toMatch(/WHERE\s+priority = \$1/)
    expect(select.params).toEqual(expect.arrayContaining(['high']))
  })

  it('reads the whole table for an operand it does not know — why the mapper never sends one', async () => {
    expect((await read(condition('is_null'))).sql).not.toMatch(/WHERE/)
  })
})
