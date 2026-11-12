import {
  generateCronAPIRoute,
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
} from '../src/api-route-generator'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'
import { withEnv } from './_helpers/fake-fetch'

/**
 * A loop inside the body of another loop runs all of its passes on every pass
 * of the outer one. The server routes ran an outer body as one flat list: the
 * inner loop node fell through to a stub and its body ran once per outer pass.
 * Each route kind is booted here and run with nested loops.
 */

const OUTER_ID = 'outer-1'
const MIDDLE_ID = 'middle-1'
const INNER_ID = 'inner-1'
const MAKE_ID = 'make-1'
const IF_ID = 'if-1'
const BODY_ID = 'body-1'
const HIGH_ID = 'high-1'
const LOW_ID = 'low-1'
const AFTER_ID = 'after-1'
const REPORT_ID = 'report-1'
const INNER_ITER_ID = INNER_ID + '_iter'
const RUNS_KEY = '__serverNestedLoopRuns'
const MADE_KEY = '__serverNestedLoopMade'

type GraphNode = Record<string, unknown> & { id: string }
type GraphEdge = Record<string, unknown> & { id: string; source: string; target: string }
interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}
interface Run {
  status: number
  loopResult: (loopId: string) => unknown
}

const runs = (): unknown[] => (globalThis as Record<string, any>)[RUNS_KEY] || []

const loopNode = (id: string, stepNumber: number, config: Record<string, unknown>): GraphNode => ({
  id,
  type: 'general-loop',
  config,
  stepNumber,
  label: id,
})

const recordingNode = (id: string, stepNumber: number): GraphNode => ({
  id,
  type: 'general-custom-js',
  config: {
    code: [
      'function customHandler() {',
      `  globalThis.${RUNS_KEY} = (globalThis.${RUNS_KEY} || []).concat('${id}');`,
      `  return { n: globalThis.${RUNS_KEY}.length };`,
      '}',
    ].join('\n'),
    context: 'server',
  },
  stepNumber,
  label: id,
})

const bodyEntry = (id: string, loopId: string, target: string): GraphEdge => ({
  id,
  source: loopId,
  target,
  sourceHandle: 'loop',
  targetHandle: 'loop-body-in',
})

const loopBack = (id: string, source: string, loopId: string): GraphEdge => ({
  id,
  source,
  target: loopId,
  sourceHandle: 'loop-body-out',
  targetHandle: 'loop-back',
})

const exitTo = (id: string, loopId: string, target: string): GraphEdge => ({
  id,
  source: loopId,
  target,
  sourceHandle: 'exit',
})

const forLoopInForLoop = (): Graph => ({
  nodes: [
    loopNode(OUTER_ID, 1, { loopType: 'for', endIndex: 2 }),
    loopNode(INNER_ID, 2, { loopType: 'for', endIndex: 3 }),
    recordingNode(BODY_ID, 3),
    recordingNode(AFTER_ID, 4),
  ],
  edges: [
    bodyEntry('e1', OUTER_ID, INNER_ID),
    bodyEntry('e2', INNER_ID, BODY_ID),
    loopBack('e3', BODY_ID, INNER_ID),
    loopBack('e4', INNER_ID, OUTER_ID),
    exitTo('e5', OUTER_ID, AFTER_ID),
  ],
})

const threeLoopsDeep = (): Graph => ({
  nodes: [
    loopNode(OUTER_ID, 1, { loopType: 'for', endIndex: 2 }),
    loopNode(MIDDLE_ID, 2, { loopType: 'forEach', collection: ['a', 'b'] }),
    loopNode(INNER_ID, 3, { loopType: 'map', collection: ['x', 'y', 'z'] }),
    recordingNode(BODY_ID, 4),
    recordingNode(AFTER_ID, 5),
  ],
  edges: [
    bodyEntry('e1', OUTER_ID, MIDDLE_ID),
    bodyEntry('e2', MIDDLE_ID, INNER_ID),
    bodyEntry('e3', INNER_ID, BODY_ID),
    loopBack('e4', BODY_ID, INNER_ID),
    loopBack('e5', INNER_ID, MIDDLE_ID),
    loopBack('e6', MIDDLE_ID, OUTER_ID),
    exitTo('e7', OUTER_ID, AFTER_ID),
  ],
})

/**
 * The outer body first makes a collection (one item on the first outer pass,
 * two on the second), then walks it with the inner loop, whose body records
 * the item it was handed.
 */
