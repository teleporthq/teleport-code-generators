import * as types from '@babel/types'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'

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

export const createAngularModulePlugin: ComponentPluginFactory<AngularRoutingConfig> = (config) => {
  const {
    moduleChunkName = DEFAULT_MODULE_CHUNK_NAME,
    decoratorChunkName = DEFAULT_MODULE_DECORATOR_CHUNK_NAME,
    importChunkName = DEFAULT_IMPORT_CHUNK_NAME,
    moduleType = 'root',
  } = config || {}

  const angularModuleGenerator: ComponentPlugin = async (structure) => {
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

          const routes = UIDLUtils.extractRoutes(uidl)
          routesAST = createRoutesAST(routes, stateDefinitions)
          ngModuleAST = createRootModuleDecorator()
          moduleDecoratorAST = createExportModuleAST('AppModule')
        }
        break
      case 'page':
        {
          dependencies.ComponentsModule = constructRouteForComponentsModule('../..')
          dependencies.CommonModule = ANGULAR_COMMON_MODULE
          const componentName = UIDLUtils.getComponentClassName(uidl)
          const componentClassName = `${componentName}Component`
          const fileName = UIDLUtils.getComponentFileName(uidl)
          dependencies[componentClassName] = constructLocalDependency(fileName)

          routesAST = createPageRouteAST(componentClassName)
          ngModuleAST = createPageModuleModuleDecorator(componentClassName)
          moduleDecoratorAST = createExportModuleAST(uidl.outputOptions.moduleName)

          // Acording to widely followed convention module should have .module in its name
          uidl.outputOptions.fileName = fileName.replace('.component', '.module')
        }
        break
      case 'component':
        {
          dependencies.CommonModule = ANGULAR_COMMON_MODULE

          // Looping through all components and importing them into component module
          Object.keys(moduleComponents).forEach((componentKey) => {
            const component = moduleComponents[componentKey]
            const componentClassName = UIDLUtils.getComponentClassName(component)
            const componentFileName = UIDLUtils.getComponentFileName(component)
            const componentFolderPath = UIDLUtils.getComponentFolderPath(component)
            dependencies[`${componentClassName}Component`] = constructComponentDependency(
              componentFolderPath,
              componentFileName
            )
          })

          const componentClassNames = Object.keys(moduleComponents).map((componentKey) =>
            UIDLUtils.getComponentClassName(moduleComponents[componentKey])
          )
          ngModuleAST = createComponentModuleDecorator(componentClassNames)
          moduleDecoratorAST = createExportModuleAST('ComponentsModule')
        }
        break
    }

    // Routes will be present for only pages and root
    if (routesAST) {
      chunks.push({
        name: moduleChunkName,
        type: ChunkType.AST,
        fileType: FileType.TS,
        content: routesAST,
        linkAfter: [importChunkName],
      })
    }

    chunks.push({
      name: decoratorChunkName,
      type: ChunkType.AST,
      fileType: FileType.TS,
      content: [ngModuleAST, moduleDecoratorAST],
      linkAfter: [importChunkName],
    })

    return structure
  }

  return angularModuleGenerator
}

export default createAngularModulePlugin()
