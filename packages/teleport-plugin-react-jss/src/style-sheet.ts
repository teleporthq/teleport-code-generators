import * as t from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import {
  ComponentPlugin,
  ComponentPluginFactory,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { StringUtils } from '@teleporthq/teleport-shared'
import { generateStylesFromStyleSetDefinitions, convertMediaAndStylesToObject } from './utils'

interface StyleSheetPlugin {
  fileName?: string
}

export const createStyleSheetPlugin: ComponentPluginFactory<StyleSheetPlugin> = (config) => {
  const { fileName } = config || { fileName: 'style' }
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

    const styleSet: Record<string, unknown> = {}
    const mediaStyles: Record<string, Record<string, unknown>> = {}
    if (Object.keys(styleSetDefinitions).length > 0) {
      generateStylesFromStyleSetDefinitions({
        styleSetDefinitions,
        styleSet,
        mediaStyles,
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

    if (Object.keys(tokens).length > 0) {
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
    }

    if (Object.keys(styleSet).length > 0) {
      chunks.push({
        name: fileName,
        type: ChunkType.AST,
        fileType: FileType.JS,
        content: t.exportNamedDeclaration(
          t.variableDeclaration('const', [
            t.variableDeclarator(
              t.identifier('useProjectStyles'),
              t.callExpression(t.identifier('createUseStyles'), [
                convertMediaAndStylesToObject(styleSet, mediaStyles),
              ])
            ),
          ])
        ),
        linkAfter: ['tokens-chunk'],
      })
    }

    return structure
  }
  return styleSheetPlugin
}
