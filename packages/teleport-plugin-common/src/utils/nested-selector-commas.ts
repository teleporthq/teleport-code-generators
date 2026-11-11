/* The nesting step of the stylesheet builder splits a nested selector on EVERY
   comma and repeats the parent in front of each piece. A comma inside
   brackets or quotes is not a selector list: `& > a:is(.x, .y)` came out as
   `.root > a:is(.x, .root .y)` and `&[data-x="a, b"]` as
   `.root[data-x="a, .root b"]`. Such commas are swapped for a placeholder
   before the builder sees the selector and put back in the text it produces.
   A comma at the top level still separates a list, each piece getting the
   parent. */
const COMMA_PLACEHOLDER = ''

const OPENING_BRACKETS = new Set(['(', '['])
const CLOSING_BRACKETS = new Set([')', ']'])
const QUOTES = new Set(['"', "'"])

const maskBracketedCommas = (selector: string): string => {
  let masked = ''
  let depth = 0
  let openQuote: string | null = null

  for (let index = 0; index < selector.length; index++) {
    const char = selector[index]

    if (char === '\\') {
      masked += char + (selector[index + 1] ?? '')
      index++
      continue
    }

    if (openQuote) {
      if (char === openQuote) {
        openQuote = null
      }
      masked += char === ',' ? COMMA_PLACEHOLDER : char
      continue
    }

    if (QUOTES.has(char)) {
      openQuote = char
    } else if (OPENING_BRACKETS.has(char)) {
      depth++
    } else if (CLOSING_BRACKETS.has(char)) {
      depth = Math.max(0, depth - 1)
    }

    masked += char === ',' && depth > 0 ? COMMA_PLACEHOLDER : char
  }

  return masked
}

type NestedStyles = { [key: string]: string | number | NestedStyles }

const maskNestedKeys = (styles: NestedStyles): NestedStyles =>
  Object.keys(styles).reduce((acc: NestedStyles, key) => {
    const value = styles[key]
    if (value !== null && typeof value === 'object') {
      acc[maskBracketedCommas(key)] = maskNestedKeys(value)
    } else {
      acc[key] = value
    }
    return acc
  }, {})

/* `rules` maps a rule name to its declarations; any key below that level whose
   value is an object is a nested selector. `build` receives the rules with
   those selectors masked and returns the CSS text, which comes back with the
   commas restored. Input that already holds the placeholder (an icon font's
   glyph in `content`, say) is built as it is, so nothing of the author's is
   ever rewritten. */
export const buildWithBracketedCommasKept = <T extends Record<string, unknown>>(
  rules: T,
  build: (maskedRules: T) => string
): string => {
  if (JSON.stringify(rules).includes(COMMA_PLACEHOLDER)) {
    return build(rules)
  }

  const maskedRules = Object.keys(rules).reduce((acc: Record<string, unknown>, ruleName) => {
    const declarations = rules[ruleName]
    acc[ruleName] =
      declarations !== null && typeof declarations === 'object'
        ? maskNestedKeys(declarations as NestedStyles)
        : declarations
    return acc
  }, {}) as T

  return build(maskedRules).split(COMMA_PLACEHOLDER).join(',')
}
