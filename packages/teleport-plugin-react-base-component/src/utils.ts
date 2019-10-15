import * as types from '@babel/types'

import { StringUtils } from '@teleporthq/teleport-shared'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { UIDLStateDefinition } from '@teleporthq/teleport-types'

export const createPureComponent = (
  name: string,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  jsxTagTree: types.JSXElement,
  t = types
): types.VariableDeclaration => {
  const arrowFunctionBody = createReturnExpressionSyntax(stateDefinitions, jsxTagTree)
  const arrowFunctionProps = [t.identifier('props')]
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
  const defaultValueArgument = ASTUtils.convertValueToLiteral(
    stateDefinition.defaultValue,
    stateDefinition.type
  )

  return t.variableDeclaration('const', [
    t.variableDeclarator(
      t.arrayPattern([
        t.identifier(stateKey),
        t.identifier(`set${StringUtils.capitalize(stateKey)}`),
      ]),
      t.callExpression(t.identifier('useState'), [defaultValueArgument])
    ),
  ])
}
