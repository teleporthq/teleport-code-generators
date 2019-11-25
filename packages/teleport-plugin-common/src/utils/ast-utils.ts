import * as types from '@babel/types'
import ParsedASTNode from './parsed-ast'
import { StringUtils } from '@teleporthq/teleport-shared'
/**
 * Adds a class definition string to an existing string of classes
 */
export const addClassStringOnJSXTag = (
  jsxNode: types.JSXElement,
  classString: string,
  classAttributeName?: string
) => {
  const classAttribute = getClassAttribute(jsxNode, { createIfNotFound: true, classAttributeName })
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
  { createIfNotFound = false, classAttributeName = 'className' },
  t = types
): types.JSXAttribute => {
  const classNameAttribute = jsxNode.openingElement.attributes.find((attribute) => {
    return attribute.type === 'JSXAttribute' && attribute.name.name === classAttributeName
  })

  if (!classNameAttribute && createIfNotFound) {
    const createdClassAttribute = t.jsxAttribute(
      t.jsxIdentifier(classAttributeName),
      t.stringLiteral('')
    )

    jsxNode.openingElement.attributes.push(createdClassAttribute)
    return createdClassAttribute
  }

  return classNameAttribute as types.JSXAttribute
}

/**
 * Makes `${name}={${prefix}.${value}}` happen in AST
 */
export const addDynamicAttributeToJSXTag = (
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
  attrName: string,
  attrValue?: any,
  t = types
) => {
  const nameOfAttribute = t.jsxIdentifier(attrName)
  let attributeDefinition
  if (typeof attrValue === 'boolean') {
    attributeDefinition = t.jsxAttribute(nameOfAttribute)
  } else {
    attributeDefinition = t.jsxAttribute(
      nameOfAttribute,
      getProperAttributeValueAssignment(attrValue)
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
    return t.stringLiteral(StringUtils.encode(value))
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

export const addSpreadAttributeToJSXTag = (
  jsxTag: types.JSXElement,
  attrName: string,
  t = types
) => {
  jsxTag.openingElement.attributes.push(t.jsxSpreadAttribute(t.identifier(attrName)))
}

export const renameJSXTag = (jsxTag: types.JSXElement, newName: string, t = types) => {
  jsxTag.openingElement.name = t.jsxIdentifier(newName)
  if (jsxTag.closingElement) {
    jsxTag.closingElement.name = t.jsxIdentifier(newName)
  }
}

export const objectToObjectExpression = (objectMap: { [key: string]: any }, t = types) => {
  const props = Object.keys(objectMap).reduce((acc: any[], key) => {
    const keyIdentifier = t.stringLiteral(key)
    const value = objectMap[key]
    let computedLiteralValue: any = null

    if (value instanceof ParsedASTNode || value.constructor.name === 'ParsedASTNode') {
      computedLiteralValue = value.ast
    } else if (typeof value === 'boolean') {
      computedLiteralValue = t.booleanLiteral(value)
    } else if (typeof value === 'string') {
      computedLiteralValue = t.stringLiteral(value)
    } else if (typeof value === 'number') {
      computedLiteralValue = t.numericLiteral(value)
    } else if (Array.isArray(value)) {
      computedLiteralValue = t.arrayExpression(
        value.map((element) => convertValueToLiteral(element))
      )
    } else if (value === Object) {
      computedLiteralValue = t.identifier('Object')
    } else if (typeof value === 'object') {
      computedLiteralValue = objectToObjectExpression(value, t)
    } else if (value === String) {
      computedLiteralValue = t.identifier('String')
    } else if (value === Number) {
      computedLiteralValue = t.identifier('Number')
    } else if (value === Array) {
      computedLiteralValue = t.identifier('Array')
    }

    if (computedLiteralValue) {
      acc.push(t.objectProperty(keyIdentifier, computedLiteralValue))
    }

    return acc
  }, [])

  const objectExpression = t.objectExpression(props)
  return objectExpression
}

type ExpressionLiteral =
  | types.StringLiteral
  | types.BooleanLiteral
  | types.NumberLiteral
  | types.Identifier
  | types.ArrayExpression
  | types.ObjectExpression
  | types.NullLiteral

export const convertValueToLiteral = (
  value: any,
  explicitType: string = '',
  t = types
): ExpressionLiteral => {
  if (value === undefined || value === null) {
    return t.nullLiteral()
  }

  if (Array.isArray(value)) {
    return t.arrayExpression(value.map((val) => convertValueToLiteral(val)))
  }

  const typeToCompare = explicitType ? explicitType : typeof value
  switch (typeToCompare) {
    case 'string':
      return t.stringLiteral(value)
    case 'boolean':
      return t.booleanLiteral(value)
    case 'number':
      return t.numericLiteral(value)
    case 'object':
      return objectToObjectExpression(value)
    default:
      return t.identifier(value.toString())
  }
}

export const addPropertyToASTObject = (
  obj: types.ObjectExpression,
  key: string,
  value: any,
  t = types
) => {
  obj.properties.push(t.objectProperty(t.identifier(key), convertValueToLiteral(value)))
}

export const getTSAnnotationForType = (type: any, t = types) => {
  switch (type) {
    case 'string':
      return t.tsStringKeyword()
    case 'number':
      return t.tsNumberKeyword()
    case 'boolean':
      return t.tsBooleanKeyword()
    default:
      return t.tsUnknownKeyword()
  }
}

export const findAttributeByName = (jsxTag: types.JSXElement, attrName: string) => {
  return jsxTag.openingElement.attributes.find(
    (attr) => attr.type === 'JSXAttribute' && attr.name.name === attrName
  ) as types.JSXAttribute
}

export const removeAttributeByName = (jsxTag: types.JSXElement, attrName: string) => {
  jsxTag.openingElement.attributes = jsxTag.openingElement.attributes.filter(
    (attr) =>
      attr.type === 'JSXSpreadAttribute' ||
      (attr.type === 'JSXAttribute' && attr.name.name !== attrName)
  )
}
