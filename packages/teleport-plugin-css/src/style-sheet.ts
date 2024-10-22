import { StyleUtils, StyleBuilders } from '@teleporthq/teleport-plugin-common'
import {
  ComponentPlugin,
  ComponentPluginFactory,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { join, relative } from 'path'

interface StyleSheetPlugin {
  fileName?: string
  /*
    Frameworks with dev servers don't need relative path mapping.
  */
  relativeFontPath?: boolean
}

export const createStyleSheetPlugin: ComponentPluginFactory<StyleSheetPlugin> = (config) => {
  const { fileName = 'style', relativeFontPath = false } = config || {
    fileName: 'style',
    relativeFontPath: false,
  }

  const styleSheetPlugin: ComponentPlugin = async (structure) => {
    const {
      uidl,
      chunks,
      options: { assets },
    } = structure
    const { styleSetDefinitions = {}, designLanguage: { tokens = {} } = {} } = uidl
    const {
      localFonts = [],
      fontsFolder,
      identifier: assetIdentifier,
    } = assets || { localFonts: [] }

    const canSkipThePlugin =
      localFonts?.length === 0 &&
      Object.keys(styleSetDefinitions).length === 0 &&
      Object.keys(tokens).length === 0

    if (canSkipThePlugin) {
      return structure
    }

    const cssMap: string[] = []
    const mediaStylesMap: Record<
      string,
      Array<{ [x: string]: Record<string, string | number> }>
    > = {}

    uidl.outputOptions = uidl.outputOptions || {}
    uidl.outputOptions.styleFileName = fileName

    if (localFonts.length > 0) {
      localFonts.forEach((font) => {
        const properties = StyleUtils.getContentOfStyleObject(font.properties) as Record<
          string,
          string | number
        >
        const format = properties?.format ? `format('${properties.format}')` : ''
        /* tslint:disable:no-string-literal */
        delete properties['format']

        const fontPath = relativeFontPath
          ? join(
              relative(join(...(uidl.outputOptions?.folderPath || [])), './'),
              join(fontsFolder || '', font.path)
            )
          : join('/', assetIdentifier || '', 'fonts', font.path)

        cssMap.push(
          StyleBuilders.createFontDecleration({
            ...properties,
            src: `url("${fontPath}") ${format}`,
          })
        )
      })
    }

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
        (styleName) => styleName
      )
    }

    cssMap.push(...StyleBuilders.generateMediaStyle(mediaStylesMap))

    if (cssMap.length === 0) {
      return structure
    }

    chunks.push({
      name: fileName,
      type: ChunkType.STRING,
      fileType: FileType.CSS,
      content: cssMap.join('\n \n'),
      linkAfter: [],
    })

    return structure
  }
  return styleSheetPlugin
}
