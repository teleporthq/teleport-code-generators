import { generateServerSegmentAPIRoute, generateSharedRuntimeUtilsCode } from '../src'
import type { WorkflowSegment } from '../src/types'
import { loadHandler, HandlerFn } from './_helpers/load-handler'

// Regression guard for the "loop body custom-js sees the wrong innerParams"
// bug.
//
// User report: a workflow fetched a list of countries, sliced the first 5,
// looped over them, ran an AI prompt per country, and used a general-custom-js
// node to project { name, description } from the two preceding loop-body
// nodes. The custom-js code was the canonical signature documented in the
// workflow editor:
//
//   function customHandler(params, innerParams) {
//     const name = innerParams[0]?.result ?? "Unknown"
//     const description = innerParams[1]?.response ?? ""
//     return { name, description }
//   }
//
// At runtime every iteration produced { name: "Unknown", description: "" }
// even though the upstream nodes returned correct values. Root cause: the
// runtime ignored loop scope when constructing arguments for general-custom-js
// and instead dumped every context entry into a single positional `params`
// array. With two declared args the legacy fnMatch branch then called the
// user function with `(previousContext, params)` — so user-`params` was
// actually `previousContext` and user-`innerParams` was actually the entire
// flat context, off by every node that ran before the loop.
//
// The fix tracks active loop scopes on `context.__loopScopeStack` and rebuilds
// params + innerParamsN in the handler. This file pins all the documented
// shapes from teleport-gui/.../custom-js.tsx and CLAUDE.md so a future change
// can't silently regress them again.

type RegularFn = HandlerFn

// The eval-scope trick (declaring __awaiter/__generator as ambient and
// piping them through `new Function`) lives in `_helpers/load-handler.ts`
// so additional shape-regression tests can reuse it without re-deriving the
// dance.
function loadCustomJsHandler(): RegularFn {
  return loadHandler('general-custom-js')
}

describe('general-custom-js — top-level (no loop, no custom node)', () => {
  const handler = loadCustomJsHandler()

  it('passes preceding workflow nodes as a flat positional params array', async () => {
    // Plain top-level `function customHandler(params)` — the workflow editor
    // tells the user this is "all data from previous nodes by position".
    const code = `function customHandler(params) {
      return { firstName: params[0]?.name, secondAge: params[1]?.age }
    }`
    const context: Record<string, unknown> = {
      'fetch-user': { name: 'alice', age: 30 },
      'fetch-meta': { name: 'meta', age: 99 },
    }
    const out = (await handler({ code, __nodeId: 'projector' }, context)) as Record<string, unknown>
    expect(out).toEqual({ firstName: 'alice', secondAge: 99 })
  })

  it('omits the current node from its own params (no self-reference)', async () => {
    const code = `function customHandler(params) {
      return { len: params.length, first: params[0] }
    }`
    const context: Record<string, unknown> = {
      a: 1,
      b: 2,
      projector: { stale: true },
    }
    const out = (await handler({ code, __nodeId: 'projector' }, context)) as any
    // params should be [1, 2] — not include the (stale) self entry.
    expect(out).toEqual({ len: 2, first: 1 })
  })

  it('skips internal scaffolding keys (__baseUrl, __skippedNodes, etc.)', async () => {
    const code = `function customHandler(params) {
      return { count: params.length, items: params }
    }`
    const context: Record<string, unknown> = {
      __baseUrl: 'http://example.com',
      __skippedNodes: { x: true },
      __previousNodeResult: { sentinel: true },
      a: 1,
      b: 2,
    }
    const out = (await handler({ code, __nodeId: 'p' }, context)) as any
    expect(out.count).toBe(2)
    expect(out.items).toEqual([1, 2])
  })
})

