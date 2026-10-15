import { generateSharedRuntimeUtilsCode } from '../src'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'

// A custom node answers its caller the output of the last node it ran. The
// email senders of teleport-gui are one branch per purpose — "is it this
// email?" → send → "was it accepted?" → a report — in one server segment, and
// their callers read the report: `{ sent, skipped }`. Whatever a segment
// answers for a branch it did not take (a route built before it stopped
// evaluating the if-statements there) must never stand in for that report.

const ifNode = (id: string, stepNumber: number) => ({
  id,
  type: 'general-if-statement',
  label: id,
  config: { conditionType: 'simple-comparison', leftValue: 1, operator: '===', rightValue: 1 },
  executionEnv: 'server',
  stepNumber,
})

const reportNode = (id: string, stepNumber: number) => ({
  id,
  type: 'general-custom-js',
  label: id,
  config: { code: 'function customHandler(p, q) { return {} }', context: 'server' },
  executionEnv: 'server',
  stepNumber,
})

const customNodes = {
  'cn-sender': {
    id: 'cn-sender',
    name: 'Sender',
    parameters: [],
    nodes: [
      ifNode('isA', 1),
      reportNode('reportA', 2),
      ifNode('isB', 2),
      ifNode('acceptedB', 3),
      reportNode('reportB', 4),
    ],
    edges: [
      { id: 'e1', source: 'isA', target: 'reportA', sourceHandle: 'true' },
      { id: 'e2', source: 'isA', target: 'isB', sourceHandle: 'false' },
      { id: 'e3', source: 'isB', target: 'acceptedB', sourceHandle: 'true' },
      { id: 'e4', source: 'acceptedB', target: 'reportB', sourceHandle: 'true' },
    ],
  },
}

function bootSender(segmentAnswer: Record<string, unknown>) {
  const plugin = new NextWorkflowProjectPlugin() as unknown as {
    generateCustomNodesFile: (
      nodes: Record<string, unknown>,
      urls: Record<string, Record<string, string>>
    ) => string
  }
  const source = plugin.generateCustomNodesFile(customNodes, {
    'cn-sender': { 'server-1': '/api/workflows/sender-seg-1' },
  })
  const utilsModule: { exports: Record<string, unknown> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', generateSharedRuntimeUtilsCode())(
    utilsModule,
    utilsModule.exports
  )
  const runtimeStub = {
    findStreamingAINodes: () => ({}),
    callStreamingServerSegment: async () => ({}),
    callServerSegment: async () => segmentAnswer,
    mergeServerResults: (context: Record<string, unknown>, results: Record<string, unknown>) => {
      Object.assign(context, results)
    },
  }
  const requireStub = (id: string) =>
    id === './runtime-utils' ? utilsModule.exports : id === './runtime' ? runtimeStub : {}
  const moduleStub: { exports: Record<string, unknown> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', source)(moduleStub, moduleStub.exports, requireStub)
  return (moduleStub.exports as Record<string, (...args: unknown[]) => Promise<unknown>>)[
    'cn-sender'
  ]
}

describe('a custom node answers the terminal of the branch it took', () => {
  it('never the result of a node on a branch the segment skipped', async () => {
    const run = bootSender({
      isA: { result: true },
      reportA: { sent: 'true', skipped: '' },
      // What an older route answered for the branch it did not take.
      isB: { result: false },
      acceptedB: { result: false },
      __skippedNodes: { isB: true, acceptedB: true, reportB: true },
    })
    expect(await run({}, {}, {})).toEqual({ sent: 'true', skipped: '' })
  })

  it('still answers the last node when nothing was skipped', async () => {
    const run = bootSender({
      isA: { result: false },
      isB: { result: true },
      acceptedB: { result: true },
      reportB: { sent: 'false', skipped: 'send-failed' },
      __skippedNodes: { reportA: true },
    })
    expect(await run({}, {}, {})).toEqual({ sent: 'false', skipped: 'send-failed' })
  })
})
