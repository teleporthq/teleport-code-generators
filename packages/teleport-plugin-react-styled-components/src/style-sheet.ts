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
      const { name, content } = style

      const className = StringUtils.dashCaseToUpperCamelCase(name)

      chunks.push({
        name: fileName,
        type: ChunkType.AST,
        fileType: FileType.JS,
        content: generateExportablCSSInterpolate(
          className,
          StyleUtils.getContentOfStyleObject(content)
        ),
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
