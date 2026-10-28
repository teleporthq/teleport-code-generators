/* tslint:disable:function-constructor no-any */
import * as nodePath from 'path'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { generateHandlerFunction } from '../src/api-route-generator'
import { BUSINESS_EVENT_TRIGGER } from '../src/automations/automations-scope'
import { withEnv } from './_helpers/fake-fetch'

/**
 * A server job's data reads, run through the REAL generated routes (final
 * review C1): the webhook / cron route, the custom-node module, the custom
 * node's server-segment route (and a nested custom node's) and the generated
 * data API, over a fake `pg` that answers each statement by its WHERE clause.
 *
 * The data API narrows a visitor's read of a private record table (orders,
 * bookings, …) to the visitor's own rows. A webhook, cron or automation reads
 * as a server job: its flag must survive every hop to the data API, or the
 * payment webhook finds no order and leaves it unpaid. A browser calling the
 * same custom node is still a visitor.
 */

const ref = (nodeId: string, path: string[]) => ({ type: 'workflowContext', nodeId, path })

const DS = 'ds-1'
const ENV: Record<string, string | undefined> = {
  NEXTAUTH_SECRET: 'app-secret',
  NEXTAUTH_URL: 'https://shop.test',
  STRIPE_WEBHOOK_SECRET: 'whsec_1',
  TELEPORT_CRON_ALLOW_UNSIGNED: 'true',
  TELEPORT_CRON_SECRET: undefined,
  VERCEL: undefined,
  VERCEL_AUTOMATION_BYPASS_SECRET: undefined,
  TELEPORT_DB_HOST: undefined,
  TELEPORT_DB_CONNECTION_STRING: undefined,
}

interface Row {
  [column: string]: any
}

const freshOrders = (): Row[] => [
  // A guest's order (no account) and a signed-in customer's.
  { id: 'ord-guest', user_id: null, customer_email: 'guest@x.com', status: 'pending' },
  { id: 'ord-member', user_id: 'u-member', customer_email: 'member@x.com', status: 'pending' },
]

const COLUMNS: Record<string, string[]> = {
  teleport_orders: ['id', 'user_id', 'customer_email', 'status'],
}

/** A `pg` stand-in that answers SELECT / COUNT / the "mark paid" UPDATE from `tables`. */
const fakePg = (
  tables: Record<string, Row[]>,
  statements: Array<{ sql: string; values: any[] }>
) => {
  const matches = (sql: string, values: any[], row: Row): boolean => {
    if (/\bFALSE\b/.test(sql)) {
      return false
    }
    const conditions = Array.from(sql.matchAll(/(\w+)(?:::text)? = \$(\d+)/g))
    return conditions.every(([, column, index]) => {
      const value = values[Number(index) - 1]
      return row[column] !== undefined && String(row[column]) === String(value)
    })
  }
  class Client {
    public async connect(): Promise<void> {
      return
    }
    public async end(): Promise<void> {
      return
    }
    public async query(
      sql: string,
      values: any[] = []
    ): Promise<{ rows: Row[]; rowCount: number }> {
      statements.push({ sql, values })
      if (/information_schema/i.test(sql)) {
        const rows = (COLUMNS[String(values[1])] || []).map((name) => ({
          column_name: name,
          data_type: 'text',
        }))
        return { rows, rowCount: rows.length }
      }
      const update = /^UPDATE (\w+) SET status = 'paid' WHERE id = \$1/.exec(sql)
      if (update) {
        const row = (tables[update[1]] || []).find((r) => String(r.id) === String(values[0]))
        if (row) {
          row.status = 'paid'
        }
        return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 }
      }
      const read = /^SELECT (COUNT\(\*\)|.+?) FROM (\w+)/.exec(sql)
      if (read) {
        const rows = (tables[read[2]] || []).filter((row) => matches(sql, values, row))
        return read[1] === 'COUNT(*)'
          ? { rows: [{ count: String(rows.length) }], rowCount: 1 }
          : { rows: rows.map((row) => ({ ...row })), rowCount: rows.length }
      }
      return { rows: [], rowCount: 0 }
    }
  }
  return { Client, types: { setTypeParser: (): void => undefined } }
}

