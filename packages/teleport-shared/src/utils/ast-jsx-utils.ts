import * as types from '@babel/types'
import { objectToObjectExpression, convertValueToLiteral } from './ast-js-utils'

/**
 * Adds a class definition string to an existing string of classes
 */
export const addClassStringOnJSXTag = (
  jsxNode: types.JSXElement,
  classString: string,
  t = types
) => {
  const classAttribute = getClassAttribute(jsxNode, { createIfNotFound: true }, t)
  if (classAttribute.value && classAttribute.value.type === 'StringLiteral') {
    const classArray = classAttribute.value.value.split(' ')
    classArray.push(classString)
    classAttribute.value.value = classArray.join(' ').trim()
  } else {
    throw new Error(
      'Attempted to set a class string literral on a jsx tag which had an invalid className attribute'
    )
  }
}

/**
 * Gets the existing className declaration attribute or generates and returns
 * a newly created and assigned one to the given JSXNode
 */
const getClassAttribute = (
  jsxNode: types.JSXElement,
  params: { createIfNotFound: boolean } = { createIfNotFound: false },
  t = types
): types.JSXAttribute => {
  const classNameAttribute = jsxNode.openingElement.attributes.find((attribute) => {
    return attribute.type === 'JSXAttribute' && attribute.name.name === 'className'
  })

  if (!classNameAttribute && params.createIfNotFound) {
    const createdClassAttribute = t.jsxAttribute(t.jsxIdentifier('className'), t.stringLiteral(''))

    jsxNode.openingElement.attributes.push(createdClassAttribute)
    return createdClassAttribute
  }

  return classNameAttribute as types.JSXAttribute
}

/**
 * Makes `${name}={${prefix}.${value}}` happen in AST
 *
 * @param jsxASTNode the jsx ast element
 * @param name the name of the prop
 * @param value the value of the prop (will be concatenated with props. before it)
 */
export const addDynamicAttributeOnTag = (
  jsxASTNode: types.JSXElement,
  name: string,
  value: string,
  prefix: string = '',
  t = types
) => {
  const content =
    prefix === ''
      ? t.identifier(value)
      : t.memberExpression(t.identifier(prefix), t.identifier(value))

  jsxASTNode.openingElement.attributes.push(
    t.jsxAttribute(t.jsxIdentifier(name), t.jsxExpressionContainer(content))
  )
}

export const stringAsTemplateLiteral = (str: string, t = types) => {
  const formmattedString = `
${str}
  `
  return t.templateLiteral(
    [
      t.templateElement(
        {
          raw: formmattedString,
          cooked: formmattedString,
        },
        true
      ),
    ],
    []
  )
}

export const addAttributeToJSXTag = (
  jsxNode: types.JSXElement,
  attribute: { name: string; value?: any },
  t = types
) => {
  const nameOfAttribute = t.jsxIdentifier(attribute.name)
  let attributeDefinition
  if (typeof attribute.value === 'boolean') {
    attributeDefinition = t.jsxAttribute(nameOfAttribute)
  } else {
    attributeDefinition = t.jsxAttribute(
      nameOfAttribute,
      getProperAttributeValueAssignment(attribute.value)
    )
  }
  jsxNode.openingElement.attributes.push(attributeDefinition)
}

/**
 * node must be a AST node element of type JSXElement (babel-types) or
 * equivalent
 */
const getProperAttributeValueAssignment = (value: any, t = types) => {
  if (!value) {
    return null
  }

  if (typeof value === 'string') {
    return t.stringLiteral(value)
  }

  return t.jsxExpressionContainer(convertValueToLiteral(value))
}

export const addChildJSXTag = (
  tag: types.JSXElement,
  childNode: types.JSXElement | types.JSXExpressionContainer,
  t = types
) => {
  tag.children.push(childNode, t.jsxText('\n'))
}

export const addChildJSXText = (tag: types.JSXElement, text: string, t = types) => {
  tag.children.push(t.jsxText(text), t.jsxText('\n'))
}

// TODO: Replace with generic add attribute?
export const addJSXTagStyles = (tag: types.JSXElement, styleMap: any, t = types) => {
  const styleObjectExpression = objectToObjectExpression(styleMap, t)
  const styleObjectExpressionContainer = t.jsxExpressionContainer(styleObjectExpression)

  const styleJSXAttr = t.jsxAttribute(t.jsxIdentifier('style'), styleObjectExpressionContainer)
  tag.openingElement.attributes.push(styleJSXAttr)
}
