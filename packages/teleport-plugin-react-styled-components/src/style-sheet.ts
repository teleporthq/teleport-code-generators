import { StyleUtils } from '@teleporthq/teleport-plugin-common'
import {
  ComponentPlugin,
  ComponentPluginFactory,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { generateExportablCSSInterpolate } from './utils'
import { StringUtils } from '@teleporthq/teleport-shared'

interface StyleSheetPlugin {
  fileName?: string
  componentLibrary?: string
}

export const createStyleSheetPlugin: ComponentPluginFactory<StyleSheetPlugin> = (config) => {
  const { fileName = 'style', componentLibrary = 'react' } = config || {}

  const styleSheetPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const { styleSetDefinitions } = uidl

    if (!styleSetDefinitions) {
      return
    }

    uidl.outputOptions = uidl.outputOptions || {}
    uidl.outputOptions.fileName = fileName

    Object.values(styleSetDefinitions).forEach((style) => {
      const { name, content, conditions = [] } = style

      const className = StringUtils.dashCaseToUpperCamelCase(name)
      let styles = StyleUtils.getContentOfStyleObject(content)

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
                [`&:${styleRef.meta.state}`]: StyleUtils.getContentOfStyleObject(styleRef.content),
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
        linkAfter: ['import-local'],
      })
    })

    dependencies.css = {
      type: 'library',
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
