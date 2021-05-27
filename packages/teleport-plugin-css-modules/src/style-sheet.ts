import { StyleUtils, StyleBuilders } from '@teleporthq/teleport-plugin-common'
import { StringUtils } from '@teleporthq/teleport-shared'
import {
  ComponentPlugin,
  ComponentPluginFactory,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { generateStyledFromStyleContent } from './utils'
interface StyleSheetPlugin {
  fileName?: string
  moduleExtension?: boolean
  camelCaseClassNames?: boolean
}

const defaultConfig = {
  fileName: 'style',
  moduleExtension: false,
}

export const createStyleSheetPlugin: ComponentPluginFactory<StyleSheetPlugin> = (config) => {
  const { fileName, moduleExtension, camelCaseClassNames } = {
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

    if (Object.keys(styleSetDefinitions).length > 0) {
      Object.values(styleSetDefinitions).forEach((style) => {
        const { name, content, conditions = [] } = style
        const className = camelCaseClassNames
          ? StringUtils.dashCaseToCamelCase(name)
          : StringUtils.camelCaseToDashCase(name)

        cssMap.push(
          StyleBuilders.createCSSClass(className, generateStyledFromStyleContent(content))
        )

        if (conditions.length === 0) {
          return
        }
        conditions.forEach((styleRef) => {
          const collectedMediaStyles = generateStyledFromStyleContent(styleRef.content)

          if (styleRef.type === 'element-state') {
            cssMap.push(
              StyleBuilders.createCSSClassWithSelector(
                className,
                `&:${styleRef.meta.state}`,
                collectedMediaStyles
              )
            )
          }

          if (styleRef.type === 'screen-size') {
            mediaStylesMap[styleRef.meta.maxWidth] = {
              ...mediaStylesMap[styleRef.meta.maxWidth],
              [className]: collectedMediaStyles,
            }
          }
        })
      })
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
