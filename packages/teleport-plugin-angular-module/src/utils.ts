import * as types from '@babel/types'
import {
  UIDLDependency,
  UIDLConditionalNode,
  UIDLStateDefinition,
  ComponentUIDL,
} from '@teleporthq/teleport-types'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'

export const createPageModuleModuleDecorator = (
  componentName: string,
  externalComponents: string[] = [],
  t = types
) => {
  const imports: types.ObjectProperty = t.objectProperty(
    t.identifier('imports'),
    t.arrayExpression([
      t.identifier('CommonModule'),
      t.identifier('ComponentsModule'),
      ...externalComponents.map((component) => t.identifier(component)),
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

export const createComponentModuleDecorator = (
  componentNames?: string[],
  externalComponents: string[] = [],
  t = types
) => {
  const componentsList =
    componentNames && componentNames.length > 0
      ? componentNames.map((componentName) => t.identifier(componentName))
      : []

  const declerations: types.ObjectProperty = t.objectProperty(
    t.identifier('declarations'),
    t.arrayExpression(componentsList)
  )

  const imports: types.ObjectProperty = t.objectProperty(
    t.identifier('imports'),
    t.arrayExpression([
      ...externalComponents.map((componentName) => t.identifier(componentName)),
      t.identifier('CommonModule'),
      t.identifier('RouterModule'),
    ])
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

export const createRootModuleDecorator = (externalComponents: string[] = [], t = types) => {
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
      ...externalComponents.map((component) => t.identifier(component)),
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
    t.classDeclaration(t.identifier(moduleName), null, t.classBody([]), null),
    [],
    null
  )
}

export const createRoutesAST = (
  routes: UIDLConditionalNode[],
  stateDefinitions: Record<string, UIDLStateDefinition>,
  t = types
) => {
  // TODO: Need to generate type annotation for routes variable, currently babel throwing error
  const routesObject = routes.map((conditionalNode) => {
    const { value: routeKey } = conditionalNode.content
    const pageDefinition = stateDefinitions.route.values.find((route) => route.value === routeKey)
    const { navLink, fileName } = pageDefinition.pageOptions

    return t.objectExpression([
      t.objectProperty(t.identifier('path'), t.stringLiteral(navLink.replace('/', ''))),
      t.objectProperty(
        t.identifier('loadChildren'),
        t.arrowFunctionExpression(
          [],
          t.callExpression(
            t.memberExpression(
              t.callExpression(t.identifier('import'), [
                t.stringLiteral(`./pages/${fileName}/${fileName}.module`),
              ]),
              t.identifier('then')
            ),
            [
              t.arrowFunctionExpression(
                [t.identifier('m')],
                t.memberExpression(
                  t.identifier('m'),
                  t.identifier(`${StringUtils.dashCaseToUpperCamelCase(fileName)}Module`)
                )
              ),
            ]
          )
        )
      ),
    ])
  })

  return t.variableDeclaration('const', [
    t.variableDeclarator(t.identifier('routes'), t.arrayExpression(routesObject)),
  ])
}

export const createPageRouteAST = (componentName: string, t = types) => {
  return t.variableDeclaration('const', [
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
}

export const constructLocalDependency = (fileName: string) => {
  const dependency: UIDLDependency = {
    type: 'local',
    path: `./${fileName}`,
    meta: {
      namedImport: true,
    },
  }
  return dependency
}

export const constructComponentDependency = (folderPath: string[], fileName: string) => {
  const dependency: UIDLDependency = {
    type: 'local',
    path: `./${folderPath.join('/')}/${fileName}`,
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

export const extractExternalDependenciesFromPage = (uidl: ComponentUIDL) => {
  const extractedDependencies: Record<string, UIDLDependency> = {}
  return traverseUIDLElements(uidl, extractedDependencies)
}

// In Angular imports are not added to components, instead they are added to modules
export const extractExtrenalImportsFromComponents = (
  components: Record<string, ComponentUIDL>
): Record<string, UIDLDependency> => {
  const externalDependencies: Record<string, UIDLDependency> = {}
  if (Object.keys(components).length > 0) {
    Object.values(components).forEach((component) => {
      traverseUIDLElements(component, externalDependencies)
    })
  }
  return externalDependencies
}

const traverseUIDLElements = (
  component: ComponentUIDL,
  dependenciesMap: Record<string, UIDLDependency>
): Record<string, UIDLDependency> => {
  UIDLUtils.traverseElements(component.node, (element) => {
    const { dependency, semanticType, elementType } = element
    const elementTag = semanticType || elementType
    if (dependency?.type === 'package') {
      const existingDependency = dependenciesMap[elementTag]

      if (existingDependency) {
        const safeImport = `${StringUtils.dashCaseToUpperCamelCase(
          StringUtils.removeIllegalCharacters(dependency.path)
        )}${elementTag}`
        dependenciesMap[safeImport] = {
          ...dependency,
          meta: {
            ...dependency.meta,
            originalName: safeImport,
          },
        }
      } else {
        dependenciesMap[elementTag] = dependency
      }
    }
  })
  return dependenciesMap
}
