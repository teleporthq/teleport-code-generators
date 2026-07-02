import { generateSharedRuntimeUtilsCode } from '../src'

// Regression guard for the operator-vocabulary mismatch (FurniFlow run
// be21af83): the worker canonicalizes if-statement operators to snake_case
// (is_not_empty, greater_than) and the GUI emits camelCase named forms
// (startsWith, notContains), but the generated runtime only implemented the
// hyphenated spellings. Unknown operators fell through to `left == right`,
// INVERTING unary semantics — a correctly filled stock-movement form
// evaluated is_not_empty(value) as `value == undefined` → false → the
// submit silently no-oped and success/error toasts were swapped.

type SharedUtils = {
  evaluateSingleComparison: (cfg: unknown, ctx: Record<string, unknown>) => boolean
  evaluateCondition: (cfg: unknown, ctx: Record<string, unknown>) => boolean
  normalizeComparisonOperator: (op: unknown) => string
}

function loadSharedRuntime(): SharedUtils {
  const src = generateSharedRuntimeUtilsCode()
  const wrapper: { exports: Record<string, unknown> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', src)(wrapper, wrapper.exports)
  return wrapper.exports as unknown as SharedUtils
}

describe('workflow runtime operator aliases', () => {
  const utils = loadSharedRuntime()

  it('normalizes snake_case, camelCase and named operators to the canonical form', () => {
    expect(utils.normalizeComparisonOperator('is_not_empty')).toBe('is-not-empty')
    expect(utils.normalizeComparisonOperator('is_empty')).toBe('is-empty')
    expect(utils.normalizeComparisonOperator('not_equals')).toBe('not-equals')
    expect(utils.normalizeComparisonOperator('greater_than')).toBe('greater-than')
    expect(utils.normalizeComparisonOperator('less_than')).toBe('less-than')
    expect(utils.normalizeComparisonOperator('greater_than_or_equal')).toBe('greater-than-or-equal')
    expect(utils.normalizeComparisonOperator('less_than_or_equal')).toBe('less-than-or-equal')
    expect(utils.normalizeComparisonOperator('starts_with')).toBe('starts-with')
    expect(utils.normalizeComparisonOperator('startsWith')).toBe('starts-with')
    expect(utils.normalizeComparisonOperator('ends_with')).toBe('ends-with')
    expect(utils.normalizeComparisonOperator('endsWith')).toBe('ends-with')
    expect(utils.normalizeComparisonOperator('not_contains')).toBe('not-contains')
    expect(utils.normalizeComparisonOperator('notContains')).toBe('not-contains')
    expect(utils.normalizeComparisonOperator('equals')).toBe('equals')
    expect(utils.normalizeComparisonOperator('matchesRegex')).toBe('matches-regex')
    // symbol operators pass through untouched
    expect(utils.normalizeComparisonOperator('===')).toBe('===')
    expect(utils.normalizeComparisonOperator('!=')).toBe('!=')
    expect(utils.normalizeComparisonOperator('>')).toBe('>')
  })

  it('evaluates is_not_empty as a UNARY check (previously inverted)', () => {
    // filled value → true (used to be `value == undefined` → false)
    expect(
      utils.evaluateSingleComparison({ leftValue: 'receipt', operator: 'is_not_empty' }, {})
    ).toBe(true)
    // empty value → false (used to be true)
    expect(utils.evaluateSingleComparison({ leftValue: '', operator: 'is_not_empty' }, {})).toBe(
      false
    )
    expect(
      utils.evaluateSingleComparison({ leftValue: undefined, operator: 'is_not_empty' }, {})
    ).toBe(false)
    expect(utils.evaluateSingleComparison({ leftValue: [], operator: 'is_not_empty' }, {})).toBe(
      false
    )
  })

  it('evaluates is_empty / is_null / is_not_null / is_true / is_false', () => {
    expect(utils.evaluateSingleComparison({ leftValue: '', operator: 'is_empty' }, {})).toBe(true)
    expect(utils.evaluateSingleComparison({ leftValue: 'x', operator: 'is_empty' }, {})).toBe(false)
    expect(utils.evaluateSingleComparison({ leftValue: null, operator: 'is_null' }, {})).toBe(true)
    expect(utils.evaluateSingleComparison({ leftValue: '', operator: 'is_null' }, {})).toBe(false)
    expect(utils.evaluateSingleComparison({ leftValue: 0, operator: 'is_not_null' }, {})).toBe(true)
    expect(utils.evaluateSingleComparison({ leftValue: 'true', operator: 'is_true' }, {})).toBe(
      true
    )
    expect(utils.evaluateSingleComparison({ leftValue: false, operator: 'is_false' }, {})).toBe(
      true
    )
  })

  it('evaluates named binary operators', () => {
    expect(
      utils.evaluateSingleComparison(
        { leftValue: 5, rightValue: '3', operator: 'greater_than' },
        {}
      )
    ).toBe(true)
    expect(
      utils.evaluateSingleComparison({ leftValue: 2, rightValue: '3', operator: 'less_than' }, {})
    ).toBe(true)
    expect(
      utils.evaluateSingleComparison(
        { leftValue: 3, rightValue: '3', operator: 'greater_than_or_equal' },
        {}
      )
    ).toBe(true)
    expect(
      utils.evaluateSingleComparison(
        { leftValue: 3, rightValue: '3', operator: 'less_than_or_equal' },
        {}
      )
    ).toBe(true)
    expect(
      utils.evaluateSingleComparison(
        { leftValue: 'a', rightValue: 'b', operator: 'not_equals' },
        {}
      )
    ).toBe(true)
    expect(
      utils.evaluateSingleComparison(
        { leftValue: 'receipt-1', rightValue: 'receipt', operator: 'startsWith' },
        {}
      )
    ).toBe(true)
    expect(
      utils.evaluateSingleComparison(
        { leftValue: 'receipt-1', rightValue: '-1', operator: 'ends_with' },
        {}
      )
    ).toBe(true)
    expect(
      utils.evaluateSingleComparison(
        { leftValue: 'abc', rightValue: 'z', operator: 'notContains' },
        {}
      )
    ).toBe(true)
  })

  it('warns on a genuinely unknown operator instead of silently comparing', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    utils.evaluateSingleComparison({ leftValue: 1, rightValue: 1, operator: 'sorta-equalish' }, {})
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('sorta-equalish'))
    warnSpy.mockRestore()
  })

  it('validate-input multiple-conditions AND from the FurniFlow run now passes for a filled form', () => {
    // Deployed `Record Stock Movement.validate-input` shape (after server
    // repair): conditions[] with leftValue/rightValue keys, snake_case ops
    // and stringified numeric rights.
    const context = {
      'get-type': { value: 'receipt', key: 'movementType' },
      'get-product': { value: 'b8b7e9aa-1111-4222-8333-abcdefabcdef', key: 'productId' },
      'get-qty': { value: 12, key: 'quantity' },
    }
    const config = {
      conditionType: 'multiple-conditions',
      logicOperator: 'AND',
      conditions: [
        {
          leftValue: { type: 'workflowContext', nodeId: 'get-type', path: ['get-type', 'value'] },
          operator: 'is_not_empty',
        },
        {
          leftValue: {
            type: 'workflowContext',
            nodeId: 'get-product',
            path: ['get-product', 'value'],
          },
          operator: 'is_not_empty',
        },
        {
          leftValue: { type: 'workflowContext', nodeId: 'get-qty', path: ['get-qty', 'value'] },
          operator: '>',
          rightValue: '0',
        },
      ],
    }
    expect(utils.evaluateCondition(config, context)).toBe(true)

    // Empty form → false (and the toast inversion scenario: is_not_empty on a
    // missing insert id must be FALSE, not true)
    const emptyContext = {
      'get-type': { value: '', key: 'movementType' },
      'get-product': { value: '', key: 'productId' },
      'get-qty': { value: 0, key: 'quantity' },
    }
    expect(utils.evaluateCondition(config, emptyContext)).toBe(false)
  })
})