// Regression guard for the 2026-06-19 Sugarpost homepage "Something went wrong"
// page-load crash. The AI generator + workflow editor advertise the preferred
// top-level signature `customHandler(params, inputs, workflowContext)` (see
// teleport-services-worker custom-js-contract.ts) and the prompt teaches the AI
// to read `workflowContext[N]` for prior node results by node index. The
// runtime previously only populated `previousContext` / `params` / `innerParams*`,
// so a handler that followed the advertised contract and read
// `workflowContext[1]` got `undefined[1]` → TypeError → the page-load workflow
// threw → the injected error-handler toast fired on the published homepage.
// The runtime now aliases `inputs` and `workflowContext` to the same array as
// `params` at top level, so the documented contract works.
describe('general-custom-js — documented (params, inputs, workflowContext) contract', () => {
  const handler = loadCustomJsHandler()

  it('populates workflowContext[N] with prior node results by node index', async () => {
    // The exact shape of the crashing "Initialize Personalized Greeting" node:
    // a page-load trigger followed by a data node, then this custom-js reads
    // workflowContext[1] (the node after the trigger).
    const code = `function customHandler(params, inputs, workflowContext) {
      const user = workflowContext[1]
      const firstName = user && user.firstName
      return { displayName: firstName && firstName.trim().length > 0 ? firstName : 'Friend' }
    }`
    const context: Record<string, unknown> = {
      'trigger-load': { url: 'https://shop.example/' },
      'get-user': { firstName: 'Ada' },
    }
    const out = (await handler({ code, __nodeId: 'compute-greeting' }, context)) as any
    expect(out).toEqual({ displayName: 'Ada' })
  })

  it('aliases workflowContext, inputs and params to the same prior-results array', async () => {
    const code = `function customHandler(params, inputs, workflowContext) {
      return {
        viaParams: params[1],
        viaInputs: inputs[1],
        viaContext: workflowContext[1],
        triggerAtZero: workflowContext[0],
      }
    }`
    const context: Record<string, unknown> = {
      'trigger-load': { kind: 'page-loaded' },
      'first-node': { value: 42 },
    }
    const out = (await handler({ code, __nodeId: 'me' }, context)) as any
    expect(out.viaParams).toEqual({ value: 42 })
    expect(out.viaInputs).toEqual({ value: 42 })
    expect(out.viaContext).toEqual({ value: 42 })
    expect(out.triggerAtZero).toEqual({ kind: 'page-loaded' })
  })

  it('does not break the legacy bare (params) signature', async () => {
    const code = `function customHandler(params) {
      return { first: params[0], len: params.length }
    }`
    const context: Record<string, unknown> = { a: { v: 1 }, b: { v: 2 } }
    const out = (await handler({ code, __nodeId: 'me' }, context)) as any
    expect(out).toEqual({ first: { v: 1 }, len: 2 })
  })
})

describe('general-custom-js — inside a single loop body', () => {
  const handler = loadCustomJsHandler()

  it('reproduces the country-workflow scenario: innerParams indexes loop-body predecessors', async () => {
    // This is the exact scenario from the bug report. The body has two
    // preceding nodes (extract-country-name, ai-funny-description); the
    // custom-js is the third and last body node and projects a result.
    const code = `function customHandler(params, innerParams) {
      const name = innerParams[0]?.result ?? "Unknown"
      const description = innerParams[1]?.response ?? ""
      return { name: name, description: description }
    }`
    const context: Record<string, unknown> = {
      // Pre-loop nodes — these belong to params, NOT innerParams.
      'fetch-countries': { status: 200, body: [], headers: {} },
      'slice-five-countries': { result: [], operation: 'slice', originalLength: 250 },
      // Loop scaffold — never appears in either array.
      'loop-countries': {
        currentItem: { name: { common: 'Bahrain' } },
        currentIndex: 0,
        iterations: 1,
      },
      // Loop-body predecessors — these belong to innerParams in step order.
      'extract-country-name': { result: 'Bahrain' },
      'ai-funny-description': {
        response: 'Welcome to Bahrain, the tiny island nation...',
        model: 'gpt-4o-mini',
        usage: { promptTokens: 41, completionTokens: 64, totalTokens: 105 },
      },
      __loopScopeStack: [
        {
          loopNodeId: 'loop-countries',
          bodyNodeIds: {
            'extract-country-name': true,
            'ai-funny-description': true,
            'build-country-result': true,
          },
        },
      ],
    }
    const out = (await handler({ code, __nodeId: 'build-country-result' }, context)) as any
    expect(out.name).toBe('Bahrain')
    expect(out.description).toBe('Welcome to Bahrain, the tiny island nation...')
  })

  it('keeps params scoped to nodes outside every active loop', async () => {
    const code = `function customHandler(params, innerParams) {
      return {
        paramKeysReachable: params.map(p => Object.keys(p)[0]),
        innerKeysReachable: innerParams.map(p => Object.keys(p)[0]),
      }
    }`
    const context: Record<string, unknown> = {
      'preloop-a': { aMarker: true },
      'preloop-b': { bMarker: true },
      theLoop: { currentItem: 'x', currentIndex: 0, iterations: 1 },
      'inLoop-1': { firstBody: true },
      'inLoop-2': { secondBody: true },
      __loopScopeStack: [
        {
          loopNodeId: 'theLoop',
          bodyNodeIds: { 'inLoop-1': true, 'inLoop-2': true, me: true },
        },
      ],
    }
    const out = (await handler({ code, __nodeId: 'me' }, context)) as any
    // params: outside the loop only, in insertion order.
    expect(out.paramKeysReachable).toEqual(['aMarker', 'bMarker'])
    // innerParams: inside the loop only, excluding self.
    expect(out.innerKeysReachable).toEqual(['firstBody', 'secondBody'])
  })

  it('excludes self from innerParams when a body node references its own scope', async () => {
    const code = `function customHandler(params, innerParams) {
      return innerParams.map(p => p)
    }`
    const context: Record<string, unknown> = {
      theLoop: { currentItem: 'x' },
      a: { tag: 'a-out' },
      me: { tag: 'me-out' },
      __loopScopeStack: [{ loopNodeId: 'theLoop', bodyNodeIds: { a: true, me: true } }],
    }
    const out = (await handler({ code, __nodeId: 'me' }, context)) as any
    expect(out).toEqual([{ tag: 'a-out' }])
  })

  it('preserves backwards compatibility for top-level signature inside a loop', async () => {
    // A node that only declares `function customHandler(params)` (no
    // innerParams) inside a loop should still receive the documented
    // workflow-level params — i.e. nodes BEFORE the loop, not the flat
    // context.
    const code = `function customHandler(params) {
      return { len: params.length }
    }`
    const context: Record<string, unknown> = {
      'preloop-a': 1,
      'preloop-b': 2,
      theLoop: { currentItem: 'x' },
      'inLoop-pred': 99,
      __loopScopeStack: [{ loopNodeId: 'theLoop', bodyNodeIds: { 'inLoop-pred': true, me: true } }],
    }
    const out = (await handler({ code, __nodeId: 'me' }, context)) as any
    expect(out.len).toBe(2)
  })
})

