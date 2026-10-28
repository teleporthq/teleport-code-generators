import * as nodePath from 'path'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { splitIntoSegments } from '../src/segment-splitter'
import { buildSegmentTrust } from '../src/segment-trust'
import { assertServerBoundCallParameters } from '../src/server-custom-node-call'
import { TableAccess } from '@teleporthq/teleport-shared'
import { withEnv } from './_helpers/fake-fetch'

/**
 * The shared "Record Event" writer (teleport-gui
 * `features/shared/builders/record-event-node.ts`) is a custom node only this
 * deployment's own server code may run (`protection.serverOnly`): a browser
 * POST to its route is refused. A public page flow — the guest checkout —
 * still records its event: the editor marks every call of such a node
 * `executionEnv: 'server'`, so the call runs inside the server segment that
 * writes the order, which calls the writer with the internal-call token. The
 * event type is a literal of that segment's own config and the entity is the
 * row the segment just wrote: nothing a browser sends names either.
 */

type Row = Record<string, unknown>

interface GeneratedFile {
  name: string
  fileType?: string
  content: unknown
}

interface GeneratedEntry {
  path: string[]
  files: GeneratedFile[]
}

const ref = (nodeId: string, path: string[]) => ({ type: 'workflowContext', nodeId, path })

// The editor's writer, step for step (record-event-node.ts), reduced to the
// columns this proof reads.
const BUILD_ROW_SCRIPT = [
  'function customHandler(previousContext, params) {',
  '  var p = params || {};',
  '  var eventType = p.eventType == null ? "" : String(p.eventType);',
  '  var entityId = p.entityId == null ? "" : String(p.entityId);',
  '  var subject = p.dedupeSubject == null ? "" : String(p.dedupeSubject);',
  '  return {',
  '    eventType: eventType,',
  '    orderId: p.orderId == null ? "" : String(p.orderId),',
  '    entityType: p.entityType == null ? "" : String(p.entityType),',
  '    entityId: entityId,',
  '    dedupeKey: eventType + ":" + (subject || entityId),',
  '    actor: p.actor == null ? "" : String(p.actor),',
  '    actorType: p.actorType ? String(p.actorType) : "system"',
  '  };',
  '}',
].join('\n')

const IS_NEW_SCRIPT = [
  'function customHandler(previousContext, params) {',
  '  var selectResult = (params && params[1]) || {};',
  '  var rows = selectResult && selectResult.rows',
  '    ? selectResult.rows',
  '    : (Array.isArray(selectResult) ? selectResult : []);',
  '  return { isNew: rows.length === 0 };',
  '}',
].join('\n')

const WRITER_ID = 'cn-writer'
const WRITER = {
  id: WRITER_ID,
  name: 'Record Order Event',
  parameters: [],
  // What the editor stamps on the writer (custom-node-protection.ts).
  protection: {
    requiresAuth: false,
    allowedRoles: [],
    serverOnly: true,
    derivedFrom: 'server-callers',
  },
  nodes: [
    {
      id: 'w-build',
      type: 'general-custom-js',
      label: 'Build Order Event Row',
      config: { code: BUILD_ROW_SCRIPT, context: 'server' },
      executionEnv: 'server',
      stepNumber: 1,
    },
    {
      id: 'w-find',
      type: 'data-select',
      label: 'Find Existing Order Event',
      config: {
        dataSourceId: 'ds-1',
        tableName: 'teleport_events',
        filters: [{ field: 'dedupe_key', operator: '=', value: ref('w-build', ['dedupeKey']) }],
        limit: 1,
        continueOnError: true,
      },
      executionEnv: 'server',
      stepNumber: 2,
    },
    {
      id: 'w-is-new',
      type: 'general-custom-js',
      label: 'Check Order Event Is New',
      config: { code: IS_NEW_SCRIPT, context: 'server' },
      executionEnv: 'server',
      stepNumber: 3,
    },
    {
      id: 'w-gate',
      type: 'general-if-statement',
      label: 'Is Order Event New?',
      config: {
        conditionType: 'simple-comparison',
        leftValue: ref('w-is-new', ['isNew']),
        operator: '=',
        rightValue: true,
      },
      executionEnv: 'universal',
      stepNumber: 4,
    },
    {
      id: 'w-insert',
      type: 'data-create-item',
      label: 'Insert Order Event',
      config: {
        dataSourceId: 'ds-1',
        tableName: 'teleport_events',
        columnMappings: [
          { column: 'event_type', value: ref('w-build', ['eventType']) },
          { column: 'dedupe_key', value: ref('w-build', ['dedupeKey']) },
          { column: 'order_id', value: ref('w-build', ['orderId']) },
          { column: 'entity_type', value: ref('w-build', ['entityType']) },
          { column: 'entity_id', value: ref('w-build', ['entityId']) },
          { column: 'actor', value: ref('w-build', ['actor']) },
          { column: 'actor_type', value: ref('w-build', ['actorType']) },
          { column: 'status', value: 'recorded' },
        ],
        continueOnError: true,
      },
      executionEnv: 'server',
      stepNumber: 5,
    },
  ],
  edges: [
    { id: 'we1', source: 'w-build', target: 'w-find' },
    { id: 'we2', source: 'w-find', target: 'w-is-new' },
    { id: 'we3', source: 'w-is-new', target: 'w-gate' },
    { id: 'we4', source: 'w-gate', target: 'w-insert', sourceHandle: 'true' },
  ],
}

