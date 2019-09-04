import * as types from '@babel/types'
import { UIDLDependency } from '@teleporthq/teleport-types'
import { dashCaseToUpperCamelCase } from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'

export const createPageModuleModuleDecorator = (componentName: string, t = types) => {
  const imports: types.ObjectProperty = t.objectProperty(
    t.identifier('imports'),
    t.arrayExpression([
      t.identifier('CommonModule'),
      t.identifier('ComponentsModule'),
      t.callExpression(t.memberExpression(t.identifier('RouterModule'), t.identifier('forChild')), [
        t.identifier('routes'),
      ]),
    ])
  )

  const decleration: types.ObjectProperty = t.objectProperty(
    t.identifier('declarations'),
    t.arrayExpression([t.identifier(componentName)])
  )

  const exportsProperty: types.ObjectProperty = t.objectProperty(
    t.identifier('exports'),
    t.arrayExpression([t.identifier(componentName)])
  )

  return t.decorator(
    t.callExpression(t.identifier('NgModule'), [
      t.objectExpression([decleration, imports, exportsProperty]),
    ])
  )
}

export const createComponentModuleDecorator = (components?: string[], t = types) => {
  const componentsList =
    components && components.length > 0
      ? components.map((component) => t.identifier(`${component}Component`))
      : []

  const declerations: types.ObjectProperty = t.objectProperty(
    t.identifier('declarations'),
    t.arrayExpression(componentsList)
  )

  const imports: types.ObjectProperty = t.objectProperty(
    t.identifier('imports'),
    t.arrayExpression([t.identifier('CommonModule')])
  )

  const exportsProperty: types.ObjectProperty = t.objectProperty(
    t.identifier('exports'),
    t.arrayExpression(componentsList)
  )

  return t.decorator(
    t.callExpression(t.identifier('NgModule'), [
      t.objectExpression([declerations, imports, exportsProperty]),
    ])
  )
}

export const createRootModuleDecorator = (t = types) => {
  const declerations: types.ObjectProperty = t.objectProperty(
    t.identifier('declarations'),
    t.arrayExpression([t.identifier('AppComponent')])
  )

  const imports: types.ObjectProperty = t.objectProperty(
    t.identifier('imports'),
    t.arrayExpression([
      t.identifier('BrowserModule'),
      t.callExpression(t.memberExpression(t.identifier('RouterModule'), t.identifier('forRoot')), [
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

export const createExportModuleAST = (moduleName: string, t = types) => {
  return t.exportNamedDeclaration(
    t.classDeclaration(t.identifier(moduleName), null, t.classBody([])),
    [],
    null
  )
}

export const createRoutesAST = (routes, t = types) => {
  // TODO: Need to generate type annotation for routes variable, currently babel throwing erro
  const routesObject = routes.map((route) => {
    const { content } = route
    return constructRootRoute(content.value)
  })
  const ast = t.variableDeclaration('const', [
    t.variableDeclarator(t.identifier('routes'), t.arrayExpression(routesObject)),
  ])
  return ast
}

export const createPageRouteAST = (componentName: string, t = types) => {
  const ast = t.variableDeclaration('const', [
    t.variableDeclarator(
      t.identifier('routes'),
      t.arrayExpression([
        t.objectExpression([
          t.objectProperty(t.identifier('path'), t.stringLiteral('')),
          t.objectProperty(t.identifier('component'), t.identifier(componentName)),
        ]),
      ])
    ),
  ])
  return ast
}

const constructRootRoute = (routeName: string, t = types) => {
  return t.objectExpression([
    t.objectProperty(t.identifier('path'), t.stringLiteral(routeName)),
    t.objectProperty(
      t.identifier('loadChildren'),
      t.stringLiteral(
        `./pages/${routeName}/${routeName}.module#${dashCaseToUpperCamelCase(
          `${routeName}-module`
        )}`
      )
    ),
  ])
}

export const constructLocalDependency = (componentName: string) => {
  const dependency: UIDLDependency = {
    type: 'local',
    path: `./${componentName}.component`,
    meta: {
      namedImport: true,
    },
  }
  return dependency
}

export const constructComponentDependency = (componentName: string) => {
  const dependency: UIDLDependency = {
    type: 'local',
    path: `./${componentName}/${componentName}.component`,
    meta: {
      namedImport: true,
    },
  }
  return dependency
}

export const constructRouteForComponentsModule = (path: string) => {
  const dependency: UIDLDependency = {
    type: 'local',
    path: `${path}/components/components.module`,
    meta: {
      namedImport: true,
    },
  }
  return dependency
}