// --- the project -------------------------------------------------------------

const EXTRACT = [
  'function customHandler(previousContext, params) {',
  '  var p = params || {};',
  '  return { orderId: p.orderId == null ? "" : String(p.orderId) };',
  '}',
].join('\n')

/** A custom node the payment node calls in turn (a receipt, an invoice): it reads the order too. */
const RECEIPT_NODE = {
  id: 'cn-receipt',
  name: 'Send Payment Receipt',
  parameters: [] as unknown[],
  nodes: [
    {
      id: 'r-extract',
      type: 'general-custom-js',
      label: 'Read The Order Id',
      config: { code: EXTRACT, context: 'server' },
      stepNumber: 0,
    },
    {
      id: 'r-read',
      type: 'data-select',
      label: 'Read The Paid Order',
      config: {
        dataSourceId: DS,
        tableName: 'teleport_orders',
        filters: [{ field: 'id', operator: '=', value: ref('r-extract', ['orderId']) }],
        limit: 1,
      },
      stepNumber: 1,
    },
  ],
  edges: [{ id: 're1', source: 'r-extract', target: 'r-read' }],
}

/**
 * "Process Payment Webhook", reduced to what decides C1: fetch the order by
 * id, mark it paid, then call the receipt node.
 */
const PAYMENT_NODE = {
  id: 'cn-payment',
  name: 'Process Payment Webhook',
  parameters: [] as unknown[],
  nodes: [
    {
      id: 'p-extract',
      type: 'general-custom-js',
      label: 'Extract Webhook Parameters',
      config: { code: EXTRACT, context: 'server' },
      stepNumber: 0,
    },
    {
      id: 'p-fetch',
      type: 'data-select',
      label: 'Fetch Order From Database',
      config: {
        dataSourceId: DS,
        tableName: 'teleport_orders',
        filters: [{ field: 'id', operator: '=', value: ref('p-extract', ['orderId']) }],
        limit: 1,
      },
      stepNumber: 1,
    },
    {
      id: 'p-mark',
      type: 'data-raw-query',
      label: 'Mark Order As Paid',
      config: {
        dataSourceId: DS,
        query: "UPDATE teleport_orders SET status = 'paid' WHERE id = $1 RETURNING id",
        params: [ref('p-fetch', ['rows', '0', 'id'])],
      },
      stepNumber: 2,
    },
    {
      id: 'p-receipt',
      type: 'general-custom-node',
      label: 'Send The Receipt',
      config: {
        customNodeId: 'cn-receipt',
        parameters: [{ key: 'orderId', value: ref('p-extract', ['orderId']) }],
      },
      stepNumber: 3,
    },
  ],
  edges: [
    { id: 'pe1', source: 'p-extract', target: 'p-fetch' },
    { id: 'pe2', source: 'p-fetch', target: 'p-mark' },
    { id: 'pe3', source: 'p-mark', target: 'p-receipt' },
  ],
}

/** "Process Subscription Webhook": loads the order, then pays it through the payment node, on the server. */
const SUBSCRIPTION_NODE = {
  id: 'cn-subscription',
  name: 'Process Subscription Webhook',
  parameters: [] as unknown[],
  nodes: [
    {
      id: 's-extract',
      type: 'general-custom-js',
      label: 'Read The Renewal',
      config: { code: EXTRACT, context: 'server' },
      executionEnv: 'server',
      stepNumber: 0,
    },
    {
      id: 's-load',
      type: 'data-select',
      label: 'Load The Order',
      config: {
        dataSourceId: DS,
        tableName: 'teleport_orders',
        filters: [{ field: 'id', operator: '=', value: ref('s-extract', ['orderId']) }],
        limit: 1,
      },
      executionEnv: 'server',
      stepNumber: 1,
    },
    {
      id: 's-pay',
      type: 'general-custom-node',
      label: 'Pay The Order',
      config: {
        customNodeId: 'cn-payment',
        parameters: [{ key: 'orderId', value: ref('s-load', ['rows', '0', 'id']) }],
      },
      executionEnv: 'server',
      stepNumber: 2,
    },
  ],
  edges: [
    { id: 'se1', source: 's-extract', target: 's-load' },
    { id: 'se2', source: 's-load', target: 's-pay' },
  ],
}

