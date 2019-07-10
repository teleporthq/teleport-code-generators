import * as types from 'typescript'

import {
  AttributeAssignCodeMod,
  EventHandlerStatement,
  ComponentUIDL,
  ComponentDependency,
  HastNode,
  NodeSyntaxGenerator,
  UIDLConditionalNode,
  UIDLConditionalExpression,
  UIDLElementNode,
  UIDLStateDefinition,
  UIDLRepeatNode,
} from '@teleporthq/teleport-types'
import * as htmlUtils from '@teleporthq/teleport-shared/lib/utils/html-utils'
import { getComponentFileName } from '@teleporthq/teleport-shared/lib/utils/uidl-utils'
import { createHTMLNode } from '@teleporthq/teleport-shared/lib/builders/html-builders'
import {
  capitalize,
  dashCaseToUpperCamelCase,
} from '@teleporthq/teleport-shared/lib/utils/string-utils'

import {
  createInputDecoratorAST,
  createDefaultClassComponent,
  createComponentDecoratorAST,
  createConstructorAST,
  createProperyDeclerationAST,
} from '@teleporthq/teleport-typescript-builder'
import { ERROR_LOG_NAME, INPUT_DEPENDENCY } from './constants'

interface AngularComponentAccumulators {
  templateLookup: Record<string, any>
  dependencies: Record<string, ComponentDependency>
  dataObject: Record<string, any>
  methodsObject: Record<string, EventHandlerStatement[]>
}

export const generateNodeSyntax: NodeSyntaxGenerator<
  AngularComponentAccumulators,
  string | HastNode
> = (node, accumulators) => {
  switch (node.type) {
    case 'static':
      return node.content.toString()

    case 'element':
      return generateElementNode(node, accumulators)

    case 'dynamic':
      return `{{${node.content.id}}}`

    case 'conditional':
      return generateConditionalNode(node, accumulators)

    case 'repeat':
      return generateRepeatNode(node, accumulators)

    default:
      throw new Error(
        `${ERROR_LOG_NAME} generateNodeSyntax encountered a node of unsupported type: ${JSON.stringify(
          node,
          null,
          2
        )}`
      )
  }
}

export const generateRepeatNode = (
  node: UIDLRepeatNode,
  accumulators: AngularComponentAccumulators
) => {
  const { dataSource, node: repeatContent, meta = {} } = node.content
  const repeatContentTag = generateNodeSyntax(repeatContent, accumulators)

  if (typeof repeatContentTag === 'string') {
    throw new Error(
      `${ERROR_LOG_NAME} generateRepeatNode received an invalid content ${repeatContentTag}`
    )
  }

  const dataObjectIdentifier = meta.dataSourceIdentifier || `items`
  accumulators.dataObject[dataObjectIdentifier] = dataSource.content

  const indexTag = meta.useIndex ? `; let i = index` : ''

  htmlUtils.addAttributeToNode(
    repeatContentTag,
    '*ngFor',
    `${meta.iteratorName} of ${dataObjectIdentifier}${indexTag}`
  )
  return repeatContentTag
}

export const generateElementNode = (
  node: UIDLElementNode,
  accumulators: AngularComponentAccumulators
) => {
  const { dependencies, dataObject, methodsObject, templateLookup } = accumulators
  const { elementType, name, key, children, attrs, dependency, events } = node.content
  const htmlNode = createHTMLNode(elementType)

  if (dependency) {
    dependencies[elementType] = { ...dependency }
  }

  if (attrs) {
    Object.keys(attrs).forEach((attrKey) => {
      const attrValue = attrs[attrKey]
      // TODO change/fix via #136
      if (attrValue.type === 'static' && Array.isArray(attrValue.content)) {
        const dataObjectIdentifier = `${name}${capitalize(attrKey)}`
        dataObject[dataObjectIdentifier] = attrValue.content
        htmlUtils.addAttributeToNode(htmlNode, `:${attrKey}`, dataObjectIdentifier)
      } else {
        addAttributeToNode(htmlNode, attrKey, attrs[attrKey])
      }
    })
  }

  if (events) {
    Object.keys(events).forEach((eventKey) => {
      const eventHandlerKey = `@${eventKey}`
      if (events[eventKey].length === 1) {
        const statement = events[eventKey][0]
        const isPropEvent = statement && statement.type === 'propCall' && statement.calls

        if (isPropEvent) {
          htmlUtils.addAttributeToNode(
            htmlNode,
            eventHandlerKey,
            `this.$emit('${statement.calls}')`
          )
        } else {
          htmlUtils.addAttributeToNode(
            htmlNode,
            eventHandlerKey,
            statement.newState === '$toggle'
              ? `${statement.modifies} = !${statement.modifies}`
              : `${statement.modifies} = ${statement.newState}`
          )
        }
      } else {
        const methodName = `handle${dashCaseToUpperCamelCase(name)}${dashCaseToUpperCamelCase(
          eventKey
        )}`
        methodsObject[methodName] = events[eventKey]
        htmlUtils.addAttributeToNode(htmlNode, eventHandlerKey, methodName)
      }
    })
  }

  if (children) {
    children.forEach((child) => {
      const childTag = generateNodeSyntax(child, accumulators)

      if (typeof childTag === 'string') {
        htmlUtils.addTextNode(htmlNode, childTag)
      } else {
        htmlUtils.addChildNode(htmlNode, childTag)
      }
    })
  }

  templateLookup[key] = htmlNode
  return htmlNode
}

