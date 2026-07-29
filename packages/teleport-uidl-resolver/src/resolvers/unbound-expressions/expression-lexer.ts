/**
 * Low-level scanning primitives shared by the expression analysers in this
 * folder (`expression-identifiers` and `expression-fallback`).
 *
 * UIDL `expr` nodes carry arbitrary JavaScript as a string. Both analysers need
 * to walk that string while *ignoring* the text inside string and template
 * literals — otherwise an incidental word inside a quoted blob such as
 * `JSON.stringify([{ "type": "condition", "source": "id" }])` would be mistaken
 * for a variable reference, and a `||` inside `"a || b"` for a real operator.
 *
 * These helpers are a hand-written lexer rather than a full parser so the
 * resolver package stays dependency-free. They only need to be correct about
 * literal boundaries and identifier spelling, which is exactly what the two
 * analysers depend on.
 */

export const IDENTIFIER_START = /[A-Za-z_$]/
export const IDENTIFIER_PART = /[A-Za-z0-9_$]/

/**
 * Words that are valid identifiers to the lexer but are language keywords or
 * literals, never a variable reference we could neutralise.
 */
export const RESERVED_WORDS = new Set([
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

export const isWhitespace = (char: string): boolean =>
  char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f' || char === '\v'

/**
 * Reads the identifier that starts at `start`. The caller must have checked
 * that `code[start]` matches `IDENTIFIER_START`.
 */
export const readIdentifier = (code: string, start: number): string => {
  let end = start + 1
  while (end < code.length && IDENTIFIER_PART.test(code[end])) {
    end += 1
  }
  return code.slice(start, end)
}

/**
 * Returns the index just past the closing quote of the string literal that
 * starts at `start` (or the end of the input for an unterminated literal).
 */
export const skipStringLiteral = (code: string, start: number): number => {
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
 * Returns the index just past the closing backtick of the template literal that
 * starts at `start`. Static text is skipped; the body of every `${ ... }`
 * interpolation is handed to `onInterpolation` so the caller can analyse it
 * with the full scanner (nested templates, strings and objects included).
 */
export const skipTemplateLiteral = (
  code: string,
  start: number,
  onInterpolation?: (fragment: string) => void
): number => {
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
          cursor = skipTemplateLiteral(code, cursor) - 1
        } else if (inner === "'" || inner === '"') {
          cursor = skipStringLiteral(code, cursor) - 1
        }
        cursor += 1
      }
      if (onInterpolation) {
        onInterpolation(code.slice(interpolationStart, cursor))
      }
      index = cursor + 1
      continue
    }
    index += 1
  }
  return index
}
