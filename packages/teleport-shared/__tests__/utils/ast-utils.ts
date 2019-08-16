import {
  ParsedASTNode,
  convertValueToLiteral,
  objectToObjectExpression,
} from '../../src/utils/ast-js-utils'

describe('AST Utils ', () => {
  describe('ParsedASTNode', () => {
    it('should create ASTNode', () => {
      const result = new ParsedASTNode('test')

      expect(typeof result).toBe('object')
      expect(result).toHaveProperty('ast')
      expect(result.ast).toBe('test')
    })
  })
  describe('convertValueToLiteral', () => {
    it('should convert value to literal', () => {
      const result = convertValueToLiteral('test')

      expect(typeof result).toBe('object')
      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('value')
      expect(result.type).toEqual('StringLiteral')
      expect(result.value).toEqual('test')
    })
    it('should convert number value to numerical literal', () => {
      const result = convertValueToLiteral(2, 'number')

      expect(typeof result).toBe('object')
      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('value')
      expect(result.type).toEqual('NumericLiteral')
      expect(result.value).toEqual(2)
    })
    it('should convert boolean value to boolean literal', () => {
      const result = convertValueToLiteral(true, 'boolean')

      expect(typeof result).toBe('object')
      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('value')
      expect(result.type).toEqual('BooleanLiteral')
      expect(result.value).toEqual(true)
    })
    it('should convert object value to boolean literal', () => {
      const result = convertValueToLiteral({ test: true }, 'object')

      expect(typeof result).toBe('object')
      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('properties')
      expect(result.type).toEqual('ObjectExpression')
      expect(result.properties.length).toEqual(1)
      expect(result.properties[0]).toHaveProperty('key')
      expect(result.properties[0].key.type).toBe('StringLiteral')
      expect(result.properties[0].key.value).toBe('test')
      expect(result.properties[0]).toHaveProperty('value')
      expect(result.properties[0].value.type).toBe('BooleanLiteral')
      expect(result.properties[0].value.value).toBe(true)
    })
    it('should convert array value to literals', () => {
      const testArray = ['test', 'testAgain', 'andAgain']
      const result = convertValueToLiteral(testArray)

      expect(typeof result).toBe('object')
      expect(result).toHaveProperty('type')
      expect(result.type).toBe('ArrayExpression')
      expect(result).toHaveProperty('elements')
      expect(result.elements.length).toEqual(testArray.length)
    })
    it('should convert identifier value to literal', () => {
      const result = convertValueToLiteral(String)

      expect(typeof result).toBe('object')
      expect(result).toHaveProperty('type')
      expect(result.type).toBe('Identifier')
    })
    it('returns a null literal for null or undefined', () => {
      expect(convertValueToLiteral(null).type).toBe('NullLiteral')
      expect(convertValueToLiteral(undefined).type).toBe('NullLiteral')
    })
  })

  describe('objectToObjectExpression', () => {
    it('should transform object to object expression', () => {
      const objTest = {
        stringKey: 'test',
        booleanKey: true,
        numberKey: 2,
        arrayKey: ['test', 'testAgain'],
        objectKey: {
          identifierKey: String,
        },
      }
      const result = objectToObjectExpression(objTest)

      expect(typeof result).toBe('object')
      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('properties')
      expect(result.properties.length).toEqual(Object.keys(objTest).length)
      expect(result.properties.length).toEqual(Object.keys(objTest).length)
    })
    const objectTest = {
      arrayKey: { key: Array },
      numberKey: { key: Number },
      stringKey: { key: String },
      booleanKey: { key: Boolean },
      objectKey: { key: Object },
      astKey: { key: new ParsedASTNode('') },
    }
    Object.keys(objectTest).map((key) => {
      it(`should transform ${key} object to object expression`, () => {
        const result = objectToObjectExpression(objectTest[key])
        expect(typeof result).toBe('object')
        expect(result).toHaveProperty('type')
        expect(result).toHaveProperty('properties')
        expect(result.type).toEqual('ObjectExpression')
      })
    })
  })
})
