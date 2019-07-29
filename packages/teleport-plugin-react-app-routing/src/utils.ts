import { ComponentDependency } from '@teleporthq/teleport-types'

export const registerReactRouterDeps = (
  dependencies: Record<string, ComponentDependency>
): void => {
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

export const registerPreactRouterDeps = (
  dependencies: Record<string, ComponentDependency>
): void => {
  dependencies.Router = {
    type: 'library',
    path: 'preact-router',
    version: '2.5.7',
    meta: {
      namedImport: true,
    },
  }
}
