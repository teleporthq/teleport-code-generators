import * as types from '@babel/types'
import { extractRoutes } from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

import {
  createRoutesAST,
  createExportModuleAST,
  createRootModuleDecorator,
  createComponentModuleDecorator,
} from './utils'

import {
  APP_COMPONENT,
  ANGULAR_ROUTER,
  COMPONENTS_MODULE,
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
  moduleType: 'root' | 'component' | 'pages'
}

export const createPlugin: ComponentPluginFactory<AngularRoutingConfig> = (config) => {
  const {
    moduleChunkName = DEFAULT_MODULE_CHUNK_NAME,
    decoratorChunkName = DEFAULT_MODULE_DECORATOR_CHUNK_NAME,
    importChunkName = DEFAULT_IMPORT_CHUNK_NAME,
    moduleType = 'root',
  } = config || {}

  const createAngularModuleGenerator: ComponentPlugin = async (structure) => {
    const { uidl, dependencies, chunks } = structure

    let routesAST: types.VariableDeclaration
    let ngModuleAST: types.Decorator
    let moduleDecoratorAST: types.ExportNamedDeclaration

    dependencies.NgModule = ANGULAR_CORE_DEPENDENCY
    switch (moduleType) {
      case 'root':
        {
          dependencies.BrowserModule = ANGULAR_PLATFORM_BROWSER
          dependencies.RouterModule = ANGULAR_ROUTER
          dependencies.ComponentsModule = COMPONENTS_MODULE
          dependencies.AppComponent = APP_COMPONENT

          const routes = extractRoutes(uidl)
          routesAST = createRoutesAST(routes)
          ngModuleAST = createRootModuleDecorator()
          moduleDecoratorAST = createExportModuleAST('AppModule')
        }
        break
      case 'component':
        {
          dependencies.CommonModule = ANGULAR_COMMON_MODULE

          ngModuleAST = createComponentModuleDecorator()
          moduleDecoratorAST = createExportModuleAST('ComponentsModule')
        }
        break
      case 'pages':
        {
          dependencies.RouterModule = ANGULAR_ROUTER
          dependencies.ComponentsModule = COMPONENTS_MODULE
          dependencies.CommonModule = ANGULAR_COMMON_MODULE
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
