import { generateServerSegmentAPIRoute } from '../src/api-route-generator'
import { splitIntoSegments } from '../src/segment-splitter'
import { buildSegmentTrust } from '../src/segment-trust'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'
import { withFetch } from './_helpers/fake-fetch'

// Inside a custom node a script's `params` holds the node's step results by
// position, and the call's parameters by name. A parameter is only ever a
// name, and a step result is only ever what that step produced in this run:
// whatever a request carries, the scripts see the same step results. These
// run the GENERATED custom-node segment route.

interface RouteReply {
  status: number
  body: any
}

interface Graph {
  id: string
  nodes: any[]
  edges: any[]
}

const savedSecret = process.env.NEXTAUTH_SECRET
beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'custom-node-params-test-secret'
})
afterAll(() => {
  if (savedSecret === undefined) {
    delete process.env.NEXTAUTH_SECRET
  } else {
    process.env.NEXTAUTH_SECRET = savedSecret
  }
})

// The shape every store script uses to find "the row the read answered":
// the last step result, scanning back, that carries rows.
const DECIDE = [
  'function customHandler(previousContext, params) {',
  '  function readRows(value) {',
  '    if (value == null) { return []; }',
  '    if (Array.isArray(value)) { return value; }',
  '    if (Array.isArray(value.rows)) { return value.rows; }',
  '    return [];',
  '  }',
  '  var row = null;',
  '  for (var i = params.length - 1; i >= 0; i--) {',
  '    var rows = readRows(params[i]);',
  '    if (rows.length > 0) { row = rows[0]; break; }',
  '  }',
  '  return {',
  '    row: row,',
  '    stepCount: params.length,',
  '    orderId: params.orderId === undefined ? null : params.orderId,',
  '    inherited: params.inherited === undefined ? null : params.inherited,',
  '    plainArray: Object.getPrototypeOf(params) === Array.prototype',
  '  };',
  '}',
].join('\n')

const EXTRACT = [
  'function customHandler(previousContext, params) {',
  '  return { orderId: params.orderId == null ? "" : String(params.orderId) };',
  '}',
].join('\n')

const REPORT = 'function customHandler() { return { done: true }; }'

const step = (id: string, type: string, stepNumber: number, config: Record<string, unknown>) => ({
  id,
  type,
  label: id,
  stepNumber,
  config,
})

const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target })

const readOrder = (orderIdFrom: string) =>
  step('read', 'data-raw-query', 2, {
    dataSourceId: 'ds-1',
    query: 'SELECT * FROM orders WHERE id::text = $1',
    params: [{ type: 'workflowContext', nodeId: orderIdFrom, path: [orderIdFrom, 'orderId'] }],
  })

const serverOnly: Graph = {
  id: 'cn-complete-payment',
  nodes: [
    step('extract', 'general-custom-js', 1, { code: EXTRACT, context: 'server' }),
    readOrder('extract'),
    step('decide', 'general-custom-js', 3, { code: DECIDE, context: 'server' }),
  ],
  edges: [edge('extract', 'read'), edge('read', 'decide')],
}

// A browser step before the server steps and one after them, as in the
// store's nodes that report back in the browser.
const withBrowserSteps: Graph = {
  id: 'cn-complete-payment-reported',
  nodes: [
    step('extract', 'general-custom-js', 1, { code: EXTRACT, context: 'client' }),
    readOrder('extract'),
    step('decide', 'general-custom-js', 3, { code: DECIDE, context: 'server' }),
    step('report', 'general-custom-js', 4, { code: REPORT, context: 'client' }),
  ],
  edges: [edge('extract', 'read'), edge('read', 'decide'), edge('decide', 'report')],
}

function bootRoute(graph: Graph) {
  const segments = splitIntoSegments({ ...graph, trigger: { type: 'manual' } } as any)
  const server = segments.find((s) => s.env === 'server') as WorkflowSegment
  const customNodeIds = graph.nodes.map((n) => n.id)
  const source = generateServerSegmentAPIRoute(server, graph.id, undefined, {
    customNodeIds,
    trust: buildSegmentTrust(server, { ...graph, segments }),
  })
  const runtime = loadServerRuntime()
  const routeModule: { exports: any } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', source)(
    routeModule,
    routeModule.exports,
    (id: string) => (id.endsWith('server-runtime') ? runtime : {})
  )
  const handler = routeModule.exports as (req: unknown, res: unknown) => Promise<void>
  // The body travels as JSON text, the way a request carries it: a key such as
  // "__proto__" arrives as an ordinary key of the parameters object.
  return async (customParamsJson: string, results: Record<string, unknown> = {}) => {
    const reply: RouteReply = { status: 0, body: null }
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
    const context = JSON.parse(`{"__customParams":${customParamsJson}}`)
    Object.assign(context, results, {
      __isInsideCustomNode: true,
      __customNodeIds: customNodeIds,
    })
    await handler({ method: 'POST', body: { context }, headers: { host: 'localhost:3000' } }, res)
    return reply
  }
}

const STORED_ORDER = { id: 'o-1', payment_status: 'pending' }
const OTHER_ROW = { id: 'o-2', payment_status: 'paid' }

