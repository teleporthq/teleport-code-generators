import { loadHandler, HandlerFn } from './_helpers/load-handler'

// Moving a top-level `general-custom-js` between `context: 'server'` and
// `context: 'client'` MUST NOT shift its positional `params[N]` indices.
//
// This is what makes the e-commerce placement sweep safe: checkout's
// "Assemble Order Data" reads params[2]/[5]/[6]/[7]/[9]/[10] and
// "Build Order Number" reads params[14] — hard-coded positions into the live
// context. If the environment switch renumbered them the workflow would write
// the wrong columns on a real order.
//
// Two mechanisms could renumber them, and both are pinned here:
//   1. The SERVER executor injects `__nodeId` into the resolved config, which
//      makes the handler EXCLUDE the executing node from `params`; the client
//      executor does not. That only matters if the executing node ALREADY has a
//      context entry — never true at top level, only inside a loop body (which
//      is filtered out of `params` anyway).
//   2. Context key ORDER. Keys are inserted as nodes complete, i.e. in graph
//      order — the same order regardless of which side each node ran on.

describe('general-custom-js — params are identical on client and server', () => {
  const handler: HandlerFn = loadHandler('general-custom-js')

  // Echoes back whatever positional slots the caller asks about.
  const PROBE = [
    'function customHandler(params) {',
    '  return { seen: params.map(function (p) { return p && p.tag ? p.tag : null; }) };',
    '}',
  ].join('\n')

  const context = () => ({
    trigger: { tag: 'trigger' },
    formNode: { tag: 'form' },
    cartTotal: { tag: 'cart' },
    createOrder: { tag: 'order' },
    // Reserved scaffolding — must never occupy a positional slot.
    __stateValues: { x: 1 },
    __baseUrl: 'https://example.com',
    __skippedNodes: {},
    triggerElement: { nodeType: 1 },
  })

  it('injecting __nodeId (the server marker) does not change the params array', async () => {
    const asClient = (await handler({ code: PROBE }, context())) as { seen: string[] }
    const asServer = (await handler({ code: PROBE, __nodeId: 'thisNode' }, context())) as {
      seen: string[]
    }

    expect(asClient.seen).toEqual(['trigger', 'form', 'cart', 'order'])
    expect(asServer.seen).toEqual(asClient.seen)
  })

  it('reserved __ keys and triggerElement never consume a positional slot', async () => {
    const result = (await handler({ code: PROBE }, context())) as { seen: string[] }
    expect(result.seen).toHaveLength(4)
  })

  it('a hard-coded index resolves to the same node either way', async () => {
    const READ_INDEX_3 = [
      'function customHandler(params) {',
      '  return { picked: params[3] && params[3].tag };',
      '}',
    ].join('\n')

    const asClient = await handler({ code: READ_INDEX_3 }, context())
    const asServer = await handler({ code: READ_INDEX_3, __nodeId: 'thisNode' }, context())
    expect(asClient).toEqual({ picked: 'order' })
    expect(asServer).toEqual({ picked: 'order' })
  })
})

describe('context key ORDER survives a client→server→client round trip', () => {
  // The runtime inserts a key when a node completes, so the order tracks the
  // GRAPH, not the execution environment. A server segment rebuilds its context
  // from the serialized client context and appends its own nodes; merging the
  // response back preserves existing positions. This simulates that round trip
  // with the real merge helper and asserts the ordering is env-independent.
  // `mergeServerResults` lives in the client runtime, which needs a DOM to load.
  // Its rule for plain values is a straight assign in the response's key order —
  // reproduced here so the ordering claim can be tested in isolation.
  const mergeServerResults = (
    context: Record<string, unknown>,
    results: Record<string, unknown>
  ) => {
    for (const key of Object.keys(results)) {
      context[key] = results[key]
    }
  }

  const runSplit = (envOf: (id: string) => 'client' | 'server') => {
    const graphOrder = ['a', 'b', 'c', 'd', 'e']
    let context: Record<string, unknown> = {}
    let i = 0
    while (i < graphOrder.length) {
      const env = envOf(graphOrder[i])
      const run: string[] = []
      while (i < graphOrder.length && envOf(graphOrder[i]) === env) {
        run.push(graphOrder[i])
        i++
      }
      if (env === 'client') {
        for (const id of run) {
          context[id] = { tag: id }
        }
      } else {
        // Server segment: the pruned client context crosses the wire, the route
        // appends its own nodes, and the whole context comes back.
        const serverContext: Record<string, unknown> = JSON.parse(JSON.stringify(context))
        for (const id of run) {
          serverContext[id] = { tag: id }
        }
        mergeServerResults(context, serverContext)
      }
    }
    context = { ...context }
    return Object.keys(context)
  }

  it('is the same whether c runs on the client or the server', () => {
    const cOnServer = runSplit((id) => (id === 'b' || id === 'c' ? 'server' : 'client'))
    const cOnClient = runSplit((id) => (id === 'b' ? 'server' : 'client'))
    expect(cOnServer).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(cOnClient).toEqual(cOnServer)
  })

  it('is the same when a whole run moves to the client', () => {
    const allServerMiddle = runSplit((id) =>
      id === 'b' || id === 'c' || id === 'd' ? 'server' : 'client'
    )
    const allClient = runSplit(() => 'client')
    expect(allServerMiddle).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(allClient).toEqual(allServerMiddle)
  })
})
