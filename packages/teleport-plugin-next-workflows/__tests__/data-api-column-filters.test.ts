import { generateDataAPIRoute } from '../src/data-api-route-generator'
import { generateServerSegmentAPIRoute } from '../src/api-route-generator'
import { splitIntoSegments } from '../src/segment-splitter'
import { buildSegmentTrust } from '../src/segment-trust'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'
import { isSecurityRuntimeSpecifier, loadSecurityRuntime } from './_helpers/load-security-runtime'

// A data step's filter names its column under `column`, `source` or `field`
// (the editor's templates write `{ column, operator, value }`). The data API
// reads the same column everywhere a filter is read: the identifier check, the
// WHERE clause of a read, a count and a write, and the visitor's identity
// binding. These run the GENERATED data API route over an in-memory table.

type Row = Record<string, unknown>

const SECRET = 'column-filters-test-secret'

/**
 * The statements the data API sends for a read, a count, an update and a
 * delete whose conditions are `column = $n`, over tables held in memory. Any
 * other statement fails, so a change in the generated SQL fails a test
 * instead of passing it vacuously.
 */
class TableStore {
  public readonly statements: string[] = []

  constructor(public readonly tables: Record<string, Row[]>) {}

  public query(sql: string, params: unknown[] = []): { rows: Row[]; rowCount: number } {
    this.statements.push(sql)
    if (/^SELECT column_name, data_type FROM information_schema\.columns/.test(sql)) {
      const rows = this.tables[String(params[1])] || []
      return {
        rows: Object.keys(rows[0] || {}).map((name) => ({ column_name: name, data_type: 'text' })),
        rowCount: 0,
      }
    }
    let match = /^SELECT COUNT\(\*\) FROM (\w+)(?: WHERE (.+))?$/.exec(sql)
    if (match) {
      const count = this.matching(match[1], match[2], params).length
      return { rows: [{ count: String(count) }], rowCount: 1 }
    }
    match = /^SELECT \* FROM (\w+)(?: WHERE (.+?))?$/.exec(sql)
    if (match) {
      const rows = this.matching(match[1], match[2], params).map((row) => ({ ...row }))
      return { rows, rowCount: rows.length }
    }
    match = /^UPDATE (\w+) SET (.+?) WHERE (.+) RETURNING \*$/.exec(sql)
    if (match) {
      const rows = this.matching(match[1], match[3], params)
      for (const row of rows) {
        for (const assignment of match[2].split(', ')) {
          const set = /^(\w+) = \$(\d+)$/.exec(assignment)
          if (!set) {
            throw new Error(`unexpected assignment: ${assignment}`)
          }
          row[set[1]] = params[Number(set[2]) - 1]
        }
      }
      return { rows: rows.map((row) => ({ ...row })), rowCount: rows.length }
    }
    match = /^DELETE FROM (\w+) WHERE (.+)$/.exec(sql)
    if (match) {
      const doomed = this.matching(match[1], match[2], params)
      this.tables[match[1]] = this.tables[match[1]].filter((row) => doomed.indexOf(row) === -1)
      return { rows: [], rowCount: doomed.length }
    }
    throw new Error(`unexpected statement: ${sql}`)
  }

  private matching(table: string, where: string | undefined, params: unknown[]): Row[] {
    const rows = this.tables[table]
    if (!rows) {
      throw new Error(`unknown table: ${table}`)
    }
    if (!where) {
      return rows
    }
    const conditions = where.split(' AND ').map((condition) => {
      if (condition === 'FALSE') {
        return () => false
      }
      const equals = /^(\w+) = \$(\d+)$/.exec(condition)
      if (!equals) {
        throw new Error(`unexpected condition: ${condition}`)
      }
      return (row: Row) => String(row[equals[1]]) === String(params[Number(equals[2]) - 1])
    })
    return rows.filter((row) => conditions.every((holds) => holds(row)))
  }
}

interface DataReply {
  status: number
  body: any
}

const bootDataRoute = (store: TableStore) => {
  const securityRuntime = loadSecurityRuntime()
  class FakeClient {
    public async connect(): Promise<void> {
      return
    }
    public async end(): Promise<void> {
      return
    }
    public async query(sql: string, params?: unknown[]) {
      return store.query(sql, params)
    }
  }
  const moduleObj: { exports: any } = { exports: {} }
  // tslint:disable-next-line:function-constructor
  new Function('require', 'module', 'exports', 'process', 'console', generateDataAPIRoute())(
    (name: string): any => {
      if (name === 'pg') {
        return { Client: FakeClient }
      }
      if (name === 'next-auth/jwt') {
        return { getToken: async (): Promise<null> => null }
      }
      if (isSecurityRuntimeSpecifier(name)) {
        return securityRuntime
      }
      throw new Error('unexpected require: ' + name)
    },
    moduleObj,
    moduleObj.exports,
    { env: { NEXTAUTH_SECRET: SECRET, TELEPORT_DB_CONNECTION_STRING: 'postgresql://x' } },
    {
      error: (): undefined => undefined,
      warn: (): undefined => undefined,
      log: (): undefined => undefined,
    }
  )
  return async (
    operation: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = { 'x-internal-data-secret': SECRET }
  ): Promise<DataReply> => {
    const reply: DataReply = { status: 0, body: null }
    await moduleObj.exports(
      { method: 'POST', query: { params: ['ds-1', operation] }, headers, body },
      {
        status(code: number) {
          reply.status = code
          return this
        },
        json(payload: unknown) {
          reply.body = payload
          return this
        },
      }
    )
    return reply
  }
}

