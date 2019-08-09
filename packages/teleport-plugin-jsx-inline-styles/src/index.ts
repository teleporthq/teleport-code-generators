import { addAttributeToJSXTag } from '@teleporthq/teleport-shared/dist/cjs/utils/ast-jsx-utils'
import { createDynamicStyleExpression } from '@teleporthq/teleport-shared/dist/cjs/builders/css-builders'
import {
  cleanupNestedStyles,
  transformDynamicStyles,
  traverseElements,
} from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'

interface InlineStyleConfig {
  componentChunkName: string
}
export const createPlugin: ComponentPluginFactory<InlineStyleConfig> = (config) => {
  const { componentChunkName = 'jsx-component' } = config || {}
  /**
   * Generate the inlines stlye definition as a AST block which will represent the
   * defined styles of this component in UIDL
   *
   * @param structure : ComponentStructure
   */
  const reactInlineStyleComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)

    if (!componentChunk) {
      return structure
    }

    traverseElements(uidl.node, (element) => {
      const { style, key } = element

      if (style && Object.keys(style).length > 0) {
        const jsxASTTag = componentChunk.meta.nodesLookup[key]
        const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop
        if (!jsxASTTag) {
          return
        }

        // Nested styles are ignored
        const rootStyles = cleanupNestedStyles(style)
        const inlineStyles = transformDynamicStyles(rootStyles, (styleValue) =>
          createDynamicStyleExpression(styleValue, propsPrefix)
        )

        addAttributeToJSXTag(jsxASTTag, 'style', inlineStyles)
      }
    })

    return structure
  }
  return reactInlineStyleComponentPlugin
}

export default createPlugin()
