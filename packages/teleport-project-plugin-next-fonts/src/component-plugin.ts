import { UIDLUtils } from '@teleporthq/teleport-shared'
import { ComponentPlugin, ChunkType, FileType, UIDLElement } from '@teleporthq/teleport-types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import * as types from '@babel/types'
import {
  NEXT_FONT_DEPENDENCY,
  generateFontDeclerationChunk,
  getFontAndVariable,
  isGoogleFont,
} from './utils'

export const createNextGoogleFontPlugin = () => {
  const googleFontPlugin: ComponentPlugin = async (structure) => {
    const { chunks, uidl } = structure
    const { styleSetDefinitions = {} } = uidl
    const importSpecifiers: types.ImportSpecifier[] = []

    const componentChunk = chunks.find((chunk) => chunk.name === 'jsx-component')
    const fontDeclerationMap: Record<string, boolean> = {}
    if (!componentChunk) {
      return structure
    }

    const rootNode = componentChunk.meta.nodesLookup[uidl.node.content.key] as types.JSXElement
    if (rootNode) {
      const generateFontDeclerationChunkAndAddToNode = (
        content: string,
        params: { weight?: string }
      ): string => {
        const [font, fontDecleration, variable] = getFontAndVariable(content)
        ASTUtils.addClassStringOnJSXTag(
          rootNode,
          [],
          [types.memberExpression(types.identifier(fontDecleration), types.identifier('variable'))]
        )

        if (!fontDeclerationMap[font]) {
          importSpecifiers.push(
            types.importSpecifier(types.identifier(font), types.identifier(font))
          )
          chunks.unshift(
            generateFontDeclerationChunk(font, fontDecleration, variable, params.weight)
          )
        }

        return variable
      }

      Object.values(styleSetDefinitions).forEach((style) => {
        if (style.content?.fontFamily && isGoogleFont(style.content.fontFamily.content as string)) {
          const variable = generateFontDeclerationChunkAndAddToNode(
            style.content.fontFamily.content as string,
            {
              weight: style.content?.fontWeight?.content as string,
            }
          )
          style.content.fontFamily = { type: 'static', content: `var(${variable})` }
        }

        style?.conditions?.forEach((cond) => {
          const { content } = cond
          if (
            content?.fontFamily?.type === 'static' &&
            isGoogleFont(content.fontFamily.content as string)
          ) {
            const variable = generateFontDeclerationChunkAndAddToNode(
              content.fontFamily.content as string,
              {
                weight: content?.fontWeight?.content as string,
              }
            )
            content.fontFamily = { type: 'static', content: `var(${variable})` }
          }
        })
      })
    }

    UIDLUtils.traverseElements(uidl.node, (node, parent) => {
      const { style = {}, referencedStyles = {} } = node

      const parentJSXNode = componentChunk.meta.nodesLookup[
        (parent?.content as UIDLElement)?.key
      ] as types.JSXElement
      if (!parentJSXNode) {
        return
      }

      /**
       * `style` are direclty applied on the node. So they can be applied using
       * style = { fontFamily: inter.style.fontFamily}
       * https://nextjs.org/docs/api-reference/next/font#style-1
       */

      if (
        style?.fontFamily?.type === 'static' &&
        isGoogleFont(style.fontFamily.content as string)
      ) {
        const [font, fontDecleration, variable] = getFontAndVariable(
          style.fontFamily.content as string
        )

        ASTUtils.addClassStringOnJSXTag(
          parentJSXNode,
          [],
          [types.memberExpression(types.identifier(fontDecleration), types.identifier('variable'))]
        )
        style.fontFamily = { type: 'static', content: `var(${variable})` }

        if (!fontDeclerationMap[fontDecleration]) {
          fontDeclerationMap[fontDecleration] = true
          importSpecifiers.push(
            types.importSpecifier(types.identifier(font), types.identifier(font))
          )
          chunks.unshift(
            generateFontDeclerationChunk(
              font,
              fontDecleration,
              variable,
              (style?.fontWeight?.content as string) || null
            )
          )
        }
      }

      /**
       * Referenced styles are only applied under a specific condition.
       * So, they need to be applied only using `var(--font)` method.
       * Or else the styles are overwritten all the time.
       * https://nextjs.org/docs/api-reference/next/font#css-variables
       */

      Object.keys(referencedStyles).forEach((styleRef) => {
        const refStyle = referencedStyles[styleRef]
        if (refStyle.content.mapType === 'inlined') {
          const { styles } = refStyle.content
          if (
            styles?.fontFamily?.type === 'static' &&
            isGoogleFont(styles.fontFamily.content as string)
          ) {
            if (!parent || parent.type !== 'element') {
              /**
               * TODO: using next/font/google in variable mode, works only by wrapping the variable
               * to the parent node. But, where there is no parent node. It's a edge case and we need to
               * figure out how to handle this use-case. Most probably this can be acheived by wrapping the node
               * with a root node with display-contents.
               */
            }

            const [font, fontDecleration, variable] = getFontAndVariable(
              styles.fontFamily.content as string
            )

            ASTUtils.addClassStringOnJSXTag(
              parentJSXNode,
              [],
              [
                types.memberExpression(
                  types.identifier(fontDecleration),
                  types.identifier('variable')
                ),
              ]
            )
            styles.fontFamily = { type: 'static', content: `var(${variable})` }

            if (!fontDeclerationMap[fontDecleration]) {
              fontDeclerationMap[fontDecleration] = true
              importSpecifiers.push(
                types.importSpecifier(types.identifier(font), types.identifier(font))
              )
              chunks.unshift(generateFontDeclerationChunk(font, fontDecleration, variable))
            }
          }
        }
      })
    })

    if (importSpecifiers.length) {
      chunks.unshift({
        type: ChunkType.AST,
        name: 'google-font-import-chunk',
        fileType: FileType.JS,
        content: types.importDeclaration(
          importSpecifiers,
          types.stringLiteral(NEXT_FONT_DEPENDENCY.path)
        ),
        linkAfter: ['import-lib', 'import-pack', 'import-local'],
      })
    }

    return structure
  }

  return googleFontPlugin
}

export default createNextGoogleFontPlugin()