const callCustomNode = (id: string, customNodeId: string, orderId: unknown) => ({
  id,
  type: 'general-custom-node',
  label: id,
  config: { customNodeId, parameters: [{ key: 'orderId', value: orderId }] },
  stepNumber: 1,
})

const stripeWebhook = (id: string, urlPath: string, customNodeId: string) => ({
  id,
  name: id,
  trigger: { type: 'event-webhook-received', nodeId: 't', scope: 'global', config: {} },
  webhookConfig: {
    urlPath,
    httpMethod: 'POST',
    signatureAlgorithm: 'payment-driver',
    paymentProvider: 'stripe',
    signatureSecret: {
      type: 'dynamic',
      content: { referenceType: 'secret', id: 'STRIPE_WEBHOOK_SECRET' },
    },
  },
  nodes: [
    callCustomNode(
      `${id}-call`,
      customNodeId,
      ref('t', ['body', 'data', 'object', 'metadata', 'orderId'])
    ),
  ],
  edges: [{ id: `${id}-e`, source: 't', target: `${id}-call` }],
})

const CRON = {
  id: 'wf-cron',
  name: 'Nightly pending orders',
  trigger: {
    type: 'event-cron-triggered',
    nodeId: 't',
    scope: 'global',
    config: { schedule: '0 * * * *', urlPath: 'cron_pending' },
  },
  nodes: [
    {
      id: 'cron-read',
      type: 'data-select',
      label: 'Read Pending Orders',
      config: {
        dataSourceId: DS,
        tableName: 'teleport_orders',
        filters: [{ field: 'status', operator: '=', value: 'pending' }],
      },
      stepNumber: 1,
    },
    { ...callCustomNode('cron-pay', 'cn-payment', 'ord-guest'), stepNumber: 2 },
  ],
  edges: [
    { id: 'ce1', source: 't', target: 'cron-read' },
    { id: 'ce2', source: 'cron-read', target: 'cron-pay' },
  ],
}

const AUTOMATION = {
  id: 'wf-auto',
  name: 'When an order is placed',
  trigger: { type: BUSINESS_EVENT_TRIGGER, nodeId: 't', scope: 'global', config: {} },
  nodes: [
    {
      id: 'auto-read',
      type: 'data-select',
      label: 'Read The Order',
      config: {
        dataSourceId: DS,
        tableName: 'teleport_orders',
        filters: [{ field: 'id', operator: '=', value: ref('t', ['order', 'id']) }],
        limit: 1,
      },
      stepNumber: 1,
    },
    { ...callCustomNode('auto-pay', 'cn-payment', ref('t', ['order', 'id'])), stepNumber: 2 },
  ],
  edges: [
    { id: 'ae1', source: 't', target: 'auto-read' },
    { id: 'ae2', source: 'auto-read', target: 'auto-pay' },
  ],
}

const CUSTOM_NODES = {
  'cn-payment': PAYMENT_NODE,
  'cn-subscription': SUBSCRIPTION_NODE,
  'cn-receipt': RECEIPT_NODE,
}

