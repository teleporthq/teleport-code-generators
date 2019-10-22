import * as types from '@babel/types'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { ASTUtils, ASTBuilders } from '@teleporthq/teleport-plugin-common'
import { UIDLUtils } from '@teleporthq/teleport-shared'

interface ReactNativeNavigationPluginConfig {
  componentChunkName: string
}

export const createReactNativeNavigationPlugin: ComponentPluginFactory<
  ReactNativeNavigationPluginConfig
> = (config) => {
  const { componentChunkName = 'jsx-component' } = config || {}

  const reactNativeNavigationPlugin: ComponentPlugin = async (structure) => {
    const { chunks, uidl } = structure
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup as Record<string, types.JSXElement>
    UIDLUtils.traverseElements(uidl.node, (element) => {
      if (
        element.elementType !== 'TouchableWithoutFeedback' ||
        !(element.attrs && element.attrs.transitionTo)
      ) {
        // Skip if element is not a navlink
        return
      }

      const jsxElement = jsxNodesLookup[element.key]
      const transitionToAttr = ASTUtils.findAttributeByName(jsxElement, 'transitionTo')

      // screen name can be a static string or a dynamic value
      const screenNameAST =
        transitionToAttr.value.type === 'JSXExpressionContainer'
          ? (transitionToAttr.value.expression as types.MemberExpression)
          : (transitionToAttr.value as types.StringLiteral)

      ASTUtils.removeAttributeByName(jsxElement, 'transitionTo')

      jsxElement.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('onPress'),
          types.jsxExpressionContainer(
            types.arrowFunctionExpression(
              [],
              types.callExpression(types.identifier('props.navigation.navigate'), [screenNameAST])
            )
          )
        )
      )

      // If any of the navlink children is a plain text or jsx expression node, it needs to be surrounded by a Text element
      if (jsxElement.children) {
        jsxElement.children = jsxElement.children.map((child) => {
          if (child.type === 'JSXText' && child.value === '\n') {
            // skip new line children which are added by default after each text element
            return child
          }

          if (child.type !== 'JSXExpressionContainer' && child.type !== 'JSXText') {
            return child
          }

          return ASTBuilders.createJSXTag('Text', [child])
        })
      }
    })

    return structure
  }

  return reactNativeNavigationPlugin
}

export default createReactNativeNavigationPlugin()
