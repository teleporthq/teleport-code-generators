import { StyleUtils, StyleBuilders } from '@teleporthq/teleport-plugin-common'
import {
  ComponentPlugin,
  ComponentPluginFactory,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'

interface StyleSheetPlugin {
  fileName?: string
}

export const createStyleSheetPlugin: ComponentPluginFactory<StyleSheetPlugin> = (config) => {
  const { fileName } = config || { fileName: 'style' }
  const styleSheetPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure
    const { styleSetDefinitions } = uidl

    if (!styleSetDefinitions) {
      return
    }
    const cssMap: string[] = []
    Object.values(styleSetDefinitions).forEach((style) => {
      const { name, content } = style
      cssMap.push(
        StyleBuilders.createCSSClass(
          name,
          // @ts-ignore
          StyleUtils.getContentOfStyleObject(content)
        )
      )
    })

    uidl.outputOptions = uidl.outputOptions || {}
    uidl.outputOptions.styleFileName = fileName

    chunks.push({
      name: fileName,
      type: ChunkType.STRING,
      fileType: FileType.CSS,
      content: cssMap.join('\n'),
      linkAfter: [],
    })

    return structure
  }
  return styleSheetPlugin
}
