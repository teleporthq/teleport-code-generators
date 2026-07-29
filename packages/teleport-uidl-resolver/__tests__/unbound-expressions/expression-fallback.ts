import { extractFallbackLiteral } from '../../src/resolvers/unbound-expressions/expression-fallback'

describe('extractFallbackLiteral', () => {
  it('returns the string literal an expression falls back to', () => {
    expect(extractFallbackLiteral('company?.name || "N/A"')).toBe('N/A')
    expect(extractFallbackLiteral("deal?.stage || 'Unassigned'")).toBe('Unassigned')
    expect(extractFallbackLiteral('company?.logo ?? "https://cdn/placeholder.png"')).toBe(
      'https://cdn/placeholder.png'
    )
  })

  it('returns the last fallback of a chain', () => {
    expect(extractFallbackLiteral('a || b || "last"')).toBe('last')
    expect(extractFallbackLiteral('a ?? b ?? "last"')).toBe('last')
  })

  it('returns numeric fallbacks verbatim', () => {
    expect(extractFallbackLiteral('parseFloat(item.price) || 0')).toBe('0')
    expect(extractFallbackLiteral('item.ratio || 1.5')).toBe('1.5')
    expect(extractFallbackLiteral('item.delta || -1')).toBe('-1')
    expect(extractFallbackLiteral('item.delta || +1')).toBe('1')
  })

  it('accepts a template literal with no interpolation', () => {
    expect(extractFallbackLiteral('item.label || `Untitled`')).toBe('Untitled')
  })

  it('rejects a template literal that still reads scope', () => {
    // tslint:disable-next-line no-invalid-template-strings
    expect(extractFallbackLiteral('item.label || `${item.id}`')).toBeNull()
  })

  it('ignores operators that live inside literals', () => {
    expect(extractFallbackLiteral(`company?.size || "size || '-'"`)).toBe(`size || '-'`)
    expect(extractFallbackLiteral(`"a || b"`)).toBeNull()
  })

  it('ignores operators nested inside parentheses, brackets or braces', () => {
    expect(extractFallbackLiteral('fn(a || "inner")')).toBeNull()
    expect(extractFallbackLiteral('map[a || "inner"]')).toBeNull()
    expect(extractFallbackLiteral('{ key: a || "inner" }')).toBeNull()
  })

  it('rejects a fallback that is not a standalone literal', () => {
    expect(extractFallbackLiteral('company?.name || buildName(company)')).toBeNull()
    expect(extractFallbackLiteral(`company?.name || (a ? 'x' : 'y')`)).toBeNull()
    expect(extractFallbackLiteral('company?.flag || true')).toBeNull()
  })

  it('does not confuse optional chaining or a ternary with a nullish fallback', () => {
    expect(extractFallbackLiteral(`company?.name`)).toBeNull()
    expect(extractFallbackLiteral(`company ? 'yes' : 'no'`)).toBeNull()
  })

  it('decodes escape sequences in the literal', () => {
    expect(extractFallbackLiteral(`a || 'It\\'s here'`)).toBe("It's here")
    expect(extractFallbackLiteral('a || "line\\nbreak"')).toBe('line\nbreak')
  })

  it('returns null for empty or non-string input', () => {
    expect(extractFallbackLiteral('')).toBeNull()
    expect(extractFallbackLiteral(undefined as unknown as string)).toBeNull()
  })
})
