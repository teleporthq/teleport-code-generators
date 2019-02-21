import * as types from '@babel/types'

import preset from 'jss-preset-default'
import jss from 'jss'
jss.setup(preset())

import { cammelCaseToDashCase, stringToCamelCase } from '../../../utils/helpers'
import { addJSXTagStyles, addExternalPropOnJsxOpeningTag } from '../../../utils/jsx-ast'
import { ParsedASTNode } from '../../../utils/js-ast'

import { ContentNode, StyleDefinitions } from '../../../../uidl-definitions/types'

export const splitDynamicAndStaticProps = (styles: Record<string, any>) => {
  return Object.keys(styles).reduce(
    (acc: { staticStyles: Record<string, any>; dynamicStyles: Record<string, any> }, key) => {
      const value = styles[key]
      if (typeof value === 'string' && value.startsWith('$props.')) {
        acc.dynamicStyles[key] = value.replace('$props.', '')
      } else {
        acc.staticStyles[key] = value
      }
      return acc
    },
    { staticStyles: {}, dynamicStyles: {} }
  )
}

export const prepareDynamicProps = (styles: StyleDefinitions, t = types) => {
  return Object.keys(styles).reduce((acc: any, key) => {
    const value = styles[key]
    if (typeof value === 'string') {
      acc[key] = new ParsedASTNode(
        t.memberExpression(t.identifier('props'), t.identifier(value.replace('$props.', '')))
      )
    } else {
      acc[key] = styles[key]
    }
    return acc
  }, {})
}

interface ApplyCSSModulesAndGetDeclarationsParams {
  nodesLookup: Record<string, types.JSXElement>
  camelCaseClassNames: boolean
}

export const applyCSSModulesAndGetDeclarations = (
  content: ContentNode,
  params: ApplyCSSModulesAndGetDeclarationsParams,
  t = types
) => {
  let accumulator: any[] = []
  const { nodesLookup = {}, camelCaseClassNames } = params

  const { styles, children, key, repeat } = content
  if (styles) {
    const root = nodesLookup[key]
    const className = cammelCaseToDashCase(key)
    const classNameInJS = camelCaseClassNames ? stringToCamelCase(className) : className
    const { staticStyles, dynamicStyles } = splitDynamicAndStaticProps(styles)

    // TODO Should we build a different plugin for dynamic props as inline styles?
    const inlineStyle = prepareDynamicProps(dynamicStyles)
    if (Object.keys(inlineStyle).length) {
      addJSXTagStyles(root, inlineStyle)
    }

    accumulator.push(
      jss
        .createStyleSheet(
          {
            [`.${className}`]: staticStyles,
          },
          {
            generateClassName: () => className,
          }
        )
        .toString()
    )

    const cssClassNameFromStylesObject = camelCaseClassNames
      ? `styles.${classNameInJS}`
      : `styles['${className}']`

    addExternalPropOnJsxOpeningTag(root, 'className', t.identifier(cssClassNameFromStylesObject))
  }

  if (repeat) {
    const items = applyCSSModulesAndGetDeclarations(repeat.content, params)
    accumulator = accumulator.concat(...items)
  }

  if (children) {
    children.forEach((child) => {
      // Inside the children array we can also encounter text elements
      if (typeof child === 'string') {
        return
      }

      const items = applyCSSModulesAndGetDeclarations(child, params)
      accumulator = accumulator.concat(...items)
    })
  }

  return accumulator
}
