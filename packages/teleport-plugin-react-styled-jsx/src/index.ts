import { ASTUtils, StringUtils, UIDLUtils, StyleBuilders } from '@teleporthq/teleport-shared'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { generateStyledJSXTag } from './utils'

interface StyledJSXConfig {
  componentChunkName: string
}

export const createPlugin: ComponentPluginFactory<StyledJSXConfig> = (config) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const reactStyledJSXChunkPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure
    const { node } = uidl

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup
    const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop

    const styleJSXString: string[] = []

    UIDLUtils.traverseElements(node, (element) => {
      const { style, key } = element
      if (style && Object.keys(style).length > 0) {
        const root = jsxNodesLookup[key]
        const className = StringUtils.camelCaseToDashCase(key)
        // Generating the string templates for the dynamic styles
        const styleRules = UIDLUtils.transformDynamicStyles(style, (styleValue) => {
          if (styleValue.content.referenceType === 'prop') {
            return `\$\{${propsPrefix}.${styleValue.content.id}\}`
          }
          throw new Error(
            `Error running transformDynamicStyles in reactStyledJSXChunkPlugin. Unsupported styleValue.content.referenceType value ${styleValue.content.referenceType}`
          )
        })
        styleJSXString.push(StyleBuilders.createCSSClass(className, styleRules))
        ASTUtils.addClassStringOnJSXTag(root, className)
      }
    })

    if (!styleJSXString || !styleJSXString.length) {
      return structure
    }

    const jsxASTNodeReference = generateStyledJSXTag(styleJSXString.join('\n'))
    // We have the ability to insert the tag into the existig JSX structure, or do something else with it.
    // Here we take the JSX <style> tag and we insert it as the last child of the JSX structure
    // inside the React Component
    const rootJSXNode = jsxNodesLookup[uidl.node.content.key]
    rootJSXNode.children.push(jsxASTNodeReference)
    return structure
  }

  return reactStyledJSXChunkPlugin
}

export default createPlugin()
