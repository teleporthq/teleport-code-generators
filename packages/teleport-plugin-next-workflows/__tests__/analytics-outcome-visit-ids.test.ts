import * as crypto from 'crypto'
import * as net from 'net'
import { generateServerSegmentAPIRoute } from '../src/api-route-generator'
import {
  generateClientRuntimeCode,
  generateSharedRuntimeUtilsCode,
} from '../src/executor-generator'
import { nodeRegistry } from '../src/nodes'
import { resolveHandlerEntryName } from '../src/nodes/types'
import { generateSecurityRuntimeCode } from '../src/security-runtime'
import { splitIntoSegments } from '../src/segment-splitter'
import { buildSegmentTrust } from '../src/segment-trust'
import { TRACKER_IDS_EXPRESSION } from '../src/trigger-generator'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'

// A sale only converts in Growth when its report names the visit it came from.
// A trigger stamps the tracker's ids on itself (`__tpa`), and the steps that read
// them look at the top of the run's context, so the runtime has to lift them
// there. The node's own test hands it `{ __tpa }` as its context, which no run
// ever did: every server-reported outcome went out with no visit, and the order's
// "remember the visit" step wrote nothing. These run the GENERATED browser runtime
// against the GENERATED routes, split and signed as the project plugin emits them.

const SHOPPER = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  visitorId: '22222222-2222-4222-8222-222222222222',
  pageLoadId: '33333333-3333-4333-8333-333333333333',
  path: '/checkout',
  exp: 'hero:b',
}
const MERCHANT = {
  sessionId: '44444444-4444-4444-8444-444444444444',
  visitorId: '55555555-5555-4555-8555-555555555555',
  pageLoadId: '66666666-6666-4666-8666-666666666666',
  path: '/orders/ORD-15',
  exp: 'hero:a',
}

const SET_ENV: Record<string, string> = {
  NEXTAUTH_SECRET: 'analytics-outcome-visit-ids-secret',
  NEXT_PUBLIC_TELEPORT_ANALYTICS_URL: 'https://analytics.example',
  NEXT_PUBLIC_TELEPORT_ANALYTICS_KEY: 'tpa_key',
  TELEPORT_ANALYTICS_SERVER_KEY: 'tpas_secret',
}

const wfCtx = (nodeId: string, path: string[]) => ({
  type: 'workflowContext',
  nodeId,
  path: [nodeId, ...path],
})

const step = (
  id: string,
  type: string,
  stepNumber: number,
  config: Record<string, unknown> = {}
) => ({ id, type, label: id, stepNumber, config })

const line = (...ids: string[]) =>
  ids.slice(1).map((target, index) => ({
    id: `${ids[index]}-${target}`,
    source: ids[index],
    target,
  }))

interface Graph {
  nodes: Array<ReturnType<typeof step>>
  edges: Array<ReturnType<typeof line>[number]>
  segments: WorkflowSegment[]
}

function graphOf(nodes: Graph['nodes'], edges: Graph['edges']): Graph {
  const segments = splitIntoSegments({
    nodes,
    edges,
    trigger: { type: 'event-element-clicked' },
  } as any)
  return { nodes, edges, segments }
}

function loadSecurity() {
  const noop = (): undefined => undefined
  const security = { exports: {} as any }
  // tslint:disable-next-line:function-constructor
  new Function(
    'module',
    'exports',
    'require',
    'process',
    'console',
    'Buffer',
    'Date',
    generateSecurityRuntimeCode()
  )(
    security,
    security.exports,
    (name: string) => (name === 'crypto' ? crypto : name === 'net' ? net : (null as never)),
    { env: {} },
    { warn: noop, error: noop, log: noop },
    Buffer,
    Date
  )
  return security.exports
}

