import * as t from '@babel/types'
import { StyleUtils, ASTUtils } from '@teleporthq/teleport-plugin-common'
import {
  ComponentPlugin,
  ComponentPluginFactory,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { StringUtils } from '@teleporthq/teleport-shared'

interface StyleSheetPlugin {
  fileName?: string
}

export const createStyleSheetPlugin: ComponentPluginFactory<StyleSheetPlugin> = (config) => {
  const { fileName } = config || { fileName: 'style' }
  const styleSheetPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const { styleSetDefinitions } = uidl

    if (!styleSetDefinitions) {
      return
    }

    const styleSet: Record<string, unknown> = {}

    if (styleSetDefinitions && Object.keys(styleSetDefinitions)) {
      Object.values(styleSetDefinitions).forEach((style) => {
        const { conditions = [] } = style
        let styles = StyleUtils.getContentOfStyleObject(style.content)

        if (conditions.length > 0) {
          conditions.forEach((styleRef) => {
            if (Object.keys(styleRef.content).length === 0) {
              return
            }

            if (styleRef.type === 'screen-size') {
              styles = {
                ...styles,
                ...{
                  [`@media(max-width: ${styleRef.meta.maxWidth}px)`]: StyleUtils.getContentOfStyleObject(
                    styleRef.content
                  ),
                },
              }
            }

            if (styleRef.type === 'element-state') {
              styles = {
                ...styles,
                ...{
                  [`&:${styleRef.meta.state}`]: StyleUtils.getContentOfStyleObject(
                    styleRef.content
                  ),
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
      type: 'library',
      path: 'react-jss',
      version: '8.6.1',
      meta: {
        namedImport: true,
      },
    }

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
      linkAfter: ['import-local'],
    })

    return structure
  }
  return styleSheetPlugin
}
