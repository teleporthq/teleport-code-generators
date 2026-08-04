import * as types from '@babel/types'
import generate from '@babel/generator'
import { parseStringWithTemplateExpressions } from '../../src/utils/ast-utils'

/** The generated source for a template literal, e.g. "`translateX(${x}px)`". */
const render = (input: string): string =>
  generate(parseStringWithTemplateExpressions(input) as types.Node).code

describe('parseStringWithTemplateExpressions', () => {
  it('converts a well-formed binding and strips the state prefix', () => {
    expect(render(`translate({{ enemy.x || '0' }}px)`)).toBe(`\`translate(\${enemy.x || '0'}px)\``)
    expect(render(`translateX({{ -(state.cameraX || 0) }}px)`)).toBe(
      `\`translateX(\${-(cameraX || 0)}px)\``
    )
  })

  it('handles several bindings in one value', () => {
    expect(render(`translate({{ ctx.x }}px, {{ ctx.y }}px)`)).toBe(
      `\`translate(\${ctx.x}px, \${ctx.y}px)\``
    )
  })

  it('re-closes a CSS function the binding genuinely swallowed', () => {
    // The unit is inferred from the one already present.
    expect(render(`translate({{ x }}px, {{ y`)).toBe(`\`translate(\${x}px, \${y}px)\``)
  })

  it('infers deg for rotate and no unit for scale', () => {
    expect(render(`rotate({{ a`)).toBe(`\`rotate(\${a}deg)\``)
    expect(render(`scale({{ s`)).toBe(`\`scale(\${s})\``)
  })
})

/**
 * Run 021fa45a — an upstream "repair" turned `{{ -(state.cameraX || 0) }}` into
 * `{{ -(state.cameraX || '' }}`, dropping the closing paren. This function then
 * counted parentheses across the WHOLE string, mistook the imbalance inside the
 * interpolation for an unclosed CSS function, appended `px)` to the end, and
 * handed Babel `` `translateX(${-(cameraX || ''}px) }px)` ``. The SyntaxError
 * escaped through the inline-style caller (which has no try/catch) and killed
 * the entire project build.
 */
describe('parseStringWithTemplateExpressions — a malformed binding must not break the build', () => {
  const BROKEN = `translateX({{ -(state.cameraX || '' }}px) }`

  it('does not throw on the exact UIDL value that killed the build', () => {
    expect(() => parseStringWithTemplateExpressions(BROKEN)).not.toThrow()
  })

  it('repairs it INSIDE the interpolation, where the paren was missing', () => {
    expect(render(BROKEN)).toBe(`\`translateX(\${-(cameraX || '')}px) }\``)
  })

  it('no longer appends a fabricated unit and paren to the end', () => {
    expect(render(BROKEN)).not.toContain('px)`')
  })

  it('closes an unterminated quote inside a binding', () => {
    expect(render(`{{ label || 'Guest }}`)).toBe(`\`\${label || 'Guest'}\``)
  })

  it('degrades to the declared literal fallback when nothing can be parsed', () => {
    // A stray closer cannot be balanced without guessing, so the binding is
    // dropped and its literal fallback kept — one value degrades, nothing throws.
    const result = render(`{{ name) || 'Guest' }}`)
    expect(result).toBe('`Guest`')
  })

  it('degrades to empty text when a broken binding declared no fallback', () => {
    expect(render(`{{ a) }}`)).toBe('``')
  })

  it('always returns a TemplateLiteral, even on the degraded path', () => {
    expect(types.isTemplateLiteral(parseStringWithTemplateExpressions(`{{ a) }}`))).toBe(true)
  })

  it('is idempotent on an already-repaired value', () => {
    const once = render(BROKEN)
    // Feeding the generated form back in (minus the backticks) is stable.
    expect(render(once.slice(1, -1))).toBe(once)
  })
})
