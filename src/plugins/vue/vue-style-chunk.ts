import { ComponentPlugin, ComponentPluginFactory } from '../../shared/types'
import { cammelCaseToDashCase } from '../../shared/utils/string-utils'
import { StyleDefinitions } from '../../uidl-definitions/types'
import { traverseNodes } from '../../shared/utils/uidl-utils'
import { createCSSClass } from '../../shared/utils/jss-utils'

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
        const { staticStyles, dynamicStyles } = filterOutDynamicStyles(style)
        const root = templateLookup[key]
        const className = cammelCaseToDashCase(key)
        jssStylesArray.push(createCSSClass(className, staticStyles))

        if (Object.keys(dynamicStyles).length) {
          const vueFriendlyStyleBind = Object.keys(dynamicStyles).reduce(
            (acc: string[], styleKey) => {
              acc.push(`${styleKey}: ${dynamicStyles[styleKey]}`)
              return acc
            },
            []
          )
          root.attr(':style', `{${vueFriendlyStyleBind.join(', ')}}`)
        }

        root.addClass(className)
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

const filterOutDynamicStyles = (style: StyleDefinitions) => {
  if (!style) {
    return { staticStyles: null, dynamicStyles: null }
  }
  return Object.keys(style).reduce(
    (acc: any, key) => {
      const styleValue = style[key].toString()
      if (styleValue.startsWith('$props.')) {
        acc.dynamicStyles[key] = styleValue.replace('$props.', '')
      } else {
        acc.staticStyles[key] = styleValue
      }
      return acc
    },
    { staticStyles: {}, dynamicStyles: {} }
  )
}
