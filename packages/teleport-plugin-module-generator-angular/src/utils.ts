import * as types from '@babel/types'
import { dashCaseToUpperCamelCase } from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'

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
