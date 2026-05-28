import * as hastUtils from '../../utils/hast-utils'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import {
  UIDLConditionalExpression,
  UIDLConditionalNode,
  HastNode,
  UIDLAttributeValue,
  UIDLEventHandlerStatement,
  UIDLElementNode,
  UIDLExpressionValue,
  UIDLDynamicReference,
  UIDLRawValue,
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
    case 'raw': {
      const rawValue = attrValue as UIDLRawValue
      if (rawValue.dynamic) {
        applyDynamicHtmlDirective(htmlNode, rawValue, params, templateSyntax, node)
        break
      }
      hastUtils.addAttributeToNode(htmlNode, attrKey, attrValue.content.toString())
      break
    }
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

// Used by the inline `renderingConditions` path on UIDLElement — identical
// semantics to `createConditionalStatement` except the reference / condition
// are supplied directly rather than extracted from a UIDLConditionalNode.
export const createInlineConditionalStatement = (
  reference: UIDLConditionalNode['content']['reference'],
  condition: UIDLConditionalExpression
): string => {
  if (reference.type === 'dynamic') {
    return createConditional(reference.content.id, condition)
  }
  return ''
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
    const { operation, operand, containsField } = conditions[0]
    return stringifyConditionalExpression(conditionalKey, operation, operand, containsField)
  }

  const stringConditions = conditions.map(({ operation, operand, containsField }) => {
    return `(${stringifyConditionalExpression(conditionalKey, operation, operand, containsField)})`
  })

  const joinOperator = matchingCriteria === 'all' ? '&&' : '||'
  return stringConditions.join(` ${joinOperator} `)
}

const stringifyOperandValue = (
  value: string | number | boolean | UIDLDynamicReference | UIDLExpressionValue
): string => {
  if (typeof value === 'string') {
    return `'${value}'`
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'object' && 'type' in value) {
    if (value.type === 'dynamic') {
      return value.content.id
    }
    if (value.type === 'expr') {
      return value.content
    }
  }
  return String(value)
}

const stringifyConditionalExpression = (
  identifier: string,
  operation: string,
  value: string | number | boolean | UIDLDynamicReference | UIDLExpressionValue,
  containsField?: string
) => {
  // Array/object operators
  if (operation === 'isEmpty') {
    return `${identifier}.length === 0`
  }
  if (operation === 'isNotEmpty') {
    return `${identifier}.length > 0`
  }
  if (operation === 'lengthEquals') {
    return `${identifier}.length === ${stringifyOperandValue(value)}`
  }
  if (operation === 'lengthGreaterThan') {
    return `${identifier}.length > ${stringifyOperandValue(value)}`
  }
  if (operation === 'lengthLessThan') {
    return `${identifier}.length < ${stringifyOperandValue(value)}`
  }
  if (operation === 'contains') {
    const operandStr = stringifyOperandValue(value)
    if (containsField) {
      return `${identifier}.some(item => item.${containsField} === ${operandStr})`
    }
    return `${identifier}.includes(${operandStr})`
  }
  if (operation === 'notContains') {
    const operandStr = stringifyOperandValue(value)
    if (containsField) {
      return `!${identifier}.some(item => item.${containsField} === ${operandStr})`
    }
    return `!${identifier}.includes(${operandStr})`
  }
  if (operation === 'hasKey') {
    return `Object.prototype.hasOwnProperty.call(${identifier}, ${stringifyOperandValue(value)})`
  }
  if (operation === 'notHasKey') {
    return `!Object.prototype.hasOwnProperty.call(${identifier}, ${stringifyOperandValue(value)})`
  }

  // Standard operators
  if (typeof value === 'boolean') {
    return `${value ? '' : '!'}${identifier}`
  }

  if (typeof value === 'string') {
    return `${identifier} ${operation} '${value}'`
  }

  if (typeof value === 'number') {
    return `${identifier} ${operation} ${value}`
  }

  if (value.type === 'dynamic') {
    return `${identifier} ${operation} ${value.content.id}`
  }

  if (value.type === 'expr') {
    return `${identifier} ${operation} ${value.content}`
  }

  return `${identifier} ${operation} ${value}`
}

const applyDynamicHtmlDirective = (
  htmlNode: HastNode,
  rawValue: UIDLRawValue,
  params: HTMLTemplateGenerationParams,
  templateSyntax: HTMLTemplateSyntax,
  node: UIDLElementNode
) => {
  const dynamicRef = rawValue.dynamic
  const { id, refPath } = dynamicRef.content
  const idWithPath = UIDLUtils.generateIdWithRefPath(id, refPath)
  const fallbackContent = rawValue.fallback || rawValue.content
  const fallbackVarName = `htmlFallback${StringUtils.generateRandomString()}`
  params.dataObject[fallbackVarName] = fallbackContent
  const expression = `${idWithPath} || ${fallbackVarName}`

  const directiveKey = templateSyntax.domHTMLInjection || 'innerHTML'
  htmlNode.tagName = 'span'
  hastUtils.addAttributeToNode(htmlNode, directiveKey, expression)

  const elementType = node.content.elementType
  if (params.dependencies[elementType]?.path?.includes('dangerous-html')) {
    delete params.dependencies[elementType]
  }
}
