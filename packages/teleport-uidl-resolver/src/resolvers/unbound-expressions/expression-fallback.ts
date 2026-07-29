/**
 * Recovers the literal an expression was authored to fall back to.
 *
 * Content bindings produced by the editor almost always carry a human-authored
 * default — `company?.name || "N/A"`, `featured?.image_url || "https://…"`.
 * When the reference at the head of such an expression turns out to be
 * unbound, dropping the WHOLE expression throws that default away and leaves an
 * empty cell / a broken `src`. Keeping the fallback preserves what the author
 * actually wanted to show when the data is missing — which is precisely the
 * situation an unbound reference represents.
 *
 * Only the tail of a top-level `||` / `??` chain is considered, and only when it
 * is a single string or number literal. Anything else (a call, a ternary, a
 * template with interpolations) is not a safe static substitute, so the caller
 * falls back to an empty value.
 */

import { skipStringLiteral, skipTemplateLiteral } from './expression-lexer'

const NUMERIC_LITERAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/

const STRING_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0',
}

const decodeStringLiteralBody = (body: string): string =>
  body.replace(/\\(.)/g, (_match, escaped: string) =>
    Object.prototype.hasOwnProperty.call(STRING_ESCAPES, escaped)
      ? STRING_ESCAPES[escaped]
      : escaped
  )

/**
 * True when a fallback operator (`||` or `??`) starts at `index`. A lone `?` is
 * either optional chaining or a ternary, and a lone `|` is bitwise — neither
 * introduces a fallback.
 */
const isFallbackOperatorAt = (expression: string, index: number): boolean => {
  const char = expression[index]
  const next = expression[index + 1]
  return (char === '|' && next === '|') || (char === '?' && next === '?')
}

/**
 * Index just past the last top-level `||` / `??` operator, or -1 when the
 * expression has none. Operators inside literals, parentheses, brackets or
 * braces are not top level — `a || (b ? 'x' : 'y')` has exactly one.
 */
const findLastFallbackOperator = (expression: string): number => {
  let depth = 0
  let index = 0
  let lastOperatorEnd = -1

  while (index < expression.length) {
    const char = expression[index]

    if (char === "'" || char === '"') {
      index = skipStringLiteral(expression, index)
      continue
    }
    if (char === '`') {
      index = skipTemplateLiteral(expression, index)
      continue
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1
      index += 1
      continue
    }
    if (char === ')' || char === ']' || char === '}') {
      depth -= 1
      index += 1
      continue
    }
    if (depth === 0 && isFallbackOperatorAt(expression, index)) {
      index += 2
      lastOperatorEnd = index
      continue
    }
    index += 1
  }

  return lastOperatorEnd
}

const parseLiteral = (text: string): string | null => {
  if (text.length === 0) {
    return null
  }

  const first = text[0]

  if (first === "'" || first === '"') {
    if (skipStringLiteral(text, 0) !== text.length || text[text.length - 1] !== first) {
      return null
    }
    return decodeStringLiteralBody(text.slice(1, -1))
  }

  if (first === '`') {
    if (skipTemplateLiteral(text, 0) !== text.length || text[text.length - 1] !== '`') {
      return null
    }
    const body = text.slice(1, -1)
    // A template with interpolations is not a literal — it still reads scope.
    if (body.indexOf('${') !== -1) {
      return null
    }
    return decodeStringLiteralBody(body)
  }

  if (NUMERIC_LITERAL.test(text)) {
    // `+1` is unary plus applied to `1`; the rendered text is just the number.
    return text[0] === '+' ? text.slice(1) : text
  }

  return null
}

/**
 * Returns the literal an expression falls back to, or `null` when it has no
 * literal fallback that can stand on its own.
 */
export const extractFallbackLiteral = (expression: string): string | null => {
  if (typeof expression !== 'string' || expression.length === 0) {
    return null
  }

  const operatorEnd = findLastFallbackOperator(expression)
  if (operatorEnd < 0) {
    return null
  }

  return parseLiteral(expression.slice(operatorEnd).trim())
}
