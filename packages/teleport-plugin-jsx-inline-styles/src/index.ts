import types from '@babel/types'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import { ASTUtils, StyleBuilders } from '@teleporthq/teleport-plugin-common'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'

interface InlineStyleConfig {
  componentChunkName: string
}
export const createInlineStylesPlugin: ComponentPluginFactory<InlineStyleConfig> = (config) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const inlineStylesPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)

    if (!componentChunk) {
      return structure
    }

    UIDLUtils.traverseElements(uidl.node, (element) => {
      const { style, key } = element

      if (style && Object.keys(style).length > 0) {
        const jsxASTTag = componentChunk.meta.nodesLookup[key] as types.JSXElement
        const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop as string
        if (!jsxASTTag) {
          return
        }

        // Nested styles are ignored
        const inlineStyles = UIDLUtils.transformDynamicStyles(style, (styleValue) =>
          StyleBuilders.createDynamicStyleExpression(styleValue, propsPrefix)
        )

        ASTUtils.addAttributeToJSXTag(jsxASTTag, 'style', inlineStyles)
      }
    })

    return structure
  }
  return inlineStylesPlugin
}

export default createInlineStylesPlugin()
