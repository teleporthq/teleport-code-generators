import * as types from '@babel/types'
import {
  ComponentPlugin,
  ComponentPluginFactory,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { generateVariantsfromStyleSet } from './utils'
import { StringUtils } from '@teleporthq/teleport-shared'
import { projectVariantPropKey, projectVariantPropPrefix, VARIANT_DEPENDENCY } from './constants'

interface StyleSheetPlugin {
  fileName?: string
}

export const createStyleSheetPlugin: ComponentPluginFactory<StyleSheetPlugin> = (config) => {
  const { fileName = 'style' } = config || {}

  const styleSheetPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const { styleSetDefinitions = {}, designLanguage: { tokens = {} } = {} } = uidl
    if (Object.keys(styleSetDefinitions).length === 0 && Object.keys(tokens).length === 0) {
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

    if (Object.keys(styleSetDefinitions).length > 0) {
      const variants = generateVariantsfromStyleSet(
        styleSetDefinitions,
        projectVariantPropPrefix,
        projectVariantPropKey
      )
      chunks.push({
        name: fileName,
        type: ChunkType.AST,
        content: types.exportNamedDeclaration(variants),
        fileType: FileType.JS,
        linkAfter: ['tokens-chunk'],
      })
      dependencies.variant = VARIANT_DEPENDENCY
    }

    if (Object.keys(tokensMap).length > 0) {
      chunks.push({
        name: 'tokens-chunk',
        type: ChunkType.AST,
        fileType: FileType.JS,
        content: types.exportNamedDeclaration(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.identifier('TOKENS'),
              types.objectExpression(
                Object.keys(tokensMap).reduce((acc: types.ObjectProperty[], token) => {
                  const value =
                    typeof tokensMap[token] === 'number'
                      ? types.numericLiteral(Number(tokensMap[token]))
                      : types.stringLiteral(String(tokensMap[token]))
                  acc.push(types.objectProperty(types.identifier(token), value))
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
