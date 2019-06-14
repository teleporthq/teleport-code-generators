import { camelCaseToDashCase } from '@teleporthq/teleport-shared/lib/utils/string-utils'
import {
  splitDynamicAndStaticStyles,
  cleanupNestedStyles,
  traverseElements,
} from '@teleporthq/teleport-shared/lib/utils/uidl-utils'
import { createCSSClass } from '@teleporthq/teleport-shared/lib/builders/css-builders'
import { getContentOfStyleObject } from '@teleporthq/teleport-shared/lib/utils/jss-utils'
import {
  addClassToNode,
  addAttributeToNode,
} from '@teleporthq/teleport-shared/lib/utils/html-utils'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLDynamicReference,
} from '@teleporthq/teleport-types'
import { FILE_TYPE } from '@teleporthq/teleport-shared/lib/constants'

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
    styleFileId = FILE_TYPE.CSS,
  } = config || {}

  const vueComponentStyleChunkPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure

    const { node } = uidl

    const templateChunk = chunks.filter((chunk) => chunk.name === vueTemplateChunk)[0]
    const templateLookup = templateChunk.meta.lookup

    const jssStylesArray = []

    traverseElements(node, (element) => {
      const { style, key } = element

      if (style) {
        const { staticStyles, dynamicStyles } = splitDynamicAndStaticStyles(style)
        const root = templateLookup[key]
        const className = camelCaseToDashCase(key)
        jssStylesArray.push(createCSSClass(className, getContentOfStyleObject(staticStyles)))

        if (Object.keys(dynamicStyles).length) {
          const rootStyles = cleanupNestedStyles(dynamicStyles)

          const vueFriendlyStyleBind = Object.keys(rootStyles).map((styleKey) => {
            return `${styleKey}: ${(rootStyles[styleKey] as UIDLDynamicReference).content.id}`
          })

          addAttributeToNode(root, ':style', `{${vueFriendlyStyleBind.join(', ')}}`)
        }

        addClassToNode(root, className)
      }
    })

    if (jssStylesArray.length > 0) {
      chunks.push({
        type: 'string',
        name: chunkName,
        meta: {
          fileId: styleFileId,
        },
        content: jssStylesArray.join('\n'),
        linkAfter: [],
      })
    }

    return structure
  }

  return vueComponentStyleChunkPlugin
}

export default createPlugin()
