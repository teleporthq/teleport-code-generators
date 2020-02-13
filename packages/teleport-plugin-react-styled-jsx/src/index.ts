import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { ASTUtils, StyleBuilders, ASTBuilders } from '@teleporthq/teleport-plugin-common'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { generateStyledJSXTag } from './utils'
import * as types from '@babel/types'

interface StyledJSXConfig {
  componentChunkName: string
}

export const createReactStyledJSXPlugin: ComponentPluginFactory<StyledJSXConfig> = (config) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const reactStyledJSXPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure
    const { node } = uidl

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup as Record<string, types.JSXElement>
    // @ts-ignore
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
    let rootJSXNode = jsxNodesLookup[uidl.node.content.key]
    if (rootJSXNode.selfClosing) {
      const selfClosingTag = rootJSXNode
      rootJSXNode = ASTBuilders.createJSXTag('')
      rootJSXNode.children.push(selfClosingTag)

      // fetching the AST parent of the root JSXNode
      // We need to replace the root node which is self-closing (eg: <img> <input>) with a fragment <>
      // The fragment will be the parent of both the old root JSXNode and the style tag
      const componentAST = componentChunk.content as types.VariableDeclaration
      const arrowFnExpr = componentAST.declarations[0].init as types.ArrowFunctionExpression
      const bodyStatement = arrowFnExpr.body as types.BlockStatement
      const returnStatement = bodyStatement.body[0] as types.ReturnStatement
      returnStatement.argument = rootJSXNode
    }

    rootJSXNode.children.push(jsxASTNodeReference)
    return structure
  }

  return reactStyledJSXPlugin
}

export default createReactStyledJSXPlugin()
