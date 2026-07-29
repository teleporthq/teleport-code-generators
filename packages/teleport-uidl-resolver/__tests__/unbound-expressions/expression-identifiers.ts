import { analyzeExpressionScope } from '../../src/resolvers/unbound-expressions/expression-identifiers'

const roots = (expression: string): string[] =>
  Array.from(analyzeExpressionScope(expression).freeIdentifiers).sort()

const isResolvable = (expression: string): boolean => analyzeExpressionScope(expression).resolvable

describe('analyzeExpressionScope', () => {
  it('returns the leading identifier of a member expression', () => {
    expect(roots('cat.name')).toEqual(['cat'])
    expect(roots('loc.location_id')).toEqual(['loc'])
  })

  it('ignores property names accessed via dot and optional chaining', () => {
    expect(roots('item?.id')).toEqual(['item'])
    expect(roots('props.inventoryItem?.name')).toEqual(['props'])
    expect(roots('event.target.value')).toEqual(['event'])
  })

  it('does not treat words inside string literals as identifiers', () => {
    expect(roots('item?.name || "Item"')).toEqual(['item'])
    expect(roots("tx?.transaction_type || 'Adjustment'")).toEqual(['tx'])
  })

  it('handles quoted JSON blobs without leaking string keys/values', () => {
    const expression =
      'JSON.stringify([{"type":"condition","source":"id","destination":params[\'id\'],"operand":"="}])'
    expect(roots(expression)).toEqual(['JSON', 'params'])
  })

  it('extracts identifiers from template-literal interpolations only', () => {
    // tslint:disable no-invalid-template-strings
    expect(roots('`/edit-inventory-item/${item?.id}`')).toEqual(['item'])
    expect(roots('`/edit-inventory-item/[id]`')).toEqual([])
    expect(roots('`${cat.name} - ${loc.city}`').sort()).toEqual(['cat', 'loc'])
    // tslint:enable no-invalid-template-strings
  })

  it('collects call-argument references but not property method names', () => {
    expect(roots('Math.max(a, b)').sort()).toEqual(['Math', 'a', 'b'])
  })

  it('does not treat unquoted object-literal keys as references', () => {
    expect(roots('{ active: item.active }')).toEqual(['item'])
    expect(roots('{ a: cat.name, b: loc.id }').sort()).toEqual(['cat', 'loc'])
  })

  it('keeps ternary branches and object shorthand values as references', () => {
    expect(roots('flag ? yes : no').sort()).toEqual(['flag', 'no', 'yes'])
    expect(roots('{ item, index }').sort()).toEqual(['index', 'item'])
  })

  it('ignores keywords and literals', () => {
    expect(roots('typeof cat === "object"')).toEqual(['cat'])
    expect(roots('true')).toEqual([])
    expect(roots('null')).toEqual([])
  })

  it('returns an empty set for empty or non-string input', () => {
    expect(roots('')).toEqual([])
    expect(
      Array.from(analyzeExpressionScope(undefined as unknown as string).freeIdentifiers)
    ).toEqual([])
  })

  it('subtracts identifiers bound by an arrow function parameter list', () => {
    expect(roots('(event) => event.target.value')).toEqual([])
    expect(roots('item => item.id')).toEqual([])
    expect(roots('rows.map((row, i) => row.name + i)').sort()).toEqual(['rows'])
    expect(roots('(a, b) => a + b + outer').sort()).toEqual(['outer'])
  })

  it('subtracts identifiers bound by a function expression', () => {
    expect(roots('(function (a) { return a })')).toEqual([])
    expect(roots('(function total(a) { return total(a) })')).toEqual([])
    expect(roots('(function (a) { return a + outer })')).toEqual(['outer'])
  })

  it('keeps nested arrow scopes independent of the outer expression', () => {
    // tslint:disable-next-line no-invalid-template-strings
    expect(roots('groups.map((group) => group.items.map((entry) => entry.id))')).toEqual(['groups'])
  })

  it('still sees references that only appear outside a callback', () => {
    expect(roots('outer.list.filter((x) => x.ok)').sort()).toEqual(['outer'])
  })

  it('reports block-scoped declarations as unresolvable rather than guessing', () => {
    expect(isResolvable('(() => { const total = 1; return total })()')).toBe(false)
    expect(isResolvable('(() => { let total = 1; return total })()')).toBe(false)
    expect(isResolvable('(() => { var total = 1; return total })()')).toBe(false)
    expect(isResolvable('props.value')).toBe(true)
    expect(isResolvable('(event) => event.target.value')).toBe(true)
  })

  it('does not mistake a property named like a keyword for a declaration', () => {
    expect(isResolvable('props.constant')).toBe(true)
    expect(roots('props.constant')).toEqual(['props'])
    // Reserved words are legal property names.
    expect(isResolvable('props.const')).toBe(true)
    expect(roots('props.const')).toEqual(['props'])
    expect(roots('props.function + Math.max(a, b)').sort()).toEqual(['Math', 'a', 'b', 'props'])
  })
})