const answering = (rows: unknown[]) => () => ({ body: { rows } })

describe('a custom node call: parameters are names, step results stay positional', () => {
  const run = bootRoute(serverOnly)

  it('hands a named parameter to every script and the read answers its row', async () => {
    await withFetch(answering([STORED_ORDER]), async (calls) => {
      const reply = await run('{"orderId":"o-1"}')
      expect(reply.status).toBe(200)
      expect(calls).toHaveLength(1)
      expect(calls[0].json.params).toEqual(['o-1'])
      expect(reply.body.results.decide).toEqual({
        row: STORED_ORDER,
        stepCount: 2,
        orderId: 'o-1',
        inherited: null,
        plainArray: true,
      })
    })
  })

  it('a key past the step results adds no step result', async () => {
    await withFetch(answering([]), async () => {
      const reply = await run(`{"orderId":"o-1","900":{"rows":[${JSON.stringify(OTHER_ROW)}]}}`)
      expect(reply.status).toBe(200)
      expect(reply.body.results.decide).toMatchObject({ row: null, stepCount: 2, orderId: 'o-1' })
    })
  })

  it('a key naming a step position leaves that step result as it was', async () => {
    await withFetch(answering([]), async () => {
      const reply = await run(`{"orderId":"o-1","0":{"rows":[${JSON.stringify(OTHER_ROW)}]}}`)
      expect(reply.status).toBe(200)
      expect(reply.body.results.decide).toMatchObject({ row: null, stepCount: 2, orderId: 'o-1' })
    })
  })

  it('"length" leaves every step result in place', async () => {
    await withFetch(answering([STORED_ORDER]), async () => {
      const reply = await run('{"orderId":"o-1","length":0}')
      expect(reply.status).toBe(200)
      expect(reply.body.results.decide).toMatchObject({
        row: STORED_ORDER,
        stepCount: 2,
        orderId: 'o-1',
      })
    })
  })

  it('"__proto__" leaves params a plain array', async () => {
    await withFetch(answering([STORED_ORDER]), async () => {
      const reply = await run(
        `{"orderId":"o-1","__proto__":{"inherited":"yes","rows":[${JSON.stringify(OTHER_ROW)}]}}`
      )
      expect(reply.status).toBe(200)
      expect(reply.body.results.decide).toEqual({
        row: STORED_ORDER,
        stepCount: 2,
        orderId: 'o-1',
        inherited: null,
        plainArray: true,
      })
    })
  })

  it('the list form of the parameters follows the same rule', async () => {
    await withFetch(answering([]), async () => {
      const reply = await run(
        `[{"key":"900","value":{"rows":[${JSON.stringify(OTHER_ROW)}]}},` +
          `{"key":"length","value":5},{"key":"orderId","value":"o-1"}]`
      )
      expect(reply.status).toBe(200)
      expect(reply.body.results.decide).toMatchObject({ row: null, stepCount: 2, orderId: 'o-1' })
    })
  })
})

describe('a custom node segment: a step result is what that step produced in this run', () => {
  const run = bootRoute(withBrowserSteps)

  it('keeps the result of a browser step that ran before the segment', async () => {
    await withFetch(answering([STORED_ORDER]), async (calls) => {
      const reply = await run('{"orderId":"o-1"}', { extract: { orderId: 'o-1' } })
      expect(reply.status).toBe(200)
      expect(calls[0].json.params).toEqual(['o-1'])
      expect(reply.body.results.decide).toMatchObject({ row: STORED_ORDER, stepCount: 3 })
    })
  })

  it('holds no result for a step that runs after the segment', async () => {
    await withFetch(answering([]), async () => {
      const reply = await run('{"orderId":"o-1"}', {
        extract: { orderId: 'o-1' },
        report: { rows: [OTHER_ROW] },
      })
      expect(reply.status).toBe(200)
      expect(reply.body.results.decide).toMatchObject({ row: null, stepCount: 3 })
    })
  })
})

describe('buildSegmentTrust — the steps that run after a segment', () => {
  const trustOf = (graph: Graph) => {
    const segments = splitIntoSegments({ ...graph, trigger: { type: 'manual' } } as any)
    const server = segments.find((s) => s.env === 'server') as WorkflowSegment
    return buildSegmentTrust(server, { ...graph, segments })
  }

  it('names the later steps the segment leads to, never an earlier one', () => {
    expect(trustOf(withBrowserSteps).downstreamNodeIds).toEqual(['report'])
    expect(trustOf(serverOnly).downstreamNodeIds).toEqual([])
  })

  it('leaves out a step of a loop body', () => {
    const looped: Graph = {
      id: 'cn-looped',
      nodes: [
        ...withBrowserSteps.nodes,
        step('loop', 'general-loop', 5, { collection: [] }),
        step('each', 'general-custom-js', 6, { code: REPORT, context: 'client' }),
      ],
      edges: [
        ...withBrowserSteps.edges,
        edge('report', 'loop'),
        { id: 'loop-each', source: 'loop', target: 'each', sourceHandle: 'loop' },
      ],
    }
    expect(trustOf(looped).downstreamNodeIds).toEqual(['report', 'loop'])
  })
})
