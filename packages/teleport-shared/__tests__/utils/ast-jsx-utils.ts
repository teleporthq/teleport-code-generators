import {
  generateStyledJSXTag,
  stringAsTemplateLiteral,
  createJSXSpreadAttribute,
  generateASTDefinitionForJSXTag,
} from '../../src/utils/ast-jsx-utils'

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
