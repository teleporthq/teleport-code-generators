import * as types from '@babel/types'
import { createJSXTag } from '@teleporthq/teleport-shared/dist/cjs/builders/ast-builders'
import {
  addChildJSXTag,
  addAttributeToJSXTag,
} from '@teleporthq/teleport-shared/dist/cjs/utils/ast-jsx-utils'
import { extractPageMetadata } from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import { camelCaseToDashCase } from '@teleporthq/teleport-shared/src/utils/string-utils'

export const createClassDecleration = (routes, routeDefinitions, t = types) => {
  const stencilRouterTag = createJSXTag('stencil-router')
  const stencilRouteSwitchTag = createJSXTag('stencil-route-switch')
  addChildJSXTag(stencilRouterTag, stencilRouteSwitchTag)

  routes.forEach((routeNode) => {
    const pageKey = routeNode.content.value.toString()
    const { componentName, path } = extractPageMetadata(routeDefinitions, pageKey)

    const stencilRouteTag = createJSXTag('stencil-route')
    addAttributeToJSXTag(stencilRouteTag, 'url', path)
    if (path === '/') {
      addAttributeToJSXTag(stencilRouteTag, 'exact', true)
    }
    addAttributeToJSXTag(stencilRouteTag, 'component', `app-${camelCaseToDashCase(componentName)}`)
    addChildJSXTag(stencilRouteSwitchTag, stencilRouteTag)
  })

  const mainTag = createJSXTag('main')
  addChildJSXTag(mainTag, stencilRouterTag)
  const divTag = createJSXTag('div')
  addChildJSXTag(divTag, mainTag)

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
