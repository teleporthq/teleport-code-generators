import {
  generateCronAPIRoute,
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
} from '../src/api-route-generator'
import { generateSharedRuntimeUtilsCode } from '../src/executor-generator'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'
import { withEnv } from './_helpers/fake-fetch'

/**
 * A loop steps by its loopType wherever it runs. The server routes walked
 * `collection` for every type, so a for, while or until loop whose body ran on
 * the server made no pass at all. Each route kind is booted here and run with
 * every loop type, next to the client executor running the same loops.
 */

const LOOP_ID = 'loop-1'
const BODY_ID = 'body-1'
const ITER_ID = LOOP_ID + '_iter'
const PASSES_KEY = '__serverLoopTypePasses'

const passes = (): number => (globalThis as Record<string, any>)[PASSES_KEY] || 0

const COUNT_PASSES_CODE = [
  'function customHandler() {',
  `  globalThis.${PASSES_KEY} = (globalThis.${PASSES_KEY} || 0) + 1;`,
  `  return { n: globalThis.${PASSES_KEY} };`,
  '}',
].join('\n')

const loopEdges = [
  {
    id: 'e1',
    source: LOOP_ID,
    target: BODY_ID,
    sourceHandle: 'loop',
    targetHandle: 'loop-body-in',
  },
  {
    id: 'e2',
    source: BODY_ID,
    target: LOOP_ID,
    sourceHandle: 'loop-body-out',
    targetHandle: 'loop-back',
  },
]

const loopNode = (config: Record<string, unknown>) => ({
  id: LOOP_ID,
  type: 'general-loop',
  config,
  stepNumber: 1,
  label: 'Loop',
})

const countingBody = () => ({
  id: BODY_ID,
  type: 'general-custom-js',
  config: { code: COUNT_PASSES_CODE, context: 'server' },
  stepNumber: 2,
  label: 'Count The Pass',
})

const BODY_RAN_FEWER_THAN_THREE_TIMES = `!context['${BODY_ID}'] || context['${BODY_ID}'].n < 3`
const BODY_RAN_THREE_TIMES = `!!context['${BODY_ID}'] && context['${BODY_ID}'].n >= 3`

interface LoopCase {
  name: string
  config: Record<string, unknown>
  expectedPasses: number
}

const NON_COLLECTION_LOOPS: LoopCase[] = [
  {
    name: 'a for loop up to endIndex',
    config: { loopType: 'for', endIndex: 4 },
    expectedPasses: 4,
  },
  {
    name: 'a for loop from startIndex by step',
    config: { loopType: 'for', startIndex: 2, endIndex: 9, step: 3 },
    expectedPasses: 3,
  },
  {
    name: 'a for loop counting down',
    config: { loopType: 'for', startIndex: 3, endIndex: 0, step: -1 },
    expectedPasses: 3,
  },
  {
    name: 'a for loop whose bounds arrive as text',
    config: { loopType: 'for', startIndex: '0', endIndex: '3' },
    expectedPasses: 3,
  },
  {
    name: 'a while loop, its condition read again before every pass',
    config: { loopType: 'while', condition: BODY_RAN_FEWER_THAN_THREE_TIMES },
    expectedPasses: 3,
  },
  {
    name: 'an until loop, its condition read again before every pass',
    config: { loopType: 'until', condition: BODY_RAN_THREE_TIMES },
    expectedPasses: 3,
  },
  {
    name: 'a while loop that never ends, stopped at maxIterations',
    config: { loopType: 'while', condition: 'true', maxIterations: 7 },
    expectedPasses: 7,
  },
  {
    name: 'an until loop that never ends, stopped at the default cap',
    config: { loopType: 'until', condition: 'false' },
    expectedPasses: 1000,
  },
]

const NON_COLLECTION_LOOP_ROWS = NON_COLLECTION_LOOPS.map(
  (loop): [string, Record<string, unknown>, number] => [loop.name, loop.config, loop.expectedPasses]
)

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

const segmentOf = (config: Record<string, unknown>): WorkflowSegment =>
  ({
    id: 'seg-loop',
    env: 'server',
    nodeIds: [LOOP_ID, BODY_ID],
    nodes: [loopNode(config), countingBody()],
    edges: loopEdges,
  } as unknown as WorkflowSegment)

type SegmentRouteGenerator = (segment: WorkflowSegment) => string

const runSegmentRoute = async (
  generate: SegmentRouteGenerator,
  config: Record<string, unknown>
) => {
  const handler = bootRoute(generate(segmentOf(config)), requireRuntime())
  const { reply, res } = jsonReply()
  await handler({ method: 'POST', body: { context: {} }, headers: { host: 'site.example' } }, res)
  return reply
}

const scheduledWorkflow = (
  config: Record<string, unknown>,
  body: Record<string, unknown>
): any => ({
  id: 'wf-scheduled-loop',
  name: 'Scheduled Loop',
  trigger: {
    type: 'event-cron-triggered',
    nodeId: 't',
    scope: 'global',
    config: { schedule: '5 * * * *', urlPath: 'cron_loop' },
  },
  nodes: [loopNode(config), body],
  edges: [{ id: 'e0', source: 't', target: LOOP_ID }, ...loopEdges],
})

const runScheduledRoute = async (
  workflow: any,
  customNodes?: Record<string, unknown>,
  customNodeModule: Record<string, unknown> = {}
) => {
  const handler = bootRoute(
    generateCronAPIRoute(workflow, customNodes as never),
    requireRuntime({ '/utils/workflows/custom-nodes': customNodeModule })
  )
  const { reply, res } = jsonReply()
  const req = {
    method: 'POST',
    url: '/api/workflows/cron_loop',
    headers: { host: 'site.example', 'x-forwarded-proto': 'https' },
    body: {},
  }
  await withEnv({ TELEPORT_CRON_ALLOW_UNSIGNED: 'true', TELEPORT_CRON_SECRET: undefined }, () =>
    handler(req, res)
  )
  return reply
}

