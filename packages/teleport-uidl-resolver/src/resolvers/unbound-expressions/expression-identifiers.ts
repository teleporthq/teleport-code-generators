/**
 * Extracts the "root" reference identifiers used by a UIDL `expr` node so the
 * resolver can tell whether an expression references a variable that is not in
 * scope (and would therefore throw a `ReferenceError` at render time).
 *
 * A root reference is an identifier that is READ as a variable — e.g. `cat` in
 * `cat.name`, `item` in `` `/edit/${item?.id}` ``, or `params` in
 * `params['id']`. Property names (the `name` in `cat.name`), string-literal
 * contents, and language keywords are NOT roots.
 *
 * The extractor is a small hand-written lexer rather than a full parser so the
 * resolver package stays dependency-free. It only needs to be correct enough to
 * find the leading identifier of every member/call/index expression while
 * ignoring string and template-literal text — which is exactly what
 * distinguishes a genuine unbound reference from an incidental word inside a
 * quoted JSON blob such as
 * `JSON.stringify([{ "type": "condition", "source": "id" }])`.
 */

const IDENTIFIER_START = /[A-Za-z_$]/
const IDENTIFIER_PART = /[A-Za-z0-9_$]/

/**
 * Words that are valid identifiers to the lexer but are language keywords or
 * literals, never a variable reference we could neutralise.
 */
const RESERVED_WORDS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'this',
  'super',
  'new',
  'delete',
  'void',
  'typeof',
  'instanceof',
  'in',
  'of',
  'do',
  'if',
  'else',
  'for',
  'while',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'return',
  'function',
  'var',
  'let',
  'const',
  'class',
  'extends',
  'yield',
  'await',
  'async',
  'throw',
  'try',
  'catch',
  'finally',
  'import',
  'export',
  'from',
  'as',
  'with',
  'debugger',
])

const isWhitespace = (char: string): boolean =>
  char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f' || char === '\v'

/**
 * True when the next non-whitespace character starting at `from` is a single
 * `:` (an object-literal key separator, not the `::` of a type/label). Used to
 * tell `{ active: item.x }` (key) apart from `cond ? item : other` (reference).
 */
const nextNonWhitespaceIsColon = (code: string, from: number): boolean => {
  let index = from
  while (index < code.length && isWhitespace(code[index])) {
    index += 1
  }
  return code[index] === ':' && code[index + 1] !== ':'
}

const skipStringLiteral = (code: string, start: number): number => {
  const quote = code[start]
  let index = start + 1
  while (index < code.length) {
    const char = code[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === quote) {
      return index + 1
    }
    index += 1
  }
  return index
}

/**
 * Reads a template literal starting at the backtick under `start`. Static text
 * is ignored; every `${ ... }` interpolation is recursively scanned for roots.
 * Returns the index just past the closing backtick.
 */
const scanTemplateLiteral = (code: string, start: number, roots: Set<string>): number => {
  let index = start + 1
  while (index < code.length) {
    const char = code[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '`') {
      return index + 1
    }
    if (char === '$' && code[index + 1] === '{') {
      const interpolationStart = index + 2
      let depth = 1
      let cursor = interpolationStart
      while (cursor < code.length && depth > 0) {
        const inner = code[cursor]
        if (inner === '{') {
          depth += 1
        } else if (inner === '}') {
          depth -= 1
          if (depth === 0) {
            break
          }
        } else if (inner === '`') {
          cursor = scanTemplateLiteral(code, cursor, roots) - 1
        } else if (inner === "'" || inner === '"') {
          cursor = skipStringLiteral(code, cursor) - 1
        }
        cursor += 1
      }
      collectRootIdentifiers(code.slice(interpolationStart, cursor), roots)
      index = cursor + 1
      continue
    }
    index += 1
  }
  return index
}

const collectRootIdentifiers = (code: string, roots: Set<string>): void => {
  let index = 0
  // Last non-whitespace character seen — used to tell a member access
  // (`.name`, `?.name`) apart from a root reference.
  let previousSignificant = ''

  while (index < code.length) {
    const char = code[index]

    if (isWhitespace(char)) {
      index += 1
      continue
    }

    if (char === "'" || char === '"') {
      index = skipStringLiteral(code, index)
      previousSignificant = '"'
      continue
    }

    if (char === '`') {
      index = scanTemplateLiteral(code, index, roots)
      previousSignificant = '`'
      continue
    }

    if (IDENTIFIER_START.test(char)) {
      let end = index + 1
      while (end < code.length && IDENTIFIER_PART.test(code[end])) {
        end += 1
      }
      const identifier = code.slice(index, end)
      const isMemberAccess = previousSignificant === '.'
      // An unquoted object-literal key (`{ key: ... }` / `, key: ...`) is a
      // property name, not a variable read.
      const isObjectKey =
        (previousSignificant === '{' || previousSignificant === ',') &&
        nextNonWhitespaceIsColon(code, end)
      if (!isMemberAccess && !isObjectKey && !RESERVED_WORDS.has(identifier)) {
        roots.add(identifier)
      }
      index = end
      previousSignificant = 'a'
      continue
    }

    previousSignificant = char
    index += 1
  }
}

/**
 * Returns the set of root reference identifiers read by an expression string.
 */
export const extractRootIdentifiers = (expression: string): Set<string> => {
  const roots = new Set<string>()
  if (typeof expression === 'string' && expression.length > 0) {
    collectRootIdentifiers(expression, roots)
  }
  return roots
}
