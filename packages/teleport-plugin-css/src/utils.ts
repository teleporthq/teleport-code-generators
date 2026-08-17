import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { PluginCSS, UIDLConditionExpressionEntry, UIDLPropDefinition } from '@teleporthq/teleport-types'

export const createConditionalStatement = (
  conditions: UIDLConditionExpressionEntry[],
  leftOperand: UIDLPropDefinition['defaultValue']
) => {
  return conditions.map((condition) => {
    const { operation, operand } = condition

    if (operand === undefined) {
      return `${ASTUtils.convertToUnaryOperator(operation)}${getValueType(operand)}`
    }

    return `${getValueType(leftOperand)} ${ASTUtils.convertToBinaryOperator(
      operation
    )} ${getValueType(operand)}`
  })
}

/**
 * Balance parentheses inside a single CSS selector "prelude" (the text before a
 * `{`). Drops unmatched `)` and closes unmatched `(`, while leaving quoted
 * strings untouched. Valid balanced parens (`:not(.x)`, `:nth-child(2n+1)`,
 * attribute values containing `)`) are preserved byte-for-byte.
 */
const balanceSelectorParens = (prelude: string): string => {
  let depth = 0
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < prelude.length; i++) {
    const ch = prelude[i]
    // A backslash escapes the next char (e.g. an escaped `\(` / `\)` inside a
    // class name) — copy both verbatim so escaped parens are never counted.
    if (ch === '\\' && i + 1 < prelude.length) {
      out += ch + prelude[i + 1]
      i++
      continue
    }
    if (quote) {
      out += ch
      if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      out += ch
      continue
    }
    if (ch === '(') {
      depth++
      out += ch
      continue
    }
    if (ch === ')') {
      if (depth === 0) {
        // Unmatched closing paren — drop it. A stray `)` in a selector makes the
        // production cssnano selector parser throw "Expected an opening
        // parenthesis", failing the whole `next build` even though dev tolerates it.
        continue
      }
      depth--
      out += ch
      continue
    }
    out += ch
  }
  if (depth > 0) {
    out += ')'.repeat(depth)
  }
  return out
}

/**
 * Repairs unbalanced parentheses in every selector of a generated stylesheet so a
 * single malformed AI-authored selector (e.g. `.card:hover) { … }`) can't break
 * the consumer's production build. Only selector preludes (text immediately
 * before each `{`) are touched; declaration blocks and quoted strings are left
 * exactly as-is. Idempotent and a no-op for well-formed CSS.
 */
export const sanitizeStylesheetSelectors = (css: string): string => {
  let out = ''
  let segStart = 0
  let quote: string | null = null
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (ch === '\\') {
      // Skip the escaped char so an escaped `\{` / `\}` / `\"` is never read as a
      // block boundary or quote delimiter.
      i++
      continue
    }
    if (quote) {
      if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '{') {
      out += balanceSelectorParens(css.slice(segStart, i)) + ch
      segStart = i + 1
    } else if (ch === '}') {
      out += css.slice(segStart, i) + ch
      segStart = i + 1
    }
  }
  out += css.slice(segStart)
  return out
}

const getValueType = (value: UIDLPropDefinition['defaultValue']) => {
  const valueType = typeof value
  switch (valueType) {
    case 'string':
      return `"${value}"`
    case 'number':
      return value
    case 'boolean':
      return value
    default:
      throw new PluginCSS(
        `Conditional node received an operand of type ${valueType} \n
            Received ${JSON.stringify(value)}`
      )
  }
}