// The tail of the guest checkout (checkout-workflow-builder.ts): the order row
// is written, then "Record Order Placed" calls the writer, then the page
// carries on in the browser.
const recordPlaced = (executionEnv: string) => ({
  id: 'record-placed',
  type: 'general-custom-node',
  label: 'Record Order Placed',
  config: {
    customNodeId: WRITER_ID,
    parameters: [
      { key: 'eventType', value: 'order-placed' },
      { key: 'entityType', value: 'order' },
      { key: 'entityId', value: ref('create-order', ['id']) },
      { key: 'orderId', value: ref('create-order', ['id']) },
      { key: 'dedupeSubject', value: ref('create-order', ['id']) },
      { key: 'actorType', value: 'customer' },
      { key: 'actor', value: ref('create-order', ['billing_email']) },
    ],
  },
  executionEnv,
  stepNumber: 3,
})

const checkout = (executionEnv: string) => ({
  id: 'wf-checkout',
  name: 'Place Order',
  trigger: { type: 'event-page-loaded', nodeId: 't', scope: 'page', config: { allPages: true } },
  nodes: [
    {
      id: 'mark',
      type: 'state-update-local-state',
      label: 'Mark Placing',
      config: {},
      executionEnv: 'client',
      stepNumber: 1,
    },
    {
      id: 'create-order',
      type: 'data-create-item',
      label: 'Create Order',
      config: {
        dataSourceId: 'ds-1',
        tableName: 'teleport_orders',
        columnMappings: [
          { column: 'billing_email', value: 'ava@example.com' },
          { column: 'total_amount', value: 53.2 },
        ],
      },
      executionEnv: 'server',
      stepNumber: 2,
    },
    recordPlaced(executionEnv),
    {
      id: 'done',
      type: 'state-update-local-state',
      label: 'Mark Placed',
      config: {},
      executionEnv: 'client',
      stepNumber: 4,
    },
  ],
  edges: [
    { id: 'e1', source: 't', target: 'mark' },
    { id: 'e2', source: 'mark', target: 'create-order' },
    { id: 'e3', source: 'create-order', target: 'record-placed' },
    { id: 'e4', source: 'record-placed', target: 'done' },
  ],
})

const generate = (executionEnv = 'server'): Promise<Map<string, string>> =>
  generateProject({ 'wf-checkout': checkout(executionEnv) }, { [WRITER_ID]: WRITER })

const generateProject = async (
  workflows: Record<string, unknown>,
  customNodes: Record<string, unknown>
): Promise<Map<string, string>> => {
  const structure = {
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
      dataSources: { 'ds-1': { id: 'ds-1', type: 'teleport', name: 'Store', config: {} } },
      workflows: {
        workflows: JSON.parse(JSON.stringify(workflows)),
        customNodes: JSON.parse(JSON.stringify(customNodes)),
      },
    },
    strategy: { pages: { options: {} } },
    files: new Map<string, GeneratedEntry>(),
    dependencies: {} as Record<string, string>,
    devDependencies: {},
  }
  await new NextWorkflowProjectPlugin().runAfter(structure as never)
  const files = new Map<string, string>()
  for (const entry of structure.files.values()) {
    for (const file of entry.files) {
      files.set(
        [...entry.path, `${file.name}.${file.fileType || 'js'}`].join('/'),
        String(file.content)
      )
    }
  }
  return files
}