const appointment = (id: string, date: string, time: string, status: string): Row => ({
  id,
  date,
  time,
  status,
})

const appointments = (): Row[] => [
  appointment('a-1', '2026-12-01', '10:00', 'confirmed'),
  appointment('a-2', '2026-12-01', '11:00', 'confirmed'),
  appointment('a-3', '2026-12-02', '10:00', 'confirmed'),
  appointment('a-4', '2026-12-01', '10:00', 'cancelled'),
]

// "Book Appointment": the slot the visitor asked for, among the confirmed ones.
const SLOT_FILTERS = [
  { column: 'date', operator: '=', value: '2026-12-01' },
  { column: 'time', operator: '=', value: '10:00' },
  { column: 'status', operator: '=', value: 'confirmed' },
]

const ids = (rows: Row[]) => rows.map((row) => row.id)

describe('a data step filter written { column, operator, value }', () => {
  it('reads only the rows the filters match', async () => {
    const data = bootDataRoute(new TableStore({ appointments: appointments() }))
    const reply = await data('select', { tableName: 'appointments', filters: SLOT_FILTERS })
    expect(reply.status).toBe(200)
    expect(ids(reply.body.rows)).toEqual(['a-1'])
    expect(reply.body.count).toBe(1)
  })

  it('counts only the rows the filters match', async () => {
    const data = bootDataRoute(new TableStore({ appointments: appointments() }))
    const reply = await data('count', { tableName: 'appointments', filters: SLOT_FILTERS })
    expect(reply.status).toBe(200)
    expect(reply.body.count).toBe(1)
  })

  it('reads the same rows as the filters written { field } and { source }', async () => {
    const data = bootDataRoute(new TableStore({ appointments: appointments() }))
    const byColumn = await data('select', { tableName: 'appointments', filters: SLOT_FILTERS })
    const byField = await data('select', {
      tableName: 'appointments',
      filters: SLOT_FILTERS.map(({ column, ...rest }) => ({ field: column, ...rest })),
    })
    const bySource = await data('select', {
      tableName: 'appointments',
      filters: SLOT_FILTERS.map(({ column, value }) => ({
        source: column,
        destination: value,
        operand: '=',
      })),
    })
    expect(ids(byField.body.rows)).toEqual(ids(byColumn.body.rows))
    expect(ids(bySource.body.rows)).toEqual(ids(byColumn.body.rows))
  })

  it('updates only the rows the filters match', async () => {
    const store = new TableStore({ appointments: appointments() })
    const data = bootDataRoute(store)
    const reply = await data('update', {
      tableName: 'appointments',
      columnMappings: { status: 'cancelled' },
      filters: SLOT_FILTERS,
    })
    expect(reply.status).toBe(200)
    expect(reply.body.updatedCount).toBe(1)
    expect(store.tables.appointments.map((row) => `${row.id}:${row.status}`)).toEqual([
      'a-1:cancelled',
      'a-2:confirmed',
      'a-3:confirmed',
      'a-4:cancelled',
    ])
  })

  it('deletes only the rows the filters match', async () => {
    const store = new TableStore({ appointments: appointments() })
    const data = bootDataRoute(store)
    const reply = await data('delete', {
      tableName: 'appointments',
      filters: [{ column: 'id', operator: '=', value: 'a-2' }],
    })
    expect(reply.status).toBe(200)
    expect(reply.body).toMatchObject({ deletedCount: 1, deletedId: 'a-2' })
    expect(ids(store.tables.appointments)).toEqual(['a-1', 'a-3', 'a-4'])
  })

  it('refuses a column that is no identifier, under whichever key it is named', async () => {
    const store = new TableStore({ appointments: appointments() })
    const data = bootDataRoute(store)
    const reply = await data('select', {
      tableName: 'appointments',
      filters: [{ column: 'id = id OR 1', operator: '=', value: 'a-1' }],
    })
    expect(reply.status).toBe(400)
    expect(store.statements.filter((sql) => /appointments/.test(sql))).toEqual([])
  })

  it('still refuses a write whose filter names no column', async () => {
    const store = new TableStore({ appointments: appointments() })
    const data = bootDataRoute(store)
    const reply = await data('update', {
      tableName: 'appointments',
      columnMappings: { status: 'cancelled' },
      filters: [{ operator: '=', value: 'a-1' }],
    })
    expect(reply.status).toBe(400)
    expect(store.tables.appointments.map((row) => row.status)).toEqual([
      'confirmed',
      'confirmed',
      'confirmed',
      'cancelled',
    ])
  })
})

