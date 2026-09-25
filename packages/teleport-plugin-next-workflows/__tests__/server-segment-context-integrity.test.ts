import { generateSharedRuntimeUtilsCode, generateServerSegmentAPIRoute } from '../src'
import { splitIntoSegments } from '../src/segment-splitter'
import type { WorkflowSegment } from '../src/types'
import type { ServerSegmentRouteOptions } from '../src/api-route-generator'

// A server segment's nodes run inside the route, and whatever the request says
// about them arrives from the browser. A crafted POST used to be able to hand
// a later node a forged result by marking the real producer skipped, to skip a
// node in the middle of the segment (a sanitizer, a guard) while its
// successors ran, and to point a custom node's inner custom-js at an injected
// context key. These run the GENERATED route against such requests.

interface RouteReply {
  status: number
  body: { success: boolean; results?: Record<string, unknown>; error?: string }
}

function loadSharedRuntime(): Record<string, unknown> {
  const utilsModule: { exports: Record<string, unknown> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', generateSharedRuntimeUtilsCode())(
    utilsModule,
    utilsModule.exports
  )
  return utilsModule.exports
}

function bootRoute(segment: WorkflowSegment, options?: ServerSegmentRouteOptions) {
  const source = generateServerSegmentAPIRoute(segment, 'Integrity', undefined, options)
  const utils = loadSharedRuntime()
  const requireStub = (id: string) => (id.endsWith('server-runtime') ? utils : {})
  const routeModule: { exports: unknown } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', source)(
    routeModule,
    routeModule.exports,
    requireStub
  )
  const handler = routeModule.exports as (req: unknown, res: unknown) => Promise<void>
  return async (context: Record<string, unknown>): Promise<RouteReply> => {
    const reply: RouteReply = { status: 0, body: { success: false } }
    const res = {
      status(code: number) {
        reply.status = code
        return this
      },
      json(payload: RouteReply['body']) {
        reply.body = payload
        return this
      },
    }
    await handler({ method: 'POST', body: { context }, headers: { host: 'localhost:3000' } }, res)
    return reply
  }
}

const script = (body: string) => `function customHandler(params) { ${body} }`

// load → price → withhold: the shape of a server step that must not be steered.
const loadNode = {
  id: 'load',
  type: 'general-custom-js',
  label: 'Load Lines',
  executionEnv: 'server' as const,
  stepNumber: 1,
  config: { code: script('return { rows: [{ amount: 10 }] }'), context: 'server' },
}
const priceNode = {
  id: 'price',
  type: 'general-custom-js',
  label: 'Price Lines',
  executionEnv: 'server' as const,
  stepNumber: 2,
  config: {
    code: script(
      'var named = params[params.length - 1] || {}; var rows = named.rows || []; return { total: rows.reduce(function (s, r) { return s + r.amount; }, 0), secret: "code-123" }'
    ),
    context: 'server',
    params: { rows: { type: 'workflowContext', nodeId: 'load', path: ['rows'] } },
  },
}
const withholdNode = {
  id: 'withhold',
  type: 'general-custom-js',
  label: 'Withhold Secret',
  executionEnv: 'server' as const,
  stepNumber: 3,
  config: {
    code: script('return { withheld: true }'),
    context: 'server',
  },
}
const chain: WorkflowSegment = {
  id: 'server-1',
  env: 'server',
  nodeIds: ['load', 'price', 'withhold'],
  nodes: [loadNode, priceNode, withholdNode],
  edges: [
    { id: 'e1', source: 'load', target: 'price' },
    { id: 'e2', source: 'price', target: 'withhold' },
  ] as WorkflowSegment['edges'],
  entryNodeIds: ['load'],
}

