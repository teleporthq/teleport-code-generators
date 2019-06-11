import * as types from '@babel/types'

import { convertValueToLiteral } from '@teleporthq/teleport-shared/lib/utils/ast-js-utils'
import {
  addAttributeToJSXTag,
  addDynamicAttributeOnTag,
} from '@teleporthq/teleport-shared/lib/utils/ast-jsx-utils'
import { capitalize } from '@teleporthq/teleport-shared/lib/utils/string-utils'

import {
  UIDLPropDefinition,
  UIDLAttributeValue,
  UIDLDynamicReference,
  UIDLStateDefinition,
  EventHandlerStatement,
  AttributeAssignCodeMod,
  ConditionalIdentifier,
  UIDLConditionalExpression,
} from '@teleporthq/teleport-types'

import { ERROR_LOG_NAME } from './constants'
import {
  GenerateNodeSyntaxReturnValue,
  ReactComponentAccumulators,
  BinaryOperator,
  UnaryOperation,
  ContentType,
} from './types'

export const createPureComponent = (
  name: string,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  jsxTagTree: GenerateNodeSyntaxReturnValue,
  nodeType: string,
  t = types
): types.VariableDeclaration => {
  let arrowFunctionBody: any
  switch (nodeType) {
    case 'static':
      arrowFunctionBody = typeof jsxTagTree === 'string' && types.stringLiteral(jsxTagTree)
      break
    case 'dynamic':
    case 'conditional':
      arrowFunctionBody =
        Object.keys(stateDefinitions).length === 0
          ? jsxTagTree
          : createReturnExpressionSyntax(stateDefinitions, jsxTagTree as types.JSXElement)
      break
    default:
      arrowFunctionBody = createReturnExpressionSyntax(
        stateDefinitions,
        jsxTagTree as types.JSXElement
      )
      break
  }

  const arrowFunction = t.arrowFunctionExpression([t.identifier('props')], arrowFunctionBody)

  const declarator = t.variableDeclarator(t.identifier(name), arrowFunction)
  const component = t.variableDeclaration('const', [declarator])

  return component
}

// Adds all the event handlers and all the instructions for each event handler
// in case there is more than one specified in the UIDL
export const addEventHandlerToTag = (
  tag: types.JSXElement,
  eventKey: string,
  eventHandlerStatements: EventHandlerStatement[],
  stateDefinitions: Record<string, UIDLStateDefinition>,
  propDefinitions: Record<string, UIDLPropDefinition> = {},
  t = types
) => {
  const eventHandlerASTStatements: types.ExpressionStatement[] = []

  eventHandlerStatements.forEach((eventHandlerAction) => {
    if (eventHandlerAction.type === 'stateChange') {
      const handler = createStateChangeStatement(eventHandlerAction, stateDefinitions)
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

export const createRepeatStructureWithMap = (
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

export const createDynamicValueExpression = (identifier: UIDLDynamicReference, t = types) => {
  const prefix = getReactVarNameForDynamicReference(identifier)
  return prefix === ''
    ? t.identifier(identifier.content.id)
    : t.memberExpression(t.identifier(prefix), t.identifier(identifier.content.id))
}

// Prepares an identifier (from props or state) to be used as a conditional rendering identifier
// Assumes the type from the corresponding props/state definitions
export const createConditionIdentifier = (
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
        type: accumulators.stateDefinitions[id].type,
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

/**
 * @param tag the ref to the AST tag under construction
 * @param attributeKey the key of the attribute that should be added on the current AST node
 * @param attributeValue the value(string, number, bool) of the attribute that should be added on the current AST node
 */
export const addAttributeToNode: AttributeAssignCodeMod<types.JSXElement> = (
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

export const createConditionalJSXExpression = (
  content: ContentType,
  conditionalExpression: UIDLConditionalExpression,
  conditionalIdentifier: ConditionalIdentifier,
  t = types
) => {
  let contentNode: types.Expression

  if (typeof content === 'string') {
    contentNode = t.stringLiteral(content)
  } else if (content.type === 'JSXExpressionContainer') {
    contentNode = content.expression as types.Expression
  } else {
    contentNode = content
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

  return t.logicalExpression('&&', binaryExpression, contentNode)
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

const createReturnExpressionSyntax = (
  stateDefinitions: Record<string, UIDLStateDefinition>,
  jsxTagTree: types.JSXElement,
  t = types
) => {
  const returnStatement = t.returnStatement(jsxTagTree)

  const stateHooks = Object.keys(stateDefinitions).map((stateKey) => {
    return createStateHookAST(stateKey, stateDefinitions[stateKey])
  })

  return t.blockStatement([...stateHooks, returnStatement] || [])
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
  stateDefinitions: Record<string, UIDLStateDefinition>,
  t = types
) => {
  if (!eventHandlerStatement.modifies) {
    console.warn(`No state identifier referenced under the "modifies" field`)
    return null
  }

  const stateKey = eventHandlerStatement.modifies
  const stateDefinition = stateDefinitions[stateKey]

  if (!stateDefinition) {
    console.warn(`No state hook was found for "${stateKey}"`)
    return null
  }

  const stateSetterArgument =
    eventHandlerStatement.newState === '$toggle'
      ? t.unaryExpression('!', t.identifier(stateKey))
      : convertValueToLiteral(eventHandlerStatement.newState, stateDefinition.type)

  return t.expressionStatement(
    t.callExpression(t.identifier(`set${capitalize(stateKey)}`), [stateSetterArgument])
  )
}

/**
 * Creates an AST line for defining a single state hook
 */
const createStateHookAST = (stateKey: string, stateDefinition: UIDLStateDefinition, t = types) => {
  const defaultValueArgument = convertValueToLiteral(
    stateDefinition.defaultValue,
    stateDefinition.type
  )

  return t.variableDeclaration('const', [
    t.variableDeclarator(
      t.arrayPattern([t.identifier(stateKey), t.identifier(`set${capitalize(stateKey)}`)]),
      t.callExpression(t.identifier('useState'), [defaultValueArgument])
    ),
  ])
}

const getSourceIdentifier = (dataSource: UIDLAttributeValue, t = types) => {
  switch (dataSource.type) {
    case 'static':
      return t.arrayExpression(
        (dataSource.content as any[]).map((element) => convertValueToLiteral(element))
      )
    case 'dynamic': {
      return createDynamicValueExpression(dataSource)
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
