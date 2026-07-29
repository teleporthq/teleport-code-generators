/**
 * Root identifiers that are always in scope where a UIDL `expr` node is
 * rendered — i.e. in the component's RENDER BODY, which is the only place this
 * resolver inspects (element children, element attributes and the link ability
 * the abilities resolver has not yet folded into attributes).
 *
 * Membership here is a promise that the code generator declares the name. It is
 * therefore limited to:
 *
 *  - `props`, the render function's own parameter,
 *  - the global-context values the JSX emitter destructures from
 *    `useGlobalContext()` whenever it sees them in an expression
 *    (`GLOBAL_EXPRESSION_IDENTIFIERS` in teleport-plugin-common node-to-jsx),
 *  - standard JavaScript / browser globals.
 *
 * Deliberately NOT here:
 *
 *  - `state` — React state is destructured into bare variables
 *    (`dynamicReferencePrefixMap.state` is `''`), so there is no `state` object
 *    at runtime and `state` / `state.x` in an expression is always a
 *    `ReferenceError`. Individual state names come from `stateDefinitions`.
 *  - `params`, `index` and render-prop names — these ARE bound, but only inside
 *    the subtree of the node that introduces them (a repeater's `.map()`
 *    callback, a CMS/data-source `renderSuccess` prop). The walker tracks them
 *    positionally so a reference that escapes its owner is still caught.
 *  - `event` / `evt` / `e` — bound only inside event handlers, which this
 *    resolver does not visit. When one appears in a render-scope expression it
 *    is either an inline callback parameter (the scope analyser sees the
 *    binding) or genuinely undeclared.
 *  - `context`, `ctx`, `metadata`, `record`, `idx`, `key`, `i` — no generator
 *    ever declares these names in a render body.
 *
 * Reserved words and literals (`true`, `null`, `undefined`, …) are filtered out
 * by the lexer itself and need no entry here.
 */
export const RENDER_SCOPE_IDENTIFIERS = new Set<string>([
  // The render function's own parameter
  'props',
  // Global-context values: the JSX emitter scans expressions for these
  // (GLOBAL_EXPRESSION_IDENTIFIERS in teleport-plugin-common node-to-jsx) and
  // injects the matching `useGlobalContext()` destructuring, so they are
  // always bound in the generated component — e.g. a navlink transitionTo of
  // `/profile/${currentUser?.id}` must not be blanked as unbound.
  'currentUser',
  'userIsLoggedIn',
  'ecommerce',
  'cart',
  'locale',
  'locales',
  // Browser globals
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'screen',
  'localStorage',
  'sessionStorage',
  'console',
  'fetch',
  'URL',
  'URLSearchParams',
  // Language built-ins
  'globalThis',
  'NaN',
  'Infinity',
  'JSON',
  'Math',
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Date',
  'RegExp',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Promise',
  'Symbol',
  'BigInt',
  'Error',
  'TypeError',
  'Function',
  'Proxy',
  'Reflect',
  'Intl',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURIComponent',
  'decodeURIComponent',
  'encodeURI',
  'decodeURI',
])

/**
 * Identifiers emitted by the code generator itself (hoisted constants, internal
 * helpers) are prefixed with `_` or `$`. Treat them as bound so we never touch
 * generator-authored expressions.
 */
export const isGeneratorInternalIdentifier = (identifier: string): boolean =>
  identifier.startsWith('_') || identifier.startsWith('$')
