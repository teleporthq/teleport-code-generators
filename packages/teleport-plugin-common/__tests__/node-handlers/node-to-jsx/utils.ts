import {
  createBinaryExpression,
  createConditionIdentifier,
} from '../../../src/node-handlers/node-to-jsx/utils'
import { dynamicNode } from '@teleporthq/teleport-uidl-builders'
import {
  JSXGenerationParams,
  JSXGenerationOptions,
} from '../../../src/node-handlers/node-to-jsx/types'

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

describe('createConditionIdentifier', () => {
  const params: JSXGenerationParams = {
    propDefinitions: {
      title: {
        type: 'string',
      },
      fields: {
        type: 'object',
      },
    },
    stateDefinitions: {
      isActive: {
        type: 'boolean',
        defaultValue: false,
      },
    },
    dependencies: {},
    nodesLookup: {},
  }

  const options: JSXGenerationOptions = {
    dynamicReferencePrefixMap: {
      prop: 'this.props',
      state: 'this',
      local: '',
    },
  }

  it('works with a prop reference', () => {
    const node = dynamicNode('prop', 'title')
    const result = createConditionIdentifier(node, params, options)

    expect(result.key).toBe('title')
    expect(result.prefix).toBe('this.props')
    expect(result.type).toBe('string')
  })

  it('works on member expressions', () => {
    const node = dynamicNode('prop', 'fields', ['title'])
    const result = createConditionIdentifier(node, params, options)

    expect(result.key).toBe("fields?.['title']")
    expect(result.prefix).toBe('this.props')
    expect(result.type).toBe('object')
  })

  it('works with a state reference', () => {
    const node = dynamicNode('state', 'isActive')
    const result = createConditionIdentifier(node, params, options)

    expect(result.key).toBe('isActive')
    expect(result.prefix).toBe('this')
    expect(result.type).toBe('boolean')
  })

  it('throws an error for unknown reference type', () => {
    const node = dynamicNode('local', 'title')
    expect(() => createConditionIdentifier(node, params, options)).toThrowError()
  })
})
