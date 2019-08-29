import { extractRoutes } from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

import { createRoutesAST, createExportModuleAST, createModuleDecorator } from './utils'

import {
  ANGULAR_CORE_DEPENDENCY,
  ANGULAR_PLATFORM_BROWSER,
  ANGULAR_ROUTER,
  DEFAULT_MODULE_CHUNK_NAME,
  DEFAULT_IMPORT_CHUNK_NAME,
  DEFAULT_MODULE_DECORATOR_CHUNK_NAME,
} from './constants'

interface AngularRoutingConfig {
  moduleChunkName: string
  decoratorChunkName: string
  importChunkName: string
}

export const createPlugin: ComponentPluginFactory<AngularRoutingConfig> = (config) => {
  const {
    moduleChunkName = DEFAULT_MODULE_CHUNK_NAME,
    decoratorChunkName = DEFAULT_MODULE_DECORATOR_CHUNK_NAME,
    importChunkName = DEFAULT_IMPORT_CHUNK_NAME,
  } = config || {}

  const angularModuleGeneratorAngular: ComponentPlugin = async (structure) => {
    const { uidl, dependencies, chunks } = structure

    dependencies.BrowserModule = ANGULAR_PLATFORM_BROWSER
    dependencies.NgModule = ANGULAR_CORE_DEPENDENCY
    dependencies.Router = ANGULAR_ROUTER
    dependencies.RouterModule = ANGULAR_ROUTER

    const routes = extractRoutes(uidl)
    const routesAST = createRoutesAST(routes)

    chunks.push({
      name: moduleChunkName,
      type: CHUNK_TYPE.AST,
      fileType: FILE_TYPE.TS,
      content: routesAST,
      linkAfter: [importChunkName],
    })

    const ngModuleAST = createModuleDecorator()
    const moduleDecoratorAST = createExportModuleAST()

    chunks.push({
      name: decoratorChunkName,
      type: CHUNK_TYPE.AST,
      fileType: FILE_TYPE.TS,
      content: [ngModuleAST, moduleDecoratorAST],
      linkAfter: [moduleChunkName],
    })

    return structure
  }

  return angularModuleGeneratorAngular
}

export default createPlugin()
