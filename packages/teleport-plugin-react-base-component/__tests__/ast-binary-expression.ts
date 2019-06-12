import { createBinaryExpression } from '../src/utils'

describe('createBinaryExpression', () => {
  it('varName === true -> varName', () => {
    const condition = { operation: '===', operand: true }
    const conditionIdentifier = {
      key: 'isVisible',
      type: 'boolean',
    }

    expect(createBinaryExpression(condition, conditionIdentifier)).toEqual({
      type: 'Identifier',
      name: 'isVisible',
    })
  })

  it('varName === false -> !varName', () => {
    const condition = { operation: '===', operand: false }
    const conditionIdentifier = {
      key: 'isVisible',
      type: 'boolean',
    }

    expect(createBinaryExpression(condition, conditionIdentifier)).toEqual({
      type: 'UnaryExpression',
      operator: '!',
      argument: { type: 'Identifier', name: 'isVisible' },
      prefix: true,
    })
  })

  it('varName === text -> varName === text', () => {
    const condition = { operation: '===', operand: 'text' }
    const conditionIdentifier = {
      key: 'isVisible',
      type: 'string',
    }

    const result = createBinaryExpression(condition, conditionIdentifier)

    expect(result).toEqual({
      type: 'BinaryExpression',
      operator: '===',
      left: { type: 'Identifier', name: 'isVisible' },
      right: { type: 'StringLiteral', value: 'text' },
    })
  })

  it('varName === undefined -> !varName', () => {
    const condition = { operation: '===' }
    const conditionIdentifier = {
      key: 'isVisible',
      type: 'string',
    }

    const result = createBinaryExpression(condition, conditionIdentifier)

    expect(result).toEqual({
      type: 'UnaryExpression',
      operator: '!',
      argument: { type: 'Identifier', name: 'isVisible' },
      prefix: true,
    })
  })

  it('varName == text -> varName === text', () => {
    const condition = { operation: '==,', operand: 'text' }
    const conditionIdentifier = {
      key: 'isVisible',
      type: 'string',
    }

    const result = createBinaryExpression(condition, conditionIdentifier)

    expect(result).toEqual({
      type: 'BinaryExpression',
      operator: '===',
      left: { type: 'Identifier', name: 'isVisible' },
      right: { type: 'StringLiteral', value: 'text' },
    })
  })

  it('varName === undefined -> !varName', () => {
    const condition = { operation: '!' }
    const conditionIdentifier = {
      key: 'isVisible',
      type: 'string',
    }

    const result = createBinaryExpression(condition, conditionIdentifier)

    expect(result).toEqual({
      type: 'UnaryExpression',
      operator: '!',
      argument: { type: 'Identifier', name: 'isVisible' },
      prefix: true,
    })
  })
})
