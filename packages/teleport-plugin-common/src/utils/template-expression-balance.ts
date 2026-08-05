/**
 * Delimiter balancing for `{{ … }}` binding expressions.
 *
 * THE DEFECT THIS EXISTS FOR. `parseStringWithTemplateExpressions` converted a
 * UIDL string into a template literal and then handed the result straight to
 * Babel. When the binding inside was unbalanced the produced source did not
 * parse, `parse()` threw, and — because the inline-style caller has no
 * try/catch — the SyntaxError escaped all the way out and killed the ENTIRE
 * project build:
 *
 *     const x = `translateX(${-(cameraX || ''}px) }px)`
 *                                          ^ Unexpected token, expected ","
 *
 * Two separate faults produced that line. The interpolated expression
 * `-(cameraX || ''` was missing its closing paren, and the "re-close the CSS
 * function" step counted parentheses across the WHOLE string — including the
 * ones inside `${…}` — decided one was missing, and appended `px)` to the end,
 * which could never help because the imbalance was inside the interpolation.
 *
 * One bad binding in one style property must never cost a project its build.
 * These helpers make the imbalance repairable where it actually is, and let the
 * caller degrade a single value instead of aborting.
 */

/** Closing delimiter for each opener that nests inside an expression. */
const CLOSER_FOR_OPENER: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
}

const CLOSERS = new Set(Object.values(CLOSER_FOR_OPENER))
const QUOTES = new Set(["'", '"', '`'])

export interface ExpressionScan {
  /** Openers still waiting for their closer, outermost first. */
  unclosed: string[]
  /** Closers that never had a matching opener. */
  strayCloserCount: number
  /** The quote character still open at the end of the scan, if any. */
  unterminatedQuote: string | null
}

/**
 * Single left-to-right pass over an expression, quote and escape aware.
 * Characters inside a string literal never affect nesting.
 */
export const scanExpression = (expression: string): ExpressionScan => {
  const unclosed: string[] = []
  let strayCloserCount = 0
  let quote: string | null = null

  for (let index = 0; index < expression.length; index++) {
    const char = expression[index]

    if (char === '\\') {
      index++
      continue
    }

    if (quote !== null) {
      if (char === quote) {
        quote = null
      }
      continue
    }

    if (QUOTES.has(char)) {
      quote = char
      continue
    }

    if (CLOSER_FOR_OPENER[char]) {
      unclosed.push(char)
      continue
    }

    if (CLOSERS.has(char)) {
      const expected = unclosed.length > 0 ? CLOSER_FOR_OPENER[unclosed[unclosed.length - 1]] : null
      if (expected === char) {
        unclosed.pop()
      } else {
        strayCloserCount++
      }
    }
  }

  return { unclosed, strayCloserCount, unterminatedQuote: quote }
}

/** True when every quote and bracket closes and no closer is stray. */
export const isBalancedExpression = (expression: string): boolean => {
  const scan = scanExpression(expression)
  return (
    scan.unclosed.length === 0 && scan.strayCloserCount === 0 && scan.unterminatedQuote === null
  )
}

/**
 * Close an expression that ends mid-quote or mid-bracket:
 * `-(cameraX || ''` → `-(cameraX || '')`.
 *
 * Returns the expression unchanged when it is already balanced, and when the
 * imbalance is a STRAY CLOSER — appending cannot fix a missing opener, and
 * inventing one would be a guess.
 */
export const balanceExpression = (expression: string): string => {
  const scan = scanExpression(expression)
  if (scan.strayCloserCount > 0) {
    return expression
  }
  if (scan.unclosed.length === 0 && scan.unterminatedQuote === null) {
    return expression
  }

  const suffix = [scan.unterminatedQuote || '', ...unclosedInReverse(scan.unclosed)].join('')

  return expression + suffix
}

const unclosedInReverse = (unclosed: string[]): string[] =>
  unclosed
    .slice()
    .reverse()
    .map((opener) => CLOSER_FOR_OPENER[opener])

/**
 * Parenthesis balance of the STATIC parts of a template string — everything
 * outside `${…}`.
 *
 * This is the number the "re-close the CSS function" step needs. Counting over
 * the whole string mixes in the expressions' own parentheses, so an imbalance
 * INSIDE an interpolation reads as a missing close on the CSS function and the
 * step appends a unit and a `)` that belong nowhere.
 */
export const countUnclosedStaticParens = (templateStr: string): number => {
  let depth = 0
  let index = 0

  while (index < templateStr.length) {
    if (templateStr[index] === '$' && templateStr[index + 1] === '{') {
      index = skipInterpolation(templateStr, index + 2)
      continue
    }
    if (templateStr[index] === '(') {
      depth++
    } else if (templateStr[index] === ')') {
      depth--
    }
    index++
  }

  return depth > 0 ? depth : 0
}

/**
 * Index just past the `}` that closes an interpolation opened at `start`.
 * Tracks nested braces and string literals so `${ {a:'}'} }` is skipped whole.
 * An unterminated interpolation consumes the rest of the string.
 */
const skipInterpolation = (templateStr: string, start: number): number => {
  let depth = 1
  let quote: string | null = null

  for (let index = start; index < templateStr.length; index++) {
    const char = templateStr[index]

    if (char === '\\') {
      index++
      continue
    }

    if (quote !== null) {
      if (char === quote) {
        quote = null
      }
      continue
    }

    if (QUOTES.has(char)) {
      quote = char
      continue
    }

    if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0) {
        return index + 1
      }
    }
  }

  return templateStr.length
}
