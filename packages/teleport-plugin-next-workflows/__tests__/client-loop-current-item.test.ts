import { generateSharedRuntimeUtilsCode } from '../src'
import { loadHandler } from './_helpers/load-handler'

// The workflow editor's context schema for "general-loop" offers a body node
// `currentItem`, `index`, `isFirst` and `isLast` off the loop's own id, and a
// server segment publishes exactly that while a body node runs. The CLIENT
// executor published the iteration only under "<loopId>_iter", so the same
// binding resolved to undefined in the browser. A loop whose body is a
// custom-node call is exactly the kind the splitter keeps on the client: the
// buyer's subscription refresh looped over ids and called its node with none.
// These run the shared `executeNodes` with such a loop.

type SharedUtils = {
  executeNodes: (
    nodes: unknown[],
    edges: unknown[],
    context: Record<string, unknown>,
    handlers: Record<string, unknown>,
    workflowConfig: Record<string, unknown>,
    callServerSegment: null,
    executionId: string
  ) => Promise<void>
}

function loadSharedRuntime(): SharedUtils {
  const utilsModule: { exports: Record<string, unknown> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', generateSharedRuntimeUtilsCode())(
    utilsModule,
    utilsModule.exports
  )
  return utilsModule.exports as unknown as SharedUtils
}

const ref = (nodeId: string, path: string[]) => ({
  type: 'workflowContext',
  nodeId,
  path: [nodeId, ...path],
})

const bodyCode = [
  'function customHandler(params) {',
  '  var named = params[params.length - 1] || {};',
  '  return { id: named.id, index: named.index, first: named.first, last: named.last };',
  '}',
].join('\n')

const buildGraph = (loopConfig: Record<string, unknown>) => ({
  nodes: [
    {
      id: 'seed',
      type: 'general-custom-js',
      stepNumber: 1,
      config: { code: 'function customHandler() { return { ids: ["a", "b", "c"] } }' },
    },
    {
      id: 'loop',
      type: 'general-loop',
      stepNumber: 2,
      config: { loopType: 'map', collection: ref('seed', ['ids']), ...loopConfig },
    },
    {
      id: 'body',
      type: 'general-custom-js',
      stepNumber: 3,
      config: {
        code: bodyCode,
        params: {
          id: ref('loop', ['currentItem']),
          index: ref('loop', ['index']),
          first: ref('loop', ['isFirst']),
          last: ref('loop', ['isLast']),
        },
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'seed', target: 'loop' },
    {
      id: 'e2',
      source: 'loop',
      target: 'body',
      sourceHandle: 'loop',
      targetHandle: 'loop-body-in',
    },
    {
      id: 'e3',
      source: 'body',
      target: 'loop',
      sourceHandle: 'loop-body-out',
      targetHandle: 'loop-back',
    },
  ],
})

const expectedRows = [
  { id: 'a', index: 0, first: true, last: false },
  { id: 'b', index: 1, first: false, last: false },
  { id: 'c', index: 2, first: false, last: true },
]

describe('client loop — a body node bound to the loop id sees the iteration', () => {
  const utils = loadSharedRuntime()
  const handlers = { 'general-custom-js': loadHandler('general-custom-js') }

  const run = async (loopConfig: Record<string, unknown>) => {
    const graph = buildGraph(loopConfig)
    const context: Record<string, unknown> = { __pendingNodePromises: [] }
    await utils.executeNodes(
      graph.nodes,
      graph.edges,
      context,
      handlers,
      { nodes: graph.nodes, edges: graph.edges },
      null,
      'run'
    )
    return context
  }

  it('resolves currentItem / index / isFirst / isLast for every iteration', async () => {
    const context = await run({})
    expect((context.loop as { results: unknown[] }).results).toEqual(expectedRows)
  })

  it('does the same when the iterations run in parallel', async () => {
    const context = await run({ parallel: true, concurrency: 2 })
    expect((context.loop as { results: unknown[] }).results).toEqual(expectedRows)
  })

  it('iterates a bound array of objects — the resolved collection is never re-resolved into text', async () => {
    // The loop's config arrives resolved; resolving an array a second time
    // treats it as the parts of one string and joins it, which is how every
    // client-side loop used to run zero times.
    const graph = buildGraph({})
    graph.nodes[0].config.code =
      'function customHandler() { return { ids: [{ id: "x" }, { id: "y" }] } }'
    graph.nodes[2].config.params = {
      id: ref('loop', ['currentItem', 'id']),
      index: ref('loop', ['index']),
      first: ref('loop', ['isFirst']),
      last: ref('loop', ['isLast']),
    }
    const context: Record<string, unknown> = { __pendingNodePromises: [] }
    await utils.executeNodes(
      graph.nodes,
      graph.edges,
      context,
      handlers,
      { nodes: graph.nodes, edges: graph.edges },
      null,
      'run'
    )
    expect((context.loop as { results: unknown[] }).results).toEqual([
      { id: 'x', index: 0, first: true, last: false },
      { id: 'y', index: 1, first: false, last: true },
    ])
  })

  it('leaves the loop summary, not an iteration, under the loop id once it is done', async () => {
    const context = await run({})
    expect(context.loop).toEqual({ results: expectedRows, iterations: 3 })
  })
})
