import * as t from '@babel/types'
import { ComponentDependency } from '@teleporthq/teleport-types-uidl-definitions'

export const registerRouterDeps = (dependencies: Record<string, ComponentDependency>): void => {
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

export const makePureComponent = (params: { name: string; jsxTagTree: t.JSXElement }) => {
  const { name, jsxTagTree } = params
  const returnStatement = t.returnStatement(jsxTagTree)
  const arrowFunction = t.arrowFunctionExpression(
    [t.identifier('props')],
    t.blockStatement([returnStatement] || [])
  )

  const declarator = t.variableDeclarator(t.identifier(name), arrowFunction)
  const component = t.variableDeclaration('const', [declarator])

  return component
}