describe('general-custom-js — nested loops', () => {
  const handler = loadCustomJsHandler()

  it('layers innerParams (innermost first) and innerParams2 (next outer)', async () => {
    const code = `function customHandler(params, innerParams, innerParams2) {
      return {
        params: params.map(p => Object.keys(p)[0]),
        innerParams: innerParams.map(p => Object.keys(p)[0]),
        innerParams2: innerParams2.map(p => Object.keys(p)[0]),
      }
    }`
    const context: Record<string, unknown> = {
      'pre-everything': { topLevel: true },
      outerLoop: { currentItem: 'o0' },
      'outerBody-pre': { outerOnly: true }, // sibling of innerLoop
      innerLoop: { currentItem: 'i0' },
      'innerBody-pred': { innerOnly: true }, // sibling of me, in inner body
      __loopScopeStack: [
        {
          loopNodeId: 'outerLoop',
          bodyNodeIds: {
            'outerBody-pre': true,
            innerLoop: true,
            'innerBody-pred': true,
            me: true,
          },
        },
        {
          loopNodeId: 'innerLoop',
          bodyNodeIds: { 'innerBody-pred': true, me: true },
        },
      ],
    }
    const out = (await handler({ code, __nodeId: 'me' }, context)) as any
    // Outside everything → params.
    expect(out.params).toEqual(['topLevel'])
    // Innermost body, excluding self → innerParams.
    expect(out.innerParams).toEqual(['innerOnly'])
    // Outer body, excluding everything attributed to inner → innerParams2.
    // Note: innerLoop scaffold is excluded because allLoopScaffoldIds catches
    // it, AND the innerLoop's body ids are claimed by the inner level.
    expect(out.innerParams2).toEqual(['outerOnly'])
  })

  it('treats completed inner-loop scaffolds as scaffolding even when sibling runs after', async () => {
    // A custom-js sitting in the OUTER loop's body, as a sibling of the
    // inner loop that has already finished. The runtime stamps every loop
    // node id it ever entered onto __loopNodeIds, so the handler still
    // knows `innerLoop` is structural even though it's no longer in the
    // active scope stack. The leaked inner-body result (`inner-body-x`)
    // still appears though — it's a real value, not scaffolding.
    const code = `function customHandler(params, innerParams) {
      return innerParams.map(p => Object.keys(p)[0])
    }`
    const context: Record<string, unknown> = {
      outerLoop: { currentItem: 'o0' },
      'outerBody-a': { outerA: true },
      innerLoop: { results: [], iterations: 0 },
      'inner-body-x': { innerX: true },
      __loopScopeStack: [
        {
          loopNodeId: 'outerLoop',
          bodyNodeIds: {
            'outerBody-a': true,
            innerLoop: true,
            'inner-body-x': true,
            me: true,
          },
        },
      ],
      // Both loops have been entered at some point this run; the runtime
      // pushes to __loopNodeIds on entry and never removes.
      __loopNodeIds: { outerLoop: true, innerLoop: true },
    }
    const out = (await handler({ code, __nodeId: 'me' }, context)) as any
    expect(out).toEqual(['outerA', 'innerX'])
  })
})

