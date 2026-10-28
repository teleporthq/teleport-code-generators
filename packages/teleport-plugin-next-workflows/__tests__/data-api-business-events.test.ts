/* tslint:disable:function-constructor */
import { DataAPIRouteOptions, generateDataAPIRoute } from '../src/data-api-route-generator'
import { generateAppEventsModuleCode } from '../src/automations/app-events-source'
import { insertedLines } from './_helpers/inserted-lines'
import { isSecurityRuntimeSpecifier, loadSecurityRuntime } from './_helpers/load-security-runtime'

// The data routes compare the app secret with the shared runtime's safeEqual.
const securityRuntime = loadSecurityRuntime()

/**
 * The data API in a project with automations (spec §5.1):
 *
 * - every successful write to `teleport_events` that comes through it — the
 *   shared "Record Order Event" writer's create, the order event claims' raw
 *   `WITH claim AS (INSERT INTO teleport_events …)` — wakes the automations'
 *   queue, once the write has succeeded and never on the error path;
 * - each product a low-stock scan finds is recorded as `product-low-stock`
 *   through `utils/app-events.js`, one event per product and stock level, off
 *   the request path.
 *
 * Without automations the route is generated exactly as before. The route is
 * EXECUTED against a fake pg client, its modules stubbed.
 */

type Row = Record<string, unknown>

const SECRET = 'server-secret'
const internal = { 'x-internal-data-secret': SECRET, host: 'shop.test' }
const BUS = '../../../lib/automations/event-bus'
const WAIT_UNTIL = '../../../lib/automations/wait-until'
const APP_EVENTS = '../../../utils/app-events'
const DUE_CHECK = '../../../lib/automations/due-check'

const LOW_STOCK_SELECT =
  "SELECT id, name, quantity AS stock, COALESCE(sku, '') AS sku FROM teleport_products " +
  "WHERE quantity IS NOT NULL AND quantity <= 5 AND id IN ('p1','p2')"
const LOW_STOCK_ROWS = [
  { id: 'p1', name: 'Beeswax Candle', stock: 2, sku: 'BWC-01' },
  { id: 'p2', name: 'Linen Napkin', stock: 0, sku: '' },
]

interface Statement {
  client: number
  sql: string
  values: unknown[]
}

interface Booted {
  run: (operation: string, body: Row) => Promise<{ status: number; body: unknown; req: Row }>
  statements: Statement[]
  wakes: unknown[]
  kicks: unknown[]
  background: Array<Promise<unknown>>
  posted: string[]
}

type QueryAnswer = { rows: Row[]; rowCount: number } | Error

const boot = (
  options: DataAPIRouteOptions,
  failOn?: RegExp,
  // Answers a statement the way a database would, when it answers it at all.
  answer?: (sql: string) => QueryAnswer | undefined
): Booted => {
  const code = generateDataAPIRoute(options)
  const statements: Statement[] = []
  const wakes: unknown[] = []
  const kicks: unknown[] = []
  const background: Array<Promise<unknown>> = []
  const posted: string[] = []
  let clients = 0
  class FakeClient {
    private id = ++clients

    public async connect(): Promise<void> {
      return
    }

    public async end(): Promise<void> {
      return
    }

    public async query(
      sql: string,
      values?: unknown[]
    ): Promise<{ rows: Row[]; rowCount: number }> {
      statements.push({ client: this.id, sql, values: values || [] })
      if (failOn && failOn.test(sql)) {
        throw new Error('the database refused it')
      }
      const answered = answer ? answer(sql) : undefined
      if (answered instanceof Error) {
        throw answered
      }
      if (answered) {
        return answered
      }
      if (/information_schema/i.test(sql)) {
        return { rows: [], rowCount: 0 }
      }
      if (sql === LOW_STOCK_SELECT) {
        return { rows: LOW_STOCK_ROWS, rowCount: LOW_STOCK_ROWS.length }
      }
      if (/^\s*INSERT INTO teleport_events/i.test(sql)) {
        return { rows: [{ id: String(statements.length) }], rowCount: 1 }
      }
      return { rows: [{ id: 'row-1' }], rowCount: 1 }
    }
  }
  const bus = {
    scheduleDispatch: (req: unknown) => {
      wakes.push(req)
      return 'fetch'
    },
  }
  const quiet = { error: () => undefined, warn: () => undefined, log: () => undefined }
  // The real utils/app-events.js, for a project with automations.
  const appEvents = { exports: {} as Row }
  new Function(
    'module',
    'exports',
    'require',
    'console',
    generateAppEventsModuleCode({ withAutomations: true })
  )(
    appEvents,
    appEvents.exports,
    (id: string) => {
      if (id === '../lib/automations/event-bus') {
        return bus
      }
      // tslint:disable-next-line:no-var-requires
      return require(id)
    },
    quiet
  )
  const modules: Record<string, unknown> = {
    pg: { Client: FakeClient },
    [BUS]: bus,
    [WAIT_UNTIL]: {
      waitUntil: (work: Promise<unknown>) => {
        background.push(work)
      },
    },
    [APP_EVENTS]: appEvents.exports,
    [DUE_CHECK]: {
      kickWhenDue: (req: unknown) => {
        kicks.push(req)
        return null
      },
    },
  }
  const fakeRequire = (name: string): unknown => {
    if (Object.prototype.hasOwnProperty.call(modules, name)) {
      return modules[name]
    }
    if (isSecurityRuntimeSpecifier(name)) {
      return securityRuntime
    }
    throw new Error('unexpected require: ' + name)
  }
  const fakeFetch = async (url: string) => {
    posted.push(url)
    return { ok: true, json: async () => ({}) }
  }
  const moduleObj: { exports: any } = { exports: {} }
  new Function('require', 'module', 'exports', 'process', 'console', 'fetch', code)(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    { env: { NEXTAUTH_SECRET: SECRET, TELEPORT_DB_CONNECTION_STRING: 'postgresql://x' } },
    quiet,
    fakeFetch
  )
  const handler = moduleObj.exports
  const run = async (operation: string, body: Row) => {
    let status = 0
    let responseBody: unknown = null
    const res = {
      status(statusCode: number) {
        status = statusCode
        return this
      },
      json(payload: unknown) {
        responseBody = payload
        return this
      },
    }
    const req = { method: 'POST', query: { params: ['ds-1', operation] }, headers: internal, body }
    await handler(req, res)
    return { status, body: responseBody, req }
  }
  return { run, statements, wakes, kicks, background, posted }
}

