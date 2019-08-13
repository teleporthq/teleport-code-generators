import { extractRoutes } from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { createComponentDecorator } from '@teleporthq/teleport-shared/dist/cjs/utils/ast-jsx-utils'
import {
  STENCIL_CORE_DEPENDENCY,
  DEFAULT_COMPONENT_DECORATOR_CHUNK_NAME,
  DEFAULT_COMPONENT_CHUNK_NAME,
  DEFAULT_IMPORT_CHUNK_NAME,
} from './constants'
import { createClassDecleration } from './utils'

interface StencilRouterConfig {
  componentDecoratorChunkName: string
  componentChunkName: string
  importChunkName: string
}

export const createPlugin: ComponentPluginFactory<StencilRouterConfig> = (config) => {
  const {
    componentChunkName = DEFAULT_COMPONENT_CHUNK_NAME,
    componentDecoratorChunkName = DEFAULT_COMPONENT_DECORATOR_CHUNK_NAME,
    importChunkName = DEFAULT_IMPORT_CHUNK_NAME,
  } = config || {}

  const stencilAppRouterComponentPlugin: ComponentPlugin = async (structure) => {
    const { chunks, uidl, dependencies } = structure

    dependencies.Component = STENCIL_CORE_DEPENDENCY
    dependencies.h = STENCIL_CORE_DEPENDENCY

    const routes = extractRoutes(uidl)
    const routeDefinitions = uidl.stateDefinitions.route

    // The name should be injected only with AppRoot only then it acts as entry point
    const decoratorAST = createComponentDecorator('AppRoot')

    chunks.push({
      name: componentDecoratorChunkName,
      type: CHUNK_TYPE.AST,
      fileType: FILE_TYPE.TSX,
      content: [decoratorAST],
      linkAfter: [importChunkName],
    })

    const exportClassAST = createClassDecleration(routes, routeDefinitions)

    chunks.push({
      name: componentChunkName,
      type: CHUNK_TYPE.AST,
      fileType: FILE_TYPE.TSX,
      content: exportClassAST,
      linkAfter: [componentDecoratorChunkName],
    })

    return structure
  }

  return stencilAppRouterComponentPlugin
}

export default createPlugin()
