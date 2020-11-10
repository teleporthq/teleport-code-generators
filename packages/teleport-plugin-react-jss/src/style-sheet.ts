import * as t from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import {
  ComponentPlugin,
  ComponentPluginFactory,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { StringUtils } from '@teleporthq/teleport-shared'
import { generatePropSyntax } from './utils'

interface StyleSheetPlugin {
  fileName?: string
}

export const createStyleSheetPlugin: ComponentPluginFactory<StyleSheetPlugin> = (config) => {
  const { fileName } = config || { fileName: 'style' }
  const styleSheetPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const { styleSetDefinitions = {}, designLanguage = {} } = uidl
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

    const styleSet: Record<string, unknown> = {}
    if (Object.keys(styleSetDefinitions).length > 0) {
      Object.values(styleSetDefinitions).forEach((style) => {
        const { conditions = [], content } = style
        const { transformedStyles } = generatePropSyntax(content)
        let styles = {
          ...transformedStyles,
        }

        if (conditions.length > 0) {
          conditions.forEach((styleRef) => {
            if (Object.keys(styleRef.content).length === 0) {
              return
            }
            const { transformedStyles: transformedMediaStyles } = generatePropSyntax(
              styleRef.content
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
                  [`&:${styleRef.meta.state}`]: transformedMediaStyles as Record<
                    string,
                    string | number
                  >,
                },
              }
            }
          })
        }

        styleSet[StringUtils.dashCaseToCamelCase(style.name)] = styles
      })
    }

    uidl.outputOptions = uidl.outputOptions || {}
    uidl.outputOptions.fileName = fileName

    dependencies.createUseStyles = {
      type: 'package',
      path: 'react-jss',
      version: '10.4.0',
      meta: {
        namedImport: true,
      },
    }

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

    chunks.push({
      name: fileName,
      type: ChunkType.AST,
      fileType: FileType.JS,
      content: t.exportNamedDeclaration(
        t.variableDeclaration('const', [
          t.variableDeclarator(
            t.identifier('useProjectStyles'),
            t.callExpression(t.identifier('createUseStyles'), [
              ASTUtils.objectToObjectExpression(styleSet),
            ])
          ),
        ])
      ),
      linkAfter: ['tokens-chunk'],
    })

    return structure
  }
  return styleSheetPlugin
}
