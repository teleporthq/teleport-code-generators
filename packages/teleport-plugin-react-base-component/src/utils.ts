import * as types from '@babel/types'

import { convertValueToLiteral } from '@teleporthq/teleport-shared/dist/cjs/utils/ast-js-utils'
import { capitalize } from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'
import { UIDLStateDefinition } from '@teleporthq/teleport-types'

import { JSXRootReturnType } from '@teleporthq/teleport-shared/dist/cjs/node-handlers/node-to-jsx/types'

export const createPureComponent = (
  name: string,
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

  const arrowFunction = t.arrowFunctionExpression([t.identifier('props')], arrowFunctionBody)

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

export const createClassComponent = (
  name: string,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  jsxTagTree: JSXRootReturnType,
  t = types
) => {
  // TODO: Add event handlers as separate functions later
  const classMethodsAndProperties = []

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
  }

  const returnedAST =
    typeof jsxTagTree === 'string' ? t.stringLiteral(jsxTagTree) : (jsxTagTree as types.JSXElement)

  const classBody = t.classBody([
    ...classMethodsAndProperties,
    t.classMethod(
      'method',
      t.identifier('render'),
      [],
      t.blockStatement([t.returnStatement(returnedAST)])
    ),
  ])

  const classDeclaration = t.classDeclaration(
    t.identifier(name),
    t.identifier('React.Component'),
    classBody
  )

  return classDeclaration
}
