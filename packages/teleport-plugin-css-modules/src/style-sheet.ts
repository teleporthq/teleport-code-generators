import { StyleUtils, StyleBuilders } from '@teleporthq/teleport-plugin-common'
import {
  ComponentPlugin,
  ComponentPluginFactory,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
interface StyleSheetPlugin {
  fileName?: string
  omitModuleextension?: boolean
}

export const createStyleSheetPlugin: ComponentPluginFactory<StyleSheetPlugin> = (config) => {
  const { fileName, omitModuleextension } = config || {
    fileName: 'style',
    omitModuleextension: false,
  }
  const styleSheetPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure
    const { styleSetDefinitions } = uidl

    if (!styleSetDefinitions || Object.keys(styleSetDefinitions).length === 0) {
      return
    }

    const cssMap: string[] = []
    const mediaStylesMap: Record<string, Record<string, unknown>> = {}

    Object.values(styleSetDefinitions).forEach((style) => {
      const { name, content, conditions = [] } = style
      cssMap.push(
        StyleBuilders.createCSSClass(
          name,
          // @ts-ignore
          StyleUtils.getContentOfStyleObject(content)
        )
      )

      if (conditions.length === 0) {
        return
      }
      conditions.forEach((styleRef) => {
        if (styleRef.type === 'element-state') {
          cssMap.push(
            StyleBuilders.createCSSClassWithSelector(
              name,
              `&:${styleRef.meta.state}`,
              // @ts-ignore
              StyleUtils.getContentOfStyleObject(styleRef.content)
            )
          )
        }

        if (styleRef.type === 'screen-size') {
          mediaStylesMap[styleRef.meta.maxWidth] = {
            ...mediaStylesMap[styleRef.meta.maxWidth],
            [name]: StyleUtils.getContentOfStyleObject(styleRef.content),
          }
        }
      })
    })

    cssMap.push(...StyleBuilders.generateMediaStyle(mediaStylesMap))

    const sheeName = omitModuleextension ? fileName : `${fileName}.module`

    uidl.outputOptions = uidl.outputOptions || {}
    uidl.outputOptions.styleFileName = sheeName

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
