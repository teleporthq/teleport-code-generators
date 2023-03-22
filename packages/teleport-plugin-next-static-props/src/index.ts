import {
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
} from '@teleporthq/teleport-types'
import { generateInitialPropsAST } from './utils'

interface StaticPropsPluginConfig {
  componentChunkName?: string
}

export const createStaticPropsPlugin: ComponentPluginFactory<StaticPropsPluginConfig> = (
  config
) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const staticPropsPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure
    if (!uidl.outputOptions?.initialPropsResource) {
      return structure
    }

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const getStaticPropsAST = generateInitialPropsAST(
      uidl.outputOptions.initialPropsResource,
      'context'
    )

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
