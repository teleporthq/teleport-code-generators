import { StyleBuilders, StyleUtils } from '@teleporthq/teleport-plugin-common'
import { UIDLUtils } from '@teleporthq/teleport-shared'
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
}) => {
  const { styleSetDefinitions, cssMap = [], mediaStylesMap } = params
  Object.keys(styleSetDefinitions).forEach((styleId) => {
    const style = styleSetDefinitions[styleId]
    const { content, conditions = [] } = style
    const className = style.className || styleId
    const subselectors = style.subselectors

    const cls = subselectors
      ? StyleBuilders.createCSSClassWithSelector(
          className,
          // & is required by jss, otherwise the final result will be empty
          `&${subselectors}`,
          generateStyledFromStyleContent(content)
        )
      : StyleBuilders.createCSSClass(className, generateStyledFromStyleContent(content))

    cssMap.push(cls)

    if (conditions.length === 0) {
      return
    }
    conditions.forEach((styleRef) => {
      const collectedMediaStyles = generateStyledFromStyleContent(styleRef.content)

      if (styleRef.type === 'element-state') {
        cssMap.push(
          StyleBuilders.createCSSClassWithSelector(
            className,
            `&${subselectors || ''}:${styleRef.meta.state}`,
            collectedMediaStyles
          )
        )
      }

      if (styleRef.type === 'screen-size') {
        const mediaStyleMap = subselectors
          ? { [`&${subselectors}`]: collectedMediaStyles }
          : collectedMediaStyles

        mediaStylesMap[styleRef.meta.maxWidth] = {
          ...mediaStylesMap[styleRef.meta.maxWidth],
          [className]: mediaStyleMap,
        }
      }
    })
  })
}
