import { generateStreamingServerSegmentAPIRoute } from '../src/api-route-generator'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'

/**
 * A streaming segment route evaluated an if-statement and then ran both of its
 * branches: it never recorded the branch not taken, and never read the record
 * a switch made of its unmatched cases.
 */

const RUNS_KEY = '__streamingIfBranchRuns'

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

const segmentWhere = (leftValue: number): WorkflowSegment =>
  ({
    id: 'seg-if',
    env: 'server',
    nodeIds: ['if-1', 'yes-1', 'no-1'],
    nodes: [
      {
        id: 'if-1',
        type: 'general-if-statement',
        config: { conditionType: 'simple-comparison', leftValue, operator: '===', rightValue: 1 },
        stepNumber: 1,
        label: 'Is One',
      },
      recordingNode('yes-1', 2),
      recordingNode('no-1', 3),
    ],
    edges: [
      { id: 'e1', source: 'if-1', target: 'yes-1', sourceHandle: 'true' },
      { id: 'e2', source: 'if-1', target: 'no-1', sourceHandle: 'false' },
    ],
  } as unknown as WorkflowSegment)

const run = async (segment: WorkflowSegment) => {
  const runtime = loadServerRuntime()
  const routeModule: { exports: any } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', generateStreamingServerSegmentAPIRoute(segment))(
    routeModule,
    routeModule.exports,
    (id: string): unknown => {
      if (id.endsWith('/utils/workflows/server-runtime')) {
        return runtime
      }
      throw new Error('Unexpected require: ' + id)
    }
  )
  const reply = { status: 0 }
  const res = {
    status(code: number) {
      reply.status = code
      return this
    },
    json() {
      return this
    },
    setHeader: (): void => undefined,
  }
  await routeModule.exports(
    { method: 'POST', body: { context: {} }, headers: { host: 'site.example' } },
    res
  )
  return reply
}

beforeEach(() => {
  delete (globalThis as Record<string, any>)[RUNS_KEY]
})

afterAll(() => {
  delete (globalThis as Record<string, any>)[RUNS_KEY]
})

describe('a streaming server segment route runs one branch of an if-statement', () => {
  it('runs only the true branch when the condition holds', async () => {
    const reply = await run(segmentWhere(1))

    expect(reply.status).toBe(200)
    expect(runs()).toEqual(['yes-1'])
  })

  it('runs only the false branch when it does not', async () => {
    const reply = await run(segmentWhere(2))

    expect(reply.status).toBe(200)
    expect(runs()).toEqual(['no-1'])
  })
})
