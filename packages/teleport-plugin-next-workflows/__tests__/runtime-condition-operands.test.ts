import { generateSharedRuntimeUtilsCode } from '../src'

/**
 * The editor's workflow templates (delete account, password reset request,
 * bookings, reviews, social, loyalty) write an if-statement's sides as
 * `leftOperand` / `rightOperand` with the operator `'='`. The runtime read only
 * `leftValue` / `rightValue`, so each of those checks compared undefined with
 * undefined and always took its "true" branch. Both spellings are read now,
 * and `'='` is equality.
 */

type SharedUtils = {
  resolveConfig: (cfg: unknown, ctx: Record<string, unknown>) => Record<string, unknown>
  evaluateCondition: (cfg: unknown, ctx: Record<string, unknown>) => boolean
}

function loadSharedRuntime(): SharedUtils {
  const wrapper: { exports: Record<string, unknown> } = { exports: {} }
  // tslint:disable-next-line:function-constructor
  new Function('module', 'exports', generateSharedRuntimeUtilsCode())(wrapper, wrapper.exports)
  return wrapper.exports as unknown as SharedUtils
}

const ref = (nodeId: string, ...path: string[]) => ({
  type: 'workflowContext',
  nodeId,
  path: [nodeId, ...path],
})

// The "Is Password Correct?" step of the editor's delete-account template.
const isPasswordCorrect = {
  conditionType: 'simple-comparison',
  leftOperand: ref('verify-password', 'isMatch'),
  operator: '=',
  rightOperand: true,
}

describe('an if-statement written with leftOperand / rightOperand', () => {
  const utils = loadSharedRuntime()
  // What every route does with an if-statement node: resolve, then evaluate.
  const evaluate = (config: unknown, context: Record<string, unknown>) =>
    utils.evaluateCondition(utils.resolveConfig(config, context), context)

  it('takes the branch its operands choose', () => {
    expect(evaluate(isPasswordCorrect, { 'verify-password': { isMatch: true } })).toBe(true)
    expect(evaluate(isPasswordCorrect, { 'verify-password': { isMatch: false } })).toBe(false)
  })

  it('reads a missing operand as missing, not as equal to the other side', () => {
    expect(evaluate(isPasswordCorrect, {})).toBe(false)
  })

  it("treats '=' as equality without warning about the operator", () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      expect(evaluate({ leftOperand: 'a', operator: '=', rightOperand: 'a' }, {})).toBe(true)
      expect(evaluate({ leftOperand: 'a', operator: '=', rightOperand: 'b' }, {})).toBe(false)
      expect(evaluate({ leftValue: 3, operator: '=', rightValue: '3' }, {})).toBe(true)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('applies inside multiple conditions', () => {
    const both = {
      conditionType: 'multiple-conditions',
      logicOperator: 'AND',
      conditions: [
        { leftOperand: ref('form', 'agreed'), operator: '=', rightOperand: true },
        { leftOperand: ref('form', 'email'), operator: 'is-not-empty' },
      ],
    }
    expect(evaluate(both, { form: { agreed: true, email: 'a@b.c' } })).toBe(true)
    expect(evaluate(both, { form: { agreed: false, email: 'a@b.c' } })).toBe(false)
  })

  it('keeps leftValue / rightValue first when a config carries both', () => {
    expect(
      evaluate(
        { leftValue: 'x', leftOperand: 'y', operator: '===', rightValue: 'x', rightOperand: 'z' },
        {}
      )
    ).toBe(true)
  })
})
