import { generateVueComponentJS, extractStateObject } from './utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { FILE_TYPE, CHUNK_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import createHTMLTemplateSyntax from '@teleporthq/teleport-shared/dist/cjs/node-handlers/node-to-html'

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

export const createPlugin: ComponentPluginFactory<VueComponentConfig> = (config) => {
  const {
    vueTemplateChunkName = DEFAULT_VUE_TEMPLATE_CHUNK_NAME,
    vueJSChunkName = DEFAULT_VUE_JS_CHUNK_NAME,
    jsChunkAfter = DEFAULT_JS_CHUNK_AFTER,
  } = config || {}

  const vueBasePlugin: ComponentPlugin = async (structure) => {
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
        customElementTagName: (value) => value,
      }
    )

    chunks.push({
      type: CHUNK_TYPE.HAST,
      name: vueTemplateChunkName,
      fileType: FILE_TYPE.HTML,
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
      type: CHUNK_TYPE.AST,
      name: vueJSChunkName,
      fileType: FILE_TYPE.JS,
      linkAfter: jsChunkAfter,
      content: jsContent,
    })

    return structure
  }

  return vueBasePlugin
}

export default createPlugin()
