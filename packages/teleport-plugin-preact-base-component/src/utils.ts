import * as types from '@babel/types'

import { convertValueToLiteral } from '@teleporthq/teleport-shared/dist/cjs/utils/ast-js-utils'
import { UIDLStateDefinition, UIDLPropDefinition } from '@teleporthq/teleport-types'

import { JSXRootReturnType } from '@teleporthq/teleport-shared/dist/cjs/node-handlers/node-to-jsx/types'

export const createClassComponent = (
  name: string,
  propDefinitions: Record<string, UIDLPropDefinition>,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  jsxTagTree: JSXRootReturnType,
  t = types
) => {
  // TODO: Add event handlers as separate functions later
  const classMethodsAndProperties = []
  const renderMethodArguments = []

  if (Object.keys(propDefinitions).length > 0 || Object.keys(stateDefinitions).length > 0) {
    renderMethodArguments.push(t.identifier('props'))
  }

  if (Object.keys(stateDefinitions).length > 0) {
    const stateDeclarationsAST = Object.keys(stateDefinitions).map((stateKey) => {
      const stateDefinition = stateDefinitions[stateKey]
      return t.objectProperty(
        t.identifier(stateKey),
        convertValueToLiteral(stateDefinition.defaultValue)
      )
    })

    classMethodsAndProperties.push(
      t.classProperty(t.identifier('state'), t.objectExpression(stateDeclarationsAST))
    )
    renderMethodArguments.push(t.identifier('state'))
  }

  const returnedAST =
    typeof jsxTagTree === 'string' ? t.stringLiteral(jsxTagTree) : (jsxTagTree as types.JSXElement)

  const classBody = t.classBody([
    ...classMethodsAndProperties,
    t.classMethod(
      'method',
      t.identifier('render'),
      renderMethodArguments,
      t.blockStatement([t.returnStatement(returnedAST)])
    ),
  ])

  const classDeclaration = t.classDeclaration(
    t.identifier(name),
    t.identifier('Component'),
    classBody
  )

  return classDeclaration
}

export const createPureComponent = (
  name: string,
  propDefinitions: Record<string, UIDLPropDefinition>,
  jsxTagTree: JSXRootReturnType,
  t = types
): types.VariableDeclaration => {
  const componentArgs = []
  const arrowFunctionBody =
    typeof jsxTagTree === 'string'
      ? t.stringLiteral(jsxTagTree)
      : t.blockStatement([t.returnStatement(jsxTagTree as types.JSXElement)])

  if (Object.keys(propDefinitions).length > 0) {
    componentArgs.push(t.identifier('props'))
  }

  const arrowFunction = t.arrowFunctionExpression(componentArgs, arrowFunctionBody)

  const declarator = t.variableDeclarator(t.identifier(name), arrowFunction)
  const component = t.variableDeclaration('const', [declarator])

  return component
}
