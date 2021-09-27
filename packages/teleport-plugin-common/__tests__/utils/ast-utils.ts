import {
  stringAsTemplateLiteral,
  addSpreadAttributeToJSXTag,
  renameJSXTag,
  addClassStringOnJSXTag,
  addAttributeToJSXTag,
  addDynamicAttributeToJSXTag,
  convertValueToLiteral,
  objectToObjectExpression,
} from '../../src/utils/ast-utils'
import ParsedASTNode from '../../src/utils/parsed-ast'
import { createJSXTag } from '../../src/builders/ast-builders'
import * as types from '@babel/types'

describe('stringAsTemplateLiteral', () => {
  it('returns TemplateLiteral', () => {
    const result = stringAsTemplateLiteral('randomString')

    expect(result.type).toBe('TemplateLiteral')
    expect(result.quasis[0].type).toBe('TemplateElement')
  })
})

describe('addSpreadAttributeToJSXTag', () => {
  it('runs with success', () => {
    const tag = createJSXTag('random')
    addSpreadAttributeToJSXTag(tag, 'randomString')

    const attr = tag.openingElement.attributes[0]
    expect(attr.type).toBe('JSXSpreadAttribute')
    expect((attr as types.JSXSpreadAttribute).argument).toHaveProperty('name', 'randomString')
  })
})

describe('renameJSXTag', () => {
  it('runs with success', () => {
    const tag = createJSXTag('random')
    renameJSXTag(tag, 'NewName')

    const openTag = tag.openingElement.name as types.JSXIdentifier
    const closeTag = tag.closingElement.name as types.JSXIdentifier
    expect(openTag.name).toBe('NewName')
    expect(closeTag.name).toBe('NewName')
  })
})

describe('addClassStringOnJSXTag', () => {
  it('adds a class on an element with no classes', () => {
    const tag = createJSXTag('button')

    addClassStringOnJSXTag(tag, 'primary')
    expect(tag.openingElement.attributes[0].type).toBe('JSXAttribute')

    const classAttr = tag.openingElement.attributes[0] as types.JSXAttribute
    expect(classAttr.name.name).toBe('className')
    expect((classAttr.value as types.StringLiteral).value).toBe('primary')
  })

  it('adds a class on an element with existing classes', () => {
    const tag = createJSXTag('button')
    addAttributeToJSXTag(tag, 'className', 'button')

    addClassStringOnJSXTag(tag, 'primary')
    expect(tag.openingElement.attributes[0].type).toBe('JSXAttribute')

    const classAttr = tag.openingElement.attributes[0] as types.JSXAttribute
    expect(classAttr.name.name).toBe('className')
    expect((classAttr.value as types.StringLiteral).value).toBe('button primary')
  })
})

describe('addAttributeToJSXTag', () => {
  it('adds an attribute with no value', () => {
    const tag = createJSXTag('button')

    addAttributeToJSXTag(tag, 'disabled')
    expect(tag.openingElement.attributes[0].type).toBe('JSXAttribute')

    const classAttr = tag.openingElement.attributes[0] as types.JSXAttribute
    expect(classAttr.name.name).toBe('disabled')
    expect(classAttr.value).toBe(null)
  })

  it('adds an attribute with false', () => {
    const tag = createJSXTag('button')

    addAttributeToJSXTag(tag, 'disabled', false)
    expect(tag.openingElement.attributes[0].type).toBe('JSXAttribute')

    const classAttr = tag.openingElement.attributes[0] as types.JSXAttribute
    expect(classAttr.name.name).toBe('disabled')
    expect(
      ((classAttr.value as types.JSXExpressionContainer).expression as types.BooleanLiteral).value
    ).toBe(false)
  })

  it('adds an attribute with the selected value', () => {
    const tag = createJSXTag('button')

    addAttributeToJSXTag(tag, 'data-attr', 'random-value')
    expect(tag.openingElement.attributes[0].type).toBe('JSXAttribute')

    const classAttr = tag.openingElement.attributes[0] as types.JSXAttribute
    expect(classAttr.name.name).toBe('data-attr')
    expect((classAttr.value as types.StringLiteral).value).toBe('random-value')
  })

  it('adds an attribute as a JSX expression when non-string', () => {
    const tag = createJSXTag('button')

    addAttributeToJSXTag(tag, 'data-attr', 1)
    expect(tag.openingElement.attributes[0].type).toBe('JSXAttribute')

    const classAttr = tag.openingElement.attributes[0] as types.JSXAttribute
    expect(classAttr.name.name).toBe('data-attr')
    expect(
      (
        (classAttr.value as types.JSXExpressionContainer)
          .expression as unknown as types.NumericLiteral
      ).value
    ).toBe(1)
  })
})