const routeFiles = (files: Map<string, string>) =>
  Array.from(files.keys()).filter((path) => path.startsWith('pages/api/workflows/'))

const writerRoute = (files: Map<string, string>): string => {
  const found = routeFiles(files).filter((path) => path.includes('record-order-event'))
  expect(found).toHaveLength(1)
  return found[0]
}

const checkoutRoute = (files: Map<string, string>): string => {
  const found = routeFiles(files).filter((path) => path.includes('place-order'))
  expect(found).toHaveLength(1)
  return found[0]
}

const resolveRelative = (fromDir: string, id: string): string => {
  const joined = nodePath.posix.normalize(nodePath.posix.join(fromDir, id))
  return joined.endsWith('.js') ? joined : `${joined}.js`
}

/** A CommonJS loader over the generated files. */
const createApp = (files: Map<string, string>) => {
  const cache = new Map<string, { exports: unknown }>()
  const load = (path: string): unknown => {
    const cached = cache.get(path)
    if (cached) {
      return cached.exports
    }
    const source = files.get(path)
    if (source === undefined) {
      throw new Error(`Cannot find module '${path}'`)
    }
    const module = { exports: {} as unknown }
    cache.set(path, module)
    const dir = nodePath.posix.dirname(path)
    const localRequire = (id: string): unknown => {
      if (id.startsWith('.')) {
        return load(resolveRelative(dir, id))
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(id)
    }
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', source)(module, module.exports, localRequire)
    return module.exports
  }
  return load
}

type Handler = (req: unknown, res: unknown) => Promise<void>

interface Reply {
  status: number
  body: any
}

const call = async (handler: Handler, headers: Record<string, string>, body: unknown) => {
  const reply: Reply = { status: 0, body: null }
  const res = {
    setHeader: () => undefined,
    status(code: number) {
      reply.status = code
      return {
        json(payload: unknown) {
          reply.body = payload
        },
      }
    },
  }
  const req = {
    method: 'POST',
    url: '/api/workflows/x',
    headers: { host: 'shop.test', 'x-forwarded-proto': 'https', ...headers },
    body,
  }
  await handler(req, res)
  return reply
}

interface Sent {
  url: string
  headers: Record<string, string>
  json: any
}

/**
 * Runs `run` with every fetch answered as the deployment would: the data API
 * (rows written are kept), and this app's own workflow routes, run in process
 * with the headers the caller sent.
 */
const asTheDeployment = async <T>(
  files: Map<string, string>,
  run: (app: (path: string) => unknown, sent: Sent[]) => Promise<T>
): Promise<T> => {
  const app = createApp(files)
  const sent: Sent[] = []
  const scope = globalThis as Record<string, unknown>
  const previous = scope.fetch
  scope.fetch = async (
    url: string,
    init: { headers?: Record<string, string>; body?: string } = {}
  ) => {
    const headers: Record<string, string> = {}
    Object.keys(init.headers || {}).forEach((name) => {
      headers[name.toLowerCase()] = (init.headers || {})[name]
    })
    const json = init.body ? JSON.parse(init.body) : null
    sent.push({ url, headers, json })
    const answer = (status: number, body: unknown) => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      headers: new Map([['content-type', 'application/json']]),
      json: async () => body,
      text: async () => JSON.stringify(body),
    })
    const pathname = new URL(url).pathname
    if (pathname === '/api/data/ds-1/create') {
      return json.tableName === 'teleport_orders'
        ? answer(200, { item: { id: 'ord-1', billing_email: 'ava@example.com' } })
        : answer(200, { item: { id: 'evt-1' } })
    }
    if (pathname === '/api/data/ds-1/select') {
      return answer(200, { rows: [] })
    }
    if (pathname.startsWith('/api/workflows/')) {
      const handler = app(`pages${pathname}.js`) as Handler
      const reply = await call(handler, headers, json)
      return answer(reply.status, reply.body)
    }
    return answer(200, {})
  }
  try {
    return await run(app, sent)
  } finally {
    scope.fetch = previous
  }
}

