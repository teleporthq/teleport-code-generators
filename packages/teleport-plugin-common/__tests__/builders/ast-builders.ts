import {
  createDefaultExport,
  createConstAssignment,
  createGenericImportStatement,
  createJSXTag,
  createSelfClosingJSXTag,
  createFunctionCall,
  createFunctionalComponent,
} from '../../src/builders/ast-builders'
import * as types from '@babel/types'

describe('createConstAssignment', () => {
  it('should creat assignment for a const', () => {
    const result = createConstAssignment('testConst')
    expect(result.type).toBe('VariableDeclaration')
    expect(result.kind).toBe('const')
    expect(result.declarations[0].type).toBe('VariableDeclarator')
    expect((result.declarations[0].id as types.Identifier).name).toBe('testConst')
  })
})
describe('createDefaultExport', () => {
  it('should creat default export', () => {
    const result = createDefaultExport('testConst')
    expect(result.type).toBe('ExportDefaultDeclaration')
    expect(result.declaration).toHaveProperty('name')
    expect((result.declaration as types.Identifier).name).toBe('testConst')
  })
})

describe('createGenericImportStatement', () => {
  it('should creat generic import statements', () => {
    const imports = [
      { identifierName: 'Card', namedImport: false, originalName: 'Card' },
      { identifierName: 'React', namedImport: false, originalName: 'React' },
      { identifierName: 'useState', namedImport: true, originalName: 'useState' },
    ]
    const result = createGenericImportStatement('../testConst', imports)
    expect(result.type).toBe('ImportDeclaration')
    expect(result.specifiers.length).toEqual(imports.length)
    expect(result.source).toHaveProperty('value')
    expect(result.source.value).toBe('../testConst')
  })
  it('should use the identifierName as originalName if no originalName is provided', () => {
    const imports = [{ identifierName: 'Card', namedImport: true }]
    const result = createGenericImportStatement('some-package', imports)
    expect(result.type).toBe('ImportDeclaration')
    expect(result.specifiers.length).toEqual(imports.length)
    expect(result.source).toHaveProperty('value')
    expect(result.source.value).toBe('some-package')
    const specifier = result.specifiers[0] as types.ImportSpecifier
    expect(specifier.local.name).toBe('Card')
    expect(specifier.imported.name).toBe('Card')
  })
  it('should creat generic import statements if no import array is provided', () => {
    const result = createGenericImportStatement('../testConst', [])
    expect(result.type).toBe('ImportDeclaration')
    expect(result.source).toHaveProperty('value')
    expect(result.source.value).toBe('../testConst')
  })
})

describe('createJSXTag', () => {
  it('returns a valid JSX tag', () => {
    const result = createJSXTag('randomString')

    expect(result.type).toBe('JSXElement')
    expect(result.openingElement.type).toBe('JSXOpeningElement')
    expect(result.openingElement.name).toHaveProperty('name', 'randomString')
    expect(result.closingElement.type).toBe('JSXClosingElement')
    expect(result.closingElement.name).toHaveProperty('name', 'randomString')
  })
})

describe('createSelfClosingJSXTag', () => {
  it('returns a valid JSX tag', () => {
    const result = createSelfClosingJSXTag('randomString')

    expect(result.type).toBe('JSXElement')
    expect(result.openingElement.type).toBe('JSXOpeningElement')
    expect(result.openingElement.name).toHaveProperty('name', 'randomString')
    expect(result.selfClosing).toBe(true)
  })
})

describe('createFunctionCall', () => {
  it('works with no arguments', () => {
    const result = createFunctionCall('console.log', [])

    expect(result.type).toBe('CallExpression')
    expect(result.arguments.length).toBe(0)
    expect((result.callee as types.Identifier).name).toBe('console.log')
  })

  it('works with arguments of different types', () => {
    const result = createFunctionCall('console.log', [0, '1'])

    expect(result.type).toBe('CallExpression')
    expect(result.arguments.length).toBe(2)
    expect(result.arguments[0].type).toBe('NumericLiteral')
    expect(result.arguments[1].type).toBe('StringLiteral')
    expect((result.callee as types.Identifier).name).toBe('console.log')
  })

  it('works with AST as arguments', () => {
    const result = createFunctionCall('console.log', [0, createJSXTag('App')])

    expect(result.type).toBe('CallExpression')
    expect(result.arguments.length).toBe(2)
    expect(result.arguments[0].type).toBe('NumericLiteral')
    expect(result.arguments[1].type).toBe('JSXElement')
    expect((result.callee as types.Identifier).name).toBe('console.log')
  })
})

describe('createFunctionalComponent', () => {
  it('returns a valid AST node', () => {
    const result = createFunctionalComponent('MyComponent', createSelfClosingJSXTag('App'))
    expect(result.type).toBe('VariableDeclaration')
    expect((result.declarations[0].id as types.Identifier).name).toBe('MyComponent')
  })
})