const generateApp = async (): Promise<Map<string, string>> => {
  const structure: any = {
    uidl: {
      name: 'Store',
      globals: { settings: { title: 'Store', language: 'en' }, env: { NEXTAUTH_SECRET: 'k' } },
      root: {
        name: 'Root',
        stateDefinitions: {
          route: { type: 'string', defaultValue: 'Home', values: [{ value: 'Home' }] },
        },
        node: { type: 'element', content: { elementType: 'container', children: [] } },
      },
      components: {},
      dataSources: { [DS]: { id: DS, type: 'teleport', name: 'Store', config: {} } },
      workflows: {
        workflows: JSON.parse(
          JSON.stringify({
            'wf-pay': stripeWebhook('wf-pay', 'webhooks/stripe-payment', 'cn-payment'),
            'wf-sub': stripeWebhook('wf-sub', 'webhooks/stripe-subscription', 'cn-subscription'),
            'wf-cron': CRON,
          })
        ),
        customNodes: JSON.parse(JSON.stringify(CUSTOM_NODES)),
      },
    },
    strategy: { pages: { options: {} } },
    files: new Map(),
    dependencies: {},
    devDependencies: {},
  }
  await new NextWorkflowProjectPlugin().runAfter(structure)
  const files = new Map<string, string>()
  for (const entry of structure.files.values()) {
    for (const file of entry.files) {
      files.set(
        [...entry.path, `${file.name}.${file.fileType || 'js'}`].join('/'),
        String(file.content)
      )
    }
  }
  // An automation's handler module (the in-app event bus runs it).
  files.set(
    'lib/automations/handlers/wf-auto.js',
    generateHandlerFunction(JSON.parse(JSON.stringify(AUTOMATION)), CUSTOM_NODES as any)
  )
  return files
}

// --- the deployment ----------------------------------------------------------

interface Reply {
  status: number
  body: any
}

interface Deployment {
  load: (path: string) => any
  call: (
    path: string,
    req: { headers?: Record<string, string>; body?: unknown; query?: any }
  ) => Promise<Reply>
  statements: Array<{ sql: string; values: any[] }>
  tables: Record<string, Row[]>
  /** The headers of every call that reached the data API. */
  dataCalls: Array<{ op: string; headers: Record<string, string> }>
}

const respond = (reply: Reply) => ({
  ok: reply.status >= 200 && reply.status < 300,
  status: reply.status,
  statusText: String(reply.status),
  headers: new Map([['content-type', 'application/json']]),
  json: async () => reply.body,
  text: async () => JSON.stringify(reply.body),
})