function bootRoute(segment: WorkflowSegment, graph: Graph) {
  const security = loadSecurity()
  const runtime = loadServerRuntime()
  const source = generateServerSegmentAPIRoute(segment, 'Flow', undefined, {
    trust: buildSegmentTrust(segment, graph as any),
  })
  const routeModule: { exports: any } = { exports: {} }
  // tslint:disable-next-line:function-constructor
  new Function('module', 'exports', 'require', source)(
    routeModule,
    routeModule.exports,
    (name: string) =>
      name.endsWith('server-runtime') ? runtime : name.endsWith('security-runtime') ? security : {}
  )
  return routeModule.exports as (req: unknown, res: unknown) => Promise<void>
}

function loadBrowserRuntime() {
  const utils = { exports: {} as any }
  // tslint:disable-next-line:function-constructor
  new Function('module', 'exports', 'require', generateSharedRuntimeUtilsCode())(
    utils,
    utils.exports,
    () => ({})
  )
  const client = { exports: {} as any }
  // tslint:disable-next-line:function-constructor
  new Function('module', 'exports', 'require', generateClientRuntimeCode())(
    client,
    client.exports,
    (name: string) => (name === './runtime-utils' ? utils.exports : (null as never))
  )
  return { utils: utils.exports, client: client.exports }
}

function handlerOf(nodeType: string, source: string) {
  const entry = resolveHandlerEntryName(source, nodeType)
  // tslint:disable-next-line:function-constructor
  return new Function(`${source}\nreturn ${entry};`)()
}

const trackerIdsIn = (window: unknown) =>
  // tslint:disable-next-line:function-constructor
  new Function('window', `return ${TRACKER_IDS_EXPRESSION};`)(window)

interface Seen {
  outcomes: Array<Record<string, any>>
  rawParams: unknown[][]
  segmentContexts: Array<Record<string, any>>
}

