import * as types from '@babel/types'
import { extractRoutes } from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { camelCaseToDashCase } from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'

import {
  createRoutesAST,
  createPageRouteAST,
  createExportModuleAST,
  constructLocalDependency,
  createRootModuleDecorator,
  constructComponentDependency,
  createComponentModuleDecorator,
  createPageModuleModuleDecorator,
  constructRouteForComponentsModule,
} from './utils'

import {
  APP_COMPONENT,
  ANGULAR_ROUTER,
  ANGULAR_COMMON_MODULE,
  ANGULAR_CORE_DEPENDENCY,
  ANGULAR_PLATFORM_BROWSER,
  DEFAULT_MODULE_CHUNK_NAME,
  DEFAULT_IMPORT_CHUNK_NAME,
  DEFAULT_MODULE_DECORATOR_CHUNK_NAME,
} from './constants'

interface AngularRoutingConfig {
  moduleChunkName: string
  decoratorChunkName: string
  importChunkName: string
  moduleType: 'root' | 'component' | 'page'
}

export const createPlugin: ComponentPluginFactory<AngularRoutingConfig> = (config) => {
  const {
    moduleChunkName = DEFAULT_MODULE_CHUNK_NAME,
    decoratorChunkName = DEFAULT_MODULE_DECORATOR_CHUNK_NAME,
    importChunkName = DEFAULT_IMPORT_CHUNK_NAME,
    moduleType = 'root',
  } = config || {}

  const createAngularModuleGenerator: ComponentPlugin = async (structure) => {
    const { uidl, dependencies, chunks, options } = structure
    const { stateDefinitions = {} } = uidl

    const { moduleComponents } = options

    let routesAST: types.VariableDeclaration
    let ngModuleAST: types.Decorator
    let moduleDecoratorAST: types.ExportNamedDeclaration

    dependencies.NgModule = ANGULAR_CORE_DEPENDENCY
    dependencies.RouterModule = ANGULAR_ROUTER
    switch (moduleType) {
      case 'root':
        {
          dependencies.BrowserModule = ANGULAR_PLATFORM_BROWSER
          dependencies.ComponentsModule = constructRouteForComponentsModule('.')
          dependencies.AppComponent = APP_COMPONENT

          const routes = extractRoutes(uidl)
          routesAST = createRoutesAST(routes, stateDefinitions)
          ngModuleAST = createRootModuleDecorator()
          moduleDecoratorAST = createExportModuleAST('AppModule')
        }
        break
      case 'page':
        {
          dependencies.ComponentsModule = constructRouteForComponentsModule('../..')
          dependencies.CommonModule = ANGULAR_COMMON_MODULE
          const componentName = `${uidl.name}Component`
          dependencies[componentName] = constructLocalDependency(uidl.meta.fileName)

          routesAST = createPageRouteAST(componentName)
          ngModuleAST = createPageModuleModuleDecorator(componentName)
          moduleDecoratorAST = createExportModuleAST(uidl.meta.moduleName)

          // Acording to widely followed convention module should have .module in its name
          uidl.meta.fileName = `${uidl.meta.fileName}.module`
        }
        break
      case 'component':
        {
          dependencies.CommonModule = ANGULAR_COMMON_MODULE
          // Looping through all components and importing them into component module
          moduleComponents.forEach(
            (component) =>
              (dependencies[`${component}Component`] = constructComponentDependency(
                camelCaseToDashCase(component)
              ))
          )

          ngModuleAST = createComponentModuleDecorator(moduleComponents)
          moduleDecoratorAST = createExportModuleAST('ComponentsModule')
        }
        break
    }

    // Routes will be present for only pages and root
    if (routesAST) {
      chunks.push({
        name: moduleChunkName,
        type: CHUNK_TYPE.AST,
        fileType: FILE_TYPE.TS,
        content: routesAST,
        linkAfter: [importChunkName],
      })
    }

    chunks.push({
      name: decoratorChunkName,
      type: CHUNK_TYPE.AST,
      fileType: FILE_TYPE.TS,
      content: [ngModuleAST, moduleDecoratorAST],
      linkAfter: [importChunkName],
    })

    return structure
  }

  return createAngularModuleGenerator
}

export default createPlugin()
