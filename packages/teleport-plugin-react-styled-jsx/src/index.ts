import {
  addClassStringOnJSXTag,
  generateStyledJSXTag,
} from '@teleporthq/teleport-shared/lib/utils/ast-jsx-utils'

import { camelCaseToDashCase } from '@teleporthq/teleport-shared/lib/utils/string-utils'
import {
  transformDynamicStyles,
  traverseElements,
} from '@teleporthq/teleport-shared/lib/utils/uidl-utils'
import { createCSSClassFromStringMap } from '@teleporthq/teleport-shared/lib/utils/jss-utils'
import { ComponentPluginFactory, ComponentPlugin, UIDLElement } from '@teleporthq/teleport-types'

interface StyledJSXConfig {
  componentChunkName: string
}

export const createPlugin: ComponentPluginFactory<StyledJSXConfig> = (config) => {
  const { componentChunkName = 'react-component' } = config || {}

  const reactStyledJSXChunkPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure

    const { node } = uidl

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup

    const styleJSXString: string[] = []

    traverseElements(node, (element) => {
      const { style, key } = element
      if (style) {
        const root = jsxNodesLookup[key]
        const className = camelCaseToDashCase(key)
        // Generating the string templates for the dynamic styles
        const styleRules = transformDynamicStyles(style, (styleValue) => {
          if (styleValue.content.referenceType === 'prop') {
            return `\$\{props.${styleValue.content.id}\}`
          }
          throw new Error(
            `Error running transformDynamicStyles in reactStyledJSXChunkPlugin. Unsupported styleValue.content.referenceType value ${
              styleValue.content.referenceType
            }`
          )
        })
        styleJSXString.push(createCSSClassFromStringMap(className, styleRules))

        addClassStringOnJSXTag(root, className)
      }
    })

    if (!styleJSXString || !styleJSXString.length) {
      return structure
    }

    const jsxASTNodeReference = generateStyledJSXTag(styleJSXString.join('\n'))
    // We have the ability to insert the tag into the existig JSX structure, or do something else with it.
    // Here we take the JSX <style> tag and we insert it as the last child of the JSX structure
    // inside the React Component
    const rootNodeKey = (node.content as UIDLElement).key
    const rootJSXNode = rootNodeKey
      ? jsxNodesLookup[rootNodeKey]
      : jsxNodesLookup[Object.keys(jsxNodesLookup)[0]]

    rootJSXNode.children.push(jsxASTNodeReference)
    return structure
  }

  return reactStyledJSXChunkPlugin
}

export default createPlugin()
