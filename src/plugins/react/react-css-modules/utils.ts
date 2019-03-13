import * as types from '@babel/types'

import { ParsedASTNode } from '../../../shared/utils/ast-js-utils'

import { StyleDefinitions } from '../../../uidl-definitions/types'

export const splitDynamicAndStaticProps = (style: Record<string, any>) => {
  return Object.keys(style).reduce(
    (acc: { staticStyles: Record<string, any>; dynamicStyles: Record<string, any> }, key) => {
      const value = style[key]
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

export const prepareDynamicProps = (style: StyleDefinitions, t = types) => {
  return Object.keys(style).reduce((acc: any, key) => {
    const value = style[key]
    if (typeof value === 'string') {
      acc[key] = new ParsedASTNode(
        t.memberExpression(t.identifier('props'), t.identifier(value.replace('$props.', '')))
      )
    } else {
      acc[key] = style[key]
    }
    return acc
  }, {})
}