describe('the visit a server-reported outcome names', () => {
  const runtime = loadBrowserRuntime()
  const scope = globalThis as Record<string, unknown>
  const savedFetch = scope.fetch
  const savedEnv: Record<string, string | undefined> = {}
  let routes: Record<string, (req: unknown, res: unknown) => Promise<void>> = {}
  let rawRows: Array<Record<string, unknown>> = []
  let seen: Seen

  beforeAll(() => {
    Object.keys(SET_ENV).forEach((name) => {
      savedEnv[name] = process.env[name]
      process.env[name] = SET_ENV[name]
    })
    // The browser's fetch and the route's own: the analytics service, the data
    // route and the workflow routes, the last answered by the generated route.
    scope.fetch = async (url: string, init: { body: string }) => {
      const address = String(url)
      const body = JSON.parse(init.body)
      if (address.indexOf('/events/tpa_key/server') !== -1) {
        seen.outcomes.push(...body.outcomes)
        return { ok: true, status: 202, json: async () => ({}) }
      }
      if (address.indexOf('/raw-query') !== -1) {
        seen.rawParams.push(body.params)
        return { ok: true, status: 200, json: async () => ({ rows: rawRows }) }
      }
      const route = routes[new URL(address, 'https://shop.test').pathname]
      seen.segmentContexts.push(body.context)
      const reply = { status: 200, body: null as any }
      const res = {
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
      await route(
        {
          method: 'POST',
          body,
          headers: { host: 'shop.test' },
          socket: { remoteAddress: '203.0.113.9' },
        },
        res
      )
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        statusText: '',
        json: async () => reply.body,
      }
    }
  })

  afterAll(() => {
    scope.fetch = savedFetch
    Object.keys(SET_ENV).forEach((name) => {
      if (savedEnv[name] === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = savedEnv[name]
      }
    })
  })

  beforeEach(() => {
    routes = {}
    rawRows = []
    seen = { outcomes: [], rawParams: [], segmentContexts: [] }
  })

  function run(
    graph: Graph,
    trigger: Record<string, unknown>,
    clientHandlers: Record<string, unknown> = {}
  ) {
    const urls: Record<string, string> = {}
    graph.segments
      .filter((segment) => segment.env === 'server')
      .forEach((segment) => {
        const path = `/api/workflows/flow-${segment.id}`
        routes[path] = bootRoute(segment, graph)
        urls[segment.id] = path
      })
    return runtime.client.executeWorkflowWithSegments(
      {
        id: 'flow',
        triggerNodeId: 'trigger',
        nodes: graph.nodes,
        edges: graph.edges,
        segments: graph.segments,
      },
      trigger,
      clientHandlers,
      urls
    )
  }

  describe('a run the visitor started: the place-order shape', () => {
    const placeOrder = graphOf(
      [
        step('assemble', 'general-custom-js', 1, {
          context: 'server',
          code: `function customHandler() {
            return {
              id: 'order-15',
              total_amount: 159,
              currency: 'RON',
              attribution: { utm_source: 'newsletter', landing_path: '/sale', visitor_id: 'stale-aid' },
            }
          }`,
        }),
        step('busy', 'state-update-local-state', 2, { property: 'isPlacing', value: 'true' }),
        // `buildRememberOrderVisitNode` in teleport-gui: order, session, visitor, arm.
        step('remember', 'data-raw-query', 3, {
          dataSourceId: 'ds',
          query:
            "UPDATE teleport_orders o SET metadata = jsonb_build_object('analyticsVisit', jsonb_build_object('sessionId', $2::text, 'visitorId', $3::text, 'exp', $4::text))::text WHERE o.id::text = $1::text AND NULLIF($2::text, '') IS NOT NULL",
          params: [
            wfCtx('assemble', ['id']),
            wfCtx('__tpa', ['sessionId']),
            wfCtx('__tpa', ['visitorId']),
            wfCtx('__tpa', ['exp']),
          ],
          continueOnError: true,
        }),
        // `buildReportOrderNode` in teleport-gui.
        step('report', 'analytics-track-outcome', 4, {
          name: 'purchase',
          value: wfCtx('assemble', ['total_amount']),
          currency: wfCtx('assemble', ['currency']),
          outcomeId: wfCtx('assemble', ['id']),
          attribution: wfCtx('assemble', ['attribution']),
        }),
      ],
      line('assemble', 'busy', 'remember', 'report')
    )

    // What a generated trigger hands the runtime (`generateExecutionCall`).
    const placeOrderWith = (stamped: unknown) =>
      run(
        placeOrder,
        { formData: {}, __tpa: stamped },
        {
          'state-update-local-state': async () => ({ updated: true }),
        }
      )

    it('splits into a server segment, a browser one and a server one', () => {
      expect(placeOrder.segments.map((segment) => segment.env)).toEqual([
        'server',
        'client',
        'server',
      ])
    })

    it('reports the sale with the session, visitor and arm of the visit', async () => {
      await placeOrderWith(SHOPPER)

      expect(seen.outcomes).toHaveLength(1)
      expect(seen.outcomes[0]).toMatchObject({
        name: 'purchase',
        value: 159,
        currency: 'RON',
        outcomeId: 'order-15',
        sessionId: SHOPPER.sessionId,
        visitorId: SHOPPER.visitorId,
        path: SHOPPER.path,
        exp: SHOPPER.exp,
        attribution: { utmSource: 'newsletter', landingPath: '/sale' },
      })
    })

    it('leaves the same ids on the order for the run that confirms its payment', async () => {
      await placeOrderWith(SHOPPER)

      expect(seen.rawParams).toEqual([
        ['order-15', SHOPPER.sessionId, SHOPPER.visitorId, SHOPPER.exp],
      ])
    })

    it('still carries the ids to the server segment after the browser one', async () => {
      await placeOrderWith(SHOPPER)

      expect(seen.segmentContexts).toHaveLength(2)
      expect(seen.segmentContexts[0].__tpa).toEqual(SHOPPER)
      expect(seen.segmentContexts[1].__tpa).toEqual(SHOPPER)
    })

    it('names no visitor for a visitor without consent, and still the session', async () => {
      await placeOrderWith({ ...SHOPPER, visitorId: null, exp: null })

      expect(seen.outcomes[0]).toMatchObject({
        sessionId: SHOPPER.sessionId,
        visitorId: null,
        exp: null,
      })
      expect(seen.rawParams).toEqual([['order-15', SHOPPER.sessionId, null, null]])
    })

    it('reports the sale with no visit, and keeps none, without a tracker', async () => {
      const stamped = trackerIdsIn({})
      expect(stamped).toBeNull()

      await placeOrderWith(stamped)

      expect(seen.segmentContexts[0]).not.toHaveProperty('__tpa')
      expect(seen.outcomes).toHaveLength(1)
      expect(seen.outcomes[0]).toMatchObject({
        outcomeId: 'order-15',
        sessionId: null,
        visitorId: null,
        path: null,
        exp: null,
      })
      // The statement's own guard writes nothing without a session.
      expect(seen.rawParams).toEqual([['order-15', null, null, null]])
    })
  })

  describe('a run without segments', () => {
    const workflow = {
      triggerNodeId: 'trigger',
      nodes: [
        step('report', 'analytics-track-outcome', 1, {
          name: 'purchase',
          value: 20,
          currency: 'RON',
          outcomeId: 'order-7',
        }),
        step('read', 'read-the-ids', 2, { sessionId: wfCtx('__tpa', ['sessionId']) }),
      ],
      edges: line('report', 'read'),
    }
    const handlers = () => ({
      'analytics-track-outcome': handlerOf(
        'analytics-track-outcome',
        nodeRegistry['analytics-track-outcome'].generateServerHandler?.() ?? ''
      ),
      'read-the-ids': async (config: { sessionId: unknown }) => ({ sessionId: config.sessionId }),
    })

    it('gives its steps the ids the trigger stamped', async () => {
      const context = await runtime.utils.executeWorkflow(workflow, { __tpa: SHOPPER }, handlers())

      expect(seen.outcomes[0]).toMatchObject({
        sessionId: SHOPPER.sessionId,
        visitorId: SHOPPER.visitorId,
        exp: SHOPPER.exp,
      })
      expect(context.read).toEqual({ sessionId: SHOPPER.sessionId })
    })

    it('runs the same with no ids stamped', async () => {
      const context = await runtime.utils.executeWorkflow(workflow, { __tpa: null }, handlers())

      expect(context).not.toHaveProperty('__tpa')
      expect(seen.outcomes[0]).toMatchObject({ sessionId: null, visitorId: null, exp: null })
      expect(context.read.sessionId).toBeUndefined()
    })
  })

  describe('a run outside the visit: a payment webhook reading the order back', () => {
    // `buildPaidOrderReportSteps` in teleport-gui: the read, then the report.
    const confirmPayment = graphOf(
      [
        step('load', 'data-raw-query', 1, {
          dataSourceId: 'ds',
          query: 'SELECT o.id FROM teleport_orders o WHERE o.id::text = $1::text',
          params: ['order-15'],
          continueOnError: true,
        }),
        step('report', 'analytics-track-outcome', 2, {
          name: 'purchase',
          value: wfCtx('load', ['result', '0', 'total_amount']),
          currency: wfCtx('load', ['result', '0', 'currency']),
          outcomeId: wfCtx('load', ['result', '0', 'id']),
          attribution: wfCtx('load', ['result', '0']),
        }),
      ],
      line('load', 'report')
    )
    const paidOrder = {
      id: 'order-15',
      total_amount: '159.00',
      currency: 'RON',
      utm_source: 'newsletter',
    }
    const rememberedVisit = {
      session_id: SHOPPER.sessionId,
      visitor_id: SHOPPER.visitorId,
      exp: SHOPPER.exp,
    }

    it('takes the ids from the visit the order kept, with none on the trigger', async () => {
      rawRows = [{ ...paidOrder, ...rememberedVisit }]

      await run(confirmPayment, { timestamp: 1 })

      expect(seen.segmentContexts[0]).not.toHaveProperty('__tpa')
      expect(seen.outcomes).toHaveLength(1)
      expect(seen.outcomes[0]).toMatchObject({
        outcomeId: 'order-15',
        value: 159,
        sessionId: SHOPPER.sessionId,
        visitorId: SHOPPER.visitorId,
        exp: SHOPPER.exp,
        attribution: { utmSource: 'newsletter' },
      })
    })

    it('prefers the visit the order kept to the ids of whoever runs the step', async () => {
      rawRows = [{ ...paidOrder, ...rememberedVisit }]

      await run(confirmPayment, { __tpa: MERCHANT })

      expect(seen.segmentContexts[0].__tpa).toEqual(MERCHANT)
      expect(seen.outcomes[0]).toMatchObject({
        sessionId: SHOPPER.sessionId,
        visitorId: SHOPPER.visitorId,
        exp: SHOPPER.exp,
      })
    })

    it('still reports the sale, with no visit, when neither names one', async () => {
      rawRows = [paidOrder]

      const context = await run(confirmPayment, { timestamp: 1 })

      expect(seen.outcomes).toHaveLength(1)
      expect(seen.outcomes[0]).toMatchObject({
        outcomeId: 'order-15',
        sessionId: null,
        visitorId: null,
        path: null,
        exp: null,
      })
      expect(context.report).toEqual({ sent: true, status: 202 })
    })

    it('sends nothing, and does not fail, when the read found no order', async () => {
      rawRows = []

      const context = await run(confirmPayment, { timestamp: 1 })

      expect(seen.outcomes).toEqual([])
      expect(context.report).toEqual({ sent: false, reason: 'no-outcome-id' })
    })
  })

  describe('a run that stays in the browser', () => {
    const customJs = (id: string, stepNumber: number, returned: string) =>
      step(id, 'general-custom-js', stepNumber, {
        code: `function customHandler(params) { return ${returned} }`,
      })
    const browserOnly = {
      nodes: [
        customJs('first', 1, '{ count: params.length }'),
        customJs('second', 2, '{ count: params.length, last: params[params.length - 1] }'),
        step('newsletter', 'analytics-track-outcome', 3, {
          name: 'newsletter',
          recordId: 'form-1',
        }),
      ],
      edges: line('first', 'second', 'newsletter'),
    }
    const inTheBrowser = (stamped: unknown) =>
      run(
        {
          ...browserOnly,
          segments: [
            {
              id: 'seg-client-1',
              env: 'client',
              nodes: browserOnly.nodes,
              edges: browserOnly.edges,
            },
          ] as unknown as WorkflowSegment[],
        },
        { __tpa: stamped },
        {
          'general-custom-js': handlerOf(
            'general-custom-js',
            nodeRegistry['general-custom-js'].generateHandler()
          ),
          'analytics-track-outcome': handlerOf(
            'analytics-track-outcome',
            nodeRegistry['analytics-track-outcome'].generateHandler()
          ),
        }
      )

    it('reads a missing tracker, or one without the ids, as no ids', () => {
      expect(trackerIdsIn(undefined)).toBeNull()
      expect(trackerIdsIn({})).toBeNull()
      expect(trackerIdsIn({ tpAnalytics: {} })).toBeNull()
      expect(trackerIdsIn({ tpAnalytics: { ids: () => SHOPPER } })).toEqual(SHOPPER)
    })

    it('runs every step without a tracker, and puts no ids on the context', async () => {
      const context = await inTheBrowser(trackerIdsIn({}))

      expect(context).not.toHaveProperty('__tpa')
      expect(context.first).toEqual({ count: 1 })
      expect(context.second.count).toBe(2)
      expect(context.newsletter).toEqual({ sent: false, reason: 'tracker-unavailable' })
      expect(seen.segmentContexts).toEqual([])
      expect(seen.outcomes).toEqual([])
    })

    it('gives a custom script the same params with the ids lifted', async () => {
      const without = await inTheBrowser(null)
      const withIds = await inTheBrowser(SHOPPER)

      expect(withIds.__tpa).toEqual(SHOPPER)
      expect(withIds.first).toEqual(without.first)
      expect(withIds.second).toEqual(without.second)
      expect(seen.segmentContexts).toEqual([])
    })
  })
})
