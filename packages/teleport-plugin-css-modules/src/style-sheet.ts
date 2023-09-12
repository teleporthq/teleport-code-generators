import { StyleUtils, StyleBuilders } from '@teleporthq/teleport-plugin-common'
import {
  ComponentPlugin,
  ComponentPluginFactory,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { StringUtils } from '@teleporthq/teleport-shared'
import { relative, join } from 'path'

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
    const { uidl, chunks, options } = structure
    const { styleSetDefinitions = {}, designLanguage: { tokens = {} } = {} } = uidl

    uidl.outputOptions = uidl.outputOptions || {}
    uidl.outputOptions.styleFileName = moduleExtension ? `${fileName}.module` : fileName

    const cssMap: string[] = []
    const mediaStylesMap: Record<
      string,
      Array<{ [x: string]: Record<string, string | number> }>
    > = {}

    if (options?.assets?.localFonts.length > 0) {
      options.assets.localFonts.forEach((font) => {
        const properties = StyleUtils.getContentOfStyleObject(font.properties) as Record<
          string,
          string | number
        >
        const format = properties?.format ? `format('${properties.format}')` : ''
        /* tslint:disable:no-string-literal */
        delete properties['format']

        const fontPath = join(
          relative(join(...(uidl.outputOptions?.folderPath || [])), './'),
          join(options.assets?.fontsFolder || '', font.path)
        )

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
        (styleId: string) =>
          StringUtils.removeIllegalCharacters(StringUtils.camelCaseToDashCase(styleId))
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
      content: cssMap.join('\n'),
      linkAfter: [],
    })

    return structure
  }
  return styleSheetPlugin
}
