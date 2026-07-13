import { resolveHandlerEntryName } from '../src/nodes/types'
import { nodeRegistry } from '../src/nodes'

/**
 * Regression coverage for resolveHandlerEntryName, which exists because a
 * handler's declared name at runtime can diverge from the
 * `nodeType.replace(/-/g, '_')` convention name: when this package is bundled
 * and minified by a consumer (e.g. teleport-gui's browser packer worker), the
 * minifier freely renames a `handlerToString(fn)`-embedded function's
 * declaration, since nothing in the bundle calls it by name — only the
 * runtime `.toString()` read does, which is invisible to the minifier.
 *
 * Two real handlers exposed shapes the resolver initially got wrong:
 *   - payment-charge-user.ts: entry declared FIRST, its own helpers after
 *     (`handlerToString(payment_charge_user) + '\n' + chargeWithStripe.toString() + ...`).
 *   - ai-custom-prompt.ts: shared AI-provider utils declared BEFORE the
 *     entry, each wrapped in a `wrapWithGuard`-style re-declaration guard
 *     (`var X = typeof X !== 'undefined' ? X : function Y() {...};` — a
 *     function EXPRESSION embedded in a ternary, not a statement-level
 *     declaration) — this crashed a real publish with "Could not resolve the
 *     entry function for workflow node type "ai-custom-prompt"".
 * A naive "first" or "last" positional heuristic breaks one of these two.
 */

function evalEntryWrapper(source: string, entryName: string): unknown {
  return new Function(`${source}\nreturn ${entryName};`)()
}

describe('resolveHandlerEntryName', () => {
  it('returns the convention name when the source declares it directly', () => {
    const source = `async function my_node_type(config, context) { return {}; }`
    expect(resolveHandlerEntryName(source, 'my-node-type')).toBe('my_node_type')
  })

  it('falls back to the actual declared name when the entry was renamed (single function)', () => {
    const source = `async function e(config, context) { return {}; }`
    expect(resolveHandlerEntryName(source, 'my-node-type')).toBe('e')
  })

  it('finds a renamed entry declared FIRST, before its own helpers (payment-charge-user shape)', () => {
    const source = `
async function zzz(config, context) {
  return helper_one(config) + helper_two(context);
}
async function helper_one(config) { return config.x; }
async function helper_two(context) { return context.y; }
`
    const resolved = resolveHandlerEntryName(source, 'payment-charge-user')
    expect(resolved).toBe('zzz')
    expect(typeof evalEntryWrapper(source, resolved)).toBe('function')
  })

  it('finds a renamed entry declared LAST, after ternary-guarded shared utils (ai-custom-prompt shape)', () => {
    const source = `
var util_one = typeof util_one !== 'undefined' ? util_one : function util_one(val) { return val; };
var util_two = typeof util_two !== 'undefined' ? util_two : function util_two(val) { return val; };

async function zzz(config, context, streamCallback) {
  return util_one(config) + util_two(context);
}
`
    const resolved = resolveHandlerEntryName(source, 'ai-custom-prompt')
    expect(resolved).toBe('zzz')
    expect(typeof evalEntryWrapper(source, resolved)).toBe('function')
  })

  it('prefers the entry-point arity (2-3 params) over a same-position helper with a different arity', () => {
    // A helper positioned BEFORE the (renamed) entry, but with an arity that
    // could never be a real handler entry point (1 param) — must not win.
    const source = `
function one_param_helper(x) { return x; }
async function zzz(config, context) { return one_param_helper(config); }
`
    expect(resolveHandlerEntryName(source, 'my-node-type')).toBe('zzz')
  })

  it('throws a clear error when no declaration can be found at all', () => {
    expect(() => resolveHandlerEntryName('var x = 1;', 'my-node-type')).toThrow(
      /Could not resolve the entry function/
    )
  })

  // Full-registry regression: every node type's generateHandler()/
  // generateServerHandler() output must resolve to a real, callable function
  // both normally AND after its entry function's declared name is renamed
  // (simulating what a minifier does) — proves the resolver's fallback logic
  // holds for every handler shape actually registered, not just hand-picked
  // examples.
  describe('every registered node type', () => {
    const nodeTypes = Object.keys(nodeRegistry)

    it.each(nodeTypes)(
      '%s: generateHandler resolves normally and after entry rename',
      (nodeType) => {
        const gen = nodeRegistry[nodeType]
        const source = gen.generateHandler().trim()
        const conventionName = nodeType.replace(/-/g, '_')

        const resolvedNormal = resolveHandlerEntryName(source, nodeType)
        expect(typeof evalEntryWrapper(source, resolvedNormal)).toBe('function')

        if (source.includes(conventionName)) {
          const renamed = source.replace(new RegExp(`\\b${conventionName}\\b`, 'g'), 'zzz_renamed')
          const resolvedRenamed = resolveHandlerEntryName(renamed, nodeType)
          expect(resolvedRenamed).toBe('zzz_renamed')
          expect(typeof evalEntryWrapper(renamed, resolvedRenamed)).toBe('function')
        }
      }
    )

    it.each(nodeTypes.filter((t) => nodeRegistry[t].generateServerHandler))(
      '%s: generateServerHandler resolves normally and after entry rename',
      (nodeType) => {
        const gen = nodeRegistry[nodeType]
        const source = gen.generateServerHandler!().trim()
        const conventionName = nodeType.replace(/-/g, '_')

        const resolvedNormal = resolveHandlerEntryName(source, nodeType)
        expect(typeof evalEntryWrapper(source, resolvedNormal)).toBe('function')

        if (source.includes(conventionName)) {
          const renamed = source.replace(new RegExp(`\\b${conventionName}\\b`, 'g'), 'zzz_renamed')
          const resolvedRenamed = resolveHandlerEntryName(renamed, nodeType)
          expect(resolvedRenamed).toBe('zzz_renamed')
          expect(typeof evalEntryWrapper(renamed, resolvedRenamed)).toBe('function')
        }
      }
    )
  })
})
