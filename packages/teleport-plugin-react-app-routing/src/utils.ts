import * as types from '@babel/types'
import { UIDLDependency } from '@teleporthq/teleport-types'
import { ASTBuilders, ASTUtils } from '@teleporthq/teleport-plugin-common'

export const createRouteRouterTag = (routeJSXDefinitions: types.JSXElement[]) => {
  const routerTag = ASTBuilders.createJSXTag('Router')

  const divContainer = ASTBuilders.createJSXTag('Switch')
  ASTUtils.addChildJSXTag(routerTag, divContainer)
  routeJSXDefinitions.forEach((route) => ASTUtils.addChildJSXTag(divContainer, route))

  return routerTag
}

export const constructRouteJSX = (componentName: string, path: string, fallback?: boolean) => {
  let JSXRoutePrefix: string
  let route: types.JSXElement

  JSXRoutePrefix = 'Route'
  route = ASTBuilders.createSelfClosingJSXTag(JSXRoutePrefix)
  ASTUtils.addDynamicAttributeToJSXTag(route, 'component', componentName)
  if (!fallback) {
    ASTUtils.addAttributeToJSXTag(route, 'exact')
  }
  ASTUtils.addAttributeToJSXTag(route, 'path', path)

  return route
}

export const registerReactRouterDeps = (dependencies: Record<string, UIDLDependency>): void => {
  dependencies.React = {
    type: 'library',
    path: 'react',
    version: '16.8.3',
  }

  dependencies.ReactDOM = {
    type: 'library',
    path: 'react-dom',
    version: '16.8.3',
  }

  dependencies.Router = {
    type: 'library',
    path: 'react-router-dom',
    version: '^5.2.0',
    meta: {
      namedImport: true,
      originalName: 'BrowserRouter',
    },
  }

  dependencies.Route = {
    type: 'library',
    path: 'react-router-dom',
    version: '^5.2.0',
    meta: {
      namedImport: true,
    },
  }

  dependencies.Switch = {
    type: 'library',
    path: 'react-router-dom',
    version: '^5.2.0',
    meta: {
      namedImport: true,
    },
  }
}
