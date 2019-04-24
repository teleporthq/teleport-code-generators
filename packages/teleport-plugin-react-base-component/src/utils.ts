import * as types from '@babel/types'

import { convertValueToLiteral } from '@teleporthq/teleport-generator-shared/lib/utils/ast-js-utils'
import {
  addChildJSXTag,
  addChildJSXText,
  addAttributeToJSXTag,
  addDynamicAttributeOnTag,
  createConditionalJSXExpression,
  generateASTDefinitionForJSXTag,
} from '@teleporthq/teleport-generator-shared/lib/utils/ast-jsx-utils'

import { capitalize } from '@teleporthq/teleport-generator-shared/lib/utils/string-utils'
import {
  UIDLElementNode,
  UIDLPropDefinition,
  UIDLRepeatNode,
  UIDLConditionalNode,
  UIDLConditionalExpression,
  UIDLAttributeValue,
  UIDLDynamicReference,
  ComponentDependency,
  UIDLStateDefinition,
  EventHandlerStatement,
  UIDLSlotNode,
} from '@teleporthq/teleport-generator-shared/lib/typings/uidl'
import {
  StateIdentifier,
  NodeSyntaxGenerator,
  AttributeAssignCodeMod,
  ConditionalIdentifier,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'

import { ERROR_LOG_NAME } from '.'

interface ReactComponentAccumulators {
  propDefinitions: Record<string, UIDLPropDefinition>
  stateIdentifiers: Record<string, StateIdentifier>
  nodesLookup: Record<string, types.JSXElement>
  dependencies: Record<string, ComponentDependency>
}

export const generateElementNode = (
  node: UIDLElementNode,
  accumulators: ReactComponentAccumulators
) => {
  const { dependencies, stateIdentifiers, propDefinitions, nodesLookup } = accumulators
  const { elementType, children, key, attrs, dependency, events } = node.content
  const elementTag = generateASTDefinitionForJSXTag(elementType)

  if (attrs) {
    Object.keys(attrs).forEach((attrKey) => {
      addAttributeToNode(elementTag, attrKey, attrs[attrKey])
    })
  }

  if (dependency) {
    // Make a copy to avoid reference leaking
    dependencies[elementType] = { ...dependency }
  }

  if (events) {
    Object.keys(events).forEach((eventKey) => {
      addEventHandlerToTag(
        elementTag,
        eventKey,
        events[eventKey],
        stateIdentifiers,
        propDefinitions
      )
    })
  }

  if (children) {
    children.forEach((child) => {
      const childTag = generateNodeSyntax(child, accumulators)

      if (typeof childTag === 'string') {
        addChildJSXText(elementTag, childTag)
      } else {
        addChildJSXTag(elementTag, childTag)
      }
    })
  }

  nodesLookup[key] = elementTag
  return elementTag
}

export const generateRepeatNode = (
  node: UIDLRepeatNode,
  accumulators: ReactComponentAccumulators
) => {
  const { node: repeatContent, dataSource, meta } = node.content

  const contentAST = generateNodeSyntax(repeatContent, accumulators)

  if (typeof contentAST === 'string' || (contentAST as types.JSXExpressionContainer).expression) {
    throw new Error(
      `${ERROR_LOG_NAME} generateRepeatNode found a repeat node that specified invalid content ${JSON.stringify(
        contentAST,
        null,
        2
      )}`
    )
  }

  const repeatAST = makeRepeatStructureWithMap(dataSource, contentAST as types.JSXElement, meta)
  return repeatAST
}

export const generateConditionalNode = (
  node: UIDLConditionalNode,
  accumulators: ReactComponentAccumulators
) => {
  const { reference, value } = node.content
  const conditionIdentifier = createConditionIdentifier(reference, accumulators)

  const subTree = generateNodeSyntax(node.content.node, accumulators)

  const condition: UIDLConditionalExpression =
    value !== undefined && value !== null
      ? { conditions: [{ operand: value, operation: '===' }] }
      : node.content.condition

  return createConditionalJSXExpression(subTree, condition, conditionIdentifier)
}

export const generateSlotNode = (
  node: UIDLSlotNode,
  accumulators: ReactComponentAccumulators,
  t = types
) => {
  // TODO: Handle multiple slots with props['slot-name']
  const childrenProp: UIDLDynamicReference = {
    type: 'dynamic',
    content: {
      referenceType: 'prop',
      id: 'children',
    },
  }

  const childrenExpression = makeDynamicValueExpression(childrenProp)

  if (node.content.fallback) {
    const fallbackContent = generateNodeSyntax(node.content.fallback, accumulators)
    let expression: types.Expression

    if (typeof fallbackContent === 'string') {
      expression = t.stringLiteral(fallbackContent)
    } else if ((fallbackContent as types.JSXExpressionContainer).expression) {
      expression = (fallbackContent as types.JSXExpressionContainer).expression as types.Expression
    } else {
      expression = fallbackContent as types.JSXElement
    }

    // props.children with fallback
    return t.jsxExpressionContainer(t.logicalExpression('||', childrenExpression, expression))
  }

  return t.jsxExpressionContainer(childrenExpression)
}

type GenerateNodeSyntaxReturnValue = string | types.JSXExpressionContainer | types.JSXElement

export const generateNodeSyntax: NodeSyntaxGenerator<
  ReactComponentAccumulators,
  GenerateNodeSyntaxReturnValue
> = (node, accumulators) => {
  switch (node.type) {
    case 'static':
      return node.content.toString()

    case 'dynamic':
      return types.jsxExpressionContainer(makeDynamicValueExpression(node))

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

export const createStateIdentifiers = (
  stateDefinitions: Record<string, UIDLStateDefinition>,
  dependencies: Record<string, ComponentDependency>
) => {
  dependencies.useState = {
    type: 'library',
    path: 'react',
    version: '16.8.3',
    meta: {
      namedImport: true,
    },
  }

  return Object.keys(stateDefinitions).reduce(
    (acc: Record<string, StateIdentifier>, stateKey: string) => {
      acc[stateKey] = {
        key: stateKey,
        type: stateDefinitions[stateKey].type,
        default: stateDefinitions[stateKey].defaultValue,
        setter: 'set' + capitalize(stateKey),
      }

      return acc
    },
    {}
  )
}

export const makePureComponent = (
  name: string,
  stateIdentifiers: Record<string, StateIdentifier>,
  jsxTagTree: types.JSXElement,
  t = types
) => {
  const returnStatement = t.returnStatement(jsxTagTree)

  const stateHooks = Object.keys(stateIdentifiers).map((stateKey) =>
    makeStateHookAST(stateIdentifiers[stateKey])
  )

  const arrowFunction = t.arrowFunctionExpression(
    [t.identifier('props')],
    t.blockStatement([...stateHooks, returnStatement] || [])
  )

  const declarator = t.variableDeclarator(t.identifier(name), arrowFunction)
  const component = t.variableDeclaration('const', [declarator])

  return component
}

// Adds all the event handlers and all the instructions for each event handler
// in case there is more than one specified in the UIDL
const addEventHandlerToTag = (
  tag: types.JSXElement,
  eventKey: string,
  eventHandlerStatements: EventHandlerStatement[],
  stateIdentifiers: Record<string, StateIdentifier>,
  propDefinitions: Record<string, UIDLPropDefinition> = {},
  t = types
) => {
  const eventHandlerASTStatements: types.ExpressionStatement[] = []

  eventHandlerStatements.forEach((eventHandlerAction) => {
    if (eventHandlerAction.type === 'stateChange') {
      const handler = createStateChangeStatement(eventHandlerAction, stateIdentifiers)
      if (handler) {
        eventHandlerASTStatements.push(handler)
      }
    }

    if (eventHandlerAction.type === 'propCall') {
      const handler = createPropCallStatement(eventHandlerAction, propDefinitions)
      if (handler) {
        eventHandlerASTStatements.push(handler)
      }
    }
  })

  let expressionContent: types.ArrowFunctionExpression | types.Expression
  if (eventHandlerASTStatements.length === 1) {
    const expression = eventHandlerASTStatements[0].expression

    expressionContent =
      expression.type === 'CallExpression' && expression.arguments.length === 0
        ? expression.callee
        : t.arrowFunctionExpression([], expression)
  } else {
    expressionContent = t.arrowFunctionExpression([], t.blockStatement(eventHandlerASTStatements))
  }

  tag.openingElement.attributes.push(
    t.jsxAttribute(t.jsxIdentifier(eventKey), t.jsxExpressionContainer(expressionContent))
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

  if (!propDefinition || propDefinition.type !== 'func') {
    console.warn(`No prop definition was found for "${propFunctionKey}"`)
    return null
  }

  return t.expressionStatement(
    t.callExpression(t.identifier('props.' + propFunctionKey), [
      ...args.map((arg) => convertValueToLiteral(arg)),
    ])
  )
}

const createStateChangeStatement = (
  eventHandlerStatement: EventHandlerStatement,
  stateIdentifiers: Record<string, StateIdentifier>,
  t = types
) => {
  if (!eventHandlerStatement.modifies) {
    console.warn(`No state identifier referenced under the "modifies" field`)
    return null
  }

  const stateKey = eventHandlerStatement.modifies
  const stateIdentifier = stateIdentifiers[stateKey]

  if (!stateIdentifier) {
    console.warn(`No state hook was found for "${stateKey}"`)
    return null
  }

  const stateSetterArgument =
    eventHandlerStatement.newState === '$toggle'
      ? t.unaryExpression('!', t.identifier(stateIdentifier.key))
      : convertValueToLiteral(eventHandlerStatement.newState, stateIdentifier.type)

  return t.expressionStatement(
    t.callExpression(t.identifier(stateIdentifier.setter), [stateSetterArgument])
  )
}

/**
 * Creates an AST line for defining a single state hook
 */
const makeStateHookAST = (stateIdentifier: StateIdentifier, t = types) => {
  const defaultValueArgument = convertValueToLiteral(stateIdentifier.default, stateIdentifier.type)
  return t.variableDeclaration('const', [
    t.variableDeclarator(
      t.arrayPattern([t.identifier(stateIdentifier.key), t.identifier(stateIdentifier.setter)]),
      t.callExpression(t.identifier('useState'), [defaultValueArgument])
    ),
  ])
}

const makeRepeatStructureWithMap = (
  dataSource: UIDLAttributeValue,
  content: types.JSXElement,
  meta: Record<string, any> = {},
  t = types
) => {
  const iteratorName = meta.iteratorName || 'item'
  const keyIdentifier = meta.useIndex ? 'index' : iteratorName

  const source = getSourceIdentifier(dataSource)

  const dynamicLocalReference: UIDLDynamicReference = {
    type: 'dynamic',
    content: {
      referenceType: 'local',
      id: keyIdentifier,
    },
  }
  addAttributeToNode(content, 'key', dynamicLocalReference)

  const arrowFunctionArguments = [t.identifier(iteratorName)]
  if (meta.useIndex) {
    arrowFunctionArguments.push(t.identifier('index'))
  }

  return t.jsxExpressionContainer(
    t.callExpression(t.memberExpression(source, t.identifier('map')), [
      t.arrowFunctionExpression(arrowFunctionArguments, content),
    ])
  )
}

const makeDynamicValueExpression = (identifier: UIDLDynamicReference, t = types) => {
  const prefix = getReactVarNameForDynamicReference(identifier)
  return prefix === ''
    ? t.identifier(identifier.content.id)
    : t.memberExpression(t.identifier(prefix), t.identifier(identifier.content.id))
}

// Prepares an identifier (from props or state) to be used as a conditional rendering identifier
// Assumes the type from the corresponding props/state definitions
const createConditionIdentifier = (
  dynamicReference: UIDLDynamicReference,
  accumulators: ReactComponentAccumulators
): ConditionalIdentifier => {
  const { id, referenceType } = dynamicReference.content

  switch (referenceType) {
    case 'prop':
      return {
        key: id,
        type: accumulators.propDefinitions[id].type,
        prefix: 'props',
      }
    case 'state':
      return {
        key: id,
        type: accumulators.stateIdentifiers[id].type,
      }
    default:
      throw new Error(
        `${ERROR_LOG_NAME} createConditionIdentifier encountered an invalid reference type: ${JSON.stringify(
          dynamicReference,
          null,
          2
        )}`
      )
  }
}

const getSourceIdentifier = (dataSource: UIDLAttributeValue, t = types) => {
  switch (dataSource.type) {
    case 'static':
      return t.arrayExpression(
        (dataSource.content as any[]).map((element) => convertValueToLiteral(element))
      )
    case 'dynamic': {
      return makeDynamicValueExpression(dataSource)
    }
    default:
      throw new Error(`Invalid type for dataSource: ${dataSource}`)
  }
}

const getReactVarNameForDynamicReference = (dynamicReference: UIDLDynamicReference) => {
  return {
    prop: 'props',
    state: '',
    static: '',
    local: '',
  }[dynamicReference.content.referenceType]
}

/**
 * @param tag the ref to the AST tag under construction
 * @param attributeKey the key of the attribute that should be added on the current AST node
 * @param attributeValue the value(string, number, bool) of the attribute that should be added on the current AST node
 */
const addAttributeToNode: AttributeAssignCodeMod<types.JSXElement> = (
  tag,
  attributeKey,
  attributeValue
) => {
  switch (attributeValue.type) {
    case 'dynamic':
      const {
        content: { id },
      } = attributeValue
      const prefix = getReactVarNameForDynamicReference(attributeValue)
      addDynamicAttributeOnTag(tag, attributeKey, id, prefix)
      return
    case 'static':
      const { content } = attributeValue
      addAttributeToJSXTag(tag, { name: attributeKey, value: content })
      return
    default:
      throw new Error(
        `${ERROR_LOG_NAME} addAttributeToNode could not generate code for assignment of type ${JSON.stringify(
          attributeValue
        )}`
      )
  }
}
