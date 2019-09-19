import { extractRoutes } from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { createComponentDecorator } from '@teleporthq/teleport-shared/dist/cjs/utils/ast-jsx-utils'
import {
  STENCIL_CORE_DEPENDENCY,
  DEFAULT_COMPONENT_DECORATOR_CHUNK_NAME,
  DEFAULT_COMPONENT_CHUNK_NAME,
  DEFAULT_IMPORT_CHUNK_NAME,
} from './constants'
import { createClassDeclaration } from './utils'

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

    /* The name should be injected only with AppRoot only then it acts as entry point,
    Sending only Root because app is appended while generation of decorators*/
    const params = {
      tag: 'app-root',
      shadow: true,
    }
    const decoratorAST = createComponentDecorator(params)

    chunks.push({
      name: componentDecoratorChunkName,
      type: ChunkType.AST,
      fileType: FileType.TSX,
      content: [decoratorAST],
      linkAfter: [importChunkName],
    })

    const classDeclarationAST = createClassDeclaration(routes, routeDefinitions)

    chunks.push({
      name: componentChunkName,
      type: ChunkType.AST,
      fileType: FileType.TSX,
      content: classDeclarationAST,
      linkAfter: [componentDecoratorChunkName],
    })

    return structure
  }

  return stencilAppRouterComponentPlugin
}

export default createPlugin()
