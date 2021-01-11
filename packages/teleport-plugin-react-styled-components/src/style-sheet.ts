import * as t from '@babel/types'
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
    const { styleSetDefinitions = {}, designLanguage: { tokens = {} } = {} } = uidl

    if (
      (!styleSetDefinitions && !tokens) ||
      (Object.keys(styleSetDefinitions).length === 0 && Object.keys(tokens).length === 0)
    ) {
      return structure
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
      styles = {
        ...styles,
        ...generatePropReferencesSyntax(content),
      }

      if (conditions.length > 0) {
        conditions.forEach((styleRef) => {
          if (Object.keys(styleRef.content).length === 0) {
            return
          }

          if (styleRef.type === 'screen-size') {
            styles = {
              ...styles,
              ...{
                [`@media(max-width: ${styleRef.meta.maxWidth}px)`]: generatePropReferencesSyntax(
                  styleRef.content
                ),
              },
            }
          }

          if (styleRef.type === 'element-state') {
            styles = {
              ...styles,
              ...{
                [`&:${styleRef.meta.state}`]: generatePropReferencesSyntax(styleRef.content),
              },
            }
          }
        })
      }

      chunks.push({
        name: fileName,
        type: ChunkType.AST,
        fileType: FileType.JS,
        content: generateExportablCSSInterpolate(className, styles),
        linkAfter: ['tokens-chunk'],
      })

      dependencies.css = {
        type: 'package',
        path: componentLibrary === 'react' ? 'styled-components' : 'styled-components/native',
        version: '4.2.0',
        meta: {
          namedImport: true,
        },
      }
    })

    if (Object.keys(tokensMap).length > 0) {
      chunks.push({
        name: 'tokens-chunk',
        type: ChunkType.AST,
        fileType: FileType.JS,
        content: t.exportNamedDeclaration(
          t.variableDeclaration('const', [
            t.variableDeclarator(
              t.identifier('TOKENS'),
              t.objectExpression(
                Object.keys(tokensMap).reduce((acc: t.ObjectProperty[], token) => {
                  const value =
                    typeof tokensMap[token] === 'number'
                      ? t.numericLiteral(Number(tokensMap[token]))
                      : t.stringLiteral(String(tokensMap[token]))
                  acc.push(t.objectProperty(t.identifier(token), value))
                  return acc
                }, [])
              )
            ),
          ])
        ),
        linkAfter: ['import-local'],
      })
    }

    uidl.outputOptions = uidl.outputOptions || {}
    uidl.outputOptions.fileName = fileName

    return structure
  }
  return styleSheetPlugin
}