/** Runs `run` with the generated code's logging muted. */
const silenced = async <T>(run: () => Promise<T>): Promise<T> => {
  const sink = console as unknown as Record<string, unknown>
  const levels = ['warn', 'error', 'log']
  const saved = levels.map((level) => sink[level])
  levels.forEach((level) => {
    sink[level] = () => undefined
  })
  try {
    return await run()
  } finally {
    levels.forEach((level, index) => {
      sink[level] = saved[index]
    })
  }
}

const ENV = {
  NEXTAUTH_SECRET: 'app-secret',
  NEXTAUTH_URL: 'https://shop.test',
  VERCEL: undefined,
  VERCEL_AUTOMATION_BYPASS_SECRET: undefined,
}

afterEach(() => {
  delete (globalThis as Row).__tqConfiguredNextAuthUrl
})

describe('the Record Event writer runs only from the server', () => {
  it('puts a call the editor marked for the server into the server segment that wrote the record', () => {
    const onServer = splitIntoSegments(checkout('server') as never)
    expect(onServer.map((segment) => [segment.env, segment.nodeIds])).toEqual([
      ['client', ['mark']],
      ['server', ['create-order', 'record-placed']],
      ['client', ['done']],
    ])

    // An ordinary custom-node call still runs in the browser.
    const inBrowser = splitIntoSegments(checkout('universal') as never)
    expect(inBrowser.map((segment) => [segment.env, segment.nodeIds])).toEqual([
      ['client', ['mark']],
      ['server', ['create-order']],
      ['client', ['record-placed', 'done']],
    ])
  })

  it('refuses a browser POST to the writer route, before anything runs', async () => {
    const files = await generate()
    expect(files.get(writerRoute(files))).toContain('"serverOnly":true')

    const reply = await withEnv(ENV, () =>
      asTheDeployment(files, async (app, sent) => {
        const handler = app(writerRoute(files)) as Handler
        const answered = await silenced(() =>
          call(
            handler,
            {},
            {
              context: {
                __isInsideCustomNode: true,
                __customNodeIds: WRITER.nodes.map((node) => node.id),
                __customParams: [
                  { key: 'eventType', value: 'order-shipment-delivered' },
                  { key: 'entityId', value: 'ord-1' },
                  { key: 'dedupeSubject', value: 'forged' },
                ],
              },
            }
          )
        )
        return { answered, sent }
      })
    )
    expect(reply.answered).toEqual({ status: 401, body: { error: 'Unauthenticated' } })
    expect(reply.sent).toEqual([])
  })

  it('records the guest checkout order-placed from the segment that wrote the order', async () => {
    const files = await generate()
    const route = files.get(checkoutRoute(files)) as string
    // The call's event type lives in the route, never in the browser bundle.
    expect(route).toContain('"order-placed"')
    expect(files.get('utils/workflows/custom-nodes.js')).not.toContain('order-placed')

    const outcome = await withEnv({ ...ENV, VERCEL_AUTOMATION_BYPASS_SECRET: 'bypass-1' }, () =>
      asTheDeployment(files, async (app, sent) => {
        const handler = app(checkoutRoute(files)) as Handler
        const answered = await silenced(() => call(handler, {}, { context: { t: {}, mark: null } }))
        return { answered, sent }
      })
    )

    expect(outcome.answered.status).toBe(200)
    expect(outcome.answered.body.success).toBe(true)

    // The writer was called by this deployment's own server code.
    const writerCalls = outcome.sent.filter((sent) => sent.url.includes('record-order-event'))
    expect(writerCalls).toHaveLength(1)
    expect(writerCalls[0].url.startsWith('https://shop.test/api/workflows/')).toBe(true)
    expect(typeof writerCalls[0].headers['x-teleport-internal']).toBe('string')
    expect(writerCalls[0].headers['x-teleport-internal'].length).toBeGreaterThan(0)
    // A password-walled deployment lets its own calls through.
    expect(writerCalls[0].headers['x-vercel-protection-bypass']).toBe('bypass-1')

    // The event row: the segment's own literal type, the order it just wrote.
    const eventInserts = outcome.sent.filter(
      (sent) =>
        sent.url.endsWith('/api/data/ds-1/create') && sent.json.tableName === 'teleport_events'
    )
    expect(eventInserts).toHaveLength(1)
    const columns = Object.fromEntries(
      eventInserts[0].json.columnMappings.map((m: Row) => [m.column, m.value])
    )
    expect(columns).toMatchObject({
      event_type: 'order-placed',
      entity_type: 'order',
      entity_id: 'ord-1',
      order_id: 'ord-1',
      dedupe_key: 'order-placed:ord-1',
      actor: 'ava@example.com',
      actor_type: 'customer',
      status: 'recorded',
    })
    // The browser gets the writer's answer like any other result of the segment.
    expect(outcome.answered.body.results).toHaveProperty('record-placed')
  })
})

