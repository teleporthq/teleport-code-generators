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
        // @ts-ignore
        const jsxASTTag = componentChunk.meta.nodesLookup[key]
        // @ts-ignore
        const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop
        if (!jsxASTTag) {
          return
        }

        // Nested styles are ignored
        const rootStyles = UIDLUtils.cleanupNestedStyles(style)
        const inlineStyles = UIDLUtils.transformDynamicStyles(rootStyles, (styleValue) =>
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
