import * as types from '@babel/types'

import { convertValueToLiteral } from '@teleporthq/teleport-shared/dist/cjs/utils/ast-js-utils'
import { capitalize } from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'
import { UIDLStateDefinition, UIDLPropDefinition } from '@teleporthq/teleport-types'

import { JSXRootReturnType } from '@teleporthq/teleport-shared/dist/cjs/node-handlers/node-to-jsx/types'

export const createPureComponent = (
  name: string,
  propDefinitions: Record<string, UIDLPropDefinition>,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  jsxTagTree: JSXRootReturnType,
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

  // Only render `props` when they are used
  const arrowFunctionProps = Object.keys(propDefinitions).length > 0 ? [t.identifier('props')] : []

  const arrowFunction = t.arrowFunctionExpression(arrowFunctionProps, arrowFunctionBody)

  const declarator = t.variableDeclarator(t.identifier(name), arrowFunction)
  const component = t.variableDeclaration('const', [declarator])

  return component
}

const createReturnExpressionSyntax = (
  stateDefinitions: Record<string, UIDLStateDefinition>,
  jsxTagTree: types.JSXElement,
  t = types
) => {
  const returnStatement = t.returnStatement(jsxTagTree)

  const stateHooks = Object.keys(stateDefinitions).map((stateKey) =>
    createStateHookAST(stateKey, stateDefinitions[stateKey])
  )

  return t.blockStatement([...stateHooks, returnStatement] || [])
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
