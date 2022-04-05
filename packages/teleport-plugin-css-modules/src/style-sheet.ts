import { StyleUtils, StyleBuilders } from '@teleporthq/teleport-plugin-common'
import {
  ComponentPlugin,
  ComponentPluginFactory,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { StringUtils } from '@teleporthq/teleport-shared'
interface StyleSheetPlugin {
  fileName?: string
  moduleExtension?: boolean
}

const defaultConfig = {
  fileName: 'style',
  moduleExtension: false,
}

export const createStyleSheetPlugin: ComponentPluginFactory<StyleSheetPlugin> = (config) => {
  const { fileName, moduleExtension } = {
    ...defaultConfig,
    ...config,
  }

  const styleSheetPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure
    const { styleSetDefinitions = {}, designLanguage: { tokens = {} } = {} } = uidl

    if (
      (!styleSetDefinitions && !tokens) ||
      (Object.keys(styleSetDefinitions).length === 0 && Object.keys(tokens).length === 0)
    ) {
      return
    }

    const cssMap: string[] = []
    const mediaStylesMap: Record<
      string,
      Array<{ [x: string]: Record<string, string | number> }>
    > = {}

    if (Object.keys(tokens).length > 0) {
      cssMap.push(
        StyleBuilders.createCSSClassWithSelector(
          '@global',
          ':root',
          StyleUtils.getTokensContentFromTokensObject(tokens)
        )
      )
    }

    if (Object.keys(styleSetDefinitions).length > 0) {
      StyleBuilders.generateStylesFromStyleSetDefinitions(
        styleSetDefinitions,
        cssMap,
        mediaStylesMap,
        (styleId: string) =>
          StringUtils.removeIllegalCharacters(StringUtils.camelCaseToDashCase(styleId))
      )
    }

    cssMap.push(...StyleBuilders.generateMediaStyle(mediaStylesMap))

    if (cssMap.length === 0) {
      return structure
    }

    uidl.outputOptions = uidl.outputOptions || {}
    uidl.outputOptions.styleFileName = moduleExtension ? `${fileName}.module` : fileName

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