describe('general-custom-js — inside a custom workflow node', () => {
  const handler = loadCustomJsHandler()

  it('passes previousContext + params indexed by customNodeIds', async () => {
    // Inside a custom node, the documented signature is:
    //   function customHandler(previousContext, params)
    // params[N] indexes by the position in the custom node's internal nodes
    // array, not by global step order.
    const code = `function customHandler(previousContext, params) {
      return {
        prevTag: previousContext?.tag,
        first: params[0],
        second: params[1],
      }
    }`
    const context: Record<string, unknown> = {
      __isInsideCustomNode: true,
      __customNodeIds: ['cn-step-0', 'cn-step-1'],
      __previousNodeResult: { tag: 'parent-output' },
      'cn-step-0': { aResult: 1 },
      'cn-step-1': { bResult: 2 },
      // Nodes from the parent workflow that should NOT appear in params:
      'unrelated-parent-node': { ignored: true },
    }
    const out = (await handler({ code, __nodeId: 'cn-me' }, context)) as any
    expect(out.prevTag).toBe('parent-output')
    expect(out.first).toEqual({ aResult: 1 })
    expect(out.second).toEqual({ bResult: 2 })
  })

  it('exposes named __customParams as properties on the params array', async () => {
    const code = `function customHandler(previousContext, params) {
      return { byIndex: params[0], byName: params.userId }
    }`
    const context: Record<string, unknown> = {
      __isInsideCustomNode: true,
      __customNodeIds: ['cn-a'],
      __customParams: [{ key: 'userId', value: 'u-42' }],
      __previousNodeResult: {},
      'cn-a': { tag: 'a' },
    }
    const out = (await handler({ code, __nodeId: 'cn-me' }, context)) as any
    expect(out.byIndex).toEqual({ tag: 'a' })
    expect(out.byName).toBe('u-42')
  })

  it('supports custom-node + loop: previousContext + params + innerParams', async () => {
    const code = `function customHandler(previousContext, params, innerParams) {
      return {
        prevTag: previousContext?.tag,
        paramsLen: params.length,
        innerKey: Object.keys(innerParams[0])[0],
      }
    }`
    const context: Record<string, unknown> = {
      __isInsideCustomNode: true,
      __customNodeIds: ['cn-step-0', 'cn-step-1', 'cn-loop', 'cn-body-pred', 'cn-me'],
      __previousNodeResult: { tag: 'parent' },
      'cn-step-0': { tag: 's0' },
      'cn-step-1': { tag: 's1' },
      'cn-loop': { currentItem: 'x' },
      'cn-body-pred': { tag: 'in-body' },
      __loopScopeStack: [
        {
          loopNodeId: 'cn-loop',
          bodyNodeIds: { 'cn-body-pred': true, 'cn-me': true },
        },
      ],
    }
    const out = (await handler({ code, __nodeId: 'cn-me' }, context)) as any
    expect(out.prevTag).toBe('parent')
    // Outside the loop within the custom node → cn-step-0 and cn-step-1
    // (cn-loop is loop scaffold, body nodes drop out).
    expect(out.paramsLen).toBe(2)
    expect(out.innerKey).toBe('tag')
  })
})

