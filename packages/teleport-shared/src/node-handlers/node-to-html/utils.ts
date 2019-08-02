import * as htmlUtils from '../../utils/html-utils'
import {
  UIDLConditionalExpression,
  UIDLConditionalNode,
  HastNode,
} from '@teleporthq/teleport-types'

export const addStaticAttributeToNode = (
  htmlNode: HastNode,
  attrKey: string,
  attrValue: any,
  overrideType?: string
) => {
  const typeOfValue = overrideType || typeof attrValue
  switch (typeOfValue) {
    case 'boolean':
      htmlUtils.addBooleanAttributeToNode(htmlNode, attrKey)
      break
    case 'string':
      htmlUtils.addAttributeToNode(htmlNode, attrKey, attrValue.toString())
      break
    default:
      // number or any other non-string
      htmlUtils.addAttributeToNode(htmlNode, `:${attrKey}`, attrValue.toString())
  }
}

export const addDynamicAttributeToNode = (
  htmlNode: HastNode,
  attrKey: string,
  attrReferenceValue: string
) => {
  htmlUtils.addAttributeToNode(htmlNode, `:${attrKey}`, attrReferenceValue)
}

export const generateConditionalStatement = (node: UIDLConditionalNode) => {
  const { node: childNode, reference, value, condition } = node.content

  const expression = standardizeUIDLConditionalExpression(value, condition)
  const statement = createConditionalStatement(reference.content.id, expression)

  if (childNode.type === 'conditional') {
    return `${statement} && ${generateConditionalStatement(childNode)}`
  }

  return statement
}

const standardizeUIDLConditionalExpression = (
  value: string | number | boolean,
  condition: UIDLConditionalExpression
) => {
  const conditionalExpression: UIDLConditionalExpression =
    value !== null && value !== undefined
      ? { conditions: [{ operand: value, operation: '===' }] }
      : condition
  return conditionalExpression
}

const createConditionalStatement = (
  conditionalKey: string,
  conditionalExpression: UIDLConditionalExpression
) => {
  const { matchingCriteria, conditions } = conditionalExpression
  if (conditions.length === 1) {
    // Separate handling for single condition to avoid unnecessary () around
    const { operation, operand } = conditions[0]
    return stringifyConditionalExpression(conditionalKey, operation, operand)
  }

  const stringConditions = conditions.map(({ operation, operand }) => {
    return `(${stringifyConditionalExpression(conditionalKey, operation, operand)})`
  })

  const joinOperator = matchingCriteria === 'all' ? '&&' : '||'
  return stringConditions.join(` ${joinOperator} `)
}

const stringifyConditionalExpression = (
  identifier: string,
  operation: string,
  value: string | number | boolean
) => {
  if (typeof value === 'boolean') {
    return `${value ? '' : '!'}${identifier}`
  }

  if (typeof value === 'string') {
    return `${identifier} ${operation} '${value}'`
  }

  return `${identifier} ${operation} ${value}`
}
