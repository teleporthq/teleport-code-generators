import {
  stringAsTemplateLiteral,
  addSpreadAttributeToJSXTag,
  renameJSXTag,
  addClassStringOnJSXTag,
  addAttributeToJSXTag,
  addDynamicAttributeToJSXTag,
} from '../../src/utils/ast-jsx-utils'
import { createJSXTag } from '../../src/builders/ast-builders'
import {
  JSXSpreadAttribute,
  JSXIdentifier,
  JSXAttribute,
  StringLiteral,
  JSXExpressionContainer,
  Identifier,
  NumberLiteral,
} from '@babel/types'

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
    expect((attr as JSXSpreadAttribute).argument).toHaveProperty('name', 'randomString')
  })
})

describe('renameJSXTag', () => {
  it('runs with success', () => {
    const tag = createJSXTag('random')
    renameJSXTag(tag, 'NewName')

    const openTag = tag.openingElement.name as JSXIdentifier
    const closeTag = tag.closingElement.name as JSXIdentifier
    expect(openTag.name).toBe('NewName')
    expect(closeTag.name).toBe('NewName')
  })
})

describe('addClassStringOnJSXTag', () => {
  it('adds a class on an element with no classes', () => {
    const tag = createJSXTag('button')

    addClassStringOnJSXTag(tag, 'primary')
    expect(tag.openingElement.attributes[0].type).toBe('JSXAttribute')

    const classAttr = tag.openingElement.attributes[0] as JSXAttribute
    expect(classAttr.name.name).toBe('className')
    expect((classAttr.value as StringLiteral).value).toBe('primary')
  })

  it('adds a class on an element with existing classes', () => {
    const tag = createJSXTag('button')
    addAttributeToJSXTag(tag, 'className', 'button')

    addClassStringOnJSXTag(tag, 'primary')
    expect(tag.openingElement.attributes[0].type).toBe('JSXAttribute')

    const classAttr = tag.openingElement.attributes[0] as JSXAttribute
    expect(classAttr.name.name).toBe('className')
    expect((classAttr.value as StringLiteral).value).toBe('button primary')
  })
})

describe('addAttributeToJSXTag', () => {
  it('adds an attribute with no value', () => {
    const tag = createJSXTag('button')

    addAttributeToJSXTag(tag, 'disabled')
    expect(tag.openingElement.attributes[0].type).toBe('JSXAttribute')

    const classAttr = tag.openingElement.attributes[0] as JSXAttribute
    expect(classAttr.name.name).toBe('disabled')
    expect(classAttr.value).toBe(null)
  })

  it('adds an attribute with the selected value', () => {
    const tag = createJSXTag('button')

    addAttributeToJSXTag(tag, 'data-attr', 'random-value')
    expect(tag.openingElement.attributes[0].type).toBe('JSXAttribute')

    const classAttr = tag.openingElement.attributes[0] as JSXAttribute
    expect(classAttr.name.name).toBe('data-attr')
    expect((classAttr.value as StringLiteral).value).toBe('random-value')
  })

  it('adds an attribute as a JSX expression when non-string', () => {
    const tag = createJSXTag('button')

    addAttributeToJSXTag(tag, 'data-attr', 1)
    expect(tag.openingElement.attributes[0].type).toBe('JSXAttribute')

    const classAttr = tag.openingElement.attributes[0] as JSXAttribute
    expect(classAttr.name.name).toBe('data-attr')
    expect(((classAttr.value as JSXExpressionContainer).expression as NumberLiteral).value).toBe(1)
  })
})

describe('addDynamicAttributeToJSXTag', () => {
  it('adds the dynamic JSX expression on the opening tag', () => {
    const tag = createJSXTag('button')

    addDynamicAttributeToJSXTag(tag, 'dynamicValue', 'title')
    expect(tag.openingElement.attributes[0].type).toBe('JSXAttribute')

    const dynamicAttr = tag.openingElement.attributes[0] as JSXAttribute
    expect(dynamicAttr.value.type).toBe('JSXExpressionContainer')
    expect(((dynamicAttr.value as JSXExpressionContainer).expression as Identifier).name).toBe(
      'title'
    )
  })

  it('adds the dynamic JSX expression on the opening tag with prefix', () => {
    const tag = createJSXTag('button')

    addDynamicAttributeToJSXTag(tag, 'dynamicValue', 'title', 'props')
    expect(tag.openingElement.attributes[0].type).toBe('JSXAttribute')

    const dynamicAttr = tag.openingElement.attributes[0] as JSXAttribute
    expect(dynamicAttr.value.type).toBe('JSXExpressionContainer')
    expect((dynamicAttr.value as JSXExpressionContainer).expression.type).toBe('MemberExpression')
  })
})
