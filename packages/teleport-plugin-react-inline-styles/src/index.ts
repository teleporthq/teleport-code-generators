import * as t from '@babel/types'

import { addJSXTagStyles } from '@teleporthq/teleport-shared/lib/utils/ast-jsx-utils'
import { ParsedASTNode } from '@teleporthq/teleport-shared/lib/utils/ast-js-utils'
import {
  cleanupNestedStyles,
  transformDynamicStyles,
  traverseElements,
} from '@teleporthq/teleport-shared/lib/utils/uidl-utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'

interface InlineStyleConfig {
  componentChunkName: string
}
export const createPlugin: ComponentPluginFactory<InlineStyleConfig> = (config) => {
  const { componentChunkName = 'react-component' } = config || {}
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

      if (style) {
        const jsxASTTag = componentChunk.meta.nodesLookup[key]
        if (!jsxASTTag) {
          return
        }

        // Nested styles are ignored
        const rootStyles = cleanupNestedStyles(style)
        const inlineStyles = transformDynamicStyles(rootStyles, (styleValue) => {
          const expression =
            styleValue.content.referenceType === 'state'
              ? t.identifier(styleValue.content.id)
              : t.memberExpression(t.identifier('props'), t.identifier(styleValue.content.id))
          return new ParsedASTNode(expression)
        })

        addJSXTagStyles(jsxASTTag, inlineStyles)
      }
    })

    return structure
  }
  return reactInlineStyleComponentPlugin
}

export default createPlugin()
