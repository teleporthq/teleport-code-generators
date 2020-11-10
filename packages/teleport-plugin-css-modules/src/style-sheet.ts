import { StyleUtils, StyleBuilders } from '@teleporthq/teleport-plugin-common'
import { UIDLUtils } from '@teleporthq/teleport-shared'
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
    const { styleSetDefinitions, designLanguage = {} } = uidl
    const { tokens = {} } = designLanguage

    if (!styleSetDefinitions || Object.keys(styleSetDefinitions).length === 0) {
      return
    }

    const cssMap: string[] = []
    const mediaStylesMap: Record<string, Record<string, unknown>> = {}

    if (Object.keys(tokens).length > 0) {
      cssMap.push(
        StyleBuilders.createCSSClassWithSelector(
          '@global',
          ':root',
          StyleUtils.getTokensContentFromTokensObject(tokens)
        )
      )
    }

    Object.values(styleSetDefinitions).forEach((style) => {
      const { name, content, conditions = [] } = style
      const { staticStyles, tokenStyles } = UIDLUtils.splitDynamicAndStaticStyles(content)

      const collectedStyles = {
        ...StyleUtils.getContentOfStyleObject(staticStyles),
        ...StyleUtils.getCSSVariablesContentFromTokenStyles(tokenStyles),
      } as Record<string, string | number>

      cssMap.push(StyleBuilders.createCSSClass(name, collectedStyles))

      if (conditions.length === 0) {
        return
      }
      conditions.forEach((styleRef) => {
        const {
          staticStyles: staticValues,
          tokenStyles: tokenValues,
        } = UIDLUtils.splitDynamicAndStaticStyles(styleRef.content)
        const collectedMediaStyles = {
          ...StyleUtils.getContentOfStyleObject(staticValues),
          ...StyleUtils.getCSSVariablesContentFromTokenStyles(tokenValues),
        } as Record<string, string | number>

        if (styleRef.type === 'element-state') {
          cssMap.push(
            StyleBuilders.createCSSClassWithSelector(
              name,
              `&:${styleRef.meta.state}`,
              collectedMediaStyles
            )
          )
        }

        if (styleRef.type === 'screen-size') {
          mediaStylesMap[styleRef.meta.maxWidth] = {
            ...mediaStylesMap[styleRef.meta.maxWidth],
            [name]: collectedMediaStyles,
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
