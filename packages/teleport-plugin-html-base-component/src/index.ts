import {
  ComponentPlugin,
  FileType,
  ChunkType,
  HastNode,
  ComponentDefaultPluginParams,
  ComponentUIDL,
  HastText,
  UIDLElementNode,
} from '@teleporthq/teleport-types'
import { HASTBuilders, HASTUtils } from '@teleporthq/teleport-plugin-common'
import { DEFAULT_COMPONENT_CHUNK_NAME } from './constants'
import { generateHtmlSyntax } from './node-handlers'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'

interface HtmlPluginConfig {
  componentChunkName: string
  wrapComponent?: boolean
}

interface HtmlPlugin {
  htmlComponentPlugin: ComponentPlugin
  addExternals: (list: Record<string, ComponentUIDL>, plugins: ComponentPlugin[]) => void
}

type HtmlPluginFactory<T> = (config?: Partial<T & ComponentDefaultPluginParams>) => HtmlPlugin

export const createHTMLBasePlugin: HtmlPluginFactory<HtmlPluginConfig> = (config) => {
  const { componentChunkName = DEFAULT_COMPONENT_CHUNK_NAME, wrapComponent = false } = config || {}
  let externals: Record<string, ComponentUIDL> = {}
  let plugins: ComponentPlugin[] = []

  const addExternals = (
    list?: Record<string, ComponentUIDL>,
    subComponentPlugins: ComponentPlugin[] = []
  ) => {
    externals = {
      ...externals,
      ...(list || {}),
    }
    plugins = subComponentPlugins
  }

  const htmlComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks = [], dependencies, options } = structure
    const { propDefinitions = {}, stateDefinitions = {}, outputOptions } = uidl

    const nodesLookup: Record<string, HastNode | HastText> = {}
    const compBase = wrapComponent
      ? HASTBuilders.createHTMLNode('body')
      : HASTBuilders.createHTMLNode('div')

    const subComponents = {
      externals: Object.values(externals).reduce(
        (acc: Record<string, ComponentUIDL>, comp: ComponentUIDL) => {
          UIDLUtils.setFriendlyOutputOptions(comp)
          comp.name = StringUtils.removeIllegalCharacters(comp.name) || 'AppComponent'
          comp.name = UIDLUtils.getComponentClassName(comp)
          acc[comp.name] = comp
          return acc
        },
        {}
      ),
      plugins,
    }
    const templateOptions = { chunks, dependencies, options, outputOptions }

    /*
      We need to generate jsx structure of every node that is defined in the UIDL.
      If we use these nodes in the later stage of the code-generation depends on the usage of these nodes.
    */
    for (const propKey of Object.keys(propDefinitions)) {
      const prop = propDefinitions[propKey]
      if (
        prop.type === 'element' &&
        prop.defaultValue !== undefined &&
        typeof prop.defaultValue === 'object'
      ) {
        await generateHtmlSyntax(
          prop.defaultValue as UIDLElementNode,
          nodesLookup,
          propDefinitions,
          stateDefinitions,
          subComponents,
          templateOptions
        )
      }
    }

    const bodyContent = await generateHtmlSyntax(
      uidl.node,
      nodesLookup,
      propDefinitions,
      stateDefinitions,
      subComponents,
      templateOptions
    )

    HASTUtils.addChildNode(compBase, bodyContent as HastNode)

    chunks.push({
      type: ChunkType.HAST,
      fileType: FileType.HTML,
      name: componentChunkName,
      content: compBase,
      linkAfter: [],
      meta: {
        nodesLookup,
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