describe('only the calls the editor marked run with the internal-call token', () => {
  // The review's probe: a public page loops over a database read and calls an
  // admin-only custom node. The read pulls the loop onto the server, and the
  // call with it — unmarked, it must stay the inert marker it always was.
  const GATED_ID = 'cn-gated'
  const GATED = {
    id: GATED_ID,
    name: 'Members Only Action',
    parameters: [],
    protection: { requiresAuth: true, allowedRoles: ['admin'], derivedFrom: 'page' },
    nodes: [
      {
        id: 'g-write',
        type: 'data-create-item',
        label: 'Admin Write',
        config: {
          dataSourceId: 'ds-1',
          tableName: 'admin_things',
          columnMappings: [{ column: 'x', value: 'y' }],
        },
        executionEnv: 'server',
        stepNumber: 1,
      },
    ],
    edges: [],
  }
  const publicLoop = (callEnv: string) => ({
    id: 'wf-public',
    name: 'Public Loop',
    trigger: { type: 'event-page-loaded', nodeId: 't', scope: 'page', config: { allPages: true } },
    nodes: [
      {
        id: 'loop',
        type: 'general-loop',
        label: 'Loop',
        config: { collection: [1, 2], loopType: 'forEach' },
        executionEnv: 'universal',
        stepNumber: 1,
      },
      {
        id: 'read',
        type: 'data-select',
        label: 'Read',
        config: { dataSourceId: 'ds-1', tableName: 'products', limit: 1 },
        executionEnv: 'server',
        stepNumber: 2,
      },
      {
        id: 'call',
        type: 'general-custom-node',
        label: 'Call Gated',
        config: { customNodeId: GATED_ID, parameters: [] },
        executionEnv: callEnv,
        stepNumber: 3,
      },
    ],
    edges: [
      { id: 'e0', source: 't', target: 'loop' },
      {
        id: 'e1',
        source: 'loop',
        target: 'read',
        sourceHandle: 'loop',
        targetHandle: 'loop-body-in',
      },
      {
        id: 'e2',
        source: 'read',
        target: 'call',
        sourceHandle: 'loop-body-out',
        targetHandle: 'loop-body-in',
      },
      {
        id: 'e3',
        source: 'call',
        target: 'loop',
        sourceHandle: 'loop-body-out',
        targetHandle: 'loop-back',
      },
    ],
  })

  it('refuses an anonymous visitor an admin-only custom node pulled onto the server by a loop', async () => {
    const files = await generateProject(
      { 'wf-public': publicLoop('universal') },
      { [GATED_ID]: GATED }
    )
    const pageRoute = routeFiles(files).find((path) => path.includes('public-loop')) as string
    expect(splitIntoSegments(publicLoop('universal') as never).map((s) => s.env)).toEqual([
      'server',
    ])
    // No call is marked, so the route is what it was before the writer moved to the server.
    expect(files.get(pageRoute)).not.toContain('__SERVER_RUN_CALLS')

    const outcome = await withEnv(ENV, () =>
      asTheDeployment(files, async (app, sent) => {
        const answered = await silenced(() =>
          call(app(pageRoute) as Handler, {}, { context: { t: {} } })
        )
        return { answered, sent }
      })
    )
    expect(outcome.answered.status).toBe(200)
    expect(outcome.sent.filter((sent) => sent.url.includes('members-only'))).toEqual([])
    expect(
      outcome.sent.filter((sent) => sent.json && sent.json.tableName === 'admin_things')
    ).toEqual([])
    // The call's result is the marker, as in a browser.
    expect(outcome.answered.body.results.call).toMatchObject({
      __customNode: true,
      customNodeId: GATED_ID,
    })
  })

  it('runs a marked call only for the node and custom node it was baked with', async () => {
    const files = await generate()
    const route = files.get(checkoutRoute(files)) as string
    expect(route).toContain(`var __SERVER_RUN_CALLS = {"record-placed":"${WRITER_ID}"};`)
  })
})