const eventCreate = {
  tableName: 'teleport_events',
  columnMappings: [
    { column: 'event_type', value: 'order-paid' },
    { column: 'dedupe_key', value: 'order-paid:o1' },
    { column: 'order_id', value: 'o1' },
  ],
}

describe('data API — a new business event wakes the automations', () => {
  it('wakes them after the shared writer creates a teleport_events row', async () => {
    const route = boot({ withAutomations: true })
    const result = await route.run('create', eventCreate)
    expect(result.status).toBe(200)
    expect(route.wakes).toEqual([result.req])

    await route.run('create', { ...eventCreate, tableName: 'public.teleport_events' })
    expect(route.wakes).toHaveLength(2)
  })

  it('wakes them after a raw query inserts into the ledger, however the table is written', async () => {
    const route = boot({ withAutomations: true })
    const inserts = [
      "WITH claim AS (\n  INSERT INTO teleport_events (event_type, dedupe_key) SELECT 'order-refunded', 'k' RETURNING id\n) SELECT COUNT(*) AS claimed FROM claim",
      'INSERT INTO "public"."teleport_events" (event_type) VALUES ($1)',
      'insert into public.teleport_events(event_type) values ($1)',
      'INSERT INTO "teleport_events" (event_type) VALUES ($1)',
    ]
    for (const query of inserts) {
      expect((await route.run('raw-query', { query, params: ['x'] })).status).toBe(200)
    }
    expect(route.wakes).toHaveLength(inserts.length)
  })

  it('leaves them asleep for any other write, a read of the ledger, or a failed write', async () => {
    const route = boot({ withAutomations: true })
    await route.run('create', { ...eventCreate, tableName: 'teleport_orders' })
    await route.run('raw-query', {
      query: 'SELECT * FROM teleport_events WHERE order_id = $1',
      params: ['o1'],
    })
    await route.run('raw-query', {
      query: 'INSERT INTO teleport_events_archive (id) VALUES ($1)',
      params: ['1'],
    })
    await route.run('update', {
      tableName: 'teleport_events',
      filters: [{ field: 'id', operator: '=', value: '1' }],
      columnMappings: [{ column: 'status', value: 'delivered' }],
    })
    expect(route.wakes).toEqual([])

    const failing = boot({ withAutomations: true }, /teleport_events/)
    expect((await failing.run('create', eventCreate)).status).toBe(500)
    expect(
      (
        await failing.run('raw-query', {
          query: 'INSERT INTO teleport_events (event_type) VALUES ($1)',
          params: ['x'],
        })
      ).status
    ).toBe(500)
    expect(failing.wakes).toEqual([])
  })

  it('leaves them asleep when the insert wrote nothing: a conflict it skipped, an error answered as empty, a claim lost', async () => {
    const CLAIM =
      "WITH claim AS (\n  INSERT INTO teleport_events (event_type, dedupe_key) SELECT 'order-paid', 'k' ON CONFLICT (dedupe_key) DO NOTHING RETURNING id\n)\nSELECT CASE WHEN EXISTS (SELECT 1 FROM claim) THEN 'true' ELSE 'false' END AS claimed"
    const INSERT = 'INSERT INTO teleport_events (event_type) VALUES ($1) ON CONFLICT DO NOTHING'
    const cases: Array<[string, QueryAnswer, number]> = [
      [INSERT, { rows: [], rowCount: 0 }, 0],
      [
        INSERT,
        Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' }),
        0,
      ],
      [CLAIM, { rows: [{ claimed: 'false' }], rowCount: 1 }, 0],
      [CLAIM, { rows: [{ claimed: 'true' }], rowCount: 1 }, 1],
      [INSERT, { rows: [], rowCount: 1 }, 1],
    ]
    for (const [query, answered, expected] of cases) {
      const route = boot({ withAutomations: true }, undefined, (sql) =>
        sql === query ? answered : undefined
      )
      const result = await route.run('raw-query', { query, params: ['x'] })
      expect({ query, answered, status: result.status, wakes: route.wakes.length }).toEqual({
        query,
        answered,
        status: 200,
        wakes: expected,
      })
    }
  })
})

