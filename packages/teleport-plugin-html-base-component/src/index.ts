import {
  ComponentPluginFactory,
  ComponentPlugin,
  FileType,
  ChunkType,
} from '@teleporthq/teleport-types'
import { DEFAULT_COMPONENT_CHUNK_NAME } from './constants'
import { generateHtmlSynatx } from './node-handlers'
import { HASTBuilders, HASTUtils } from '@teleporthq/teleport-plugin-common'

interface HtmlPluginConfig {
  componentChunkName: string
}

export const createHTMLComponentPlugin: ComponentPluginFactory<HtmlPluginConfig> = (config) => {
  const { componentChunkName = DEFAULT_COMPONENT_CHUNK_NAME } = config || {}
  const htmlComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl } = structure
    const templatesLookUp: Record<string, unknown> = {}

    const htmlTag = HASTBuilders.createHTMLNode('html')
    const bodyTag = HASTBuilders.createHTMLNode('body')
    HASTUtils.addChildNode(htmlTag, bodyTag)

    const bodyContent = generateHtmlSynatx(uidl.node, templatesLookUp)

    if (typeof bodyContent === 'string') {
      const spanTag = HASTBuilders.createHTMLNode('span')
      HASTUtils.addTextNode(spanTag, bodyContent)
      HASTUtils.addChildNode(spanTag, bodyTag)
    } else {
      HASTUtils.addChildNode(bodyTag, bodyContent)
    }

    structure.chunks.push({
      type: ChunkType.HAST,
      fileType: FileType.HTML,
      name: componentChunkName,
      content: htmlTag,
      linkAfter: [],
      meta: {
        nodesLookup: templatesLookUp,
      },
    })

    return structure
  }

  return htmlComponentPlugin
}

export default createHTMLComponentPlugin()
