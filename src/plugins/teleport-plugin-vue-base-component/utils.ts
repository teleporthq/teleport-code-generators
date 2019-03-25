import * as types from '@babel/types'
import {
  PropDefinition,
  ContentNode,
  ComponentDependency,
  ComponentUIDL,
  ConditionalExpression,
  StateDefinition,
  EventHandlerStatement,
} from '../../uidl-definitions/types'
import * as htmlUtils from '../../shared/utils/html-utils'
import { objectToObjectExpression, convertValueToLiteral } from '../../shared/utils/ast-js-utils'
import { isDynamicPrefixedValue, removeDynamicPrefix } from '../../shared/utils/uidl-utils'
import { capitalize } from '../../shared/utils/string-utils'

// content is each node from the UIDL
// lookups contains
export const generateVueNodesTree = (
  content: ContentNode,
  accumulators: {
    templateLookup: Record<string, any>
    dependencies: Record<string, ComponentDependency>
    dataObject: Record<string, any>
    methodsObject: Record<string, EventHandlerStatement[]>
  }
) => {
  const { type, name, key, children, attrs, dependency, repeat, events } = content
  const { templateLookup, dependencies, dataObject, methodsObject } = accumulators

  const htmlNode = htmlUtils.createHTMLNode(type)

  if (dependency) {
    dependencies[type] = { ...dependency }
  }

  if (attrs) {
    Object.keys(attrs).forEach((attrKey) => {
      addAttributeToNode(htmlNode, name, attrKey, attrs[attrKey], dataObject)
    })
  }

  if (events) {
    Object.keys(events).forEach((eventKey) => {
      const methodName = `handle${capitalize(name)}${capitalize(eventKey)}`
      methodsObject[methodName] = events[eventKey]
      htmlUtils.addAttributeToNode(htmlNode, `@${eventKey}`, methodName)
    })
  }

  if (repeat) {
    const { dataSource, content: repeatContent, meta = {} } = repeat
    const repeatContentTag = generateVueNodesTree(repeatContent, accumulators)

    let dataObjectIdentifier = meta.dataSourceIdentifier || `${name}Items`
    if (isDynamicPrefixedValue(dataSource)) {
      dataObjectIdentifier = removeDynamicPrefix(dataSource as string)
    } else {
      dataObject[dataObjectIdentifier] = dataSource
    }

    const iteratorName = meta.iteratorName || 'item'
    const iterator = meta.useIndex ? `(${iteratorName}, index)` : iteratorName
    const keyIdentifier = meta.useIndex ? 'index' : iteratorName

    htmlUtils.addAttributeToNode(
      repeatContentTag,
      'v-for',
      `${iterator} in ${dataObjectIdentifier}`
    )
    htmlUtils.addAttributeToNode(repeatContentTag, ':key', `${keyIdentifier}`)
    htmlUtils.addChildNode(htmlNode, repeatContentTag)
  }

  if (children) {
    children.forEach((child) => {
      if (typeof child === 'string') {
        addTextToNode(htmlNode, child)
        return
      }

      if (child.type === 'state') {
        const stateBranches = child.states || []
        const stateKey = child.name
        stateBranches.forEach((stateBranch) => {
          const stateContent = stateBranch.content

          // 'v-if' needs to be added on a tag, so in case of a text node we wrap it with
          // a 'span' which is the less intrusive of all
          const stateBranchNode =
            typeof stateContent === 'string'
              ? htmlUtils.createHTMLNode('span', [htmlUtils.createTextNode(stateContent)])
              : generateVueNodesTree(stateContent, accumulators)

          const conditionalStatement = createConditionalStatement(stateKey, stateBranch.value)
          htmlUtils.addAttributeToNode(stateBranchNode, 'v-if', conditionalStatement)
          htmlUtils.addChildNode(htmlNode, stateBranchNode)
        })
        return
      }

      const childTag = generateVueNodesTree(child, accumulators)
      htmlUtils.addChildNode(htmlNode, childTag)
    })
  }

  templateLookup[key] = htmlNode

  return htmlNode
}

export const extractStateObject = (stateDefinitions: Record<string, StateDefinition>) => {
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

const createVuePropsDefinition = (uidlPropDefinitions: Record<string, PropDefinition>) => {
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
      default:
        // don't handle anything else
        return acc
    }

    acc[name] = defaultValue ? { type: mappedType, default: defaultValue } : mappedType
    return acc
  }, {})
}

const createMethodsObject = (
  methods: Record<string, EventHandlerStatement[]>,
  propDefinitions: Record<string, PropDefinition>,
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
  propDefinitions: Record<string, PropDefinition>,
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

// This function decides how to add an attribute based on the prefix
// $props. $state. $local. have a different behavior, since they need to be bound with ':'
// Also arrays are added to the dataObject for better readability
const addAttributeToNode = (
  htmlNode: any,
  uidlNodeName: string,
  key: string,
  value: string,
  dataObject: Record<string, any>
) => {
  if (isDynamicPrefixedValue(value)) {
    const attrValue = removeDynamicPrefix(value)
    htmlUtils.addAttributeToNode(htmlNode, `:${key}`, attrValue)
  } else if (Array.isArray(value)) {
    const dataObjectIdentifier = `${uidlNodeName}${capitalize(key)}`
    dataObject[dataObjectIdentifier] = value
    htmlUtils.addAttributeToNode(htmlNode, `:${key}`, dataObjectIdentifier)
  } else {
    htmlUtils.addAttributeToNode(htmlNode, key, value)
  }
}

// This function decides how to add a text element inside another HTML node
// $props. $state. $local. have a different behavior, they need to be rendered inside {{ }}
const addTextToNode = (htmlNode: any, text: string) => {
  if (isDynamicPrefixedValue(text)) {
    // special treatment for $props.children where we need to add a <slot></slot> tag
    if (text === '$props.children') {
      const slot = htmlUtils.createHTMLNode('slot')
      htmlUtils.addChildNode(htmlNode, slot)
    } else {
      htmlUtils.addTextNode(htmlNode, `{{${removeDynamicPrefix(text)}}}`)
    }
  } else {
    htmlUtils.addTextNode(htmlNode, text)
  }
}

const createConditionalStatement = (
  stateKey: string,
  stateValue: string | number | boolean | ConditionalExpression
) => {
  if (typeof stateValue !== 'object') {
    return stringifyConditionalExpression(stateKey, '===', stateValue)
  }

  const { matchingCriteria, conditions } = stateValue
  const stringConditions = conditions.map(({ operation, operand }) => {
    return `(${stringifyConditionalExpression(stateKey, operation, operand)})`
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
