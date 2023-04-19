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
    const { uidl, chunks, dependencies } = structure
    if (!uidl.outputOptions?.initialPropsData) {
      return structure
    }

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

    uidl.outputOptions.initialPropsData.resourceMappers?.forEach((mapper) => {
      dependencies[mapper.name] = mapper.resource
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
