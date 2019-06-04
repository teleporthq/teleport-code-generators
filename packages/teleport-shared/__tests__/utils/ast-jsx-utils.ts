import {
  generateStyledJSXTag,
  createBinaryExpression,
  stringAsTemplateLiteral,
  createJSXSpreadAttribute,
  generateASTDefinitionForJSXTag,
} from '../../src/utils/ast-jsx-utils'

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

describe('stringAsTemplateLiteral', () => {
  it('returns TemplateLiteral', () => {
    const result = stringAsTemplateLiteral('randomString')

    expect(result.type).toBe('TemplateLiteral')
    expect(result.quasis[0].type).toBe('TemplateElement')
  })
})

describe('generateStyledJSXTag', () => {
  it('returns JSXTag', () => {
    const result = generateStyledJSXTag('randomString')

    expect(result.type).toBe('JSXElement')
    expect(result.openingElement.type).toBe('JSXOpeningElement')
    expect(result.openingElement.name).toHaveProperty('name', 'style')
    expect(result.closingElement.type).toBe('JSXClosingElement')
    expect(result.closingElement.name).toHaveProperty('name', 'style')
  })
})

describe('generateASTDefinitionForJSXTag', () => {
  it('returns ASTDefinitionForJSXTag', () => {
    const result = generateASTDefinitionForJSXTag('randomString')

    expect(result.type).toBe('JSXElement')
    expect(result.openingElement.type).toBe('JSXOpeningElement')
    expect(result.openingElement.name).toHaveProperty('name', 'randomString')
    expect(result.closingElement.type).toBe('JSXClosingElement')
    expect(result.closingElement.name).toHaveProperty('name', 'randomString')
  })
})

describe('createJSXSpreadAttribute', () => {
  it('runs with success', () => {
    const result = createJSXSpreadAttribute('randomString')

    expect(result.type).toBe('JSXSpreadAttribute')
    expect(result.argument).toHaveProperty('name', 'randomString')
  })
})
