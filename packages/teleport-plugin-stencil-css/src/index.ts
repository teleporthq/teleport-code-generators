import { camelCaseToDashCase } from '@teleporthq/teleport-shared/lib/utils/string-utils'
import {
  splitDynamicAndStaticStyles,
  cleanupNestedStyles,
  traverseElements,
  transformDynamicStyles,
} from '@teleporthq/teleport-shared/lib/utils/uidl-utils'
import {
  createCSSClass,
  createDynamicStyleExpression,
} from '@teleporthq/teleport-shared/lib/builders/css-builders'
import { getContentOfStyleObject } from '@teleporthq/teleport-shared/lib/utils/jss-utils'
import { addAttributeToJSXTag } from '@teleporthq/teleport-shared/lib/utils/ast-jsx-utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { FILE_TYPE } from '@teleporthq/teleport-shared/lib/constants'

interface StencilStyleChunkConfig {
  componentChunkName: string
  styleChunkName: string
  styleFileId: string
}

export const createPlugin: ComponentPluginFactory<StencilStyleChunkConfig> = (config) => {
  const {
    componentChunkName = 'stencil-component',
    styleChunkName = 'stencil-style',
    styleFileId = FILE_TYPE.CSS,
  } = config || {}

  const stencilComponentStyleChunkPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure

    const { node } = uidl

    const stencilComponent = chunks.filter((chunk) => chunk.name === componentChunkName)[0]
    const jsxNodesLookup = stencilComponent.meta.nodesLookup

    const jssStylesArray = []

    traverseElements(node, (element) => {
      const { style, key } = element

      if (style) {
        const { staticStyles, dynamicStyles } = splitDynamicAndStaticStyles(style)
        const root = jsxNodesLookup[key]

        if (Object.keys(dynamicStyles).length > 0) {
          const rootStyles = cleanupNestedStyles(dynamicStyles)
          const inlineStyles = transformDynamicStyles(rootStyles, (styleValue) =>
            createDynamicStyleExpression(styleValue)
          )

          addAttributeToJSXTag(root, 'style', inlineStyles)
        }

        if (Object.keys(staticStyles).length > 0) {
          const className = camelCaseToDashCase(key)
          jssStylesArray.push(createCSSClass(className, getContentOfStyleObject(staticStyles)))

          addAttributeToJSXTag(root, 'class', className)
        }
      }
    })

    if (jssStylesArray.length > 0) {
      chunks.push({
        type: 'string',
        name: styleChunkName,
        meta: {
          fileId: styleFileId,
        },
        content: jssStylesArray.join('\n'),
        linkAfter: [],
      })
    }

    return structure
  }

  return stencilComponentStyleChunkPlugin
}

export default createPlugin()
