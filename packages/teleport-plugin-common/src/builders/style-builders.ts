import jss from 'jss'
import preset from 'jss-preset-default'
import * as types from '@babel/types'
import { UIDLDynamicReference } from '@teleporthq/teleport-types'
import ParsedASTNode from '../utils/parsed-ast'

jss.setup(preset())

export const createCSSClass = (className: string, styleObject: Record<string, string | number>) => {
  return jss
    .createStyleSheet(
      {
        [`.${className}`]: styleObject,
      },
      {
        generateId: () => className,
      }
    )
    .toString()
}

export const createCSSClassWithSelector = (
  className: string,
  selector: string,
  styleObject: Record<string, string | number>
) => {
  return jss
    .createStyleSheet(
      {
        [`.${className}`]: {
          [selector]: styleObject,
        },
      },
      {
        generateId: () => className,
      }
    )
    .toString()
}

export const createCSSClassWithMediaQuery = (
  className: string,
  mediaOffset: string,
  styleObject: Record<string, string | number>
) => {
  return jss
    .createRule(
      `@media(${mediaOffset})`,
      {
        [`.${className}`]: styleObject,
      },
      {
        generateId: () => className,
      }
    )
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