/** The generated files, run as one deployment: every self-call is answered by the generated route it names. */
const deploy = (files: Map<string, string>): Deployment => {
  const statements: Deployment['statements'] = []
  const tables: Record<string, Row[]> = { teleport_orders: freshOrders() }
  const pg = fakePg(tables, statements)
  const sessionOf = (req: any) => {
    const cookie = String((req && req.headers && req.headers.cookie) || '')
    const match = /next-auth\.session-token=([\w-]+)/.exec(cookie)
    return match ? { sub: match[1], id: match[1], email: `${match[1]}@x.com`, role: 'user' } : null
  }
  const overrides: Record<string, unknown> = {
    // The provider's signature check (Stripe's): the delivery is genuine.
    'utils/payments/index.js': {
      get: () => ({ verifyWebhook: async (input: any) => ({ ok: true, body: input.body }) }),
    },
    'lib/automations/store.js': {
      appBaseUrl: () => 'https://shop.test',
      saveWait: async (): Promise<void> => undefined,
    },
  }
  const cache = new Map<string, { exports: any }>()
  const load = (path: string): any => {
    if (Object.prototype.hasOwnProperty.call(overrides, path)) {
      return overrides[path]
    }
    const cached = cache.get(path)
    if (cached) {
      return cached.exports
    }
    const source = files.get(path)
    if (source === undefined) {
      throw new Error(`Cannot find module '${path}'`)
    }
    const module = { exports: {} as any }
    cache.set(path, module)
    const dir = nodePath.posix.dirname(path)
    const localRequire = (id: string): unknown => {
      if (id.startsWith('.')) {
        const joined = nodePath.posix.normalize(nodePath.posix.join(dir, id))
        const candidates = [joined, `${joined}.js`, `${joined}/index.js`]
        const found = candidates.find(
          (candidate) =>
            files.has(candidate) || Object.prototype.hasOwnProperty.call(overrides, candidate)
        )
        return load(found || `${joined}.js`)
      }
      if (id === 'pg') {
        return pg
      }
      if (id === 'next-auth/jwt') {
        return { getToken: async (options: any) => sessionOf(options && options.req) }
      }
      if (id === 'node-fetch') {
        return (...args: any[]) => (globalThis as any).fetch(...args)
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(id)
    }
    new Function('module', 'exports', 'require', source)(module, module.exports, localRequire)
    return module.exports
  }
  const call = async (
    path: string,
    req: { headers?: Record<string, string>; body?: unknown; query?: any }
  ): Promise<Reply> => {
    const reply: Reply = { status: 200, body: null }
    const res: any = {
      setHeader: (): any => res,
      status(code: number) {
        reply.status = code
        return res
      },
      json(payload: unknown) {
        reply.body = payload
        return res
      },
      end() {
        return res
      },
    }
    const handler = load(path)
    await (handler.default || handler)(
      {
        method: 'POST',
        url: '/' + path.replace(/^pages/, '').replace(/\.js$/, ''),
        query: req.query || {},
        headers: { host: 'shop.test', 'x-forwarded-proto': 'https', ...(req.headers || {}) },
        body: req.body,
      },
      res
    )
    return reply
  }
  const dataCalls: Deployment['dataCalls'] = []
  ;(globalThis as any).fetch = async (url: string, init: any = {}) => {
    const headers: Record<string, string> = {}
    Object.keys(init.headers || {}).forEach((name) => {
      headers[name.toLowerCase()] = init.headers[name]
    })
    const body = init.body ? JSON.parse(init.body) : undefined
    const pathname = new URL(url).pathname
    const data = /^\/api\/data\/([^/]+)\/([^/]+)$/.exec(pathname)
    if (data) {
      dataCalls.push({ op: data[2], headers })
      return respond(
        await call('pages/api/data/[...params].js', {
          headers,
          body,
          query: { params: [data[1], data[2]] },
        })
      )
    }
    if (pathname.startsWith('/api/workflows/') && files.has(`pages${pathname}.js`)) {
      return respond(await call(`pages${pathname}.js`, { headers, body }))
    }
    return respond({ status: 200, body: {} })
  }
  return { load, call, statements, tables, dataCalls }
}

const silenced = async <T>(run: () => Promise<T>): Promise<T> => {
  const sink = console as unknown as Record<string, unknown>
  const levels = ['warn', 'error', 'log']
  const saved = levels.map((level) => sink[level])
  levels.forEach((level) => {
    sink[level] = (): undefined => undefined
  })
  try {
    return await run()
  } finally {
    levels.forEach((level, index) => {
      sink[level] = saved[index]
    })
  }
}

const inDeployment = async <T>(run: (deployment: Deployment) => Promise<T>): Promise<T> => {
  const files = await generateApp()
  const previous = (globalThis as any).fetch
  try {
    return await withEnv(ENV, () => silenced(() => run(deploy(files))))
  } finally {
    ;(globalThis as any).fetch = previous
  }
}

const orderReads = (deployment: Deployment) =>
  deployment.statements.filter((s) => /^SELECT .+ FROM teleport_orders/.test(s.sql))

const stripeEvent = (orderId: string) =>
  Buffer.from(
    JSON.stringify({
      id: `evt_${orderId}`,
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', metadata: { orderId } } },
    })
  )

const webhookPath = (urlPath: string): string => `pages/api/${urlPath}.js`

describe('a server job reads private records through every hop (final review C1)', () => {
  it.each([
    ['a guest order', 'ord-guest'],
    ['a signed-in customer order', 'ord-member'],
  ])('the Stripe payment webhook finds %s and marks it paid', async (_label, orderId) => {
    await inDeployment(async (deployment) => {
      const reply = await deployment.call(webhookPath('webhooks/stripe-payment'), {
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=abc' },
        body: stripeEvent(orderId),
      })
      expect(reply.status).toBe(200)
      const read = orderReads(deployment)
      expect(read.length).toBeGreaterThan(0)
      read.forEach((statement) => expect(statement.sql).not.toMatch(/\bFALSE\b/))
      expect(deployment.tables.teleport_orders.find((row) => row.id === orderId)!.status).toBe(
        'paid'
      )
      // The custom node's segment route kept the job's flag for its data calls.
      expect(deployment.dataCalls.length).toBeGreaterThan(0)
      deployment.dataCalls.forEach((dataCall) =>
        expect(dataCall.headers['x-tq-server-job']).toBe('1')
      )
    })
  })

  it('the subscription webhook loads the order and pays it through the nested payment node', async () => {
    await inDeployment(async (deployment) => {
      const reply = await deployment.call(webhookPath('webhooks/stripe-subscription'), {
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=abc' },
        body: stripeEvent('ord-member'),
      })
      expect(reply.status).toBe(200)
      // Three reads of the order: the subscription node's, the payment node's
      // it runs on the server, and the receipt node that one calls in turn.
      expect(orderReads(deployment).length).toBeGreaterThanOrEqual(3)
      orderReads(deployment).forEach((statement) => expect(statement.sql).not.toMatch(/\bFALSE\b/))
      expect(deployment.tables.teleport_orders.find((row) => row.id === 'ord-member')!.status).toBe(
        'paid'
      )
    })
  })

  it('a cron reads the pending orders, and pays one through a custom node', async () => {
    await inDeployment(async (deployment) => {
      const reply = await deployment.call('pages/api/workflows/cron_pending.js', { body: {} })
      expect(reply.status).toBe(200)
      const pending = orderReads(deployment).find((statement) => /status = \$1/.test(statement.sql))
      expect(pending!.sql).not.toMatch(/\bFALSE\b/)
      expect(deployment.tables.teleport_orders.find((row) => row.id === 'ord-guest')!.status).toBe(
        'paid'
      )
    })
  })

  it('an automation handler reads the order of its event, and pays it through a custom node', async () => {
    await inDeployment(async (deployment) => {
      const handler = deployment.load('lib/automations/handlers/wf-auto.js')
      await handler.run(
        { event: { id: 'e1', type: 'order-placed' }, order: { id: 'ord-member' } },
        {}
      )
      expect(orderReads(deployment).length).toBeGreaterThanOrEqual(2)
      orderReads(deployment).forEach((statement) => expect(statement.sql).not.toMatch(/\bFALSE\b/))
      expect(deployment.tables.teleport_orders.find((row) => row.id === 'ord-member')!.status).toBe(
        'paid'
      )
    })
  })

  it('a browser calling the same custom node is still a visitor, whatever it claims', async () => {
    await inDeployment(async (deployment) => {
      const segmentRoute = Array.from((await generateApp()).keys()).find((path) =>
        /^pages\/api\/workflows\/process-payment-webhook-.*\.js$/.test(path)
      ) as string
      expect(segmentRoute).toBeDefined()
      for (const headers of [
        {},
        // A forged job flag, signed in as another customer.
        { 'x-tq-server-job': '1', cookie: 'next-auth.session-token=u-other' },
      ]) {
        deployment.statements.length = 0
        deployment.tables.teleport_orders = freshOrders()
        await deployment.call(segmentRoute, {
          headers,
          body: { context: { __customParams: { orderId: 'ord-member' } } },
        })
        const read = orderReads(deployment)
        expect(read.length).toBeGreaterThan(0)
        // A guest finds nothing; another customer only their own rows (none here).
        expect(read[0].sql).toMatch(/\bFALSE\b|user_id::text = \$\d+/)
        expect(
          deployment.tables.teleport_orders.find((row) => row.id === 'ord-member')!.status
        ).toBe('pending')
      }
    })
  })
})
