/**
 * JavaScript identifier safety for names that originate in the UIDL.
 *
 * A UIDL state / prop / global-state name is DATA. It is routinely derived from
 * a database column or a form field, so it can legally be any string — a WoW
 * character sheet really does have a column called `class`. The generators, on
 * the other hand, turn those names into JavaScript BINDINGS
 * (`const [class, setClass] = useState("")`), and `class` is a reserved word:
 * the emitted page does not parse, prettier throws
 * `SyntaxError: Unexpected token, expected "{"`, and the whole project build
 * dies before a single file is written.
 *
 * This module is the single place that maps "a name from the UIDL" to "a name
 * that is legal in identifier position".
 *
 * ## What is deliberately NOT renamed
 *
 * Only IDENTIFIER positions are sanitised. Everywhere a name is a STRING — the
 * `stateSetters` / `stateTypes` / `__stateValues` map keys the workflow runtime
 * looks up by `config.property`, an object-literal key, a `props.<name>` member
 * access — the original name is kept verbatim. Renaming those would silently
 * break every workflow binding written against the original name (the runtime
 * would log `no setter for "class"` and skip the update), which is a far worse
 * failure than the build error this module exists to prevent.
 *
 * ## Why a trailing underscore is collision-free
 *
 * Every state / prop name reaches the generators through
 * `StringUtils.createStateOrPropStoringValue`, i.e. `dashCaseToCamelCase`,
 * whose `/[-_]+(.)?/g` replacement removes EVERY underscore. So a normalised
 * name can never itself end in `_`, and `class` -> `class_` cannot collide with
 * a sibling name.
 */

/**
 * Words that may never be used as a binding name in the code we emit.
 *
 * Generated components are ES modules and therefore always strict mode, so the
 * strict-mode-only reserved words are as fatal as the unconditional ones.
 *
 * `undefined` is not a reserved word, but binding it shadows the value the
 * generators emit for "no value" (`t.identifier('undefined')`) throughout the
 * output, so it is treated as reserved here as well.
 */
export const RESERVED_JS_IDENTIFIERS: ReadonlySet<string> = new Set<string>([
  // Reserved in every context.
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  // Reserved in strict mode / modules — which is all generated output.
  'arguments',
  'await',
  'eval',
  'implements',
  'interface',
  'let',
  'package',
  'private',
  'protected',
  'public',
  'static',
  'yield',
  // Not reserved, but binding it breaks the generators' own emissions.
  'undefined',
])

/** Matches a complete, syntactically valid ECMAScript identifier (ASCII subset). */
const VALID_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** Matches the leading identifier of an id such as `class?.['spec']` or `fields.name`. */
const LEADING_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/

/** Every character that is illegal anywhere inside an identifier. */
const ILLEGAL_IDENTIFIER_CHARS_RE = /[^A-Za-z0-9_$]/g

/** Used when a name sanitises down to nothing at all (e.g. `"***"`). */
export const FALLBACK_JS_IDENTIFIER = '_value'

/** True when `name` is a reserved word that cannot be used as a binding. */
export const isReservedJSIdentifier = (name: string): boolean =>
  typeof name === 'string' && RESERVED_JS_IDENTIFIERS.has(name)

/**
 * True when `name` can be emitted verbatim in identifier position — i.e. it is
 * a syntactically valid identifier AND not a reserved word.
 */
export const isValidJSIdentifierName = (name: string): boolean =>
  typeof name === 'string' && VALID_IDENTIFIER_RE.test(name) && !RESERVED_JS_IDENTIFIERS.has(name)

/**
 * True when `name` can be an UNQUOTED object-literal key or a member access
 * after a dot. Reserved words qualify — `{ class: x }` and `props.class` are
 * both legal — so this is deliberately laxer than
 * {@link isValidJSIdentifierName}; only the identifier SYNTAX matters here.
 */
export const isValidPropertyKeyName = (name: string): boolean =>
  typeof name === 'string' && VALID_IDENTIFIER_RE.test(name)

/**
 * Map any UIDL-supplied name onto a name that is legal in binding position.
 *
 * Valid, non-reserved names are returned UNCHANGED, so this is a no-op for
 * every name the generators have ever produced — the emitted output only
 * differs for names that would not have compiled at all.
 *
 * Not injective in the general case (`a-b` and `a_b` both sanitise to `a_b`),
 * which is safe here because state / prop names are normalised through
 * `createStateOrPropStoringValue` first and therefore contain neither
 * character by the time a generator sees them.
 */
export const createSafeJSIdentifier = (
  name: string,
  fallback: string = FALLBACK_JS_IDENTIFIER
): string => {
  if (typeof name !== 'string' || name === '') {
    return fallback
  }

  if (isValidJSIdentifierName(name)) {
    return name
  }

  let safe = name.replace(ILLEGAL_IDENTIFIER_CHARS_RE, '_')
  if (/^[0-9]/.test(safe)) {
    safe = `_${safe}`
  }
  // `"***"` collapses to `"___"`, which is a legal identifier, so the only way
  // to reach an empty string here is an empty input — already handled above.
  if (safe === '') {
    return fallback
  }
  // Re-check AFTER the character pass: `"class"` survives it untouched, and
  // `"my class"` becomes `"my_class"` which is no longer reserved.
  return RESERVED_JS_IDENTIFIERS.has(safe) ? `${safe}_` : safe
}

/**
 * A property path is all that may follow the binding: optional chaining,
 * dotted access, or a bracket lookup. Anything else (a space, an operator, a
 * call) means the string is a hand-written EXPRESSION rather than a reference,
 * and rewriting its first word would corrupt it — `typeof x === 'string'` must
 * never become `typeof_ x === 'string'`.
 */
const PROPERTY_PATH_TAIL_RE = /^(\?\.|\.|\[)/

/**
 * Sanitise ONLY the leading identifier of an id that may already carry a
 * property path, leaving the path untouched:
 *
 *   `class`               -> `class_`
 *   `class?.['spec']`     -> `class_?.['spec']`
 *   `fields.name`         -> `fields.name`         (already legal — unchanged)
 *   `typeof x === 'y'`    -> `typeof x === 'y'`    (an expression — untouched)
 *
 * `UIDLUtils.generateIdWithRefPath` produces exactly the first three shapes,
 * and the JSX generators hand the whole string to `t.identifier(...)` and rely
 * on babel printing it verbatim. Only the head is a binding; the rest is member
 * access against real data keys and must keep its original spelling.
 */
export const createSafeJSIdentifierPath = (idWithPath: string): string => {
  if (typeof idWithPath !== 'string' || idWithPath === '') {
    return idWithPath
  }

  const match = LEADING_IDENTIFIER_RE.exec(idWithPath)
  if (!match) {
    // Does not start with an identifier at all (e.g. a numeric or empty head).
    // There is nothing safe to rewrite, so leave it for the caller's own
    // validation rather than inventing a binding.
    return idWithPath
  }

  const head = match[0]
  const tail = idWithPath.slice(head.length)
  if (tail !== '' && !PROPERTY_PATH_TAIL_RE.test(tail)) {
    return idWithPath
  }

  const safeHead = createSafeJSIdentifier(head)
  return safeHead === head ? idWithPath : `${safeHead}${tail}`
}
