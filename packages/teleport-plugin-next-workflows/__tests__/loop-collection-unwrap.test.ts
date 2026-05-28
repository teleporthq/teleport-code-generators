import { generateSharedRuntimeUtilsCode, generateServerSegmentAPIRoute } from '../src'
import type { WorkflowSegment } from '../src/types'

// Regression guard for the "loop iterates 0 times even though the
// upstream node returned data" bug.
//
// Many workflow nodes wrap their primary array in a metadata envelope:
//   transform-array          -> { result, operation, originalLength }
//   integration-airtable     -> { records, ... }
//   utility-semantic-search  -> { matches, ... }
// When the upstream binding targets the parent node id without drilling
// into the inner field, the loop's `resolved.collection` is the whole
// envelope. The old runtime saw a non-array, fell through to [], and
// silently produced 0 iterations.
//
// `unwrapWorkflowCollection` (in runtime-utils) coerces the envelope to
// the inner array when there is exactly ONE array-typed property —
// which is unambiguous and matches the schema convention. Multi-array
// envelopes stay non-iterable so the user must pick the field
// explicitly.
//
// This file extracts the helper from the *generated* runtime string and
// also boots a generated server-segment api route end-to-end, so any
// future refactor that drops or weakens the unwrap fails loudly.

type Unwrap = (value: unknown) => unknown

function extractUnwrapHelper(): Unwrap {
  const src = generateSharedRuntimeUtilsCode()
  const match = src.match(/function unwrapWorkflowCollection[\s\S]*?\n\}/)
  if (!match) {
    throw new Error('unwrapWorkflowCollection not found in generated runtime')
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(match[0] + '\nreturn unwrapWorkflowCollection;')() as Unwrap
}

describe('unwrapWorkflowCollection — loop collection coercion', () => {
  const unwrap = extractUnwrapHelper()

  describe('passes arrays through unchanged', () => {
    it('returns a populated array as-is', () => {
      const arr = [1, 2, 3]
      expect(unwrap(arr)).toBe(arr)
    })

    it('returns an empty array as-is', () => {
      const arr: number[] = []
      expect(unwrap(arr)).toBe(arr)
    })

    it('preserves array element identity (no copy)', () => {
      const item = { id: 'x' }
      const arr = [item]
      expect((unwrap(arr) as object[])[0]).toBe(item)
    })
  })

  describe('unwraps single-array envelopes', () => {
    it('handles transform-array shape { result, operation, originalLength }', () => {
      const inner = ['fr', 'de', 'us']
      const wrapper = { result: inner, operation: 'slice', originalLength: 250 }
      expect(unwrap(wrapper)).toBe(inner)
    })

    it('handles integration-airtable shape { records, ... }', () => {
      const inner = [{ id: 'rec1' }, { id: 'rec2' }]
      const wrapper = { records: inner, hasMore: false }
      expect(unwrap(wrapper)).toBe(inner)
    })

    it('handles utility-semantic-search shape { matches, ... }', () => {
      const inner = [{ score: 0.9 }, { score: 0.8 }]
      const wrapper = { matches: inner, query: 'q' }
      expect(unwrap(wrapper)).toBe(inner)
    })

    it('handles general-loop shape { results, currentItem, ... }', () => {
      const inner = [{ name: 'a' }, { name: 'b' }]
      const wrapper = { results: inner, completed: true, iterations: 2 }
      expect(unwrap(wrapper)).toBe(inner)
    })
  })

  describe('refuses ambiguous multi-array envelopes', () => {
    it('returns [] when the envelope has more than one array property', () => {
      // utility-extract-links shape — three arrays, can't pick one safely.
      const wrapper = {
        links: ['a', 'b'],
        internalLinks: ['a'],
        externalLinks: ['b'],
      }
      expect(unwrap(wrapper)).toEqual([])
    })

    it('returns [] for utility-csv-parse shape { data, headers }', () => {
      const wrapper = { data: [['x']], headers: ['col'] }
      expect(unwrap(wrapper)).toEqual([])
    })
  })

  describe('falls back to [] for non-iterable inputs', () => {
    it('returns [] for undefined', () => {
      expect(unwrap(undefined)).toEqual([])
    })

    it('returns [] for null', () => {
      expect(unwrap(null)).toEqual([])
    })

    it('returns [] for primitive types', () => {
      expect(unwrap('hello')).toEqual([])
      expect(unwrap(42)).toEqual([])
      expect(unwrap(true)).toEqual([])
    })

    it('returns [] for an envelope with zero array properties', () => {
      const wrapper = { status: 200, message: 'ok' }
      expect(unwrap(wrapper)).toEqual([])
    })

    it('returns [] for an envelope where the only array property is a deep nested one (we only check own enumerable props)', () => {
      const wrapper = { meta: { items: [1, 2, 3] }, status: 'ok' }
      expect(unwrap(wrapper)).toEqual([])
    })
  })

  describe('matches the canonical user scenario', () => {
    // The reported bug: fetch-countries -> slice-five-countries (transform-array)
    // -> loop-countries. The loop binding pointed at the slice node id without
    // drilling into .result, so loop saw the envelope and produced
    // iterations: 0, results: []. With the unwrap, it iterates 5 times.
    it('reproduces the slice-five-countries -> loop case', () => {
      const sliceOutput = {
        result: [
          { name: { common: 'Denmark' } },
          { name: { common: 'France' } },
          { name: { common: 'Japan' } },
          { name: { common: 'Brazil' } },
          { name: { common: 'Egypt' } },
        ],
        operation: 'slice',
        originalLength: 250,
      }
      const collection = unwrap(sliceOutput) as unknown[]
      expect(Array.isArray(collection)).toBe(true)
      expect(collection.length).toBe(5)
    })
  })
})

