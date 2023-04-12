import {
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
} from '@teleporthq/teleport-types'
import { generateInitialPathsAST } from './utils'

interface StaticPropsPluginConfig {
  componentChunkName?: string
}

export const createStaticPathsPlugin: ComponentPluginFactory<StaticPropsPluginConfig> = (
  config
) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const staticPathsPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure
    if (!uidl.outputOptions?.initialPathsData) {
      return structure
    }

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const getStaticPathsAST = generateInitialPathsAST(
      uidl.outputOptions.initialPathsData,
      undefined,
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