describe('a marked call records only what the server did', () => {
  const withParameter = (key: string, value: unknown) => {
    const workflow = checkout('server')
    const record = workflow.nodes.find((node) => node.id === 'record-placed') as {
      config: { parameters: Array<{ key: string; value: unknown }> }
    }
    record.config.parameters = record.config.parameters.map((parameter) =>
      parameter.key === key ? { key, value } : parameter
    )
    return { 'wf-checkout': workflow }
  }

  it('refuses the export when a parameter is a browser step’s result, naming the step', async () => {
    await expect(
      generateProject(withParameter('entityId', ref('mark', ['id'])), { [WRITER_ID]: WRITER })
    ).rejects.toThrow(
      /The step "Record Order Placed" \(record-placed\) in "Place Order" records an event with the result of "Mark Placing" \(mark\), which runs in the visitor's browser/
    )
  })

  it('refuses the trigger, the page state and a chip of a browser step', async () => {
    for (const value of [
      ref('t', ['formData', 'email']),
      '{{state.orderId}}',
      `<span class="context-value-inline" data-ctx-node-id="mark" data-ctx-path='["mark","id"]'>Id</span>`,
      // Read the way the runtime reads a chip: no node id, or an empty one,
      // and the node is the first segment of the path.
      `<span class="context-value-inline" data-ctx-path='["mark","id"]'>Id</span>`,
      `<span class="context-value-inline" data-ctx-node-id="" data-ctx-path="[&quot;mark&quot;,&quot;id&quot;]">Id</span>`,
    ]) {
      await expect(
        generateProject(withParameter('actor', value), { [WRITER_ID]: WRITER })
      ).rejects.toThrow(/An event can only be recorded from what the site's server did/)
    }
  })

  it('takes literals, this segment’s results and an earlier server segment’s signed results', async () => {
    const workflow = checkout('server')
    // The order is read on the server before the browser step, then recorded.
    workflow.nodes.splice(0, 0, {
      id: 'read-settings',
      type: 'data-select',
      label: 'Read Settings',
      config: { dataSourceId: 'ds-1', tableName: 'settings', limit: 1 },
      executionEnv: 'server',
      stepNumber: 0,
    } as never)
    workflow.edges = [
      { id: 'e0', source: 't', target: 'read-settings' },
      { id: 'e0b', source: 'read-settings', target: 'mark' },
      ...workflow.edges.filter((edge) => edge.source !== 't'),
    ]
    const record = workflow.nodes.find((node) => node.id === 'record-placed') as {
      config: { parameters: Array<{ key: string; value: unknown }> }
    }
    record.config.parameters.push({
      key: 'currency',
      value: ref('read-settings', ['rows', '0', 'currency']),
    })
    await expect(
      generateProject({ 'wf-checkout': workflow }, { [WRITER_ID]: WRITER })
    ).resolves.toBeDefined()
  })

  it('leaves a custom node only server code calls alone: its browser steps run on the server', async () => {
    const SETTLE_ID = 'cn-settle'
    const settle = {
      id: SETTLE_ID,
      name: 'Settle Cash Order',
      parameters: [],
      protection: {
        requiresAuth: false,
        allowedRoles: [],
        serverOnly: true,
        derivedFrom: 'server-callers',
      },
      nodes: [
        {
          id: 's-params',
          type: 'general-custom-js',
          label: 'Extract Parameters',
          config: {
            code: 'function customHandler(previousContext, params) { return params || {} }',
            context: 'client',
          },
          executionEnv: 'client',
          stepNumber: 1,
        },
        {
          id: 's-write',
          type: 'data-update-item',
          label: 'Settle',
          config: {
            dataSourceId: 'ds-1',
            tableName: 'teleport_orders',
            filters: [],
            columnMappings: [],
          },
          executionEnv: 'server',
          stepNumber: 2,
        },
        {
          ...recordPlaced('server'),
          id: 's-record',
          config: {
            customNodeId: WRITER_ID,
            parameters: [
              { key: 'eventType', value: 'order-paid' },
              { key: 'entityId', value: ref('s-params', ['orderId']) },
            ],
          },
          stepNumber: 3,
        },
      ],
      edges: [
        { id: 's1', source: 's-params', target: 's-write' },
        { id: 's2', source: 's-write', target: 's-record' },
      ],
    }
    await expect(
      generateProject({}, { [WRITER_ID]: WRITER, [SETTLE_ID]: settle })
    ).resolves.toBeDefined()
    // The same node called from a page any signed-in customer opens is checked…
    await expect(
      generateProject(
        {},
        {
          [WRITER_ID]: WRITER,
          [SETTLE_ID]: {
            ...settle,
            protection: { requiresAuth: true, allowedRoles: [], derivedFrom: 'page' },
          },
        }
      )
    ).rejects.toThrow(/"Extract Parameters" \(s-params\), which runs in the visitor's browser/)
    // …and one only the business's admins run is not: they can do what the event says anyway.
    await expect(
      generateProject(
        {},
        {
          [WRITER_ID]: WRITER,
          [SETTLE_ID]: {
            ...settle,
            protection: { requiresAuth: true, allowedRoles: ['admin'], derivedFrom: 'page' },
          },
        }
      )
    ).resolves.toBeDefined()
  })
})

describe('only the business’s staff roles skip the check', () => {
  // A route only signed-in visitors reach, with a browser value in the call.
  const gated = (allowedRoles: string[]) => {
    const workflow = checkout('server') as Record<string, unknown> & {
      nodes: Array<{ id: string; config: { parameters?: Array<{ key: string; value: unknown }> } }>
    }
    workflow.protection = { requiresAuth: true, allowedRoles, derivedFrom: 'page' }
    const record = workflow.nodes.find((node) => node.id === 'record-placed')!
    record.config.parameters = record.config.parameters!.map((parameter) =>
      parameter.key === 'actor' ? { key: 'actor', value: ref('mark', ['email']) } : parameter
    )
    return workflow
  }
  const check = (allowedRoles: string[], staffRoles: string[]) => {
    const workflow = gated(allowedRoles)
    const segments = splitIntoSegments(workflow as never)
    const segment = segments.find((candidate) => candidate.nodeIds.includes('record-placed'))!
    assertServerBoundCallParameters(
      segment,
      buildSegmentTrust(segment, {
        nodes: workflow.nodes as never,
        edges: (workflow as unknown as { edges: never }).edges,
        segments,
      }),
      {
        owner: 'Place Order',
        graphNodes: workflow.nodes as never,
        protection: workflow.protection as never,
        staffRoles,
      }
    )
  }

  it('refuses a route a visitor with a role of their own can reach', async () => {
    await expect(
      generateProject({ 'wf-checkout': gated(['user']) }, { [WRITER_ID]: WRITER })
    ).rejects.toThrow(/"Mark Placing" \(mark\), which runs in the visitor's browser/)
    const staff = TableAccess.resolveStaffRoles(null)
    expect(() => check(['customer'], staff)).toThrow(/which runs in the visitor's browser/)
    expect(() => check(['admin', 'user'], staff)).toThrow(/which runs in the visitor's browser/)
  })

  it('leaves the generated admin’s routes alone: the admin role and the admin panel’s own roles', async () => {
    await expect(
      generateProject({ 'wf-checkout': gated(['admin']) }, { [WRITER_ID]: WRITER })
    ).resolves.toBeDefined()
    const withPanelRoles = TableAccess.resolveStaffRoles({
      folderProtection: {
        panel: { folderName: 'admin-panel', allowedRoles: ['manager'] },
      },
    } as never)
    expect(withPanelRoles).toEqual(['admin', 'manager'])
    expect(() => check(['manager'], withPanelRoles)).not.toThrow()
    expect(() => check(['manager'], TableAccess.resolveStaffRoles(null))).toThrow()
  })
})

describe('a call nested inside the marked node keeps its own gates', () => {
  // The re-review's probe: a node that writes the ledger and then calls an
  // admin-only node, called — marked — from a public page.
  const GATED_ID = 'cn-gated'
  const GATED = {
    id: GATED_ID,
    name: 'Members Only Action',
    parameters: [] as unknown[],
    protection: { requiresAuth: true, allowedRoles: ['admin'], derivedFrom: 'page' },
    nodes: [
      {
        id: 'g-write',
        type: 'data-create-item',
        label: 'Admin Write',
        config: {
          dataSourceId: 'ds-1',
          tableName: 'admin_things',
          columnMappings: [{ column: 'x', value: 'y' }],
        },
        executionEnv: 'server',
        stepNumber: 1,
      },
    ],
    edges: [] as unknown[],
  }
  const LOGGER_ID = 'cn-logger'
  const LOGGER = {
    id: LOGGER_ID,
    name: 'My Logger',
    parameters: [] as unknown[],
    protection: {
      requiresAuth: false,
      allowedRoles: [] as string[],
      serverOnly: true,
      derivedFrom: 'server-callers',
    },
    nodes: [
      {
        id: 'l-write',
        type: 'data-create-item',
        label: 'Log It',
        config: {
          dataSourceId: 'ds-1',
          tableName: 'teleport_events',
          columnMappings: [{ column: 'event_type', value: 'x' }],
        },
        executionEnv: 'server',
        stepNumber: 1,
      },
      {
        id: 'l-call',
        type: 'general-custom-node',
        label: 'Then Gated',
        config: { customNodeId: GATED_ID, parameters: [] as unknown[] },
        executionEnv: 'universal',
        stepNumber: 2,
      },
    ],
    edges: [{ id: 'le1', source: 'l-write', target: 'l-call' }],
  }
  const page = {
    id: 'wf-public',
    name: 'Public Page',
    trigger: { type: 'event-page-loaded', nodeId: 't', scope: 'page', config: { allPages: true } },
    nodes: [
      {
        id: 'read',
        type: 'data-select',
        label: 'Read',
        config: { dataSourceId: 'ds-1', tableName: 'products', limit: 1 },
        executionEnv: 'server',
        stepNumber: 1,
      },
      {
        id: 'call',
        type: 'general-custom-node',
        label: 'Record Something',
        config: { customNodeId: LOGGER_ID, parameters: [{ key: 'eventType', value: 'x' }] },
        executionEnv: 'server',
        stepNumber: 2,
      },
    ],
    edges: [
      { id: 'e0', source: 't', target: 'read' },
      { id: 'e1', source: 'read', target: 'call' },
    ],
  }

  it('runs the nested admin-only node without the internal-call token: an anonymous visitor is refused', async () => {
    const files = await generateProject(
      { 'wf-public': page },
      { [GATED_ID]: GATED, [LOGGER_ID]: LOGGER }
    )
    const pageRoute = routeFiles(files).find((path) => path.includes('public-page')) as string
    const outcome = await withEnv(ENV, () =>
      asTheDeployment(files, async (app, sent) => {
        const answered = await silenced(() =>
          call(app(pageRoute) as Handler, {}, { context: { t: {} } })
        )
        return { answered, sent }
      })
    )
    // The marked node itself ran on the server, with the token…
    const loggerCalls = outcome.sent.filter((sent) => sent.url.includes('my-logger'))
    expect(loggerCalls).toHaveLength(1)
    expect(loggerCalls[0].headers['x-teleport-internal']).toBeTruthy()
    // …the node it calls was asked as the visitor, and refused them.
    const gatedCalls = outcome.sent.filter((sent) => sent.url.includes('members-only'))
    expect(gatedCalls).toHaveLength(1)
    expect(gatedCalls[0].headers).not.toHaveProperty('x-teleport-internal')
    expect(
      outcome.sent.filter((sent) => sent.json && sent.json.tableName === 'admin_things')
    ).toEqual([])
  })
})
