import { StringUtils } from '@teleporthq/teleport-shared'
import { UIDLStaticValue, UIDLStyleDefinitions, UIDLStyleValue } from '@teleporthq/teleport-types'

const CSS_FUNCTIONS = [
  'radial-gradient',
  'linear-gradient',
  'conic-gradient',
  'repeating-linear-gradient',
  'repeating-radial-gradient',
  'repeating-conic-gradient',
]

// CSS `content` property has the strictest value grammar of any
// property the AI emits: it must be either a quoted string, one of
// a fixed set of keywords, or a recognised function call. The AI
// occasionally produces garbage here (e.g. the raw fragment `';`
// straight out of a hallucinated declaration), and the
// downstream JSS serializer happily concatenates that into
// `content: ';;` — a CSS parse error that breaks the entire
// stylesheet on Next.js dev (the browser stops applying any rule
// after the malformed one). When we can't recognise the value as
// valid, we fall back to an empty string literal — losing the
// decoration but keeping the stylesheet parseable.
const CONTENT_KEYWORDS = new Set([
  'none',
  'normal',
  'open-quote',
  'close-quote',
  'no-open-quote',
  'no-close-quote',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
])

const CONTENT_FUNCTION_PREFIXES = [
  'attr(',
  'counter(',
  'counters(',
  'var(',
  'url(',
  'image(',
  'image-set(',
  'linear-gradient(',
  'radial-gradient(',
  'conic-gradient(',
]

const isProperlyQuotedString = (value: string): boolean => {
  if (value.length < 2) {
    return false
  }
  const first = value.charAt(0)
  const last = value.charAt(value.length - 1)
  if (first !== last) {
    return false
  }
  if (first !== '"' && first !== "'") {
    return false
  }
  // Walk the interior and reject unescaped occurrences of the same
  // quote character — those would close the string early and leak
  // arbitrary CSS into the surrounding stylesheet.
  for (let i = 1; i < value.length - 1; i++) {
    const ch = value.charAt(i)
    if (ch === '\\') {
      i++ // skip the escaped character
      continue
    }
    if (ch === first) {
      return false
    }
  }
  return true
}

export const sanitizeContentValue = (raw: string): string => {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return "''"
  }
  if (CONTENT_KEYWORDS.has(trimmed)) {
    return trimmed
  }
  for (const prefix of CONTENT_FUNCTION_PREFIXES) {
    if (trimmed.startsWith(prefix) && trimmed.endsWith(')')) {
      return trimmed
    }
  }
  if (isProperlyQuotedString(trimmed)) {
    return trimmed
  }
  // Last-resort repair: strip every quote and semicolon (the two
  // characters that break the surrounding rule) and wrap the
  // remainder in single quotes. If nothing legible survives, fall
  // through to an empty string. We deliberately do NOT try to
  // preserve "almost a quoted string" inputs — the AI's malformed
  // emissions don't have a clear repair path and silently keeping
  // them risks injecting CSS the user didn't author.
  const stripped = trimmed.replace(/['";]/g, '').trim()
  return "'" + stripped + "'"
}

const isValidCSSValue = (value: string | number, key?: string): boolean => {
  if (typeof value === 'number') {
    return true
  }

  // Check for CSS functions that are missing their parentheses (e.g. "radial-gradientfoo")
  for (const fn of CSS_FUNCTIONS) {
    if (value.includes(fn) && !value.includes(`${fn}(`)) {
      return false
    }
  }

  // The `content` property is treated separately by
  // `sanitizeContentValue` — it has its own grammar (quoted string
  // OR keyword OR function call) that the general colon/paren
  // check below would mis-evaluate for a legitimate quoted string
  // that happens to contain a `:`.
  if (key === 'content') {
    return true
  }

  // Check for values that contain embedded CSS declarations (e.g. "valueproperty-name: other")
  // A colon in a CSS value normally only appears inside url() or var() or similar functions.
  // If a colon appears outside of parentheses, the value is likely corrupted.
  //
  // Parentheses and colons inside a quoted string (e.g. a `url("data:...(...)")`
  // data-URI or a `font-family: "Foo (Bold)"`) are literal text, not syntax, so
  // the scan tracks the active quote and ignores everything inside it.
  let parenDepth = 0
  let quote = ''
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (quote) {
      if (char === quote && value[i - 1] !== '\\') {
        quote = ''
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
    } else if (char === '(') {
      parenDepth++
    } else if (char === ')') {
      parenDepth--
      // A closing paren with no matching opener means the value is corrupted.
      if (parenDepth < 0) {
        return false
      }
    } else if (char === ':' && parenDepth === 0) {
      // Colons outside parentheses in a CSS value indicate a corrupted/merged declaration
      return false
    }
  }

  // Unbalanced parentheses leave an unclosed CSS function — e.g. a stream that
  // was truncated mid-value (`color-mix(in srgb, var(--color-surface) 50%,`).
  // Emitting it produces `color: color-mix(...50%,;` which fails the CSS parser
  // and breaks the whole stylesheet (and the Next.js production build).
  if (parenDepth !== 0) {
    return false
  }

  return true
}

const getContentOfStyleKey = (styleValue: UIDLStyleValue) => {
  if (styleValue.type === 'static') {
    return styleValue.content
  }
  throw new Error(
    `getContentOfStyleKey received unsupported ${JSON.stringify(
      styleValue,
      null,
      2
    )} UIDLNodeStyleValue value`
  )
}

export const getContentOfStyleObject = (styleObject: UIDLStyleDefinitions) => {
  return Object.keys(styleObject).reduce((acc: Record<string, unknown>, key) => {
    const value = getContentOfStyleKey(styleObject[key])
    if (typeof value === 'string' || typeof value === 'number') {
      if (isValidCSSValue(value, key)) {
        // The `content` CSS property is the only one in the AI's
        // typical output that consistently arrives malformed — the
        // sanitiser repairs or empty-strings it so the surrounding
        // rule stays parseable.
        if (key === 'content' && typeof value === 'string') {
          acc[key] = sanitizeContentValue(value)
        } else {
          acc[key] = value
        }
      }
    } else {
      acc[key] = value
    }
    return acc
  }, {})
}

export const getTokensContentFromTokensObject = (tokens: Record<string, UIDLStaticValue>) => {
  return Object.keys(tokens || {}).reduce((acc: Record<string, string | number>, key) => {
    acc[StringUtils.generateCSSVariableName(key)] = tokens[key].content as string
    return acc
  }, {})
}

export const getCSSVariablesContentFromTokenStyles = (styleObject: UIDLStyleDefinitions) => {
  return Object.keys(styleObject || {}).reduce((acc: Record<string, string>, key) => {
    const style = styleObject[key]
    if (style.type === 'dynamic' && style.content.referenceType === 'token') {
      acc[key] = `var(${StringUtils.generateCSSVariableName(style.content.id)})`
    }
    return acc
  }, {})
}
