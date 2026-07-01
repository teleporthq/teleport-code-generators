/**
 * Root identifiers that are always in scope inside a generated component and
 * therefore can never be an "unbound" reference:
 *
 *  - values the code generator injects into the render scope (`props`, `state`,
 *    `event`, `params`, `context`, `metadata`, and common map callback vars),
 *  - standard JavaScript globals / built-ins.
 *
 * Iterator variables introduced by repeaters (`item`, `kpi`, ...) are NOT
 * listed here — they are tracked positionally as the walker descends into a
 * repeater's subtree, so an iterator reference that escapes its repeater is
 * still correctly flagged as unbound.
 */
export const AMBIENT_IDENTIFIERS = new Set<string>([
  // Code-generator provided render-scope values
  'props',
  'state',
  'context',
  'ctx',
  'metadata',
  'record',
  // Event handler / map callback parameters
  'event',
  'evt',
  'e',
  'params',
  'index',
  'idx',
  'key',
  'i',
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
  'undefined',
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
