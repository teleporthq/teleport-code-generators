import {
  ChunkDefinition,
  ChunkType,
  FileType,
  FrameWorkConfigOptions,
  ProjectPlugin,
  ProjectPluginStructure,
  UIDLStyleInlineAsset,
} from '@teleporthq/teleport-types'
import pluginNextFonts from './component-plugin'
import {
  generateFontDeclerationChunk,
  getFontAndVariable,
  isGoogleFont,
  NEXT_FONT_DEPENDENCY,
} from './utils'
import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import css from 'css'

export class ProjectPluginNextFonts implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    const { strategy, uidl } = structure
    const defaultStyles: UIDLStyleInlineAsset[] = []

    uidl.globals.assets = uidl.globals.assets.filter((asset) => {
      if (asset.type === 'font' && asset.path.indexOf('google')) {
        return
      }

      if (asset.type === 'style' && 'content' in asset) {
        defaultStyles.push(asset)
        return
      }

      return asset
    })

    strategy.pages.plugins.unshift(pluginNextFonts)
    strategy.components.plugins.unshift(pluginNextFonts)
    strategy.projectStyleSheet.plugins.unshift(pluginNextFonts)
    strategy.framework.config.plugins.unshift(pluginNextFonts)

    const oldConfigContentGenerator = strategy.framework.config.configContentGenerator
    strategy.framework.config.configContentGenerator = (opts: FrameWorkConfigOptions) => {
      const result = oldConfigContentGenerator(opts)

      const declerationChunks: ChunkDefinition[] = []
      const importSpecifiers: types.ImportSpecifier[] = []
      const isFontDeclared: Record<string, boolean> = {}

      const appJSChunk = result.chunks.js.find((chunk) => chunk.name === 'app-js-chunk')

      const exportDefaultChunk = (appJSChunk.content as types.ExportDefaultDeclaration[]).find(
        (chunk) => chunk.type === 'ExportDefaultDeclaration'
      ) as types.ExportDefaultDeclaration

      const funcBody = (
        (exportDefaultChunk.declaration as types.FunctionDeclaration).body as types.BlockStatement
      ).body
      const oldReturnStatement = funcBody.find(
        (item) => item.type === 'ReturnStatement'
      ) as types.ReturnStatement

      if (!oldReturnStatement) {
        return result
      }

      const returnStatement = types.returnStatement(
        types.jsxElement(
          types.jsxOpeningElement(types.jsxIdentifier('main'), []),
          types.jsxClosingElement(types.jsxIdentifier('main')),
          [oldReturnStatement.argument as types.JSXElement]
        )
      )

      ;(
        (exportDefaultChunk.declaration as types.FunctionDeclaration).body as types.BlockStatement
      ).body = funcBody.filter(
        (elm) => elm.type !== 'ReturnStatement'
      ) as types.BlockStatement['body']
      ;(
        (exportDefaultChunk.declaration as types.FunctionDeclaration).body as types.BlockStatement
      ).body.push(returnStatement)
      appJSChunk.linkAfter = ['font-decleration-chunk']

      /**
       * Handling project style shsets that are added on project level
       */
      defaultStyles.forEach((style) => {
        const ast = css.parse(style.content)
        ast.stylesheet?.rules.forEach((rule) => {
          if (!('declarations' in rule)) {
            return
          }

          const fontWeight = rule.declarations.find(
            (item) => 'property' in item && item.property === 'font-weight'
          )

          rule.declarations.forEach((item) => {
            if (!('property' in item) || item.property !== 'font-family') {
              return
            }

            if (!isGoogleFont(item.value)) {
              return
            }

            const [font, fontDecleration, variable] = getFontAndVariable(item.value)
            if (!isFontDeclared[font]) {
              importSpecifiers.push(
                types.importSpecifier(types.identifier(font), types.identifier(font))
              )
              const chunk: ChunkDefinition = generateFontDeclerationChunk(
                font,
                fontDecleration,
                variable,
                (fontWeight as css.Declaration)?.value || null
              )

              declerationChunks.push(chunk)
              ASTUtils.addClassStringOnJSXTag(
                returnStatement.argument as types.JSXElement,
                [],
                [
                  types.memberExpression(
                    types.identifier(fontDecleration),
                    types.identifier('variable')
                  ),
                ]
              )
              item.value = '${' + `${fontDecleration}.style.fontFamily` + '}'
              isFontDeclared[font] = true
            }
          })
        })

        /**
         * Pushing the string styles into the head of __app.js file
         */

        const jsxElm = types.jsxElement(
          types.jsxOpeningElement(types.jsxIdentifier('style'), [
            types.jsxAttribute(types.jsxIdentifier('jsx')),
            types.jsxAttribute(types.jsxIdentifier('global')),
          ]),
          types.jsxClosingElement(types.jsxIdentifier('style')),
          [
            types.jsxExpressionContainer(
              types.templateLiteral([types.templateElement({ raw: css.stringify(ast) })], [])
            ),
          ]
        )

        ;(returnStatement.argument as types.JSXElement).children.unshift(jsxElm)
      })

      /**
       * Handling project-styles, and updating fonts and font variables respectively
       */
      Object.values(uidl.root?.styleSetDefinitions || {}).forEach((style) => {
        if (
          style.content?.fontFamily?.type === 'static' &&
          isGoogleFont(style.content?.fontFamily.content as string)
        ) {
          const [font, fontDecleration, variable] = getFontAndVariable(
            style.content.fontFamily.content as string
          )
          if (!isFontDeclared[font]) {
            importSpecifiers.push(
              types.importSpecifier(types.identifier(font), types.identifier(font))
            )
            const chunk: ChunkDefinition = generateFontDeclerationChunk(
              font,
              fontDecleration,
              variable,
              (style?.content?.fontWeight?.content as string) || null
            )
            declerationChunks.push(chunk)
            ASTUtils.addClassStringOnJSXTag(
              returnStatement.argument as types.JSXElement,
              [],
              [
                types.memberExpression(
                  types.identifier(fontDecleration),
                  types.identifier('variable')
                ),
              ]
            )
            isFontDeclared[font] = true
          }
        }
      })

      if (importSpecifiers.length) {
        result.chunks.js.push({
          type: ChunkType.AST,
          name: 'google-font-import-chunk',
          fileType: FileType.JS,
          content: types.importDeclaration(
            importSpecifiers,
            types.stringLiteral(NEXT_FONT_DEPENDENCY.path)
          ),
          linkAfter: [],
        })
        result.chunks.js.unshift(...declerationChunks)
      }

      return result
    }

    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    return structure
  }
}