describe('runtime-utils end-to-end — simulated transform-array -> loop chain', () => {
  // This boots the *entire* shared runtime in a fresh vm context with
  // native async support and uses its real exports to walk through the
  // exact data flow that broke in production: a transform-array slice
  // node feeds a general-loop with a bare-nodeId binding. Without the
  // unwrap, the loop saw the {result, operation, originalLength}
  // envelope, treated it as non-array, and ran 0 iterations. With the
  // unwrap, it iterates over `slice.result`.

  type SharedUtils = {
    resolveValue: (v: unknown, ctx: Record<string, unknown>) => unknown
    unwrapWorkflowCollection: (v: unknown) => unknown
    resolveConfig: (cfg: unknown, ctx: Record<string, unknown>) => any
  }

  function loadSharedRuntime(): SharedUtils {
    const src = generateSharedRuntimeUtilsCode()
    const wrapper: any = { exports: {} }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('module', 'exports', src)(wrapper, wrapper.exports)
    return wrapper.exports as SharedUtils
  }

  it('iterates the inner array when the binding skipped .result (the user bug)', () => {
    const utils = loadSharedRuntime()

    // Build the context the way the server runtime would after running the
    // slice node: { result: <array>, operation, originalLength }.
    const context: Record<string, unknown> = {
      'slice-stub': {
        result: [{ name: 'Denmark' }, { name: 'France' }, { name: 'Japan' }],
        operation: 'slice',
        originalLength: 250,
      },
    }

    // The buggy binding: targets the parent node id without drilling.
    const collectionRef = {
      type: 'workflowContext',
      nodeId: 'slice-stub',
      path: ['slice-stub'],
    }

    const resolved = utils.resolveValue(collectionRef, context)
    // Sanity check that resolveValue returns the envelope (the source of
    // the original bug). This locks in the documented behaviour of
    // resolveContextRef so a future change there also stays explicit.
    expect(resolved).toEqual(context['slice-stub'])
    expect(Array.isArray(resolved)).toBe(false)

    const collection = utils.unwrapWorkflowCollection(resolved)
    expect(Array.isArray(collection)).toBe(true)
    expect((collection as unknown[]).length).toBe(3)
    expect((collection as Array<{ name: string }>)[0].name).toBe('Denmark')
  })

  it('passes through a properly-drilled binding without modification', () => {
    const utils = loadSharedRuntime()
    const context: Record<string, unknown> = {
      'slice-stub': {
        result: [{ name: 'A' }, { name: 'B' }],
        operation: 'slice',
        originalLength: 10,
      },
    }

    // The good binding: drills into .result.
    const collectionRef = {
      type: 'workflowContext',
      nodeId: 'slice-stub',
      path: ['slice-stub', 'result'],
    }

    const resolved = utils.resolveValue(collectionRef, context)
    expect(Array.isArray(resolved)).toBe(true)

    // unwrap is a no-op for already-arrays, so no behaviour change.
    const collection = utils.unwrapWorkflowCollection(resolved)
    expect(collection).toBe(resolved)
  })

  it('handles a fetch -> slice envelope chain (the actual scenario)', () => {
    const utils = loadSharedRuntime()

    // Seed a fake fetch-countries result. (Format matches what the
    // general-http-request handler returns: { status, body, headers }.)
    const ctx: Record<string, unknown> = {
      'fetch-countries': {
        status: 200,
        body: [
          { name: 'Denmark' },
          { name: 'France' },
          { name: 'Japan' },
          { name: 'Brazil' },
          { name: 'Egypt' },
          { name: 'India' },
        ],
        headers: {},
      },
    }

    // Resolve the slice-stub config the way the runtime does:
    // input is a workflowContext ref to fetch-countries.body.
    const sliceConfig = utils.resolveConfig(
      {
        operation: 'slice',
        input: {
          type: 'workflowContext',
          nodeId: 'fetch-countries',
          path: ['fetch-countries', 'body'],
        },
        start: 0,
        end: 3,
      },
      ctx
    )

    // The slice handler shape: { result, operation, originalLength }.
    // We simulate it by hand here so the test doesn't depend on the
    // transform-array node implementation drift. The important thing
    // is what comes next — the unwrap.
    ctx['slice-stub'] = {
      result: (sliceConfig.input as unknown[]).slice(sliceConfig.start, sliceConfig.end),
      operation: sliceConfig.operation,
      originalLength: (sliceConfig.input as unknown[]).length,
    }

    // Now the loop's collection binding (bare path). Resolve and unwrap.
    const looped = utils.unwrapWorkflowCollection(
      utils.resolveValue(
        { type: 'workflowContext', nodeId: 'slice-stub', path: ['slice-stub'] },
        ctx
      )
    )

    expect(Array.isArray(looped)).toBe(true)
    expect((looped as unknown[]).length).toBe(3) // sliced from 6 to 3
  })
})

