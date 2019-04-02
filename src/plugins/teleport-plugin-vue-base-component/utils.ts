import * as types from '@babel/types'

import * as htmlUtils from '../../shared/utils/html-utils'
import { objectToObjectExpression, convertValueToLiteral } from '../../shared/utils/ast-js-utils'
import { capitalize, stringToUpperCamelCase } from '../../shared/utils/string-utils'

// content is each node from the UIDL
// lookups contains
export const generateVueNodesTree = (
  node: UIDLNode,
  accumulators: {
    templateLookup: Record<string, any>
    dependencies: Record<string, ComponentDependency>
    dataObject: Record<string, any>
    methodsObject: Record<string, EventHandlerStatement[]>
    stateDefinitions: Record<string, any>
  }
) => {
  const { templateLookup, dependencies, dataObject, methodsObject } = accumulators

  if (node.type === 'static') {
    return node.content.toString()
  }

  if (node.type === 'dynamic') {
    return `{{${node.content.id}}}`
  }

  if (node.type === 'element') {
    const { elementType, name, key, children, attrs, dependency, events } = node.content
    const htmlNode = htmlUtils.createHTMLNode(elementType)

    if (dependency) {
      dependencies[elementType] = { ...dependency }
    }

    if (attrs) {
      Object.keys(attrs).forEach((attrKey) => {
        const attrValue = attrs[attrKey]
        // arrays are moved to the data object and referenced as dynamic keys (binding)
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
        const methodName = `handle${stringToUpperCamelCase(name)}${stringToUpperCamelCase(
          eventKey
        )}`
        methodsObject[methodName] = events[eventKey]
        htmlUtils.addAttributeToNode(htmlNode, `@${eventKey}`, methodName)
      })
    }

    if (children) {
      children.forEach((child) => {
        const childTag = generateVueNodesTree(child, accumulators)

        if (typeof childTag === 'string') {
          htmlUtils.addTextNode(htmlNode, childTag)
        } else {
          htmlUtils.addChildNode(htmlNode, childTag)
        }

        // if (child.type === 'state' && child.states) {
        //   const stateBranches = child.states || []
        //   const stateKey = child.name
        //   const isBooleanState =
        //     stateDefinitions[stateKey] && stateDefinitions[stateKey].type === 'boolean'
        //   if (isBooleanState && stateBranches.length === 2) {
        //     const conditionalStatement = createConditionalStatement(stateKey, stateBranches[0].value)
        //     const consequentContent = stateBranches[0].content
        //     const alternateContent = stateBranches[1].content
        //     const consequentNode = getNodeFromContent(consequentContent, accumulators)
        //     const alternateNode = getNodeFromContent(alternateContent, accumulators)
        //     htmlUtils.addAttributeToNode(consequentNode, 'v-if', conditionalStatement)
        //     htmlUtils.addChildNode(htmlNode, consequentNode)
        //     htmlUtils.addBooleanAttributeToNode(alternateNode, 'v-else')
        //     htmlUtils.addChildNode(htmlNode, alternateNode)
        //   } else {
        //     stateBranches.forEach((stateBranch) => {
        //       const stateContent = stateBranch.content

        //       // 'v-if' needs to be added on a tag, so in case of a text node we wrap it with
        //       // a 'span' which is the less intrusive of all
        //       const stateBranchNode = getNodeFromContent(stateContent, accumulators)
        //       const conditionalStatement = createConditionalStatement(stateKey, stateBranch.value)
        //       htmlUtils.addAttributeToNode(stateBranchNode, 'v-if', conditionalStatement)
        //       htmlUtils.addChildNode(htmlNode, stateBranchNode)
        //     })
        //   }
        //   return
        // }
      })
    }

    templateLookup[key] = htmlNode
    return htmlNode
  }

  if (node.type === 'repeat') {
    const { dataSource, node: repeatContent, meta = {} } = node.content
    const repeatContentTag = generateVueNodesTree(repeatContent, accumulators)

    let dataObjectIdentifier = meta.dataSourceIdentifier || `items`
    if (dataSource.type === 'dynamic') {
      dataObjectIdentifier = dataSource.content.id
    } else {
      dataObject[dataObjectIdentifier] = dataSource.content
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
    return repeatContentTag
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

// This function decides how to add an attribute based on the prefix
// $props. $state. $local. have a different behavior, since they need to be bound with ':'
// Also arrays are added to the dataObject for better readability
const addAttributeToNode = (
  htmlNode: any,
  attributeKey: string,
  attributeValue: UIDLAttributeValue
) => {
  // TODO review with addAttributeToNode from react
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
        `Could not generate code for assignment of type ${JSON.stringify(attributeValue)}`
      )
  }
}

// const createConditionalStatement = (
//   stateKey: string,
//   stateValue: string | number | boolean | ConditionalExpression
// ) => {
//   if (typeof stateValue !== 'object') {
//     return stringifyConditionalExpression(stateKey, '===', stateValue)
//   }

//   const { matchingCriteria, conditions } = stateValue
//   const stringConditions = conditions.map(({ operation, operand }) => {
//     return `(${stringifyConditionalExpression(stateKey, operation, operand)})`
//   })

//   const joinOperator = matchingCriteria === 'all' ? '&&' : '||'
//   return stringConditions.join(` ${joinOperator} `)
// }

// const stringifyConditionalExpression = (
//   identifier: string,
//   operation: string,
//   value: string | number | boolean
// ) => {
//   if (typeof value === 'boolean') {
//     return `${value ? '' : '!'}${identifier}`
//   }

//   if (typeof value === 'string') {
//     return `${identifier} ${operation} '${value}'`
//   }

//   return `${identifier} ${operation} ${value}`
// }

// const getNodeFromContent = (content: any, accumulators) => {
//   return typeof content === 'string'
//     ? htmlUtils.createHTMLNode('span', [htmlUtils.createTextNode(content)])
//     : generateVueNodesTree(content, accumulators)
// }