const forEachOverWhatTheOuterPassMade = (): Graph => ({
  nodes: [
    loopNode(OUTER_ID, 1, { loopType: 'for', endIndex: 2 }),
    {
      id: MAKE_ID,
      type: 'general-custom-js',
      config: {
        code: [
          'function customHandler() {',
          `  globalThis.${MADE_KEY} = (globalThis.${MADE_KEY} || 0) + 1;`,
          `  return { items: globalThis.${MADE_KEY} === 1 ? ['a'] : ['b', 'c'] };`,
          '}',
        ].join('\n'),
        context: 'server',
      },
      stepNumber: 2,
      label: 'Make The Items',
    },
    loopNode(INNER_ID, 3, {
      loopType: 'forEach',
      collection: { type: 'workflowContext', nodeId: MAKE_ID, path: [MAKE_ID, 'items'] },
    }),
    {
      id: BODY_ID,
      type: 'general-custom-js',
      config: {
        code: [
          'function customHandler(params) {',
          `  globalThis.${RUNS_KEY} = (globalThis.${RUNS_KEY} || []).concat(params.item);`,
          '  return { ok: true };',
          '}',
        ].join('\n'),
        params: {
          item: { type: 'workflowContext', nodeId: INNER_ID, path: [INNER_ID, 'currentItem'] },
        },
        context: 'server',
      },
      stepNumber: 4,
      label: 'Record The Item',
    },
  ],
  edges: [
    bodyEntry('e1', OUTER_ID, MAKE_ID),
    { id: 'e2', source: MAKE_ID, target: INNER_ID },
    bodyEntry('e3', INNER_ID, BODY_ID),
    loopBack('e4', BODY_ID, INNER_ID),
    loopBack('e5', INNER_ID, OUTER_ID),
  ],
})

const branchInTheInnerBody = (): Graph => ({
  nodes: [
    loopNode(OUTER_ID, 1, { loopType: 'for', endIndex: 2 }),
    loopNode(INNER_ID, 2, { loopType: 'for', endIndex: 4 }),
    {
      id: IF_ID,
      type: 'general-if-statement',
      config: {
        conditionType: 'simple-comparison',
        leftValue: {
          type: 'workflowContext',
          nodeId: INNER_ITER_ID,
          path: [INNER_ITER_ID, 'index'],
        },
        operator: '>=',
        rightValue: 2,
      },
      stepNumber: 3,
      label: 'Index Is High',
    },
    recordingNode(HIGH_ID, 4),
    recordingNode(LOW_ID, 5),
    recordingNode(AFTER_ID, 6),
  ],
  edges: [
    bodyEntry('e1', OUTER_ID, INNER_ID),
    bodyEntry('e2', INNER_ID, IF_ID),
    { id: 'e3', source: IF_ID, target: HIGH_ID, sourceHandle: 'true' },
    { id: 'e4', source: IF_ID, target: LOW_ID, sourceHandle: 'false' },
    loopBack('e5', HIGH_ID, INNER_ID),
    loopBack('e6', LOW_ID, INNER_ID),
    loopBack('e7', INNER_ID, OUTER_ID),
    exitTo('e8', OUTER_ID, AFTER_ID),
  ],
})

const requireRuntime = (extra: Record<string, unknown> = {}) => {
  const runtime = loadServerRuntime()
  return (id: string): unknown => {
    if (id.endsWith('/utils/workflows/server-runtime')) {
      return runtime
    }
    const known = Object.keys(extra).find((suffix) => id.endsWith(suffix))
    if (known) {
      return extra[known]
    }
    throw new Error('Unexpected require: ' + id)
  }
}

const bootRoute = (source: string, requireFn: (id: string) => unknown) => {
  const routeModule: { exports: any } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', source)(routeModule, routeModule.exports, requireFn)
  return routeModule.exports as (req: unknown, res: unknown) => Promise<void>
}

const jsonReply = () => {
  const reply = { status: 0, body: undefined as any }
  const res = {
    status(code: number) {
      reply.status = code
      return this
    },
    json(payload: unknown) {
      reply.body = payload
      return this
    },
    setHeader: (): void => undefined,
  }
  return { reply, res }
}

const runSegmentRoute =
  (generate: (segment: WorkflowSegment) => string) =>
  async (graph: Graph): Promise<Run> => {
    const segment = {
      id: 'seg-nested-loops',
      env: 'server',
      nodeIds: graph.nodes.map((node) => node.id),
      nodes: graph.nodes,
      edges: graph.edges,
    } as unknown as WorkflowSegment
    const handler = bootRoute(generate(segment), requireRuntime())
    const { reply, res } = jsonReply()
    await handler({ method: 'POST', body: { context: {} }, headers: { host: 'site.example' } }, res)
    return { status: reply.status, loopResult: (loopId) => reply.body.results[loopId] }
  }

/**
 * A scheduled route replies with no results, so its last step is a custom node
 * that is handed the result of every loop of the graph.
 */
