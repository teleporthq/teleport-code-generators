import * as types from '@babel/types'
import { ASTBuilders, ASTUtils, UIDLUtils, StringUtils } from '@teleporthq/teleport-shared'
import { UIDLStateDefinition, UIDLConditionalNode } from '@teleporthq/teleport-types'

export const createClassDeclaration = (
  routes: UIDLConditionalNode[],
  routeDefinitions: UIDLStateDefinition,
  t = types
) => {
  const stencilRouterTag = ASTBuilders.createJSXTag('stencil-router')
  const stencilRouteSwitchTag = ASTBuilders.createJSXTag('stencil-route-switch')
  ASTUtils.addChildJSXTag(stencilRouterTag, stencilRouteSwitchTag)

  routes.forEach((routeNode) => {
    const pageKey = routeNode.content.value.toString()
    const { componentName, navLink } = UIDLUtils.extractPageOptions(routeDefinitions, pageKey)

    const stencilRouteTag = ASTBuilders.createJSXTag('stencil-route')
    ASTUtils.addAttributeToJSXTag(stencilRouteTag, 'url', navLink)
    if (navLink === '/') {
      ASTUtils.addAttributeToJSXTag(stencilRouteTag, 'exact', true)
    }
    ASTUtils.addAttributeToJSXTag(
      stencilRouteTag,
      'component',
      `app-${StringUtils.camelCaseToDashCase(componentName)}`
    )
    ASTUtils.addChildJSXTag(stencilRouteSwitchTag, stencilRouteTag)
  })

  const mainTag = ASTBuilders.createJSXTag('main')
  ASTUtils.addChildJSXTag(mainTag, stencilRouterTag)
  const divTag = ASTBuilders.createJSXTag('div')
  ASTUtils.addChildJSXTag(divTag, mainTag)

  const returnAST = divTag as types.JSXElement

  const classBodyAST = t.classBody([
    t.classMethod(
      'method',
      t.identifier('render'),
      [],
      t.blockStatement([t.returnStatement(returnAST)])
    ),
  ])

  const exportClass = t.exportNamedDeclaration(
    t.classDeclaration(t.identifier('AppRoot'), null, classBodyAST),
    [],
    null
  )
  return exportClass
}
