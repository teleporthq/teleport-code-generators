import jss from 'jss'
import preset from 'jss-preset-default'
import * as types from '@babel/types'
import { UIDLDynamicReference } from '@teleporthq/teleport-types'
import { ParsedASTNode } from '../utils/ast-js-utils'

jss.setup(preset())

export const createCSSClass = (className: string, styleObject: Record<string, string | number>) => {
  return jss
    .createStyleSheet(
      {
        [`.${className}`]: styleObject,
      },
      {
        generateClassName: () => className,
      }
    )
    .toString()
}

export const createDynamicStyleExpression = (styleValue: UIDLDynamicReference, t = types) => {
  switch (styleValue.content.referenceType) {
    case 'state':
    case 'local':
      return new ParsedASTNode(t.identifier(styleValue.content.id))
    case 'prop':
      return new ParsedASTNode(
        t.memberExpression(t.identifier('props'), t.identifier(styleValue.content.id))
      )
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