describe('a read bound to the visitor by a { column } filter', () => {
  const getToken = async ({ req }: { req: any }) => (req && req.__token) || null

  const savedSecret = process.env.NEXTAUTH_SECRET
  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = SECRET
  })
  afterAll(() => {
    if (savedSecret === undefined) {
      delete process.env.NEXTAUTH_SECRET
    } else {
      process.env.NEXTAUTH_SECRET = savedSecret
    }
  })

  // "My Reports": the signed-in visitor, then the reports they filed.
  const graph = {
    id: 'wf-my-reports',
    nodes: [
      {
        id: 'currentUser',
        type: 'account-get-current',
        label: 'Get Current User',
        stepNumber: 1,
        config: {},
      },
      {
        id: 'myReports',
        type: 'data-select',
        label: 'My Reports',
        stepNumber: 2,
        config: {
          dataSourceId: 'ds-1',
          tableName: 'content_reports',
          filters: [
            {
              column: 'reporter_id',
              operator: '=',
              value: {
                type: 'workflowContext',
                nodeId: 'currentUser',
                path: ['currentUser', 'id'],
              },
            },
          ],
        },
      },
    ],
    edges: [{ id: 'e1', source: 'currentUser', target: 'myReports' }],
  }

  const reports = (): Row[] => [
    { id: 'r-1', reporter_id: 'u-1', content_id: 'c-1' },
    { id: 'r-2', reporter_id: 'u-2', content_id: 'c-1' },
    { id: 'r-3', reporter_id: 'u-1', content_id: 'c-2' },
  ]

  const bootSegment = () => {
    const segments = splitIntoSegments({ ...graph, trigger: { type: 'manual' } } as any)
    const server = segments.find((s) => s.env === 'server') as WorkflowSegment
    const trust = buildSegmentTrust(server, { ...graph, segments })
    const source = generateServerSegmentAPIRoute(server, graph.id, undefined, { trust })
    const runtime = loadServerRuntime({ getToken })
    const routeModule: { exports: any } = { exports: {} }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('module', 'exports', 'require', source)(
      routeModule,
      routeModule.exports,
      (id: string) => (id.endsWith('server-runtime') ? runtime : {})
    )
    return { trust, handler: routeModule.exports as (req: unknown, res: unknown) => Promise<void> }
  }

  /** Runs the segment for `token`, its data step answered by the data API route. */
  const runAs = async (token: Record<string, unknown> | null, context: Record<string, unknown>) => {
    const store = new TableStore({ content_reports: reports() })
    const data = bootDataRoute(store)
    const { handler } = bootSegment()
    const scope = globalThis as Record<string, unknown>
    const previousFetch = scope.fetch
    scope.fetch = async (url: string, init: { headers: Record<string, string>; body: string }) => {
      const operation = String(url).split('/').pop() as string
      const headers: Record<string, string> = {}
      Object.keys(init.headers || {}).forEach((name) => {
        headers[name.toLowerCase()] = init.headers[name]
      })
      const answer = await data(operation, JSON.parse(init.body), headers)
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        json: async () => answer.body,
      }
    }
    try {
      const reply: { status: number; body: any } = { status: 0, body: null }
      await handler(
        {
          method: 'POST',
          body: { context: JSON.parse(JSON.stringify(context)) },
          headers: token
            ? { host: 'localhost:3000', cookie: 'next-auth.session-token=signed' }
            : { host: 'localhost:3000' },
          __token: token,
        },
        {
          setHeader: (): undefined => undefined,
          status(code: number) {
            reply.status = code
            return this
          },
          json(payload: unknown) {
            reply.body = payload
            return this
          },
        }
      )
      return { reply, store }
    } finally {
      scope.fetch = previousFetch
    }
  }

  it('is a read the route binds to the visitor', () => {
    expect(bootSegment().trust.session?.identityReads).toEqual({ myReports: ['reporter_id'] })
  })

  it("reads the signed-in visitor's rows, whatever user the request names", async () => {
    const { reply } = await runAs(
      { id: 'u-1', email: 'one@shop.test' },
      { currentUser: { id: 'u-2', user: { id: 'u-2' } } }
    )
    expect(reply.status).toBe(200)
    expect(ids(reply.body.results.myReports.rows)).toEqual(['r-1', 'r-3'])
  })

  it('reads nothing for a guest', async () => {
    const { reply, store } = await runAs(null, { currentUser: { id: 'u-2', user: { id: 'u-2' } } })
    expect(reply.status).toBe(200)
    expect(reply.body.results.myReports.rows).toEqual([])
    expect(store.statements.filter((sql) => /content_reports/.test(sql))).toEqual([])
  })
})
