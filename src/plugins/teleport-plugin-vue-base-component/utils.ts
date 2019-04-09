import * as types from '@babel/types'

import * as htmlUtils from '../../shared/utils/html-utils'
import { objectToObjectExpression, convertValueToLiteral } from '../../shared/utils/ast-js-utils'
import { capitalize, stringToUpperCamelCase } from '../../shared/utils/string-utils'
import {
  UIDLPropDefinition,
  UIDLStateDefinition,
  EventHandlerStatement,
  ComponentUIDL,
  UIDLConditionalExpression,
  ComponentDependency,
  UIDLElementNode,
  UIDLRepeatNode,
  UIDLConditionalNode,
  UIDLSlotNode,
} from '../../typings/uidl-definitions'
import { NodeSyntaxGenerator, HastNode, AttributeAssignCodeMod } from '../../typings/generators'

import { ERROR_LOG_NAME } from '.'

interface VueComponentAccumulators {
  templateLookup: Record<string, any>
  dependencies: Record<string, ComponentDependency>
  dataObject: Record<string, any>
  methodsObject: Record<string, EventHandlerStatement[]>
}

export const generateElementNode = (
  node: UIDLElementNode,
  accumulators: VueComponentAccumulators
) => {
  const { dependencies, dataObject, methodsObject, templateLookup } = accumulators
  const { elementType, name, key, children, attrs, dependency, events } = node.content
  const htmlNode = htmlUtils.createHTMLNode(elementType)

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
        const methodName = `handle${stringToUpperCamelCase(name)}${stringToUpperCamelCase(
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

export const generateRepeatNode = (
  node: UIDLRepeatNode,
  accumulators: VueComponentAccumulators
) => {
  const { dataSource, node: repeatContent, meta = {} } = node.content
  const repeatContentTag = generateNodeSyntax(repeatContent, accumulators)

  let dataObjectIdentifier = meta.dataSourceIdentifier || `items`
  if (dataSource.type === 'dynamic') {
    dataObjectIdentifier = dataSource.content.id
  } else {
    accumulators.dataObject[dataObjectIdentifier] = dataSource.content
  }

  const iteratorName = meta.iteratorName || 'item'
  const iterator = meta.useIndex ? `(${iteratorName}, index)` : iteratorName
  const keyIdentifier = meta.useIndex ? 'index' : iteratorName

  if (typeof repeatContentTag === 'string') {
    throw new Error(
      `${ERROR_LOG_NAME} generateRepeatNode received an invalid content ${repeatContentTag}`
    )
  }

  htmlUtils.addAttributeToNode(repeatContentTag, 'v-for', `${iterator} in ${dataObjectIdentifier}`)
  htmlUtils.addAttributeToNode(repeatContentTag, ':key', `${keyIdentifier}`)
  return repeatContentTag
}

export const generateConditionalNode = (
  node: UIDLConditionalNode,
  accumulators: VueComponentAccumulators
) => {
  const { reference, value } = node.content
  const conditionalKey = reference.content.id

  // 'v-if' needs to be added on a tag, so in case of a text node we wrap it with
  // a 'span' which is the less intrusive of all

  let conditionalTag = generateNodeSyntax(node.content.node, accumulators)

  const condition: UIDLConditionalExpression =
    value !== null && value !== undefined
      ? { conditions: [{ operand: value, operation: '===' }] }
      : node.content.condition

  const conditionalStatement = createConditionalStatement(conditionalKey, condition)

  if (typeof conditionalTag === 'string') {
    const wrappingSpan = htmlUtils.createHTMLNode('span')
    htmlUtils.addTextNode(wrappingSpan, conditionalTag)
    conditionalTag = wrappingSpan
  }

  htmlUtils.addAttributeToNode(conditionalTag, 'v-if', conditionalStatement)
  return conditionalTag
}

export const generateSlotNode = (node: UIDLSlotNode, accumulators: VueComponentAccumulators) => {
  const slotNode = htmlUtils.createHTMLNode('slot')

  if (node.content.name) {
    htmlUtils.addAttributeToNode(slotNode, 'name', node.content.name)
  }

  if (node.content.fallback) {
    const { fallback } = node.content
    const fallbackContent = generateNodeSyntax(fallback, accumulators)

    if (typeof fallbackContent === 'string') {
      htmlUtils.addTextNode(slotNode, fallbackContent)
    } else {
      htmlUtils.addChildNode(slotNode, fallbackContent)
    }
  }

  return slotNode
}

export const generateNodeSyntax: NodeSyntaxGenerator<
  VueComponentAccumulators,
  string | HastNode
> = (node, accumulators) => {
  switch (node.type) {
    case 'static':
      return node.content.toString()

    case 'dynamic':
      return `{{${node.content.id}}}`

    case 'element':
      return generateElementNode(node, accumulators)

    case 'repeat':
      return generateRepeatNode(node, accumulators)

    case 'conditional':
      return generateConditionalNode(node, accumulators)

    case 'slot':
      return generateSlotNode(node, accumulators)

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

export const extractStateObject = (stateDefinitions: Record<string, UIDLStateDefinition>) => {
  return Object.keys(stateDefinitions).reduce((result, key) => {
    result[key] = stateDefinitions[key].defaultValue
    return result
  }, {})
}

export const generateVueComponentJS = (
  uidl: ComponentUIDL,
  componentDependencies: string[],
  dataObject: Record<string, any>,
  methodsObject: Record<string, EventHandlerStatement[]>,
  t = types
) => {
  const vueObjectProperties = []

  if (uidl.propDefinitions) {
    const props = createVuePropsDefinition(uidl.propDefinitions)
    const propsAST = objectToObjectExpression(props)
    vueObjectProperties.push(t.objectProperty(t.identifier('props'), propsAST))
  }

  if (componentDependencies.length) {
    const componentsAST = t.objectExpression([
      ...componentDependencies.map((declarationName) => {
        return t.objectProperty(
          t.identifier(declarationName),
          t.identifier(declarationName),
          false,
          true
        )
      }),
    ])
    vueObjectProperties.push(t.objectProperty(t.identifier('components'), componentsAST))
  }

  if (Object.keys(dataObject).length > 0) {
    const dataAST = objectToObjectExpression(dataObject)
    vueObjectProperties.push(
      t.objectMethod(
        'method',
        t.identifier('data'),
        [],
        t.blockStatement([t.returnStatement(dataAST)])
      )
    )
  }

  if (Object.keys(methodsObject).length > 0) {
    const methodsAST = createMethodsObject(methodsObject, uidl.propDefinitions)
    vueObjectProperties.push(
      t.objectProperty(t.identifier('methods'), t.objectExpression(methodsAST))
    )
  }

  return t.exportDefaultDeclaration(
    t.objectExpression([
      t.objectProperty(t.identifier('name'), t.stringLiteral(uidl.name)),
      ...vueObjectProperties,
    ])
  )
}

const createVuePropsDefinition = (uidlPropDefinitions: Record<string, UIDLPropDefinition>) => {
  return Object.keys(uidlPropDefinitions).reduce((acc: { [key: string]: any }, name) => {
    let mappedType
    const { type, defaultValue } = uidlPropDefinitions[name]
    switch (type) {
      case 'string':
        mappedType = String
        break
      case 'number':
        mappedType = Number
        break
      case 'boolean':
        mappedType = Boolean
        break
      case 'array':
        mappedType = Array
        break
      case 'object':
        mappedType = Object
        break
      case 'func':
        mappedType = Function
        break
      default:
        // don't handle anything else
        throw new Error(
          `createVuePropsDefinition encountered a unknown PropDefinition, ${JSON.stringify(
            uidlPropDefinitions[name]
          )}`
        )
    }

    acc[name] = defaultValue ? { type: mappedType, default: defaultValue } : mappedType
    return acc
  }, {})
}

const createMethodsObject = (
  methods: Record<string, EventHandlerStatement[]>,
  propDefinitions: Record<string, UIDLPropDefinition>,
  t = types
) => {
  return Object.keys(methods).map((eventKey) => {
    const astStatements = []
    methods[eventKey].map((statement) => {
      const astStatement =
        statement.type === 'propCall'
          ? createPropCallStatement(statement, propDefinitions)
          : createStateChangeStatement(statement)

      if (astStatement) {
        astStatements.push(astStatement)
      }
    })
    return t.objectMethod('method', t.identifier(eventKey), [], t.blockStatement(astStatements))
  })
}

const createStateChangeStatement = (statement: EventHandlerStatement, t = types) => {
  const { modifies, newState } = statement

  const rightOperand =
    newState === '$toggle'
      ? t.unaryExpression('!', t.memberExpression(t.identifier('this'), t.identifier(modifies)))
      : convertValueToLiteral(newState)

  return t.expressionStatement(
    t.assignmentExpression(
      '=',
      t.memberExpression(t.identifier('this'), t.identifier(modifies)),
      rightOperand
    )
  )
}

const createPropCallStatement = (
  eventHandlerStatement: EventHandlerStatement,
  propDefinitions: Record<string, UIDLPropDefinition>,
  t = types
) => {
  const { calls: propFunctionKey, args = [] } = eventHandlerStatement

  if (!propFunctionKey) {
    console.warn(`No prop definition referenced under the "calls" field`)
    return null
  }

  const propDefinition = propDefinitions[propFunctionKey]

  if (!propDefinition) {
    console.warn(`No prop definition was found for function "${propFunctionKey}"`)
    return null
  }

  // In vue it's favorable to use $emit for a specific event than sending the function as a prop
  return t.expressionStatement(
    t.callExpression(t.identifier('this.$emit'), [
      t.stringLiteral(propFunctionKey),
      ...args.map((arg) => convertValueToLiteral(arg)),
    ])
  )
}

// This function decides how to add an attribute based on the attribute type
// Also arrays are added to the dataObject for better readability
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