describe('data API — the activity kick', () => {
  it('starts a check for due automation work on every request, before anything else', async () => {
    const route = boot({ withAutomations: true })
    const read = await route.run('select', { tableName: 'teleport_products', filters: [] })
    await route.run('create', { ...eventCreate, tableName: 'teleport_orders' })
    expect(route.kicks).toEqual([read.req, expect.anything()])
    const code = generateDataAPIRoute({ withAutomations: true })
    expect(code.indexOf('kickDueAutomations(req);')).toBeLessThan(
      code.indexOf('var params = req.query.params;')
    )
  })

  it('is not there without automations', async () => {
    const route = boot({})
    await route.run('select', { tableName: 'teleport_products', filters: [] })
    expect(route.kicks).toEqual([])
    expect(generateDataAPIRoute({})).not.toContain('due-check')
  })
})

describe('data API — the low-stock events', () => {
  it('records one product-low-stock event per product the scan found, off the request', async () => {
    const route = boot({ withAutomations: true, lowStockAlertsEnabled: true, lowStockThreshold: 5 })
    const result = await route.run('raw-query', { query: LOW_STOCK_SELECT })
    expect(result.status).toBe(200)
    expect(route.posted).toEqual(['https://shop.test/api/ecommerce/low-stock-alert'])
    // Kept alive by the platform, not awaited by the request.
    expect(route.background).toHaveLength(1)
    await Promise.all(route.background)

    const events = route.statements.filter((statement) =>
      /INSERT INTO teleport_events/.test(statement.sql)
    )
    // On a connection of their own, not the request's.
    expect(events.every((statement) => statement.client !== route.statements[0].client)).toBe(true)
    expect(events.map((statement) => statement.values)).toEqual([
      [
        'product-low-stock',
        'low-stock:p1:2',
        null,
        'product',
        'p1',
        JSON.stringify({
          product: { id: 'p1', name: 'Beeswax Candle', stock: 2, threshold: 5, sku: 'BWC-01' },
        }),
        null,
        'system',
      ],
      [
        'product-low-stock',
        'low-stock:p2:0',
        null,
        'product',
        'p2',
        JSON.stringify({ product: { id: 'p2', name: 'Linen Napkin', stock: 0, threshold: 5 } }),
        null,
        'system',
      ],
    ])
    // Each new event wakes the automations, on the origin the request reached.
    expect(route.wakes).toEqual([result.req, result.req])
  })

  it('records nothing when the low-stock alerts are off', async () => {
    const route = boot({ withAutomations: true, lowStockAlertsEnabled: false })
    await route.run('raw-query', { query: LOW_STOCK_SELECT })
    expect(route.background).toEqual([])
    expect(route.statements.some((statement) => /teleport_events/.test(statement.sql))).toBe(false)
  })
})

describe('data API — generated without automations', () => {
  it('is the same route whether the flag is off or left out', () => {
    for (const options of [{}, { lowStockAlertsEnabled: true, lowStockThreshold: 7 }]) {
      expect(generateDataAPIRoute({ ...options, withAutomations: false })).toBe(
        generateDataAPIRoute(options)
      )
    }
    const plain = generateDataAPIRoute({ lowStockAlertsEnabled: true })
    expect(plain).not.toContain('lib/automations')
    expect(plain).not.toContain('app-events')
  })

  it('gains only the wake-up and the low-stock events with automations', () => {
    const options = { lowStockAlertsEnabled: true, lowStockThreshold: 7 }
    const diff = insertedLines(
      generateDataAPIRoute(options),
      generateDataAPIRoute({ ...options, withAutomations: true })
    )
    expect(diff.kept).toBe(true)
    const added = diff.inserted.join('\n')
    expect(added).toContain('function wroteBusinessEvent(operation, body, result, req)')
    expect(added).toContain('if (wroteBusinessEvent(operation, body, result, req)) {')
    expect(added).toContain('kickDueAutomations(req);')
    expect(added).toContain('recordLowStockEvents(req, rows, extractThresholdFromQuery(query));')
    // The wake-up comes after the write, before the route answers.
    const route = generateDataAPIRoute({ ...options, withAutomations: true })
    expect(route.indexOf('wakeAutomations(req);\n    }')).toBeLessThan(
      route.indexOf('return res.status(200).json(result);')
    )
    expect(route.indexOf('} catch (error) {\n    // Return proper status codes')).toBeGreaterThan(
      route.indexOf('wakeAutomations(req);\n    }')
    )
  })

  it('never reaches for the bus or the app events without automations', async () => {
    const route = boot({ lowStockAlertsEnabled: true })
    await route.run('create', eventCreate)
    await route.run('raw-query', { query: LOW_STOCK_SELECT })
    expect(route.wakes).toEqual([])
    expect(route.background).toEqual([])
  })
})
