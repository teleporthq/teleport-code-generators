import { StyleDefinitions } from '../../uidl-definitions/types'
import { ComponentPlugin, ComponentPluginFactory } from '../../shared/types'
import { addClassStringOnJSXTag, generateStyledJSXTag } from '../../shared/utils/ast-jsx-utils'

import { cammelCaseToDashCase } from '../../shared/utils/string-utils'
import { traverseNodes } from '../../shared/utils/uidl-utils'
import { createCSSClass } from '../../shared/utils/jss-utils'

interface StyledJSXConfig {
  componentChunkName: string
}

export const createPlugin: ComponentPluginFactory<StyledJSXConfig> = (config) => {
  const { componentChunkName = 'react-component' } = config || {}

  const reactStyledJSXChunkPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure

    const { content } = uidl

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup

    const styleJSXString: string[] = []

    traverseNodes(content, (node) => {
      const { style, key } = node
      if (style) {
        const root = jsxNodesLookup[key]
        const className = cammelCaseToDashCase(key)
        const styleRules = prepareDynamicProps(style)
        styleJSXString.push(createCSSClass(className, styleRules))

        addClassStringOnJSXTag(root, className)
      }
    })

    if (!styleJSXString || !styleJSXString.length) {
      return structure
    }

    const jsxASTNodeReference = generateStyledJSXTag(styleJSXString.join('\n'))
    const rootJSXNode = jsxNodesLookup[content.key]

    // We have the ability to insert the tag into the existig JSX structure, or do something else with it.
    // Here we take the JSX <style> tag and we insert it as the last child of the JSX structure
    // inside the React Component
    rootJSXNode.children.push(jsxASTNodeReference)

    return structure
  }

  return reactStyledJSXChunkPlugin
}

export default createPlugin()

const prepareDynamicProps = (style: StyleDefinitions) => {
  return Object.keys(style).reduce((acc: any, key) => {
    const value = style[key]
    // tslint:disable-next-line:prefer-conditional-expression
    if (typeof value === 'string' && value.startsWith('$props.')) {
      acc[key] = `\$\{${value.replace('$props.', 'props.')}\}`
    } else {
      acc[key] = style[key]
    }
    return acc
  }, {})
}
