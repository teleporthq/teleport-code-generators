import preset from 'jss-preset-default'
import jss from 'jss'
jss.setup(preset())

import { ComponentPlugin, ComponentPluginFactory } from '../../shared/types'
import { cammelCaseToDashCase } from '../../shared/utils/string-utils'
import { ContentNode, StyleDefinitions } from '../../uidl-definitions/types'

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

    const jssStylesArray = generateStyleTagStrings(content, templateLookup)

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

const generateStyleTagStrings = (content: ContentNode, templateLookup: Record<string, any>) => {
  let accumulator: string[] = []

  const { style, children, key } = content

  if (style) {
    const { staticStyles, dynamicStyles } = filterOutDynamicStyles(style)
    const root = templateLookup[key]
    const className = cammelCaseToDashCase(key)
    accumulator.push(
      jss
        .createStyleSheet(
          {
            [`.${className}`]: staticStyles,
          },
          {
            generateClassName: () => className,
          }
        )
        .toString()
    )

    if (Object.keys(dynamicStyles).length) {
      const vueFriendlyStyleBind = Object.keys(dynamicStyles).reduce((acc: string[], styleKey) => {
        acc.push(`${styleKey}: ${dynamicStyles[styleKey]}`)
        return acc
      }, [])
      root.attr(':style', `{${vueFriendlyStyleBind.join(', ')}}`)
    }

    root.addClass(className)
  }

  if (children) {
    children.forEach((child) => {
      // Skip text children
      if (typeof child === 'string') {
        return
      }
      const items = generateStyleTagStrings(child, templateLookup)
      accumulator = accumulator.concat(...items)
    })
  }

  return accumulator
}