const runOnClient = async (config: Record<string, unknown>) => {
  const shared: { exports: Record<string, any> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', generateSharedRuntimeUtilsCode())(shared, shared.exports)
  const context: Record<string, any> = {}
  let ran = 0
  const handlers = {
    'general-custom-js': async () => {
      ran++
      return { n: ran }
    },
  }
  await shared.exports.executeNodes(
    [loopNode(config), countingBody()],
    loopEdges,
    context,
    handlers,
    {},
    null,
    'exec-1'
  )
  return { ran, context }
}

beforeEach(() => {
  delete (globalThis as Record<string, any>)[PASSES_KEY]
})

afterAll(() => {
  delete (globalThis as Record<string, any>)[PASSES_KEY]
})

describe.each<[string, SegmentRouteGenerator]>([
  ['a server segment route', (segment) => generateServerSegmentAPIRoute(segment)],
  [
    'a streaming server segment route',
    (segment) => generateStreamingServerSegmentAPIRoute(segment),
  ],
])('%s steps a loop by its type', (_route, generate) => {
  it.each(NON_COLLECTION_LOOP_ROWS)('runs %s', async (_name, config, expectedPasses) => {
    const reply = await runSegmentRoute(generate, config)

    expect(reply.status).toBe(200)
    expect(passes()).toBe(expectedPasses)
    expect(reply.body.results[LOOP_ID]).toEqual({
      completed: true,
      iterations: expectedPasses,
      results: [],
    })
  })

  it('still walks the collection of a forEach and a map loop', async () => {
    const forEach = await runSegmentRoute(generate, { loopType: 'forEach', collection: ['a', 'b'] })
    expect(passes()).toBe(2)
    expect(forEach.body.results[LOOP_ID]).toEqual({ completed: true, iterations: 2, results: [] })

    const map = await runSegmentRoute(generate, { loopType: 'map', collection: ['a', 'b', 'c'] })
    expect(passes()).toBe(5)
    expect(map.body.results[LOOP_ID]).toEqual({
      completed: true,
      iterations: 3,
      results: [{ n: 3 }, { n: 4 }, { n: 5 }],
    })
  })
})

describe('a scheduled route steps a loop by its type', () => {
  it.each(NON_COLLECTION_LOOP_ROWS)('runs %s', async (_name, config, expectedPasses) => {
    const reply = await runScheduledRoute(scheduledWorkflow(config, countingBody()))

    expect(reply.status).toBe(200)
    expect(passes()).toBe(expectedPasses)
  })

  const customNodeBody = (parameters: Record<string, unknown>) => ({
    id: BODY_ID,
    type: 'general-custom-node',
    config: { customNodeId: 'cn-record', parameters },
    stepNumber: 2,
    label: 'Record The Pass',
  })
  const customNodes: Record<string, unknown> = {
    'cn-record': { id: 'cn-record', name: 'Record', nodes: [], edges: [] },
  }
  const iterationRef = (field: string) => ({
    type: 'workflowContext',
    nodeId: ITER_ID,
    path: [ITER_ID, field],
  })
  const recordingModule = () => {
    const seen: unknown[] = []
    const module = {
      'cn-record': async (_context: unknown, parameters: unknown) => {
        seen.push(parameters)
        return { n: seen.length }
      },
    }
    return { seen, module }
  }

  it('hands a for loop body the index of its pass', async () => {
    const { seen, module } = recordingModule()
    const workflow = scheduledWorkflow(
      { loopType: 'for', startIndex: 1, endIndex: 7, step: 2 },
      customNodeBody({ index: iterationRef('index') })
    )

    const reply = await runScheduledRoute(workflow, customNodes, module)

    expect(reply.status).toBe(200)
    expect(seen).toEqual([{ index: 1 }, { index: 3 }, { index: 5 }])
  })

  it('hands a while loop body the number of its pass, and its condition too', async () => {
    const { seen, module } = recordingModule()
    const workflow = scheduledWorkflow(
      { loopType: 'while', condition: `context['${ITER_ID}'].iteration < 2` },
      customNodeBody({ iteration: iterationRef('iteration') })
    )

    const reply = await runScheduledRoute(workflow, customNodes, module)

    expect(reply.status).toBe(200)
    expect(seen).toEqual([{ iteration: 0 }, { iteration: 1 }])
  })

  it('still hands a forEach loop body the item of its pass', async () => {
    const { seen, module } = recordingModule()
    const workflow = scheduledWorkflow(
      { loopType: 'forEach', collection: [{ id: 'a' }, { id: 'b' }] },
      customNodeBody({
        id: { type: 'workflowContext', nodeId: LOOP_ID, path: [LOOP_ID, 'currentItem', 'id'] },
        index: { type: 'workflowContext', nodeId: LOOP_ID, path: [LOOP_ID, 'index'] },
        isLast: { type: 'workflowContext', nodeId: LOOP_ID, path: [LOOP_ID, 'isLast'] },
      })
    )

    const reply = await runScheduledRoute(workflow, customNodes, module)

    expect(reply.status).toBe(200)
    expect(seen).toEqual([
      { id: 'a', index: 0, isLast: false },
      { id: 'b', index: 1, isLast: true },
    ])
  })
})

describe('the client executor and the server routes make the same passes', () => {
  it.each(NON_COLLECTION_LOOP_ROWS)('for %s', async (_name, config, expectedPasses) => {
    const client = await runOnClient(config)

    expect(client.ran).toBe(expectedPasses)
    expect(client.context[LOOP_ID]).toEqual({ completed: true, iterations: expectedPasses })
  })
})