describe('general-custom-js — error and fallback behaviour', () => {
  const handler = loadCustomJsHandler()

  it('returns { error } when the user code throws', async () => {
    const code = `function customHandler(params) { throw new Error('boom') }`
    const out = (await handler({ code, __nodeId: 'me' }, {})) as any
    expect(out).toEqual({ error: 'boom' })
  })

  it('awaits a returned promise', async () => {
    const code = `function customHandler(params) {
      return Promise.resolve({ async: true })
    }`
    const out = (await handler({ code, __nodeId: 'me' }, {})) as any
    expect(out).toEqual({ async: true })
  })

  it('falls back to a plain script body when no function declaration is present', async () => {
    // Some legacy nodes ship code without a function wrapper.
    const code = `return { bodyMode: true, paramCount: params.length }`
    const context: Record<string, unknown> = { a: 1, b: 2 }
    const out = (await handler({ code, __nodeId: 'me' }, context)) as any
    expect(out).toEqual({ bodyMode: true, paramCount: 2 })
  })

  it('hands innerParams=[] when declared outside any loop so innerParams[0]?.x is safe', async () => {
    // Users sometimes paste a function with innerParams in its signature
    // even when the node isn't actually inside a loop. Returning undefined
    // there would make `innerParams[0]?.x` throw — which is worse than the
    // documented optional-chaining graceful fallback. We pass [] instead.
    const code = `function customHandler(params, innerParams) {
      return { hasInner: Array.isArray(innerParams), value: innerParams[0]?.x ?? 'absent' }
    }`
    const out = (await handler({ code, __nodeId: 'me' }, {})) as any
    expect(out).toEqual({ hasInner: true, value: 'absent' })
  })
})

describe('runtime emission — loop scope stack is pushed and popped', () => {
  // Pin the api-route-generator's regular server segment so a future refactor
  // can't drop the __loopScopeStack management. We grep the generated route
  // for the documented push/pop pattern and the helper-aware unwrap.

  const buildSegment = (): WorkflowSegment => ({
    id: 'server-1',
    env: 'server',
    nodeIds: ['l', 'b'],
    nodes: [
      {
        id: 'l',
        type: 'general-loop',
        label: 'Loop',
        config: {
          loopType: 'map',
          collection: { type: 'workflowContext', nodeId: 'src', path: ['src'] },
        },
        executionEnv: 'universal',
        stepNumber: 1,
      } as any,
      {
        id: 'b',
        type: 'general-custom-js',
        label: 'Build',
        config: { code: 'function customHandler(params, innerParams) { return innerParams }' },
        executionEnv: 'universal',
        stepNumber: 2,
      } as any,
    ],
    edges: [
      {
        id: 'e1',
        source: 'l',
        target: 'b',
        sourceHandle: 'loop',
        targetHandle: 'loop-body-in',
      } as any,
      {
        id: 'e2',
        source: 'b',
        target: 'l',
        sourceHandle: 'loop-body-out',
        targetHandle: 'loop-back',
      } as any,
    ],
  })

  it('pushes a loop scope before iterating and pops after', () => {
    const route = generateServerSegmentAPIRoute(buildSegment())
    expect(route).toMatch(
      /context\.__loopScopeStack\.push\(\{\s*loopNodeId:\s*node\.id,\s*bodyNodeIds:\s*bodyNodeIds\s*\}\)/
    )
    expect(route).toContain('context.__loopScopeStack.pop();')
  })

  it('initialises __loopScopeStack lazily (does not assume caller seeded it)', () => {
    const route = generateServerSegmentAPIRoute(buildSegment())
    expect(route).toMatch(/if \(!context\.__loopScopeStack\) context\.__loopScopeStack = \[\];/)
  })
})

describe('shared runtime — executeLoop pushes and pops the scope stack', () => {
  it('emits push and pop around the loop body so nested loops layer correctly', () => {
    const src = generateSharedRuntimeUtilsCode()
    // The runtime tracks scope via __loopScopeStack on the live context.
    expect(src).toMatch(
      /context\.__loopScopeStack\.push\(\{\s*loopNodeId:\s*loopNode\.id,\s*bodyNodeIds:\s*bodyNodeIdsMap\s*\}\)/
    )
    expect(src).toMatch(/context\.__loopScopeStack\.pop\(\)/)
    // Parallel iterations clone the stack so nested-loop pushes in branch A
    // don't affect branch B.
    expect(src).toMatch(
      /iterCtx\.__loopScopeStack\s*=\s*\(context\.__loopScopeStack \|\| \[\]\)\.slice\(\)/
    )
    // Persistent registry of loop ids so completed inner loops are still
    // recognised as scaffolding by sibling nodes that run after them.
    expect(src).toContain('context.__loopNodeIds')
  })
})

