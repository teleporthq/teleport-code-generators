import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkDefinition,
  ChunkType,
  UIDLDependency,
  FileType,
} from '@teleporthq/teleport-types'
import { GOOGLE_FONTS } from './fonts'
import * as types from '@babel/types'

interface NextImagePluginConfig {
  componentChunkName: string
  localAssetFolder: string
}

const NEXT_FONT_DEPENDENCY: UIDLDependency = {
  type: 'library',
  path: 'next/font/google',
  version: '13.3.0',
}

export const createNextGoogleFontPlugin: ComponentPluginFactory<NextImagePluginConfig> = (
  config
) => {
  const { componentChunkName = 'jsx-component' } = config || {}
  const googleFontPlugin: ComponentPlugin = async (structure) => {
    const { chunks, uidl } = structure
    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return
    }

    UIDLUtils.traverseElements(uidl.node, ({ style, key }) => {
      const jsxNode = componentChunk.meta.nodesLookup[key] as types.JSXElement
      if (!style?.fontFamily || style.fontFamily.type !== 'static' || !jsxNode) {
        return
      }

      const font = style.fontFamily.content as string
      const fontVariable = StringUtils.camelCaseToDashCase(
        StringUtils.removeIllegalCharacters(font)
      )
      const isGoogleFont = GOOGLE_FONTS.indexOf(font) !== -1
      if (!isGoogleFont) {
        return
      }

      const chunk: ChunkDefinition = {
        type: ChunkType.AST,
        name: 'google-font-import-chunk',
        fileType: FileType.JS,
        content: types.importDeclaration(
          [types.importSpecifier(types.identifier(font), types.identifier(font))],
          types.stringLiteral(NEXT_FONT_DEPENDENCY.path)
        ),
        linkAfter: [],
      }

      const variableDeclerationChunk: ChunkDefinition = {
        type: ChunkType.AST,
        name: 'font-var-chunk',
        fileType: FileType.JS,
        content: types.variableDeclaration('const', [
          types.variableDeclarator(
            types.identifier(fontVariable),
            types.callExpression(types.identifier(font), [
              types.objectExpression([
                types.objectProperty(types.identifier('preload'), types.identifier('false')),
              ]),
            ])
          ),
        ]),
        linkAfter: [],
      }

      const isInlineStyleAlreadyAdded = jsxNode.openingElement.attributes.find(
        (attr) => attr.type === 'JSXAttribute' && attr.name.name === 'style'
      )

      if (!isInlineStyleAlreadyAdded) {
        const jsxAttribute: types.JSXAttribute = types.jsxAttribute(
          types.jsxIdentifier('style'),
          types.jsxExpressionContainer(
            types.objectExpression([
              types.objectProperty(
                types.identifier('fontFamily'),
                types.memberExpression(
                  types.memberExpression(types.identifier(fontVariable), types.identifier('style')),
                  types.identifier('fontFamily')
                )
              ),
            ])
          )
        )
        jsxNode.openingElement.attributes.push(jsxAttribute)
      }

      delete style.fontFamily
      chunks.unshift(chunk)
      chunks.push(variableDeclerationChunk)
    })

    return structure
  }

  return googleFontPlugin
}

export default createNextGoogleFontPlugin()
