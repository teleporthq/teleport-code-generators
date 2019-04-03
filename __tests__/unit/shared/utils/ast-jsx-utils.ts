import { createBinaryExpression } from '../../../../src/shared/utils/ast-jsx-utils'

describe('createBinaryExpression', () => {
  it('varName === true -> varName', () => {
    const condition = { operation: '===', operand: true }
    const stateIdentifier = {
      key: 'isVisible',
      type: 'boolean',
      default: true,
      setter: 'setIsVisible',
    }

    expect(createBinaryExpression(condition, stateIdentifier)).toEqual({
      type: 'Identifier',
      name: 'isVisible',
    })
  })

  it('varName === false -> !varName', () => {
    const condition = { operation: '===', operand: false }
    const stateIdentifier = {
      key: 'isVisible',
      type: 'boolean',
      default: true,
      setter: 'setIsVisible',
    }

    expect(createBinaryExpression(condition, stateIdentifier)).toEqual({
      type: 'UnaryExpression',
      operator: '!',
      argument: { type: 'Identifier', name: 'isVisible' },
      prefix: true,
    })
  })
})
