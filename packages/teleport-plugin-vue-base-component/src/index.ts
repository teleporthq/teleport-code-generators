import { generateVueComponentJS, extractStateObject } from './utils'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  FileType,
  ChunkType,
} from '@teleporthq/teleport-types'
import { createHTMLTemplateSyntax } from '@teleporthq/teleport-plugin-common'
import { UIDLUtils } from '@teleporthq/teleport-shared'

import {
  DEFAULT_VUE_TEMPLATE_CHUNK_NAME,
  DEFAULT_VUE_JS_CHUNK_NAME,
  DEFAULT_JS_CHUNK_AFTER,
} from './constants'

interface VueComponentConfig {
  vueTemplateChunkName: string
  vueJSChunkName: string
  jsChunkAfter: string[]
}

export const createVueComponentPlugin: ComponentPluginFactory<VueComponentConfig> = (config) => {
  const {
    vueTemplateChunkName = DEFAULT_VUE_TEMPLATE_CHUNK_NAME,
    vueJSChunkName = DEFAULT_VUE_JS_CHUNK_NAME,
    jsChunkAfter = DEFAULT_JS_CHUNK_AFTER,
  } = config || {}

  const vueComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure

    const templateLookup: { [key: string]: any } = {}
    const dataObject: Record<string, any> = {}
    const methodsObject: Record<string, any> = {}

    const templateContent = createHTMLTemplateSyntax(
      uidl.node,
      {
        templateLookup,
        dependencies,
        dataObject,
        methodsObject,
      },
      {
        interpolation: (value) => `{{ ${value} }}`,
        eventBinding: (value) => `@${value}`,
        valueBinding: (value) => `:${value}`,
        eventEmmitter: (value) => `this.$emit('${value}')`,
        conditionalAttr: 'v-if',
        repeatAttr: 'v-for',
        repeatIterator: (iteratorName, iteratedCollection, useIndex) => {
          const iterator = useIndex ? `(${iteratorName}, index)` : iteratorName
          return `${iterator} in ${iteratedCollection}`
        },
        customElementTagName: (value) => UIDLUtils.createWebComponentFriendlyName(value),
        dependencyHandling: 'import',
      }
    )

    chunks.push({
      type: ChunkType.HAST,
      name: vueTemplateChunkName,
      fileType: FileType.HTML,
      meta: {
        nodesLookup: templateLookup,
      },
      content: templateContent,
      linkAfter: [],
    })

    const stateObject = uidl.stateDefinitions ? extractStateObject(uidl.stateDefinitions) : {}
    const jsContent = generateVueComponentJS(
      uidl,
      Object.keys(dependencies),
      {
        ...stateObject,
        ...dataObject,
      },
      methodsObject
    )

    chunks.push({
      type: ChunkType.AST,
      name: vueJSChunkName,
      fileType: FileType.JS,
      linkAfter: jsChunkAfter,
      content: jsContent,
    })

    return structure
  }

  return vueComponentPlugin
}

export default createVueComponentPlugin()
