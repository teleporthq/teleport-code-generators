import * as types from '@babel/types'

import { convertValueToLiteral } from '../../utils/ast-utils'
import { StringUtils } from '@teleporthq/teleport-shared'
import {
  UIDLPropDefinition,
  UIDLAttributeValue,
  UIDLDynamicReference,
  UIDLStateDefinition,
  UIDLEventHandlerStatement,
  UIDLConditionalExpression,
  UIDLPropCallEvent,
  UIDLStateModifierEvent,
} from '@teleporthq/teleport-types'

import {
  BinaryOperator,
  UnaryOperation,
  JSXASTReturnType,
  ConditionalIdentifier,
  JSXGenerationParams,
  JSXGenerationOptions,
} from './types'

// Adds all the event handlers and all the instructions for each event handler
// in case there is more than one specified in the UIDL
export const addEventHandlerToTag = (
  tag: types.JSXElement,
  eventKey: string,
  eventHandlerStatements: UIDLEventHandlerStatement[],
  params: JSXGenerationParams,
  options: JSXGenerationOptions,
  t = types
) => {
  const eventHandlerASTStatements: types.ExpressionStatement[] = []
  const { propDefinitions, stateDefinitions } = params

  eventHandlerStatements.forEach((eventHandlerAction) => {
    if (eventHandlerAction.type === 'stateChange') {
      const handler = createStateChangeStatement(eventHandlerAction, stateDefinitions, options)
      if (handler) {
        eventHandlerASTStatements.push(handler)
      }
    }

    if (eventHandlerAction.type === 'propCall') {
      const handler = createPropCallStatement(eventHandlerAction, propDefinitions, options)
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
        ? (expression.callee as types.ArrowFunctionExpression | types.Expression)
        : t.arrowFunctionExpression([], expression)
  } else {
    expressionContent = t.arrowFunctionExpression([], t.blockStatement(eventHandlerASTStatements))
  }

  tag.openingElement.attributes.push(
    t.jsxAttribute(t.jsxIdentifier(eventKey), t.jsxExpressionContainer(expressionContent))
  )
}

const createPropCallStatement = (
  eventHandlerStatement: UIDLPropCallEvent,
  propDefinitions: Record<string, UIDLPropDefinition>,
  options: JSXGenerationOptions,
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

  const prefix = options.dynamicReferencePrefixMap.prop
    ? options.dynamicReferencePrefixMap.prop + '.'
    : ''
  return t.expressionStatement(
    t.callExpression(t.identifier(prefix + propFunctionKey), [
      ...args.map((arg) => convertValueToLiteral(arg)),
    ])
  )
}

const createStateChangeStatement = (
  eventHandlerStatement: UIDLStateModifierEvent,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  options: JSXGenerationOptions,
  t = types
) => {
  if (!eventHandlerStatement.modifies) {
    console.warn(`No state identifier referenced under the "modifies" field`)
    return null
  }

  const stateKey = eventHandlerStatement.modifies
  const stateDefinition = stateDefinitions[stateKey]

  const statePrefix = options.dynamicReferencePrefixMap.state
    ? options.dynamicReferencePrefixMap.state + '.'
    : ''

  const newStateValue =
    eventHandlerStatement.newState === '$toggle'
      ? t.unaryExpression('!', t.identifier(statePrefix + stateKey))
      : convertValueToLiteral(eventHandlerStatement.newState, stateDefinition.type)

  switch (options.stateHandling) {
    case 'hooks':
      return t.expressionStatement(
        t.callExpression(t.identifier(StringUtils.createStateStoringFunction(stateKey)), [
          newStateValue,
        ])
      )
    case 'function':
      return t.expressionStatement(
        t.callExpression(t.identifier('this.setState'), [
          t.objectExpression([t.objectProperty(t.identifier(stateKey), newStateValue)]),
        ])
      )
    case 'mutation':
    default:
      return t.expressionStatement(
        t.assignmentExpression('=', t.identifier(statePrefix + stateKey), newStateValue)
      )
  }
}

export const createDynamicValueExpression = (
  identifier: UIDLDynamicReference,
  options: JSXGenerationOptions,
  t = types,
  params?: JSXGenerationParams
) => {
  const { projectContexts = {} } = params || {}

  const identifierContent = identifier.content

  if (
    identifierContent.referenceType === 'expr' ||
    identifierContent.referenceType === 'attr' ||
    identifierContent.referenceType === 'children' ||
    identifierContent.referenceType === 'token'
  ) {
    throw new Error(
      `Dynamic reference type "${identifierContent.referenceType}" is not supported yet`
    )
  }

  if (identifierContent.referenceType === 'ctx') {
    // TODO handle situation when context is not using path
    // TODO only allow ctxID not id for context references
    const contextMeta = projectContexts[identifierContent.ctxId ?? identifierContent.id]
    if (!contextMeta) {
      throw new Error(
        `Could not find the referenced context: ${
          identifierContent.ctxId ?? identifierContent.id
        } on node ${JSON.stringify(identifierContent)}`
      )
    }

    return t.memberExpression(
      t.identifier(StringUtils.camelize(contextMeta.providerName)),
      t.identifier(identifierContent.path.join('?.'))
    )
  }

  const prefix = options.dynamicReferencePrefixMap[identifierContent.referenceType] || ''
  return prefix === ''
    ? t.identifier(identifierContent.id)
    : t.memberExpression(t.identifier(prefix), t.identifier(identifierContent.id))
}

// Prepares an identifier (from props or state) to be used as a conditional rendering identifier
// Assumes the type from the corresponding props/state definitions
export const createConditionIdentifier = (
  dynamicReference: UIDLDynamicReference,
  params: JSXGenerationParams,
  options: JSXGenerationOptions
): ConditionalIdentifier => {
  const { id, referenceType } = dynamicReference.content

  // in case the id is a member expression: eg: fields.name
  const referenceRoot = id.split('.')[0]

  switch (referenceType) {
    case 'prop':
      return {
        key: id,
        type: params.propDefinitions[referenceRoot].type,
        prefix: options.dynamicReferencePrefixMap.prop,
      }
    case 'state':
      return {
        key: id,
        type: params.stateDefinitions[referenceRoot].type,
        prefix: options.dynamicReferencePrefixMap.state,
      }
    default:
      throw new Error(
        `createConditionIdentifier encountered an invalid reference type: ${JSON.stringify(
          dynamicReference,
          null,
          2
        )}`
      )
  }
}

export const createConditionalJSXExpression = (
  content: JSXASTReturnType,
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

export const getRepeatSourceIdentifier = (
  dataSource: UIDLAttributeValue,
  options: JSXGenerationOptions
) => {
  switch (dataSource.type) {
    case 'static':
      return convertValueToLiteral(dataSource.content)
    case 'dynamic': {
      return createDynamicValueExpression(dataSource, options)
    }
    default:
      throw new Error(`Invalid type for dataSource: ${dataSource}`)
  }
}
