/**
 * The one way a generated workflow handler reports a commerce funnel step.
 *
 * ## Why a global and not an import
 *
 * A node handler ships as a SERIALIZED function body (`fn.toString()`) that is
 * evaluated at runtime with no module scope — it cannot import anything. The
 * analytics tracker publishes `window.tpTrackCommerce` when it boots, and that
 * global is the only channel a handler can reach.
 *
 * ## Why every call is guarded twice
 *
 * The global is absent on any project that did not enable analytics, and absent
 * on every server-side render. These handlers run inside add-to-cart and
 * checkout, where an exception costs a sale — so a missing tracker has to be a
 * silent no-op, never a `ReferenceError`. The `try` covers the second failure
 * mode: a tracker that is present but throws (storage disabled, a browser
 * extension replacing the global) must not take the cart down with it.
 *
 * ## ⛔ Why a calling node must NOT import `trackCommerceStep`
 *
 * TypeScript's CommonJS emit rewrites a cross-module call into
 * `(0, commerce_tracking_1.trackCommerceStep)(...)`. That survives `.toString()`
 * verbatim, and `commerce_tracking_1` does not exist in the generated workflow
 * segment — so the handler throws `ReferenceError` the first time a shopper adds
 * to the cart, in production only, because nothing about it is visible in the
 * TypeScript source.
 *
 * A caller therefore declares the name AMBIENTLY (`declare function
 * trackCommerceStep`), which emits nothing and leaves a bare identifier in the
 * serialized body, and appends `COMMERCE_TRACKING_HELPER_SOURCE` so the runtime
 * definition travels with it. `assertHandlerHasNoModuleRefs` fails the build if
 * a module reference ever creeps back in.
 */

/**
 * ⛔ EXACTLY ONE PARAMETER. Not a style choice.
 *
 * When this package is minified by a consumer, the handler's own entry function
 * loses its conventional name, and `resolveHandlerEntryName` then identifies the
 * entry by ARITY: it prefers a 2-param declaration, because every real handler
 * entry is `(config, context)`. A 2-param helper concatenated after a 1-param
 * entry therefore WINS, and the generated workflow calls the tracking helper
 * where it meant to call add-to-cart.
 *
 * One object parameter keeps the helper out of that contest, and the resolver's
 * positional fallback then correctly picks the entry, which is emitted first.
 * `resolve-handler-entry-name.test.ts` checks every registered node type against
 * exactly this, and is what caught it.
 *
 * Not exported either: exporting invites the cross-module call this file exists
 * to prevent. It is here to be read by `.toString()` below, nothing else.
 */
function trackCommerceStep(step: { name: string; detail?: Record<string, unknown> }): void {
  try {
    const tracker = (globalThis as Record<string, unknown>).tpTrackCommerce
    if (typeof tracker === 'function') {
      ;(tracker as (n: string, d?: Record<string, unknown>) => void)(step.name, step.detail)
    }
  } catch (e) {
    /* analytics must never break a cart or a checkout */
  }
}

/** ES5 source of the helper, for concatenating after a serialized handler. */
export const COMMERCE_TRACKING_HELPER_SOURCE = trackCommerceStep.toString()

/**
 * Matches the two shapes TypeScript's CJS emit produces for a cross-module
 * call — `(0, ns_1.fn)(…)` and a bare `ns_1.fn(…)`.
 */
const MODULE_REFERENCE = /\b[A-Za-z_$][\w$]*_\d+\s*\./

/**
 * Fails the BUILD when a serialized handler still references a module namespace.
 *
 * Cheap insurance against a failure that is otherwise invisible: the TypeScript
 * compiles, the tests that only read the source pass, and the handler throws in
 * a shopper's browser. Called by every `generateHandler` that concatenates a
 * helper.
 */
export function assertHandlerHasNoModuleRefs(source: string, nodeType: string): string {
  const match = source.match(MODULE_REFERENCE)
  if (match) {
    throw new Error(
      `The "${nodeType}" handler references the module namespace "${match[0]}". ` +
        'A serialized handler has no module scope, so this throws ReferenceError at ' +
        'runtime. Declare the helper ambiently (declare function ...) and append its ' +
        'source instead of importing it.'
    )
  }
  return source
}
