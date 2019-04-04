import * as types from '@babel/types'

import { convertValueToLiteral } from '../../shared/utils/ast-js-utils'
import {
  addChildJSXTag,
  addChildJSXText,
  addAttributeToJSXTag,
  addDynamicChild,
  addDynamicAttributeOnTag,
  generateASTDefinitionForJSXTag,
  createConditionalJSXExpression,
  createTernaryOperation,
} from '../../shared/utils/ast-jsx-utils'

import { isDynamicPrefixedValue, removeDynamicPrefix } from '../../shared/utils/uidl-utils'
import { capitalize } from '../../shared/utils/string-utils'
import {
  ContentNode,
  PropDefinition,
  StateIdentifier,
  ComponentDependency,
  StateDefinition,
  EventHandlerStatement,
} from '../../typings/uidl-definitions'

export const generateTreeStructure = (
  content: ContentNode,
  accumulators: {
    propDefinitions: Record<string, PropDefinition>
    stateIdentifiers: Record<string, StateIdentifier>
    nodesLookup: Record<string, types.JSXElement>
    dependencies: Record<string, ComponentDependency>
  }
): types.JSXElement => {
  const { type, children, key, attrs, dependency, events, repeat } = content
  const { propDefinitions, stateIdentifiers, nodesLookup, dependencies } = accumulators

  const mainTag = generateASTDefinitionForJSXTag(type)

  if (attrs) {
    Object.keys(attrs).forEach((attrKey) => {
      addAttributeToTag(mainTag, attrKey, attrs[attrKey])
    })
  }

  if (dependency) {
    // Make a copy to avoid reference leaking
    dependencies[type] = { ...dependency }
  }

  if (events) {
    Object.keys(events).forEach((eventKey) => {
      addEventHandlerToTag(mainTag, eventKey, events[eventKey], stateIdentifiers, propDefinitions)
    })
  }

  if (repeat) {
    const { content: repeatContent, dataSource, meta } = repeat

    const contentAST = generateTreeStructure(repeatContent, accumulators)

    const dataSourceIdentifier = isDynamicPrefixedValue(dataSource)
      ? removeDynamicPrefix(dataSource as string, 'props')
      : dataSource

    const repeatAST = makeRepeatStructureWithMap(dataSourceIdentifier, contentAST, meta)
    mainTag.children.push(repeatAST)
  }

  if (children) {
    children.forEach((child) => {
      if (!child) {
        return
      }

      if (typeof child === 'string') {
        addTextElementToTag(mainTag, child)
        return
      }

      if (child.type === 'state') {
        const { states = [], name: stateKey } = child
        const isBooleanState =
          stateIdentifiers[stateKey] && stateIdentifiers[stateKey].type === 'boolean'
        if (isBooleanState && states.length === 2) {
          const consequentContent = states[0].content
          const alternateContent = states[1].content
          const consequent =
            typeof consequentContent === 'string'
              ? types.stringLiteral(consequentContent)
              : generateTreeStructure(consequentContent, accumulators)
          const alternate =
            typeof alternateContent === 'string'
              ? types.stringLiteral(alternateContent)
              : generateTreeStructure(alternateContent, accumulators)
          const jsxExpression = createTernaryOperation(
            stateIdentifiers[stateKey].key,
            consequent,
            alternate
          )
          mainTag.children.push(jsxExpression)
        } else {
          states.forEach((stateBranch) => {
            const stateContent = stateBranch.content
            const stateIdentifier = stateIdentifiers[stateKey]
            if (!stateIdentifier) {
              return
            }

            const stateSubTree =
              typeof stateContent === 'string'
                ? stateContent
                : generateTreeStructure(stateContent, accumulators)

            const jsxExpression = createConditionalJSXExpression(
              stateSubTree,
              stateBranch.value,
              stateIdentifier
            )

            mainTag.children.push(jsxExpression)
          })
        }

        return
      }

      const childTag = generateTreeStructure(child, accumulators)

      addChildJSXTag(mainTag, childTag)
    })
  }

  // UIDL name should be unique
  nodesLookup[key] = mainTag

  return mainTag
}

export const createStateIdentifiers = (
  stateDefinitions: Record<string, StateDefinition>,
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
  dataSource: string | any[],
  content: types.JSXElement,
  meta: Record<string, any> = {},
  t = types
) => {
  const iteratorName = meta.iteratorName || 'item'
  const keyIdentifier = meta.useIndex ? 'index' : iteratorName

  const source =
    typeof dataSource === 'string'
      ? t.identifier(dataSource)
      : t.arrayExpression(dataSource.map((element) => convertValueToLiteral(element)))

  addAttributeToTag(content, 'key', `$local.${keyIdentifier}`)

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

/**
 * @param tag the ref to the AST tag under construction
 * @param key the key of the attribute that should be added on the current AST node
 * @param value the value(string, number, bool) of the attribute that should be added on the current AST node
 */
const addAttributeToTag = (tag: types.JSXElement, key: string, value: any) => {
  if (isDynamicPrefixedValue(value)) {
    const attrValue = removeDynamicPrefix(value)
    const propsPrefix = value.startsWith('$props') ? 'props' : ''
    addDynamicAttributeOnTag(tag, key, attrValue, propsPrefix)
  } else {
    addAttributeToJSXTag(tag, { name: key, value })
  }
}

const addTextElementToTag = (tag: types.JSXElement, text: string) => {
  if (isDynamicPrefixedValue(text)) {
    const propsPrefix = text.startsWith('$props') ? 'props' : ''
    addDynamicChild(tag, removeDynamicPrefix(text), propsPrefix)
  } else {
    addChildJSXText(tag, text)
  }
}
