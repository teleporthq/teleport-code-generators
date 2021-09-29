import {
  ComponentPluginFactory,
  ComponentPlugin,
  FileType,
  ChunkType,
  HastNode,
} from '@teleporthq/teleport-types'
import { DEFAULT_COMPONENT_CHUNK_NAME } from './constants'
import { generateHtmlSynatx } from './node-handlers'
import { HASTBuilders, HASTUtils } from '@teleporthq/teleport-plugin-common'

interface HtmlPluginConfig {
  componentChunkName: string
  wrapComponent?: boolean
}

export const createHTMLComponentPlugin: ComponentPluginFactory<HtmlPluginConfig> = (config) => {
  const { componentChunkName = DEFAULT_COMPONENT_CHUNK_NAME, wrapComponent = false } = config || {}
  const htmlComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl } = structure
    const { propDefinitions = {}, stateDefinitions = {} } = uidl

    const templatesLookUp: Record<string, unknown> = {}
    const compBase = wrapComponent
      ? HASTBuilders.createHTMLNode('body')
      : HASTBuilders.createHTMLNode('div')

    const bodyContent = generateHtmlSynatx(
      uidl.node,
      templatesLookUp,
      propDefinitions,
      stateDefinitions
    )
    HASTUtils.addChildNode(compBase, bodyContent as HastNode)

    structure.chunks.push({
      type: ChunkType.HAST,
      fileType: FileType.HTML,
      name: componentChunkName,
      content: compBase,
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
