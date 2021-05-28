import { StyleBuilders, StyleUtils } from '@teleporthq/teleport-plugin-common'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import {
  UIDLStyleSetDefinition,
  UIDLStyleSheetContent,
  UIDLStyleValue,
} from '@teleporthq/teleport-types'

export const generateStyledFromStyleContent = (
  styles: Record<string, UIDLStyleSheetContent> | Record<string, UIDLStyleValue> = {}
): Record<string, string | number> => {
  const { staticStyles, tokenStyles } = UIDLUtils.splitDynamicAndStaticStyles(styles)

  const collectedStyles = {
    ...StyleUtils.getContentOfStyleObject(staticStyles),
    ...StyleUtils.getCSSVariablesContentFromTokenStyles(tokenStyles),
  } as Record<string, string | number>

  return collectedStyles
}

export const generateStylesFromStyleSetDefinitions = (params: {
  styleSetDefinitions: Record<string, UIDLStyleSetDefinition>
  cssMap: string[]
  mediaStylesMap: Record<string, Record<string, unknown>>
  formatClassName?: boolean
  camelCaseClassNames?: boolean
}) => {
  const {
    styleSetDefinitions,
    cssMap = [],
    mediaStylesMap,
    formatClassName = false,
    camelCaseClassNames = false,
  } = params
  Object.keys(styleSetDefinitions).forEach((styleId) => {
    const style = styleSetDefinitions[styleId]
    const { content, conditions = [] } = style
    let className = styleId
    if (formatClassName) {
      className = camelCaseClassNames
        ? StringUtils.dashCaseToCamelCase(styleId)
        : StringUtils.camelCaseToDashCase(styleId)
    }

    cssMap.push(StyleBuilders.createCSSClass(className, generateStyledFromStyleContent(content)))

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