const addAttributeToNode: AttributeAssignCodeMod<HastNode> = (
  htmlNode,
  attributeKey,
  attributeValue
) => {
  switch (attributeValue.type) {
    case 'dynamic':
      const {
        content: { id },
      } = attributeValue
      htmlUtils.addAttributeToNode(htmlNode, `:${attributeKey}`, id)
      return
    case 'static':
      const primitiveValue = attributeValue.content
      if (typeof attributeValue.content === 'boolean') {
        htmlUtils.addBooleanAttributeToNode(htmlNode, attributeKey)
      } else if (typeof attributeValue.content !== 'string') {
        htmlUtils.addAttributeToNode(htmlNode, `:${attributeKey}`, primitiveValue.toString())
      } else {
        htmlUtils.addAttributeToNode(htmlNode, attributeKey, primitiveValue.toString())
      }
      return
    default:
      throw new Error(
        `${ERROR_LOG_NAME} addAttributeToNode could not generate code for assignment of type ${JSON.stringify(
          attributeValue
        )}`
      )
  }
}

export const generateConditionalNode = (
  node: UIDLConditionalNode,
  accumulators: AngularComponentAccumulators
) => {
  let conditionalTag = generateNodeSyntax(node.content.node, accumulators)
  if (typeof conditionalTag === 'string') {
    const wrappingSpan = createHTMLNode('span')
    htmlUtils.addTextNode(wrappingSpan, conditionalTag)
    conditionalTag = wrappingSpan
  }

  const conditionalStatement = generateConditionalStatement(node)
  htmlUtils.addAttributeToNode(conditionalTag, '*ngIf', conditionalStatement)
  return conditionalTag
}

const generateConditionalStatement = (node: UIDLConditionalNode) => {
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

export const generateAngularComponentTS = (
  uidl: ComponentUIDL,
  dataObject: Record<string, any>,
  methodsObject: Record<string, EventHandlerStatement[]>,
  dependencies: Record<string, ComponentDependency>
) => {
  const constructorStatements: any = []
  const statements: any = []
  let property: types.PropertyDeclaration
  const stateObjects = uidl.stateDefinitions
  const propObjects = uidl.propDefinitions
  const componentName = getComponentFileName(uidl)

  if (dataObject) {
    Object.keys(dataObject).map((key) => {
      if (dataObject[key].referenceType === 'prop') {
        dependencies.Input = INPUT_DEPENDENCY

        property = createInputDecoratorAST(
          key,
          propObjects[key].defaultValue,
          propObjects[key].type
        )
      } else {
        property = createProperyDeclerationAST(key, dataObject[key], stateObjects[key].type)
      }

      statements.push(property)
    })
  }

  const constructorAST = createConstructorAST(constructorStatements)
  statements.push(constructorAST)

  return [
    createComponentDecoratorAST('app-root', `./${componentName}.html`, `./${componentName}.css`),
    createDefaultClassComponent(statements),
  ]
}

export const extractStateObject = (stateDefinitions: Record<string, UIDLStateDefinition>) => {
  return Object.keys(stateDefinitions).reduce((result, key) => {
    result[key] = stateDefinitions[key].defaultValue
    return result
  }, {})
}
