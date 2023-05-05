import {
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
  TeleportError,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import { StringUtils } from '@teleporthq/teleport-shared'
import { generateInitialPropsAST } from './utils'

interface StaticPropsPluginConfig {
  componentChunkName?: string
}

export const createStaticPropsPlugin: ComponentPluginFactory<StaticPropsPluginConfig> = (
  config
) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const staticPropsPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, options } = structure
    const { resources } = options

    if (!uidl.outputOptions?.initialPropsData || !resources?.items) {
      return structure
    }

    const { resourceId } = uidl?.outputOptions?.initialPropsData
    const usedResource = resources.items[resourceId.content]

    if (!usedResource) {
      throw new TeleportError(
        `Resource ${resourceId.content} is being used, but missing from the project ressources`
      )
    }

    const resourceImportName = StringUtils.dashCaseToCamelCase(
      StringUtils.camelCaseToDashCase(usedResource.name)
    )

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const getStaticPropsAST = generateInitialPropsAST(
      uidl.outputOptions.initialPropsData,
      'context',
      !!uidl.outputOptions.dynamicRouteAttribute,
      uidl.outputOptions.pagination
    )

    chunks.push({
      name: 'import-resource-chunk',
      type: ChunkType.AST,
      fileType: FileType.JS,
      content: types.importDeclaration(
        [types.importDefaultSpecifier(types.identifier(resourceImportName))],
        types.stringLiteral(
          `${resources.path}${StringUtils.camelCaseToDashCase(usedResource.name)}`
        )
      ),
      linkAfter: [''],
    })

    chunks.push({
      name: 'getStaticProps',
      type: ChunkType.AST,
      fileType: FileType.JS,
      content: getStaticPropsAST,
      linkAfter: [componentChunkName],
    })

    return structure
  }

  return staticPropsPlugin
}

export default createStaticPropsPlugin()
