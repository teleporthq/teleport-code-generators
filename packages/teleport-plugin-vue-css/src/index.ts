import { camelCaseToDashCase } from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'
import {
  splitDynamicAndStaticStyles,
  cleanupNestedStyles,
  traverseElements,
} from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import { createCSSClass } from '@teleporthq/teleport-shared/dist/cjs/builders/css-builders'
import { getContentOfStyleObject } from '@teleporthq/teleport-shared/dist/cjs/utils/jss-utils'
import {
  addClassToNode,
  addAttributeToNode,
} from '@teleporthq/teleport-shared/dist/cjs/utils/html-utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { FILE_TYPE, CHUNK_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { DEFAULT_VUE_DYNAMIC_STYLE } from './utils'

interface VueStyleChunkConfig {
  chunkName: string
  vueJSChunk: string
  vueTemplateChunk: string
  dynamicStylesSyntax?: (value) => any
}

export const createPlugin: ComponentPluginFactory<VueStyleChunkConfig> = (config) => {
  const {
    chunkName = 'vue-style-chunk',
    vueTemplateChunk = 'vue-template-chunk',
    dynamicStylesSyntax = DEFAULT_VUE_DYNAMIC_STYLE,
  } = config || {}

  const vueComponentStyleChunkPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure

    const { node } = uidl

    const templateChunk = chunks.filter((chunk) => chunk.name === vueTemplateChunk)[0]
    const templateLookup = templateChunk.meta.nodesLookup

    const jssStylesArray = []

    traverseElements(node, (element) => {
      const { style, key } = element

      if (style) {
        const { staticStyles, dynamicStyles } = splitDynamicAndStaticStyles(style)
        const root = templateLookup[key]

        if (Object.keys(staticStyles).length > 0) {
          const className = camelCaseToDashCase(key)
          jssStylesArray.push(createCSSClass(className, getContentOfStyleObject(staticStyles)))
          addClassToNode(root, className)
        }

        if (Object.keys(dynamicStyles).length) {
          const rootStyles = cleanupNestedStyles(dynamicStyles)

          const vueFriendlyStyleBind = dynamicStylesSyntax(rootStyles)

          // If dynamic styles are on nested-styles they are unfortunately lost, since inline style does not support that
          if (Object.keys(vueFriendlyStyleBind).length > 0) {
            addAttributeToNode(root, ':style', `{${vueFriendlyStyleBind.join(', ')}}`)
          }
        }
      }
    })

    if (jssStylesArray.length > 0) {
      chunks.push({
        type: CHUNK_TYPE.STRING,
        name: chunkName,
        fileType: FILE_TYPE.CSS,
        content: jssStylesArray.join('\n'),
        linkAfter: [],
      })
    }

    return structure
  }

  return vueComponentStyleChunkPlugin
}

export default createPlugin()