describe('addDynamicAttributeToJSXTag', () => {
  it('adds the dynamic JSX expression on the opening tag', () => {
    const tag = createJSXTag('button')

    addDynamicAttributeToJSXTag(tag, 'dynamicValue', 'title')
    expect(tag.openingElement.attributes[0].type).toBe('JSXAttribute')

    const dynamicAttr = tag.openingElement.attributes[0] as types.JSXAttribute
    expect(dynamicAttr.value.type).toBe('JSXExpressionContainer')
    expect(
      ((dynamicAttr.value as types.JSXExpressionContainer).expression as types.Identifier).name
    ).toBe('title')
  })

  it('adds the dynamic JSX expression on the opening tag with prefix', () => {
    const tag = createJSXTag('button')

    addDynamicAttributeToJSXTag(tag, 'dynamicValue', 'title', 'props')
    expect(tag.openingElement.attributes[0].type).toBe('JSXAttribute')

    const dynamicAttr = tag.openingElement.attributes[0] as types.JSXAttribute
    expect(dynamicAttr.value.type).toBe('JSXExpressionContainer')
    expect((dynamicAttr.value as types.JSXExpressionContainer).expression.type).toBe(
      'MemberExpression'
    )
  })
})

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
    const result = convertValueToLiteral('test') as types.StringLiteral

    expect(typeof result).toBe('object')
    expect(result).toHaveProperty('type')
    expect(result).toHaveProperty('value')
    expect(result.type).toEqual('StringLiteral')
    expect(result.value).toEqual('test')
  })
  it('should convert number value to numerical literal', () => {
    const result = convertValueToLiteral(2, 'number') as types.NumericLiteral

    expect(typeof result).toBe('object')
    expect(result).toHaveProperty('type')
    expect(result).toHaveProperty('value')
    expect(result.type).toEqual('NumericLiteral')
    expect(result.value).toEqual(2)
  })
  it('should convert boolean value to boolean literal', () => {
    const result = convertValueToLiteral(true, 'boolean') as types.BooleanLiteral

    expect(typeof result).toBe('object')
    expect(result).toHaveProperty('type')
    expect(result).toHaveProperty('value')
    expect(result.type).toEqual('BooleanLiteral')
    expect(result.value).toEqual(true)
  })
  it('should convert object value to boolean literal', () => {
    const result = convertValueToLiteral({ test: true }, 'object') as types.ObjectExpression

    expect(typeof result).toBe('object')
    expect(result).toHaveProperty('type')
    expect(result).toHaveProperty('properties')
    expect(result.type).toEqual('ObjectExpression')
    expect(result.properties.length).toEqual(1)
    const property = result.properties[0] as types.ObjectProperty
    expect(property).toHaveProperty('key')
    expect(property.key.type).toBe('StringLiteral')
    // @ts-ignore
    expect(property.key.value).toBe('test')
    expect(property).toHaveProperty('value')
    expect(property.value.type).toBe('BooleanLiteral')
    expect((property.value as types.BooleanLiteral).value).toBe(true)
  })
  it('should convert array value to literals', () => {
    const testArray = ['test', 'testAgain', 'andAgain']
    const result = convertValueToLiteral(testArray) as types.ArrayExpression

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
  // tslint:disable-next-line:no-any
  const objectTest: Record<string, any> = {
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