describe('end-to-end — country workflow simulated through the generated runtime', () => {
  // This test boots the SHARED runtime (the actual code that ships into
  // the client + server bundles) plus the generated handler for
  // general-custom-js, then drives the exact iteration loop the api-route
  // generator emits. The point is to prove that the country-workflow
  // scenario produces { name, description } per iteration end-to-end —
  // not just that the handler can be called in isolation.

  type SharedUtils = {
    resolveValue: (v: unknown, ctx: Record<string, unknown>) => unknown
    resolveConfig: (cfg: unknown, ctx: Record<string, unknown>) => any
    unwrapWorkflowCollection: (v: unknown) => unknown
  }

  function loadSharedRuntime(): SharedUtils {
    const src = generateSharedRuntimeUtilsCode()
    const wrapper: any = { exports: {} }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('module', 'exports', src)(wrapper, wrapper.exports)
    return wrapper.exports as SharedUtils
  }

  it('produces { name, description } per iteration when binding skips an envelope and crosses scopes', async () => {
    const utils = loadSharedRuntime()
    const customJs = loadCustomJsHandler()

    // Build the live context the way the regular server segment would:
    // fetch + slice already ran. The slice envelope is intentionally bound
    // by parent node id (no `.result` drill) so the loop has to unwrap.
    const context: Record<string, unknown> = {
      'fetch-countries': {
        status: 200,
        body: [{ name: { common: 'Bahrain' } }, { name: { common: 'Belize' } }],
        headers: {},
      },
      'slice-five-countries': {
        result: [{ name: { common: 'Bahrain' } }, { name: { common: 'Belize' } }],
        operation: 'slice',
        originalLength: 250,
      },
    }

    // Body node configs (resolved per iteration).
    const extractConfig = {
      operation: 'get',
      path: 'name.common',
      input: {
        type: 'workflowContext',
        nodeId: 'loop-countries',
        path: ['loop-countries', 'currentItem'],
      },
    }
    const buildConfig = {
      __nodeId: 'build-country-result',
      code: `function customHandler(params, innerParams) {
        const name = innerParams[0]?.result ?? 'Unknown'
        const description = innerParams[1]?.response ?? ''
        return { name: name, description: description }
      }`,
    }

    // Stand-in for the AI node — returns a deterministic string keyed off
    // the upstream extracted name so we can assert per-iteration values
    // line up.
    const aiHandler = (cfg: any) => {
      return Promise.resolve({
        response: 'A funny line about ' + (cfg.input?.result ?? 'unknown'),
        model: 'stub',
        usage: {},
      })
    }

    // Mimic the api-route-generator's loop body executor, including the
    // documented push/pop dance. The IDs match the user's workflow.
    const bodyNodeIds: Record<string, true> = {
      'extract-country-name': true,
      'ai-funny-description': true,
      'build-country-result': true,
    }
    if (!context.__loopScopeStack) {
      ;(context as any).__loopScopeStack = []
    }
    ;(context as any).__loopScopeStack.push({ loopNodeId: 'loop-countries', bodyNodeIds })
    if (!context.__loopNodeIds) {
      ;(context as any).__loopNodeIds = {}
    }
    ;(context as any).__loopNodeIds['loop-countries'] = true

    const collection = utils.unwrapWorkflowCollection(
      utils.resolveValue(
        { type: 'workflowContext', nodeId: 'slice-five-countries', path: ['slice-five-countries'] },
        context
      )
    ) as Array<{ name: { common: string } }>

    const results: any[] = []
    for (let i = 0; i < collection.length; i++) {
      ;(context as any)['loop-countries'] = {
        currentItem: collection[i],
        currentIndex: i,
        iterations: i + 1,
      }

      // extract-country-name (transform-object stub)
      const resolvedExtract = utils.resolveConfig(extractConfig, context)
      const path = (resolvedExtract.path || '').split('.')
      let cur: any = resolvedExtract.input
      for (let p = 0; p < path.length; p++) {
        cur = cur?.[path[p]]
      }
      ;(context as any)['extract-country-name'] = { result: cur }

      // ai-funny-description (stub handler with same shape as real one)
      ;(context as any)['ai-funny-description'] = await aiHandler({
        input: (context as any)['extract-country-name'],
      })

      // build-country-result (the real handler — what we're regression-testing)
      const built = await customJs(buildConfig, context)
      ;(context as any)['build-country-result'] = built
      results.push(built)
    }

    ;(context as any).__loopScopeStack.pop()

    expect(results).toEqual([
      { name: 'Bahrain', description: 'A funny line about Bahrain' },
      { name: 'Belize', description: 'A funny line about Belize' },
    ])
  })
})
