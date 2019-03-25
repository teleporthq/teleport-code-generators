import { ComponentPlugin, ComponentPluginFactory } from '../../shared/types'
import { cammelCaseToDashCase } from '../../shared/utils/string-utils'
import {
  traverseNodes,
  splitDynamicAndStaticStyles,
  cleanupNestedStyles,
} from '../../shared/utils/uidl-utils'
import { createCSSClass } from '../../shared/utils/jss-utils'
import { addClassToNode, addAttributeToNode } from '../../shared/utils/html-utils'

interface VueStyleChunkConfig {
  chunkName: string
  vueJSChunk: string
  vueTemplateChunk: string
  styleFileId: string
}

export const createPlugin: ComponentPluginFactory<VueStyleChunkConfig> = (config) => {
  const {
    chunkName = 'vue-style-chunk',
    vueTemplateChunk = 'vue-template-chunk',
    styleFileId = 'vuecss',
  } = config || {}

  const vueComponentStyleChunkPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure

    const { content } = uidl

    const templateChunk = chunks.filter((chunk) => chunk.name === vueTemplateChunk)[0]
    const templateLookup = templateChunk.meta.lookup

    const jssStylesArray = []

    traverseNodes(content, (node) => {
      const { style, key } = node

      if (style) {
        const { staticStyles, dynamicStyles } = splitDynamicAndStaticStyles(style)
        const root = templateLookup[key]
        const className = cammelCaseToDashCase(key)
        jssStylesArray.push(createCSSClass(className, staticStyles))

        if (Object.keys(dynamicStyles).length) {
          const rootStyles = cleanupNestedStyles(dynamicStyles)

          const vueFriendlyStyleBind = Object.keys(rootStyles).map((styleKey) => {
            return `${styleKey}: ${rootStyles[styleKey].replace('$props.', '')}`
          })

          addAttributeToNode(root, ':style', `{${vueFriendlyStyleBind.join(', ')}}`)
        }

        addClassToNode(root, className)
      }
    })

    chunks.push({
      type: 'string',
      name: chunkName,
      meta: {
        fileId: styleFileId,
      },
      content: jssStylesArray.join('\n'),
      linkAfter: [],
    })

    return structure
  }

  return vueComponentStyleChunkPlugin
}

export default createPlugin()
