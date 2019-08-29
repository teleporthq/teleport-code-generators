import * as types from '@babel/types'
import { dashCaseToUpperCamelCase } from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'

export const createModuleDecorator = (t = types) => {
  const declerations: types.ObjectProperty = t.objectProperty(
    t.identifier('decleration'),
    t.arrayExpression([t.identifier('AppComponent')])
  )

  const imports: types.ObjectProperty = t.objectProperty(
    t.identifier('imports'),
    t.arrayExpression([
      t.identifier('BrowserModule'),
      t.callExpression(t.memberExpression(t.identifier('RouterModule'), t.identifier('routes')), [
        t.identifier('routes'),
      ]),
      t.identifier('ComponentsModule'),
    ])
  )

  const providers = t.objectProperty(t.identifier('providers'), t.arrayExpression([]))

  const bootstrap = t.objectProperty(
    t.identifier('bootstrap'),
    t.arrayExpression([t.identifier('AppComponent')])
  )

  return t.decorator(
    t.callExpression(t.identifier('NgModule'), [
      t.objectExpression([declerations, imports, providers, bootstrap]),
    ])
  )
}

export const createExportModuleAST = (t = types) => {
  return t.exportNamedDeclaration(
    t.classDeclaration(t.identifier('AppModule'), null, t.classBody([])),
    [],
    null
  )
}

export const createRoutesAST = (routes, t = types) => {
  // TODO: Need to generate type annotation for routes variable, currently babel throwing erro
  const routesObject = routes.map((route) => {
    const { content } = route
    return constructRoute(content.value)
  })
  return t.variableDeclaration('const', [
    t.variableDeclarator(t.identifier('routes'), t.arrayExpression(routesObject)),
  ])
}

const constructRoute = (routeName: string, t = types) => {
  return t.objectExpression([
    t.objectProperty(t.identifier('path'), t.stringLiteral(routeName)),
    t.objectProperty(
      t.identifier('loadChildren'),
      t.stringLiteral(
        `./pages/${routeName}/${routeName}.module/#${dashCaseToUpperCamelCase(
          `${routeName}-module`
        )}`
      )
    ),
  ])
}
