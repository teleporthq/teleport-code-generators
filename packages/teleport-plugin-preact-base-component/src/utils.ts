import * as types from '@babel/types'

import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { UIDLStateDefinition, UIDLPropDefinition } from '@teleporthq/teleport-types'

export const createClassComponent = (
  name: string,
  propDefinitions: Record<string, UIDLPropDefinition>,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  jsxTagTree: types.JSXElement,
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
        ASTUtils.convertValueToLiteral(stateDefinition.defaultValue)
      )
    })

    classMethodsAndProperties.push(
      t.classProperty(t.identifier('state'), t.objectExpression(stateDeclarationsAST))
    )
    renderMethodArguments.push(t.identifier('state'))
  }

  const classBody = t.classBody([
    ...classMethodsAndProperties,
    t.classMethod(
      'method',
      t.identifier('render'),
      renderMethodArguments,
      t.blockStatement([t.returnStatement(jsxTagTree)])
    ),
  ])

  const classDeclaration = t.classDeclaration(
    t.identifier(name),
    t.identifier('Component'),
    classBody,
    null
  )

  return classDeclaration
}

export const createPureComponent = (
  name: string,
  propDefinitions: Record<string, UIDLPropDefinition>,
  jsxTagTree: types.JSXElement,
  t = types
): types.VariableDeclaration => {
  const componentArgs = []
  const arrowFunctionBody = t.blockStatement([t.returnStatement(jsxTagTree)])

  if (Object.keys(propDefinitions).length > 0) {
    componentArgs.push(t.identifier('props'))
  }

  const arrowFunction = t.arrowFunctionExpression(componentArgs, arrowFunctionBody)

  const declarator = t.variableDeclarator(t.identifier(name), arrowFunction)
  const component = t.variableDeclaration('const', [declarator])

  return component
}

export const createDOMInjectionNode = (content: string, t = types) => {
  return t.jsxElement(
    t.jsxOpeningElement(
      t.jsxIdentifier('span'),
      [
        t.jsxAttribute(
          t.jsxIdentifier('dangerouslySetInnerHTML'),
          t.jsxExpressionContainer(
            t.objectExpression([t.objectProperty(t.identifier('__html'), t.stringLiteral(content))])
          )
        ),
      ],
      true
    ),
    null,
    [],
    true
  )
}
