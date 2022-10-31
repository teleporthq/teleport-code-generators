import * as types from '@babel/types'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
  UIDLDependency,
  UIDLRootComponent,
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
  extractExtrenalImportsFromComponents,
  extractExternalDependenciesFromPage,
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
    const { uidl, chunks, options, dependencies } = structure

    const { moduleComponents = {} } = options

    let routesAST: types.VariableDeclaration
    let ngModuleAST: types.Decorator
    let moduleDecoratorAST: types.ExportNamedDeclaration
    let externalDependencies: Record<string, UIDLDependency> = {}

    dependencies.NgModule = ANGULAR_CORE_DEPENDENCY
    dependencies.RouterModule = ANGULAR_ROUTER

    switch (moduleType) {
      case 'root':
        {
          const { stateDefinitions } = uidl as UIDLRootComponent
          dependencies.BrowserModule = ANGULAR_PLATFORM_BROWSER
          dependencies.ComponentsModule = constructRouteForComponentsModule('.')
          dependencies.AppComponent = APP_COMPONENT
          dependencies.CUSTOM_ELEMENTS_SCHEMA = ANGULAR_CORE_DEPENDENCY

          const routes = UIDLUtils.extractRoutes(uidl as UIDLRootComponent)
          routesAST = createRoutesAST(routes, stateDefinitions)
          ngModuleAST = createRootModuleDecorator()
          moduleDecoratorAST = createExportModuleAST('AppModule')
        }
        break
      case 'page':
        {
          dependencies.ComponentsModule = constructRouteForComponentsModule('../..')
          dependencies.CommonModule = ANGULAR_COMMON_MODULE
          dependencies.CUSTOM_ELEMENTS_SCHEMA = ANGULAR_CORE_DEPENDENCY
          const componentName = UIDLUtils.getComponentClassName(uidl)
          const fileName = UIDLUtils.getComponentFileName(uidl)
          dependencies[componentName] = constructLocalDependency(fileName)

          routesAST = createPageRouteAST(componentName)

          externalDependencies = extractExternalDependenciesFromPage(uidl)

          ngModuleAST = createPageModuleModuleDecorator(
            componentName,
            Object.keys(getExternalDeps(externalDependencies))
          )
          moduleDecoratorAST = createExportModuleAST(uidl.outputOptions.moduleName)

          uidl.outputOptions.fileName = fileName.replace('.component', '.module')
        }
        break
      case 'component':
        {
          dependencies.CommonModule = ANGULAR_COMMON_MODULE
          dependencies.CUSTOM_ELEMENTS_SCHEMA = ANGULAR_CORE_DEPENDENCY

          // Looping through all components and importing them into component module
          Object.keys(moduleComponents).forEach((componentKey) => {
            const component = moduleComponents[componentKey]
            const componentClassName = UIDLUtils.getComponentClassName(component)
            const componentFileName = UIDLUtils.getComponentFileName(component)
            const componentFolderPath = UIDLUtils.getComponentFolderPath(component)
            dependencies[componentClassName] = constructComponentDependency(
              componentFolderPath,
              componentFileName
            )
          })

          const componentClassNames = Object.keys(moduleComponents).map((componentKey) =>
            UIDLUtils.getComponentClassName(moduleComponents[componentKey])
          )

          externalDependencies = extractExtrenalImportsFromComponents(moduleComponents)

          ngModuleAST = createComponentModuleDecorator(
            componentClassNames,
            Object.keys(getExternalDeps(externalDependencies))
          )
          moduleDecoratorAST = createExportModuleAST('ComponentsModule')
        }
        break
      default:
        throw new Error(`Invalid module type '${moduleType}'`)
    }

    if (Object.keys(externalDependencies).length > 0) {
      Object.keys(externalDependencies).forEach((importRef) => {
        dependencies[importRef] = externalDependencies[importRef]
      })
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

const getExternalDeps = (externalDependencies: Record<string, UIDLDependency>) => {
  return Object.keys(externalDependencies).reduce(
    (acc: Record<string, UIDLDependency>, depName: string) => {
      if (!externalDependencies[depName]?.meta?.importJustPath) {
        acc[depName] = externalDependencies[depName]
      }
      return acc
    },
    {}
  )
}

export default createAngularModulePlugin()
