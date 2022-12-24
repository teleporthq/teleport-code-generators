import { ComponentPluginFactory, ComponentPlugin, UIDLDependency } from '@teleporthq/teleport-types'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import * as types from '@babel/types'

interface NextImagePluginConfig {
  componentChunkName: string
  localAssetFolder: string
}

/*
  At the moment, the plugin is very restricted wo work only in the following cases.
  - When both the units specified for the img match. 
    Eg - both height and width to have same 'px' identifier

-   When the `img` tag has only width and height specified.
    https://github.com/vercel/next.js/discussions/18312
*/

const CSS_REGEX = /^([+-]?(?:\d+|\d*\.\d+))([a-z]*|%)$/
const NEXT_HEAD_DEPENDENCY: UIDLDependency = {
  type: 'library',
  path: 'next/image',
  version: '10.2.0',
}

export const createNextImagePlugin: ComponentPluginFactory<NextImagePluginConfig> = (config) => {
  const { componentChunkName = 'jsx-component', localAssetFolder = 'playground_assets' } =
    config || {}
  const nextImagePlugin: ComponentPlugin = async (structure) => {
    const { chunks, uidl, dependencies } = structure
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return
    }

    UIDLUtils.traverseElements(uidl.node, (element) => {
      const { elementType, attrs = {}, style = {}, key } = element

      if (key && elementType === 'img' && Object.keys(style).length === 2) {
        const imageSource = attrs?.src?.content.toString()
        if (!imageSource?.startsWith(`/${localAssetFolder}`)) {
          return
        }

        if (!(style.hasOwnProperty('width') && style.hasOwnProperty('height'))) {
          return
        }

        const { height, width } = style
        const heightUnit = String(height.content).match(CSS_REGEX)?.[2]
        const widthUnit = String(width.content).match(CSS_REGEX)?.[2]

        if (heightUnit?.length === 0 || heightUnit !== widthUnit) {
          return
        }

        const jsxTag = (
          componentChunk.meta.nodesLookup as unknown as Record<string, types.JSXElement>
        )[key]

        if (!jsxTag) {
          return
        }

        ;(jsxTag.openingElement.name as types.JSXIdentifier).name = 'Image'
        ;(jsxTag.closingElement.name as types.JSXIdentifier).name = 'Image'
        jsxTag.openingElement.attributes = [
          ...jsxTag.openingElement.attributes,
          types.jsxAttribute(
            types.jsxIdentifier('width'),
            types.jsxExpressionContainer(types.numericLiteral(parseInt(String(width.content), 10)))
          ),
          types.jsxAttribute(
            types.jsxIdentifier('height'),
            types.jsxExpressionContainer(types.numericLiteral(parseInt(String(height.content), 10)))
          ),
        ]

        if (!dependencies.Image) {
          dependencies.Image = NEXT_HEAD_DEPENDENCY
        }
      }
    })

    return structure
  }

  return nextImagePlugin
}

export default createNextImagePlugin()
