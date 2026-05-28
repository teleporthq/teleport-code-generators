import * as types from '@babel/types'
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
      const { style, key, dynamicStyleBindings } = element
      const hasStyle = style && Object.keys(style).length > 0
      const hasDynamicBindings =
        dynamicStyleBindings && Object.keys(dynamicStyleBindings).length > 0

      if (!hasStyle && !hasDynamicBindings) {
        return
      }

      const jsxASTTag = componentChunk.meta.nodesLookup[key] as types.JSXElement
      const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop as string
      if (!jsxASTTag) {
        return
      }

      let inlineStyles: Record<string, unknown> = {}

      if (hasStyle) {
        inlineStyles = UIDLUtils.transformDynamicStyles(style, (styleValue) =>
          StyleBuilders.createDynamicStyleExpression(styleValue, propsPrefix)
        )
      }

      if (hasDynamicBindings) {
        for (const [cssProperty, binding] of Object.entries(dynamicStyleBindings)) {
          const camelCaseProperty = cssProperty.replace(/-([a-z])/g, (_, letter: string) =>
            letter.toUpperCase()
          )
          inlineStyles[camelCaseProperty] = StyleBuilders.createDynamicBindingExpression(binding)
        }
      }

      ASTUtils.addAttributeToJSXTag(jsxASTTag, 'style', inlineStyles)
    })

    return structure
  }
  return inlineStylesPlugin
}

export default createInlineStylesPlugin()
