import {
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
  TeleportError,
} from '@teleporthq/teleport-types'
import { StringUtils } from '@teleporthq/teleport-shared'
import { generateInitialPathsAST } from './utils'

interface StaticPropsPluginConfig {
  componentChunkName?: string
}

export const createStaticPathsPlugin: ComponentPluginFactory<StaticPropsPluginConfig> = (
  config
) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const staticPathsPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, options } = structure
    const { resources } = options

    if (!uidl.outputOptions?.initialPathsData || !resources?.items) {
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
      StringUtils.camelCaseToDashCase(`${usedResource.name}-reource`)
    )

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const getStaticPathsAST = generateInitialPathsAST(
      uidl.outputOptions.initialPathsData,
      resourceImportName,
      uidl.outputOptions.pagination
    )

    chunks.push({
      name: 'getStaticPaths',
      type: ChunkType.AST,
      fileType: FileType.JS,
      content: getStaticPathsAST,
      linkAfter: [componentChunkName],
    })

    return structure
  }

  return staticPathsPlugin
}

export default createStaticPathsPlugin()
