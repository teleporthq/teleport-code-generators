import * as types from '@babel/types'
import { StateIdentifier } from '../../../shared/types'
import { convertValueToLiteral } from '../../../shared/utils/ast-js-utils'
import {
  addChildJSXText,
  addAttributeToJSXTag,
  addDynamicChild,
  addDynamicPropOnJsxOpeningTag,
} from '../../../shared/utils/ast-jsx-utils'
import { EventHandlerStatement, PropDefinition } from '../../../uidl-definitions/types'

// Adds all the event handlers and all the instructions for each event handler
// in case there is more than one specified in the UIDL
export const addEventHandlerToTag = (
  tag: types.JSXElement,
  eventKey: string,
  eventHandlerStatements: EventHandlerStatement[],
  stateIdentifiers: Record<string, StateIdentifier>,
  propDefinitions: Record<string, PropDefinition> = {},
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
  propDefinitions: Record<string, PropDefinition>,
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

/**
 * Creates an AST line for defining a single state hook
 */
export const makeStateHookAST = (stateIdentifier: StateIdentifier, t = types) => {
  const defaultValueArgument = convertValueToLiteral(stateIdentifier.default, stateIdentifier.type)
  return t.variableDeclaration('const', [
    t.variableDeclarator(
      t.arrayPattern([t.identifier(stateIdentifier.key), t.identifier(stateIdentifier.setter)]),
      t.callExpression(t.identifier('useState'), [defaultValueArgument])
    ),
  ])
}

export const makeRepeatStructureWithMap = (
  dataSource: string | any[],
  content: types.JSXElement,
  meta: Record<string, any> = {},
  t = types
) => {
  const source =
    typeof dataSource === 'string'
      ? t.identifier(dataSource)
      : t.arrayExpression(dataSource.map((element) => convertValueToLiteral(element)))

  const arrowFunctionArguments = [t.identifier('item')]
  if (meta.useIndex) {
    arrowFunctionArguments.push(t.identifier('index'))
  }

  return t.jsxExpressionContainer(
    t.callExpression(t.memberExpression(source, t.identifier('map')), [
      t.arrowFunctionExpression(arrowFunctionArguments, content),
    ])
  )
}

/**
 *
 * @param tag the ref to the AST tag under construction
 * @param key the key of the attribute that should be added on the current AST node
 * @param value the value(string, number, bool) of the attribute that should be added on the current AST node
 */
export const addAttributeToTag = (tag: types.JSXElement, key: string, value: any) => {
  if (typeof value !== 'string') {
    addAttributeToJSXTag(tag, { name: key, value })
    return
  }

  if (value.startsWith('$props.')) {
    const dynamicPropValue = value.replace('$props.', '')
    addDynamicPropOnJsxOpeningTag(tag, key, dynamicPropValue, 'props')
  } else if (value.startsWith('$state.')) {
    const dynamicPropValue = value.replace('$state.', '')
    addDynamicPropOnJsxOpeningTag(tag, key, dynamicPropValue)
  } else if (value === '$item' || value === '$index') {
    addDynamicPropOnJsxOpeningTag(tag, key, value.slice(1))
  } else {
    addAttributeToJSXTag(tag, { name: key, value })
  }
}

export const addTextElementToTag = (tag: types.JSXElement, text: string) => {
  if (text.startsWith('$props.') && !text.endsWith('$props.')) {
    addDynamicChild(tag, text.replace('$props.', ''), 'props')
  } else if (text.startsWith('$state.') && !text.endsWith('$state.')) {
    addDynamicChild(tag, text.replace('$state.', ''))
  } else if (text === '$item' || text === '$index') {
    addDynamicChild(tag, text.slice(1))
  } else {
    addChildJSXText(tag, text)
  }
}
