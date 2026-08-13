import { generateSharedRuntimeUtilsCode } from '../src'

// Producers that cannot type their output emit booleans as the strings
// "true"/"false" — the evaluate-auth custom-js most notably (see
// is-logged-in-gate.ts), plus any inspector text input. `is-true`/`is-false`
// and coerceForComparison already read those as booleans, but `is-truthy` was
// plain `!!left`, and the string "false" is truthy in JS: an is-truthy gate on
// isLoggedIn admitted EVERY visitor, and an is-falsy check never fired.

type SharedUtils = {
  evaluateSingleComparison: (cfg: unknown, ctx: Record<string, unknown>) => boolean
}

function loadSharedRuntime(): SharedUtils {
  const src = generateSharedRuntimeUtilsCode()
  const wrapper: { exports: Record<string, unknown> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', src)(wrapper, wrapper.exports)
  return wrapper.exports as unknown as SharedUtils
}

describe('workflow runtime truthiness of stringified booleans', () => {
  const utils = loadSharedRuntime()

  const isTruthy = (leftValue: unknown) =>
    utils.evaluateSingleComparison({ leftValue, operator: 'is-truthy' }, {})
  const isFalsy = (leftValue: unknown) =>
    utils.evaluateSingleComparison({ leftValue, operator: 'is-falsy' }, {})

  it('treats the string "false" as false, matching is-false and coerceForComparison', () => {
    expect(isTruthy('false')).toBe(false)
    expect(isFalsy('false')).toBe(true)
  })

  it('keeps the string "true" true', () => {
    expect(isTruthy('true')).toBe(true)
    expect(isFalsy('true')).toBe(false)
  })

  it('agrees with is-true/is-false on the same value', () => {
    for (const value of ['true', 'false', true, false]) {
      expect(isTruthy(value)).toBe(
        utils.evaluateSingleComparison({ leftValue: value, operator: 'is-true' }, {})
      )
      expect(isFalsy(value)).toBe(
        utils.evaluateSingleComparison({ leftValue: value, operator: 'is-false' }, {})
      )
    }
  })

  it('leaves ordinary JS truthiness untouched', () => {
    expect(isTruthy(true)).toBe(true)
    expect(isTruthy(false)).toBe(false)
    expect(isTruthy('anything')).toBe(true)
    expect(isTruthy('')).toBe(false)
    expect(isTruthy(0)).toBe(false)
    expect(isTruthy(1)).toBe(true)
    expect(isTruthy(null)).toBe(false)
    expect(isTruthy(undefined)).toBe(false)
    expect(isFalsy('')).toBe(true)
    expect(isFalsy(0)).toBe(true)
    expect(isFalsy('anything')).toBe(false)
  })

  it('normalizes the snake_case and camelCase spellings the same way', () => {
    expect(utils.evaluateSingleComparison({ leftValue: 'false', operator: 'is_truthy' }, {})).toBe(
      false
    )
    expect(utils.evaluateSingleComparison({ leftValue: 'false', operator: 'isTruthy' }, {})).toBe(
      false
    )
    expect(utils.evaluateSingleComparison({ leftValue: 'false', operator: 'is_falsy' }, {})).toBe(
      true
    )
  })
})
