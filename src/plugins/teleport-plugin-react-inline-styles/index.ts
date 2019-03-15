import { ComponentPlugin, ComponentPluginFactory } from '../../shared/types'

import * as t from '@babel/types'

import { addJSXTagStyles } from '../../shared/utils/ast-jsx-utils'
import { ParsedASTNode } from '../../shared/utils/ast-js-utils'
import {
  traverseNodes,
  cleanupNestedStyles,
  transformDynamicStyles,
} from '../../shared/utils/uidl-utils'

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

    traverseNodes(uidl.content, (node) => {
      const { style, key } = node

      if (style) {
        const jsxASTTag = componentChunk.meta.nodesLookup[key]
        if (!jsxASTTag) {
          return
        }

        // Nested styles are ignored
        const rootStyles = cleanupNestedStyles(style)
        const inlineStyles = transformDynamicStyles(
          rootStyles,
          (styleValue) =>
            new ParsedASTNode(
              t.memberExpression(
                t.identifier('props'),
                t.identifier(styleValue.replace('$props.', ''))
              )
            )
        )

        addJSXTagStyles(jsxASTTag, inlineStyles)
      }
    })

    return structure
  }
  return reactInlineStyleComponentPlugin
}

export default createPlugin()
