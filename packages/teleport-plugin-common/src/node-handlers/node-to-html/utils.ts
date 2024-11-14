import * as hastUtils from '../../utils/hast-utils'
import { StringUtils } from '@teleporthq/teleport-shared'
import {
  UIDLConditionalExpression,
  UIDLConditionalNode,
  HastNode,
  UIDLAttributeValue,
  UIDLEventHandlerStatement,
  UIDLElementNode,
} from '@teleporthq/teleport-types'
import { HTMLTemplateGenerationParams, HTMLTemplateSyntax } from './types'
import { createHTMLNode } from '../../builders/hast-builders'
import generateElementNode from '../node-to-html'

export const handleAttribute = (
  htmlNode: HastNode,
  elementName: string,
  attrKey: string,
  attrValue: UIDLAttributeValue,
  params: HTMLTemplateGenerationParams,
  templateSyntax: HTMLTemplateSyntax,
  node: UIDLElementNode
) => {
  const { dataObject } = params
  const dynamicAttrKey = templateSyntax.valueBinding(attrKey, node)
  switch (attrValue.type) {
    case 'dynamic':
    case 'import':
      hastUtils.addAttributeToNode(htmlNode, dynamicAttrKey, attrValue.content.id)
      break
    case 'comp-style':
      hastUtils.addAttributeToNode(
        htmlNode,
        attrKey,
        StringUtils.encode(attrValue.content.toString())
      )
      break
    case 'raw':
      hastUtils.addAttributeToNode(htmlNode, attrKey, attrValue.content.toString())
      break
    case 'static':
      if (Array.isArray(attrValue.content)) {
        // This handles the cases when arrays are sent as props or passed as attributes
        // The array will be placed on the dataObject and the data reference is placed on the node
        const dataObjectIdentifier = `${elementName}${StringUtils.capitalize(attrKey)}`
        dataObject[dataObjectIdentifier] = attrValue.content
        hastUtils.addAttributeToNode(htmlNode, dynamicAttrKey, dataObjectIdentifier)
      } else if (typeof attrValue.content === 'boolean') {
        attrValue.content === true
          ? hastUtils.addBooleanAttributeToNode(htmlNode, attrKey)
          : hastUtils.addBooleanAttributeToNode(htmlNode, dynamicAttrKey, false)
      } else if (typeof attrValue.content === 'string') {
        hastUtils.addAttributeToNode(
          htmlNode,
          attrKey,
          StringUtils.encode(attrValue.content.toString())
        )
      } else {
        // For numbers and values that are passed to components and maintain their type
        hastUtils.addAttributeToNode(htmlNode, dynamicAttrKey, attrValue.content.toString())
      }
      break

    case 'element':
      const templateNode = createHTMLNode(templateSyntax.slotTagName)
      const templateContent = generateElementNode(attrValue, params, templateSyntax)

      if (templateSyntax.slotBinding === 'v-slot') {
        hastUtils.addBooleanAttributeToNode(
          templateNode,
          `${templateSyntax.slotBinding}:${attrKey}`
        )
      } else {
        hastUtils.addBooleanAttributeToNode(templateNode, `${templateSyntax.slotBinding}${attrKey}`)
      }

      hastUtils.addChildNode(templateNode, templateContent)
      hastUtils.addChildNode(htmlNode, templateNode)
      break

    case 'object': {
      dataObject[attrKey] = attrValue.content
      hastUtils.addAttributeToNode(htmlNode, dynamicAttrKey, attrKey)
      break
    }

    case 'expr':
      // TODO: Check this in the future. Not throwing an error for now
      console.info(`Expressions are not supported in HTML templates`)
      break

    default:
      throw new Error(
        `generateElementNode could not generate code for attribute of type ${JSON.stringify(
          attrValue
        )}`
      )
  }
}

export const handleEvent = (
  htmlNode: HastNode,
  elementName: string,
  eventKey: string,
  eventHandlerStatements: UIDLEventHandlerStatement[],
  params: HTMLTemplateGenerationParams,
  templateSyntax: HTMLTemplateSyntax
) => {
  const { methodsObject } = params
  const eventHandlerKey = templateSyntax.eventBinding(eventKey)

  if (eventHandlerStatements.length === 1) {
    const statement = eventHandlerStatements[0]

    if (statement.type === 'propCall' && statement.calls) {
      const eventEmitter = templateSyntax.eventEmmitter(statement.calls)
      hastUtils.addAttributeToNode(htmlNode, eventHandlerKey, eventEmitter)
    }

    if (statement.type === 'stateChange') {
      hastUtils.addAttributeToNode(
        htmlNode,
        eventHandlerKey,
        statement.newState === '$toggle'
          ? `${statement.modifies} = !${statement.modifies}`
          : `${statement.modifies} = ${statement.newState}`
      )
    }
  } else {
    const methodName = `handle${StringUtils.dashCaseToUpperCamelCase(
      elementName
    )}${StringUtils.dashCaseToUpperCamelCase(eventKey)}`
    const eventNameBiding = templateSyntax.eventHandlersBindingMode
      ? templateSyntax.eventHandlersBindingMode(methodName)
      : methodName

    methodsObject[methodName] = eventHandlerStatements
    hastUtils.addAttributeToNode(htmlNode, eventHandlerKey, eventNameBiding)
  }
}

export const createConditionalStatement = (node: UIDLConditionalNode): string => {
  const { node: childNode, reference, value, condition } = node.content

  const expression = standardizeUIDLConditionalExpression(value, condition)
  if (reference.type === 'dynamic') {
    const statement = createConditional(reference.content.id, expression)

    if (childNode.type === 'conditional') {
      return `${statement} && ${createConditionalStatement(childNode)}`
    }

    return statement
  }

  // expression nodes are not supported in html based templates.
  if (reference.type === 'expr') {
    return ''
  }
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

const createConditional = (
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
    // @todo
    // unlike jsx code generation, we are not converting the operand to binary or unary operation.
    // Please refer to https://github.com/teleporthq/teleport-code-generators/blob/development/packages/teleport-plugin-common/src/node-handlers/node-to-jsx/utils.ts#L303-L319
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
