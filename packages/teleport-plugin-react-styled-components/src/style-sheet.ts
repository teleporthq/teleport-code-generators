import * as t from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import {
  ComponentPlugin,
  ComponentPluginFactory,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { generateExportablCSSInterpolate, generatePropReferencesSyntax } from './utils'
import { StringUtils } from '@teleporthq/teleport-shared'

interface StyleSheetPlugin {
  fileName?: string
  componentLibrary?: string
}

export const createStyleSheetPlugin: ComponentPluginFactory<StyleSheetPlugin> = (config) => {
  const { fileName = 'style', componentLibrary = 'react' } = config || {}

  const styleSheetPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const { styleSetDefinitions, designLanguage = {} } = uidl
    const { tokens = {} } = designLanguage

    if (!styleSetDefinitions && !tokens) {
      return
    }

    const tokensMap: Record<string, string | number> = Object.keys(tokens || {}).reduce(
      (acc: Record<string, string | number>, key: string) => {
        const style = tokens[key]
        const name: string = StringUtils.capitalize(StringUtils.dashCaseToCamelCase(key))
        acc[name] = style.content as string
        return acc
      },
      {}
    )

    Object.values(styleSetDefinitions).forEach((style) => {
      const { name, content, conditions = [] } = style

      const className = StringUtils.dashCaseToUpperCamelCase(name)
      let styles = {}
      const { transformedStyles } = generatePropReferencesSyntax(content, 0)
      styles = {
        ...styles,
        ...transformedStyles,
      }

      if (conditions.length > 0) {
        conditions.forEach((styleRef) => {
          if (Object.keys(styleRef.content).length === 0) {
            return
          }
          const { transformedStyles: transformedMediaStyles } = generatePropReferencesSyntax(
            styleRef.content,
            0
          )

          if (styleRef.type === 'screen-size') {
            styles = {
              ...styles,
              ...{
                [`@media(max-width: ${styleRef.meta.maxWidth}px)`]: transformedMediaStyles,
              },
            }
          }

          if (styleRef.type === 'element-state') {
            styles = {
              ...styles,
              ...{
                [`&:${styleRef.meta.state}`]: transformedMediaStyles,
              },
            }
          }
        })
      }

      uidl.outputOptions = uidl.outputOptions || {}
      uidl.outputOptions.fileName = fileName

      chunks.push({
        name: fileName,
        type: ChunkType.AST,
        fileType: FileType.JS,
        content: generateExportablCSSInterpolate(className, styles),
        linkAfter: ['tokens-chunk'],
      })
    })

    chunks.push({
      name: 'tokens-chunk',
      type: ChunkType.AST,
      fileType: FileType.JS,
      content: t.exportNamedDeclaration(
        t.variableDeclaration('const', [
          t.variableDeclarator(
            t.identifier('TOKENS'),
            ASTUtils.objectToObjectExpression(tokensMap)
          ),
        ])
      ),
      linkAfter: ['import-local'],
    })

    dependencies.css = {
      type: 'package',
      path: componentLibrary === 'react' ? 'styled-components' : 'styled-components/native',
      version: '4.2.0',
      meta: {
        namedImport: true,
      },
    }

    return structure
  }
  return styleSheetPlugin
}
