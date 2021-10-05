import {
  ComponentPlugin,
  FileType,
  ChunkType,
  HastNode,
  ComponentDefaultPluginParams,
  ComponentUIDL,
} from '@teleporthq/teleport-types'
import { HASTBuilders, HASTUtils } from '@teleporthq/teleport-plugin-common'
import { DEFAULT_COMPONENT_CHUNK_NAME } from './constants'
import { generateHtmlSynatx } from './node-handlers'

interface HtmlPluginConfig {
  componentChunkName: string
  wrapComponent?: boolean
}

interface HtmlPlugin {
  htmlComponentPlugin: ComponentPlugin
  addExternals: (list: Record<string, ComponentUIDL>) => void
}

type HtmlPluginFactory<T> = (config?: Partial<T & ComponentDefaultPluginParams>) => HtmlPlugin

export const createHTMLBasePlugin: HtmlPluginFactory<HtmlPluginConfig> = (config) => {
  const { componentChunkName = DEFAULT_COMPONENT_CHUNK_NAME, wrapComponent = false } = config || {}
  let externals: Record<string, ComponentUIDL> = {}

  const addExternals = (list?: Record<string, ComponentUIDL>) => {
    externals = {
      ...externals,
      ...(list || {}),
    }
  }

  const htmlComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure
    const { propDefinitions = {}, stateDefinitions = {} } = uidl

    const templatesLookUp: Record<string, unknown> = {}
    const compBase = wrapComponent
      ? HASTBuilders.createHTMLNode('body')
      : HASTBuilders.createHTMLNode('div')

    const bodyContent = await generateHtmlSynatx(
      uidl.node,
      templatesLookUp,
      propDefinitions,
      stateDefinitions,
      externals,
      { chunks, dependencies, options }
    )
    HASTUtils.addChildNode(compBase, bodyContent as HastNode)

    chunks.push({
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

  return {
    htmlComponentPlugin,
    addExternals,
  }
}

export default createHTMLBasePlugin()
