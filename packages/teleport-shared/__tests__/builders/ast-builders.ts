import {
  createConstAssignment,
  createDefaultExport,
  createGenericImportStatement,
} from '../../src/builders/ast-builders'

describe('AST builder', () => {
  describe('createConstAssignment', () => {
    it('should creat assignment for a const', () => {
      const result = createConstAssignment('testConst')
      expect(result.type).toBe('VariableDeclaration')
      expect(result.kind).toBe('const')
      expect(result.declarations[0].type).toBe('VariableDeclarator')
      expect(result.declarations[0].id.name).toBe('testConst')
    })
  })
  describe('createDefaultExport', () => {
    it('should creat default export', () => {
      const result = createDefaultExport('testConst')
      expect(result.type).toBe('ExportDefaultDeclaration')
      expect(result.declaration).toHaveProperty('name')
      expect(result.declaration.name).toBe('testConst')
    })
  })

  describe('createGenericImportStatement', () => {
    it('should creat generic import statements', () => {
      const imports = [
        { identifier: 'Card', namedImport: false, originalName: 'Card' },
        { identifier: 'React', namedImport: false, originalName: 'React' },
        { identifier: 'useState', namedImport: true, originalName: 'useState' },
      ]
      const result = createGenericImportStatement('../testConst', imports)
      expect(result.type).toBe('ImportDeclaration')
      expect(result.specifiers.length).toEqual(imports.length)
      expect(result.source).toHaveProperty('value')
      expect(result.source.value).toBe('../testConst')
    })
  })
  it('should creat generic import statements if no import array is provided', () => {
    const result = createGenericImportStatement('../testConst', [])
    expect(result.type).toBe('ImportDeclaration')
    expect(result.source).toHaveProperty('value')
    expect(result.source.value).toBe('../testConst')
  })
})