describe('generated server segment — what the request says about its own nodes', () => {
  it('drops a forged result for a node it runs itself', async () => {
    const run = bootRoute(chain)
    const reply = await run({ load: { rows: [{ amount: 100000 }] } })
    expect(reply.status).toBe(200)
    expect(reply.body.results?.load).toEqual({ rows: [{ amount: 10 }] })
    expect(reply.body.results?.price).toMatchObject({ total: 10 })
  })

  it('cannot keep a forged result alive by marking its producer skipped', async () => {
    const run = bootRoute(chain)
    const reply = await run({
      load: { rows: [{ amount: 100000 }] },
      __skippedNodes: { load: true },
    })
    expect(reply.status).toBe(200)
    // A skip where the branch enters the segment covers everything it
    // reaches inside it, as the client's own branch walk marks it.
    expect(reply.body.results?.load).toBeUndefined()
    expect(reply.body.results?.price).toBeUndefined()
    expect(reply.body.results?.withhold).toBeUndefined()
  })

  it('ignores a skip mark on a node in the middle of the segment', async () => {
    const run = bootRoute(chain)
    const reply = await run({ __skippedNodes: { withhold: true, price: true } })
    expect(reply.body.results?.price).toMatchObject({ total: 10 })
    expect(reply.body.results?.withhold).toEqual({ withheld: true })
  })

  it('ignores a loop-body mark the request puts on one of its own nodes', async () => {
    // The route skips loop-body nodes in its main pass; only its own loop
    // handling may mark them.
    const run = bootRoute(chain)
    const reply = await run({ __loopBodyNodeIds: { withhold: true, price: true } })
    expect(reply.body.results?.price).toMatchObject({ total: 10 })
    expect(reply.body.results?.withhold).toEqual({ withheld: true })
  })

  it('still skips a branch the client decided where it enters the segment', async () => {
    // A client if-node upstream chose the other branch: both of its targets
    // landed in this segment, and only the untaken one is marked.
    const other = { ...withholdNode, id: 'other', label: 'Other Branch', stepNumber: 2 }
    const branches: WorkflowSegment = {
      id: 'server-1',
      env: 'server',
      nodeIds: ['load', 'other'],
      nodes: [loadNode, other],
      edges: [],
      entryNodeIds: ['load', 'other'],
    }
    const reply = await bootRoute(branches)({ __skippedNodes: { other: true } })
    expect(reply.body.results?.load).toEqual({ rows: [{ amount: 10 }] })
    expect(reply.body.results?.other).toBeUndefined()
  })

  it('reads a custom node inner results by the ids baked into the route', async () => {
    const readFirst = {
      id: 'read',
      type: 'general-custom-js',
      label: 'Read First Param',
      executionEnv: 'server' as const,
      stepNumber: 2,
      config: {
        code: 'function customHandler(previous, params) { return { first: params[0] } }',
        context: 'server',
      },
    }
    const segment: WorkflowSegment = {
      id: 'server-1',
      env: 'server',
      nodeIds: ['load', 'read'],
      nodes: [loadNode, readFirst],
      edges: [{ id: 'e1', source: 'load', target: 'read' }] as WorkflowSegment['edges'],
      entryNodeIds: ['load'],
    }
    const run = bootRoute(segment, { customNodeIds: ['load', 'read'] })
    const reply = await run({
      __isInsideCustomNode: true,
      __customNodeIds: ['injected', 'load', 'read'],
      injected: { rows: [{ amount: 100000 }] },
    })
    expect(reply.body.results?.read).toEqual({ first: { rows: [{ amount: 10 }] } })
  })
})

describe('splitIntoSegments — entry nodes', () => {
  it('marks where a branch from outside the segment can begin, convergence included', () => {
    const node = (id: string, type: string, stepNumber: number) => ({
      id,
      type,
      label: id,
      stepNumber,
      config: {},
    })
    const segments = splitIntoSegments({
      nodes: [
        node('gate', 'general-if-statement', 1),
        node('a', 'data-select', 2),
        node('b', 'data-select', 3),
        node('join', 'data-select', 4),
      ],
      edges: [
        { id: 'e1', source: 'gate', target: 'a', sourceHandle: 'true' },
        { id: 'e2', source: 'gate', target: 'b', sourceHandle: 'false' },
        { id: 'e3', source: 'a', target: 'join' },
        { id: 'e4', source: 'gate', target: 'join', sourceHandle: 'true' },
      ],
      trigger: { type: 'manual' },
    } as never)
    const server = segments.find((s) => s.env === 'server')
    expect(server?.nodeIds).toEqual(expect.arrayContaining(['a', 'b', 'join']))
    expect(server?.entryNodeIds).toEqual(expect.arrayContaining(['a', 'b', 'join']))
  })
})
