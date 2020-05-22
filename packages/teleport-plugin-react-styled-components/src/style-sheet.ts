import { StyleUtils } from '@teleporthq/teleport-plugin-common'
import {
  ComponentPlugin,
  ComponentPluginFactory,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { generateExportableStyledComponent } from './utils'

interface StyleSheetPlugin {
  fileName?: string
  componentLibrary?: string
}

export const createStyleSheetPlugin: ComponentPluginFactory<StyleSheetPlugin> = (config) => {
  const { fileName, componentLibrary } = config || { fileName: 'style', componentLibrary: 'react' }
  const styleSheetPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const { styleSetDefinitions } = uidl

    if (!styleSetDefinitions) {
      return
    }
    Object.values(styleSetDefinitions).forEach((style) => {
      const { name, content } = style
      chunks.push({
        name: `${fileName}`,
        type: ChunkType.AST,
        fileType: FileType.JS,
        content: generateExportableStyledComponent(
          name,
          'div',
          // @ts-ignore
          StyleUtils.getContentOfStyleObject(content)
        ),
        linkAfter: ['import-local'],
      })
    })

    dependencies.styled = {
      type: 'library',
      path: componentLibrary === 'react' ? 'styled-components' : 'styled-components/native',
      version: '4.2.0',
    }

    return structure
  }
  return styleSheetPlugin
}
