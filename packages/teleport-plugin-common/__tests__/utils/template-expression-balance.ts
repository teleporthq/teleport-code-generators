import {
  balanceExpression,
  countUnclosedStaticParens,
  isBalancedExpression,
  scanExpression,
} from '../../src/utils/template-expression-balance'

describe('scanExpression', () => {
  it('reports a clean expression as fully closed', () => {
    const scan = scanExpression('-(cameraX || 0)')
    expect(scan.unclosed).toEqual([])
    expect(scan.strayCloserCount).toBe(0)
    expect(scan.unterminatedQuote).toBeNull()
  })

  it('never lets a bracket inside a string affect nesting', () => {
    expect(isBalancedExpression(`name || '(unclosed'`)).toBe(true)
    expect(isBalancedExpression(`name || ')'`)).toBe(true)
  })

  it('honours escapes inside a string', () => {
    expect(isBalancedExpression(`name || 'it\\'s fine'`)).toBe(true)
  })

  it('reports an unterminated quote', () => {
    expect(scanExpression(`name || 'oops`).unterminatedQuote).toBe("'")
  })

  it('counts a closer that never had an opener as stray', () => {
    expect(scanExpression('0)').strayCloserCount).toBe(1)
  })

  it('treats a mismatched closer as stray rather than guessing', () => {
    expect(scanExpression('fn(a]').strayCloserCount).toBe(1)
  })
})

describe('balanceExpression', () => {
  it('closes the paren the upstream repair dropped', () => {
    expect(balanceExpression(`-(cameraX || ''`)).toBe(`-(cameraX || '')`)
  })

  it('closes an unterminated quote BEFORE the brackets around it', () => {
    expect(balanceExpression(`fn(x, 'label`)).toBe(`fn(x, 'label')`)
  })

  it('closes nested brackets outermost-last', () => {
    expect(balanceExpression('fn(items[0')).toBe('fn(items[0])')
  })

  it('leaves a balanced expression byte-for-byte alone', () => {
    for (const expr of [`-(cameraX || 0)`, `a.b`, `items[0].name`, `fn(a, 'b')`]) {
      expect(balanceExpression(expr)).toBe(expr)
    }
  })

  it('refuses to guess where a missing opener belonged', () => {
    expect(balanceExpression('cameraX)')).toBe('cameraX)')
  })
})

describe('countUnclosedStaticParens', () => {
  it('ignores parentheses inside an interpolation', () => {
    // The whole point: the `(` in the expression is not a CSS function call.
    expect(countUnclosedStaticParens(`translateX(\${-(cameraX || 0)}px)`)).toBe(0)
  })

  it('counts a genuinely unclosed CSS function', () => {
    expect(countUnclosedStaticParens(`translate(\${x}px, \${y}px`)).toBe(1)
  })

  it('does not go negative on extra closers', () => {
    expect(countUnclosedStaticParens(`\${x}px))`)).toBe(0)
  })

  it('skips a brace inside a string inside an interpolation', () => {
    expect(countUnclosedStaticParens(`translateX(${'${'}fn('}')${'}'}px)`)).toBe(0)
  })

  it('tolerates an unterminated interpolation', () => {
    expect(countUnclosedStaticParens(`translateX(\${-(cameraX`)).toBe(1)
  })
})