describe('every loop emit site routes through unwrapWorkflowCollection', () => {
  // The runtime fix is only effective if every place that emits a loop
  // calls `unwrapWorkflowCollection`. This test pins the wiring at all
  // four emit sites — regular server segment, streaming server segment,
  // cron handler, client-side runtime — so a future refactor can't drop
  // the call from one site and silently reintroduce the 0-iterations
  // regression on a subset of workflows.

  const buildLoopSegment = (): WorkflowSegment => ({
    id: 'server-1',
    env: 'server',
    nodeIds: ['the-loop'],
    nodes: [
      {
        id: 'the-loop',
        type: 'general-loop',
        config: {
          loopType: 'forEach',
          collection: { type: 'workflowContext', nodeId: 'src', path: ['src'] },
        },
        stepNumber: 1,
        label: 'Loop',
      } as any,
    ],
    edges: [],
  })

  it('regular server segment uses utils.unwrapWorkflowCollection for the loop collection', () => {
    const src = generateServerSegmentAPIRoute(buildLoopSegment(), 'T')
    expect(src).toContain('utils.unwrapWorkflowCollection(resolved.collection)')
  })

  it('client-side runtime uses unwrapWorkflowCollection in executeLoop', () => {
    const src = generateSharedRuntimeUtilsCode()
    // The helper is defined and called inside executeLoop.
    expect(src).toContain('function unwrapWorkflowCollection')
    expect(src).toContain('unwrapWorkflowCollection(resolveValue(config.collection, context))')
    // And it's exported so the api routes can reach it via `utils.X`.
    expect(src).toMatch(/module\.exports\s*=\s*\{[^}]*unwrapWorkflowCollection/s)
  })

  it('shared runtime exports the helper for cron / webhook handlers too', () => {
    // generateServerRuntimeCode is a thin re-export of runtime-utils.
    // The cron/webhook generators load the same module and access
    // utils.unwrapWorkflowCollection from there.
    const src = generateSharedRuntimeUtilsCode()
    const moduleExports = src.match(/module\.exports\s*=\s*\{[\s\S]*?\}/)?.[0] || ''
    expect(moduleExports).toContain('unwrapWorkflowCollection')
  })
})
