import { UIDLDependency } from '@teleporthq/teleport-types'
import {
  createSelfClosingJSXTag,
  createJSXTag,
} from '@teleporthq/teleport-shared/dist/cjs/builders/ast-builders'
import {
  addChildJSXTag,
  addAttributeToJSXTag,
  addDynamicAttributeToJSXTag,
} from '@teleporthq/teleport-shared/dist/cjs/utils/ast-jsx-utils'

export const createRouteRouterTag = (flavour: string, routeJSXDefinitions) => {
  const routerTag = createJSXTag('Router')

  if (flavour === 'preact') {
    routeJSXDefinitions.forEach((route) => addChildJSXTag(routerTag, route))
    return routerTag
  }
  const divContainer = createJSXTag('div')
  addChildJSXTag(routerTag, divContainer)
  routeJSXDefinitions.forEach((route) => addChildJSXTag(divContainer, route))

  return routerTag
}

export const constructRouteJSX = (flavour: string, componentName: string, path: string) => {
  let JSXRoutePrefix: string
  let route

  if (flavour === 'preact') {
    JSXRoutePrefix = componentName
    route = createSelfClosingJSXTag(JSXRoutePrefix)
  } else {
    JSXRoutePrefix = 'Route'
    route = createSelfClosingJSXTag(JSXRoutePrefix)
    addAttributeToJSXTag(route, 'exact')
    addDynamicAttributeToJSXTag(route, 'component', componentName)
  }

  addAttributeToJSXTag(route, 'path', path)

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
    version: '4.3.1',
    meta: {
      namedImport: true,
      originalName: 'BrowserRouter',
    },
  }

  dependencies.Route = {
    type: 'library',
    path: 'react-router-dom',
    version: '4.3.1',
    meta: {
      namedImport: true,
    },
  }
}

export const registerPreactRouterDeps = (dependencies: Record<string, UIDLDependency>): void => {
  dependencies.Router = {
    type: 'library',
    path: 'preact-router',
    version: '2.5.7',
    meta: {
      namedImport: true,
    },
  }
}
