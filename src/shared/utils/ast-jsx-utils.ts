import * as types from '@babel/types'
import { objectToObjectExpression, convertValueToLiteral } from './ast-js-utils'
import { UIDLConditionalExpression } from '../../typings/uidl-definitions'
import { ConditionalIdentifier } from '../../typings/generators'

type BinaryOperator =
  | '==='
  | '+'
  | '-'
  | '/'
  | '%'
  | '*'
  | '**'
  | '&'
  | '|'
  | '>>'
  | '>>>'
  | '<<'
  | '^'
  | '=='
  | '!='
  | '!=='
  | 'in'
  | 'instanceof'
  | '>'
  | '<'
  | '>='
  | '<='

type UnaryOperation = '+' | '-' | 'void' | 'throw' | 'delete' | '!' | '~' | 'typeof'

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

// TODO: Use generateASTDefinitionForJSXTag instead?
export const generateStyledJSXTag = (
  templateLiteral: string | types.TemplateLiteral,
  t = types
) => {
  if (typeof templateLiteral === 'string') {
    templateLiteral = stringAsTemplateLiteral(templateLiteral, t)
  }

  const jsxTagChild = t.jsxExpressionContainer(templateLiteral)
  const jsxTag = generateBasicJSXTag('style', [jsxTagChild, t.jsxText('\n')], t)
  addAttributeToJSXTag(jsxTag, { name: 'jsx' }, t)
  return jsxTag
}

const stringAsTemplateLiteral = (str: string, t = types) => {
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

const generateBasicJSXTag = (tagName: string, children: any[] = [], t = types) => {
  const jsxIdentifier = t.jsxIdentifier(tagName)
  const openingDiv = t.jsxOpeningElement(jsxIdentifier, [], false)
  const closingDiv = t.jsxClosingElement(jsxIdentifier)

  const tag = t.jsxElement(openingDiv, closingDiv, children, false)

  return tag
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

/**
 * Generates the AST definiton (without start/end position) for a JSX tag
 * with an opening and closing tag.
 *
 * t is the babel-types api which generates the JSON structure representing the AST.
 * This is set as a parameter to allow us to remove babel-types at some point if we
 * decide to, and to allow easier unit testing of the utils.
 *
 * Requires the tagName, which is a string that will be used to generate the
 * tag.
 *
 * Example:
 * generateASTDefinitionForJSXTag("div") will generate the AST
 * equivalent of <div></div>
 */
export const generateASTDefinitionForJSXTag = (tagName: string, t = types) => {
  const jsxIdentifier = t.jsxIdentifier(tagName)
  const openingDiv = t.jsxOpeningElement(jsxIdentifier, [], false)
  const closingDiv = t.jsxClosingElement(jsxIdentifier)

  const tag = t.jsxElement(openingDiv, closingDiv, [], false)

  return tag
}

export const addChildJSXTag = (
  tag: types.JSXElement,
  childNode: types.JSXElement | types.JSXExpressionContainer
) => {
  tag.children.push(childNode, types.jsxText('\n'))
}

export const addChildJSXText = (tag: types.JSXElement, text: string, t = types) => {
  tag.children.push(t.jsxText(text), types.jsxText('\n'))
}

// TODO: Replace with generic add attribute?
export const addJSXTagStyles = (tag: types.JSXElement, styleMap: any, t = types) => {
  const styleObjectExpression = objectToObjectExpression(styleMap, t)
  const styleObjectExpressionContainer = t.jsxExpressionContainer(styleObjectExpression)

  const styleJSXAttr = t.jsxAttribute(t.jsxIdentifier('style'), styleObjectExpressionContainer)
  tag.openingElement.attributes.push(styleJSXAttr)
}

export const createConditionalJSXExpression = (
  content: types.JSXElement | types.JSXExpressionContainer | string,
  conditionalExpression: UIDLConditionalExpression,
  conditionalIdentifier: ConditionalIdentifier,
  t = types
) => {
  let contentNode: types.Expression

  if (typeof content === 'string') {
    contentNode = t.stringLiteral(content)
  } else if ((content as types.JSXExpressionContainer).expression) {
    contentNode = (content as types.JSXExpressionContainer).expression as types.Expression
  } else {
    contentNode = content as types.JSXElement
  }

  let binaryExpression:
    | types.LogicalExpression
    | types.BinaryExpression
    | types.UnaryExpression
    | types.Identifier
    | types.MemberExpression

  // When the stateValue is an object we will compute a logical/binary expression on the left side
  const { conditions, matchingCriteria } = conditionalExpression
  const binaryExpressions = conditions.map((condition) =>
    createBinaryExpression(condition, conditionalIdentifier)
  )

  if (binaryExpressions.length === 1) {
    binaryExpression = binaryExpressions[0]
  } else {
    // the first two binary expressions are put together as a logical expression
    const [firstExp, secondExp] = binaryExpressions
    const operation = matchingCriteria === 'all' ? '&&' : '||'
    let expression: types.LogicalExpression = t.logicalExpression(operation, firstExp, secondExp)

    // accumulate the rest of the expressions to the logical expression
    for (let index = 2; index < binaryExpressions.length; index++) {
      expression = t.logicalExpression(operation, expression, binaryExpressions[index])
    }

    binaryExpression = expression
  }

  return t.jsxExpressionContainer(t.logicalExpression('&&', binaryExpression, contentNode))
}

export const createBinaryExpression = (
  condition: {
    operation: string
    operand?: string | number | boolean
  },
  conditionalIdentifier: ConditionalIdentifier,
  t = types
) => {
  const { operand, operation } = condition
  const identifier = conditionalIdentifier.prefix
    ? t.memberExpression(
        t.identifier(conditionalIdentifier.prefix),
        t.identifier(conditionalIdentifier.key)
      )
    : t.identifier(conditionalIdentifier.key)

  if (operation === '===') {
    if (operand === true) {
      return identifier
    }

    if (operand === false) {
      return t.unaryExpression('!', identifier)
    }
  }

  if (operand !== undefined) {
    const stateValueIdentifier = convertValueToLiteral(operand, conditionalIdentifier.type)

    return t.binaryExpression(convertToBinaryOperator(operation), identifier, stateValueIdentifier)
  } else {
    return operation ? t.unaryExpression(convertToUnaryOperator(operation), identifier) : identifier
  }
}

/**
 * Because of the restrictions of the AST Types we need to have a clear subset of binary operators we can use
 * @param operation - the operation defined in the UIDL for the current state branch
 */
const convertToBinaryOperator = (operation: string): BinaryOperator => {
  const allowedOperations = ['===', '!==', '>=', '<=', '>', '<']
  if (allowedOperations.includes(operation)) {
    return operation as BinaryOperator
  } else {
    return '==='
  }
}

const convertToUnaryOperator = (operation: string): UnaryOperation => {
  const allowedOperations = ['!']
  if (allowedOperations.includes(operation)) {
    return operation as UnaryOperation
  } else {
    return '!'
  }
}

export const createTernaryOperation = (
  stateKey: string,
  leftNode: types.JSXElement | types.StringLiteral,
  rightNode: types.JSXElement | types.StringLiteral,
  t = types
) => {
  return types.jsxExpressionContainer(
    types.conditionalExpression(types.identifier(stateKey), leftNode, rightNode)
  )
}
