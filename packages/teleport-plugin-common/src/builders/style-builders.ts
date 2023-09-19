import jss from 'jss'
import preset from 'jss-preset-default'
import * as types from '@babel/types'
import {
  HastNode,
  UIDLAttributeValue,
  UIDLDynamicReference,
  UIDLStyleSetDefinition,
} from '@teleporthq/teleport-types'
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

export const createFontDecleration = (styleObject: Record<string, string | number>) => {
  return jss
    .createStyleSheet({
      '@font-face': styleObject,
    })
    .toString()
}

export const createCSSClassWithMediaQuery = (
  mediaOffset: string,
  styleObject: Record<string, string | number | Record<string, string | number>>
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

export const generateMediaStyle = (
  styleMap: Record<
    string,
    Array<{ [x: string]: Record<string, string | number | Record<string, string | number>> }>
  >
) => {
  const styles: string[] = []
  Object.keys(styleMap)
    .map((id) => Number(id))
    .sort((a, b) => b - a)
    .forEach((mediaOffset) => {
      styles.push(
        createCSSClassWithMediaQuery(
          `max-width: ${mediaOffset}px`,
          (styleMap[String(mediaOffset)] || []).reduce(
            (acc: Record<string, string | number>, style) => {
              Object.assign(acc, style)
              return acc
            },
            {}
          )
        )
      )
    })
  return styles
}

export const generateStylesFromStyleSetDefinitions = (
  styleSetDefinitions: Record<string, UIDLStyleSetDefinition>,
  cssMap: string[],
  mediaStylesMap: Record<
    string,
    Array<{ [x: string]: Record<string, string | number | Record<string, string | number>> }>
  >,
  className: (val: string) => string
) => {
  Object.keys(styleSetDefinitions).forEach((styleId) => {
    const style = styleSetDefinitions[styleId]
    const { content, conditions = [], type } = style
    const name = className(style.className || styleId)
    const subselectors = style.subselectors

    const { staticStyles, tokenStyles } = UIDLUtils.splitDynamicAndStaticStyles(content)
    const collectedStyles = {
      ...getContentOfStyleObject(staticStyles),
      ...getCSSVariablesContentFromTokenStyles(tokenStyles),
    } as Record<string, string | number>

    // & is required by jss, otherwise the final result will be empty
    const cls = subselectors
      ? createCSSClassWithSelector(name, `&${subselectors}`, collectedStyles)
      : createCSSClass(name, collectedStyles)
    if (type === 'reusable-component-style-map') {
      cssMap.unshift(cls)
    } else {
      cssMap.push(cls)
    }

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
        if (type === 'reusable-component-style-map') {
          cssMap.unshift(
            createCSSClassWithSelector(
              name,
              `&${subselectors || ''}:${styleRef.meta.state}`,
              collecedMediaStyles
            )
          )
        } else {
          cssMap.push(
            createCSSClassWithSelector(
              name,
              `&${subselectors || ''}:${styleRef.meta.state}`,
              collecedMediaStyles
            )
          )
        }
      }

      if (styleRef.type === 'screen-size') {
        const { maxWidth } = styleRef.meta
        if (!mediaStylesMap[String(maxWidth)]) {
          mediaStylesMap[String(maxWidth)] = []
        }

        const mediaStyleMap = subselectors
          ? { [`&${subselectors}`]: collecedMediaStyles }
          : collecedMediaStyles

        if (type === 'reusable-component-style-map') {
          mediaStylesMap[String(maxWidth)].unshift({ [name]: mediaStyleMap })
        } else {
          mediaStylesMap[String(maxWidth)].push({ [name]: mediaStyleMap })
        }
      }
    })
  })
}

export const setPropValueForCompStyle = (params: {
  attrs: Record<string, UIDLAttributeValue>
  key: string
  jsxNodesLookup: Record<string, types.JSXElement | HastNode>
  templateStyle?: 'jsx' | 'html'
  getClassName: (str: string) => string
}) => {
  const { attrs, jsxNodesLookup, key, templateStyle = 'jsx', getClassName } = params
  Object.keys(attrs).forEach((attr) => {
    if (attrs[attr].type !== 'comp-style') {
      return
    }

    if (templateStyle === 'jsx') {
      const compInstanceNode = jsxNodesLookup[key] as types.JSXElement
      compInstanceNode.openingElement?.attributes.forEach((attribute: types.JSXAttribute) => {
        if (attribute.name?.name === attr && (attribute.value as types.StringLiteral)?.value) {
          ;(attribute.value as types.StringLiteral).value = getClassName(
            (attribute.value as types.StringLiteral).value
          )
        }
      })
    }

    if (templateStyle === 'html') {
      const compInstanceNode = jsxNodesLookup[key] as HastNode
      if (!compInstanceNode?.properties[attr]) {
        return
      }
      compInstanceNode.properties[attr] = getClassName(String(compInstanceNode.properties[attr]))
    }
  })
}