const runScheduledRoute = async (graph: Graph): Promise<Run> => {
  const loopIds = graph.nodes.filter((node) => node.type === 'general-loop').map((node) => node.id)
  const parameters: Record<string, unknown> = {}
  loopIds.forEach((loopId) => {
    parameters[loopId] = { type: 'workflowContext', nodeId: loopId, path: [loopId] }
  })
  const reportNode = {
    id: REPORT_ID,
    type: 'general-custom-node',
    config: { customNodeId: 'cn-report', parameters },
    stepNumber: graph.nodes.length + 1,
    label: 'Report The Loops',
  }
  const workflow: any = {
    id: 'wf-scheduled-nested-loops',
    name: 'Scheduled Nested Loops',
    trigger: {
      type: 'event-cron-triggered',
      nodeId: 't',
      scope: 'global',
      config: { schedule: '5 * * * *', urlPath: 'cron_nested_loops' },
    },
    nodes: [...graph.nodes, reportNode],
    edges: [
      { id: 'e0', source: 't', target: OUTER_ID },
      ...graph.edges,
      exitTo('e-report', OUTER_ID, REPORT_ID),
    ],
  }
  const customNodes: Record<string, unknown> = {
    'cn-report': { id: 'cn-report', name: 'Report', nodes: [], edges: [] },
  }
  let reported: Record<string, unknown> = {}
  const customNodeModule = {
    'cn-report': async (_context: unknown, handed: Record<string, unknown>) => {
      reported = handed
      return { ok: true }
    },
  }
  const handler = bootRoute(
    generateCronAPIRoute(workflow, customNodes as never),
    requireRuntime({ '/utils/workflows/custom-nodes': customNodeModule })
  )
  const { reply, res } = jsonReply()
  const req = {
    method: 'POST',
    url: '/api/workflows/cron_nested_loops',
    headers: { host: 'site.example', 'x-forwarded-proto': 'https' },
    body: {},
  }
  await withEnv({ TELEPORT_CRON_ALLOW_UNSIGNED: 'true', TELEPORT_CRON_SECRET: undefined }, () =>
    handler(req, res)
  )
  return { status: reply.status, loopResult: (loopId) => reported[loopId] }
}

const clearRecordings = () => {
  delete (globalThis as Record<string, any>)[RUNS_KEY]
  delete (globalThis as Record<string, any>)[MADE_KEY]
}

beforeEach(clearRecordings)
afterAll(clearRecordings)

describe.each<[string, (graph: Graph) => Promise<Run>]>([
  ['a server segment route', runSegmentRoute(generateServerSegmentAPIRoute)],
  ['a streaming server segment route', runSegmentRoute(generateStreamingServerSegmentAPIRoute)],
  ['a scheduled route', runScheduledRoute],
])('%s runs a loop inside a loop', (_route, run) => {
  it('runs every pass of the inner loop on every pass of the outer loop', async () => {
    const result = await run(forLoopInForLoop())

    expect(result.status).toBe(200)
    expect(runs()).toEqual([BODY_ID, BODY_ID, BODY_ID, BODY_ID, BODY_ID, BODY_ID, AFTER_ID])
    expect(result.loopResult(OUTER_ID)).toEqual({ completed: true, iterations: 2, results: [] })
    expect(result.loopResult(INNER_ID)).toEqual({ completed: true, iterations: 3, results: [] })
  })

  it('runs a loop in a loop in a loop', async () => {
    const result = await run(threeLoopsDeep())

    expect(result.status).toBe(200)
    expect(runs()).toEqual([...Array(12).fill(BODY_ID), AFTER_ID])
    expect(result.loopResult(OUTER_ID)).toEqual({ completed: true, iterations: 2, results: [] })
    expect(result.loopResult(MIDDLE_ID)).toEqual({ completed: true, iterations: 2, results: [] })
    expect(result.loopResult(INNER_ID)).toEqual({
      completed: true,
      iterations: 3,
      results: [{ n: 10 }, { n: 11 }, { n: 12 }],
    })
  })

  it('walks the collection the current outer pass made', async () => {
    const result = await run(forEachOverWhatTheOuterPassMade())

    expect(result.status).toBe(200)
    expect(runs()).toEqual(['a', 'b', 'c'])
    expect(result.loopResult(OUTER_ID)).toEqual({ completed: true, iterations: 2, results: [] })
    expect(result.loopResult(INNER_ID)).toEqual({ completed: true, iterations: 2, results: [] })
  })

  it('takes one branch of the inner body per inner pass', async () => {
    const result = await run(branchInTheInnerBody())

    expect(result.status).toBe(200)
    expect(runs()).toEqual([
      LOW_ID,
      LOW_ID,
      HIGH_ID,
      HIGH_ID,
      LOW_ID,
      LOW_ID,
      HIGH_ID,
      HIGH_ID,
      AFTER_ID,
    ])
    expect(result.loopResult(INNER_ID)).toEqual({ completed: true, iterations: 4, results: [] })
  })
})
