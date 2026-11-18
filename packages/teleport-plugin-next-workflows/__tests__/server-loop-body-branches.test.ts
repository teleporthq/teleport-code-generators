import {
  generateCronAPIRoute,
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
} from '../src/api-route-generator'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'
import { withEnv } from './_helpers/fake-fetch'

/**
 * An if-statement inside a loop body takes one branch per pass. The server
 * routes ran the body as a flat list, so both branches ran on every pass.
 * Each route kind runs a four-pass loop whose body branches on the pass index.
 */

const LOOP_ID = 'loop-1'
const IF_ID = 'if-1'
const HIGH_ID = 'high-1'
const LOW_ID = 'low-1'
const AFTER_ID = 'after-1'
const ITER_ID = LOOP_ID + '_iter'
const RUNS_KEY = '__serverLoopBranchRuns'

const runs = (): string[] => (globalThis as Record<string, any>)[RUNS_KEY] || []

const recordingNode = (id: string, stepNumber: number) => ({
  id,
  type: 'general-custom-js',
  config: {
    code: [
      'function customHandler() {',
      `  globalThis.${RUNS_KEY} = (globalThis.${RUNS_KEY} || []).concat('${id}');`,
      '  return { ok: true };',
      '}',
    ].join('\n'),
    context: 'server',
  },
  stepNumber,
  label: id,
})

const nodes = [
  {
    id: LOOP_ID,
    type: 'general-loop',
    config: { loopType: 'for', endIndex: 4 },
    stepNumber: 1,
    label: 'Loop',
  },
  {
    id: IF_ID,
    type: 'general-if-statement',
    config: {
      conditionType: 'simple-comparison',
      leftValue: { type: 'workflowContext', nodeId: ITER_ID, path: [ITER_ID, 'index'] },
      operator: '>=',
      rightValue: 2,
    },
    stepNumber: 2,
    label: 'Index Is High',
  },
  recordingNode(HIGH_ID, 3),
  recordingNode(LOW_ID, 4),
  recordingNode(AFTER_ID, 5),
]

const edges = [
  { id: 'e1', source: LOOP_ID, target: IF_ID, sourceHandle: 'loop', targetHandle: 'loop-body-in' },
  { id: 'e2', source: IF_ID, target: HIGH_ID, sourceHandle: 'true' },
  { id: 'e3', source: IF_ID, target: LOW_ID, sourceHandle: 'false' },
  {
    id: 'e4',
    source: HIGH_ID,
    target: LOOP_ID,
    sourceHandle: 'loop-body-out',
    targetHandle: 'loop-back',
  },
  {
    id: 'e5',
    source: LOW_ID,
    target: LOOP_ID,
    sourceHandle: 'loop-body-out',
    targetHandle: 'loop-back',
  },
  { id: 'e6', source: LOOP_ID, target: AFTER_ID, sourceHandle: 'exit' },
]

const ONE_BRANCH_PER_PASS = [LOW_ID, LOW_ID, HIGH_ID, HIGH_ID, AFTER_ID]

const requireRuntime = () => {
  const runtime = loadServerRuntime()
  return (id: string): unknown => {
    if (id.endsWith('/utils/workflows/server-runtime')) {
      return runtime
    }
    throw new Error('Unexpected require: ' + id)
  }
}

const bootRoute = (source: string) => {
  const routeModule: { exports: any } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', source)(
    routeModule,
    routeModule.exports,
    requireRuntime()
  )
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

const segment = {
  id: 'seg-loop-branches',
  env: 'server',
  nodeIds: nodes.map((node) => node.id),
  nodes,
  edges,
} as unknown as WorkflowSegment

beforeEach(() => {
  delete (globalThis as Record<string, any>)[RUNS_KEY]
})

afterAll(() => {
  delete (globalThis as Record<string, any>)[RUNS_KEY]
})

describe.each<[string, () => string]>([
  ['a server segment route', () => generateServerSegmentAPIRoute(segment)],
  ['a streaming server segment route', () => generateStreamingServerSegmentAPIRoute(segment)],
])('%s runs one branch of a loop body per pass', (_route, generate) => {
  it('skips the branch the if-statement did not take, on that pass only', async () => {
    const handler = bootRoute(generate())
    const { reply, res } = jsonReply()

    await handler({ method: 'POST', body: { context: {} }, headers: { host: 'site.example' } }, res)

    expect(reply.status).toBe(200)
    expect(runs()).toEqual(ONE_BRANCH_PER_PASS)
  })
})

describe('a scheduled route runs one branch of a loop body per pass', () => {
  it('skips the branch the if-statement did not take, on that pass only', async () => {
    const workflow: any = {
      id: 'wf-scheduled-loop-branches',
      name: 'Scheduled Loop Branches',
      trigger: {
        type: 'event-cron-triggered',
        nodeId: 't',
        scope: 'global',
        config: { schedule: '5 * * * *', urlPath: 'cron_loop_branches' },
      },
      nodes,
      edges: [{ id: 'e0', source: 't', target: LOOP_ID }, ...edges],
    }
    const handler = bootRoute(generateCronAPIRoute(workflow, undefined as never))
    const { reply, res } = jsonReply()
    const req = {
      method: 'POST',
      url: '/api/workflows/cron_loop_branches',
      headers: { host: 'site.example', 'x-forwarded-proto': 'https' },
      body: {},
    }

    await withEnv({ TELEPORT_CRON_ALLOW_UNSIGNED: 'true', TELEPORT_CRON_SECRET: undefined }, () =>
      handler(req, res)
    )

    expect(reply.status).toBe(200)
    expect(runs()).toEqual(ONE_BRANCH_PER_PASS)
  })
})
