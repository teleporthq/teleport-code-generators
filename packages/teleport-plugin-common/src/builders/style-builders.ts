import jss from 'jss'
import preset from 'jss-preset-default'
import * as types from '@babel/types'
import { UIDLDynamicReference, UIDLStyleSetDefinition } from '@teleporthq/teleport-types'
import ParsedASTNode from '../utils/parsed-ast'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import {
  getContentOfStyleObject,
  getCSSVariablesContentFromTokenStyles,
} from '../utils/style-utils'
jss.setup(preset())

export const createCSSClass = (key: string, styleObject: Record<string, string | number>) => {
  return jss
    .createStyleSheet(
      {
        [key]: styleObject,
      },
      {
        generateId: () => key,
      }
    )
    .toString()
}

export const createCSSClassWithSelector = (
  key: string,
  selector: string,
  styleObject: Record<string, string | number>
) => {
  return jss
    .createStyleSheet(
      {
        [key]: {
          [selector]: styleObject,
        },
      },
      {
        generateId: () => key,
      }
    )
    .toString()
}

export const createCSSClassWithMediaQuery = (
  mediaOffset: string,
  styleObject: Record<string, string | number>
) => {
  return jss
    .createRule(`@media(${mediaOffset})`, styleObject, {
      generateId: (data) => data.key,
    })
    .toString()
}

export const createDynamicStyleExpression = (
  styleValue: UIDLDynamicReference,
  propsPrefix: string = '',
  t = types
) => {
  switch (styleValue.content.referenceType) {
    case 'state':
    case 'local':
      return new ParsedASTNode(t.identifier(styleValue.content.id))
    case 'prop':
      return new ParsedASTNode(
        t.memberExpression(t.identifier(propsPrefix), t.identifier(styleValue.content.id))
      )
    case 'token':
      return `var(${StringUtils.generateCSSVariableName(styleValue.content.id)})`
    default:
      throw new Error(
        `createDynamicStyleExpression received unsupported ${JSON.stringify(
          styleValue,
          null,
          2
        )} UIDLDynamicReference value`
      )
  }
}

export const generateMediaStyle = (mediaStylesMap: Record<string, Record<string, unknown>>) => {
  const styles: string[] = []
  Object.keys(mediaStylesMap)
    .sort((a: string, b: string) => Number(a) - Number(b))
    .reverse()
    .forEach((mediaOffset: string) => {
      styles.push(
        createCSSClassWithMediaQuery(
          `max-width: ${mediaOffset}px`,
          // @ts-ignore
          mediaStylesMap[mediaOffset]
        )
      )
    })
  return styles
}

export const generateStylesFromStyleSetDefinitions = (
  styleSetDefinitions: Record<string, UIDLStyleSetDefinition>,
  cssMap: string[],
  mediaStylesMap: Record<string, Record<string, unknown>>,
  componentFileName: string,
  forceScoping: boolean = false
) => {
  Object.keys(styleSetDefinitions).forEach((styleId) => {
    const style = styleSetDefinitions[styleId]
    const { content, conditions = [] } = style
    const className = forceScoping
      ? `${componentFileName}-${StringUtils.camelCaseToDashCase(styleId)}`
      : styleId

    const { staticStyles, tokenStyles } = UIDLUtils.splitDynamicAndStaticStyles(content)
    const collectedStyles = {
      ...getContentOfStyleObject(staticStyles),
      ...getCSSVariablesContentFromTokenStyles(tokenStyles),
    } as Record<string, string | number>
    cssMap.push(createCSSClass(className, collectedStyles))

    if (conditions.length === 0) {
      return
    }
    conditions.forEach((styleRef) => {
      const { staticStyles: staticValues, tokenStyles: tokenValues } =
        UIDLUtils.splitDynamicAndStaticStyles(styleRef.content)
      const collecedMediaStyles = {
        ...getContentOfStyleObject(staticValues),
        ...getCSSVariablesContentFromTokenStyles(tokenValues),
      } as Record<string, string | number>

      if (styleRef.type === 'element-state') {
        cssMap.push(
          createCSSClassWithSelector(className, `&:${styleRef.meta.state}`, collecedMediaStyles)
        )
      }

      if (styleRef.type === 'screen-size') {
        mediaStylesMap[styleRef.meta.maxWidth] = {
          ...mediaStylesMap[styleRef.meta.maxWidth],
          [className]: collecedMediaStyles,
        }
      }
    })
  })
}
