import * as t from '@babel/types'
import { cammelCaseToDashCase } from '../../shared/utils/string-utils'
import { stringAsTemplateLiteral } from '../../shared/utils/ast-jsx-utils'
import { UIDLStyleValue } from '../../typings/uidl-definitions'

export const generateStyledComponent = (name: string, type: string, styles: object) => {
  return t.variableDeclaration('const', [
    t.variableDeclarator(
      t.identifier(name),
      t.taggedTemplateExpression(
        t.memberExpression(t.identifier('styled'), t.identifier(type)),
        stringAsTemplateLiteral(mapStyles(styles))
      )
    ),
  ])
}

const mapStyles = (styles: object) => {
  let style = ''
  Object.keys(styles).forEach((item) => {
    if (typeof styles[item] === 'string') {
      style = `${style}
      ${cammelCaseToDashCase(item)}: ${styles[item]};`
    } else {
      style = `${style}
      ${item} {
        ${mapStyles(styles[item])}
      };`
    }
  })
  return style
}

export const countPropReferences = (style: UIDLStyleValue, timesReferred: number) => {
  Object.keys(style).map((item) => {
    if (style[item].type === 'dynamic' && style[item].content.referenceType === 'prop') {
      timesReferred++
    } else if (style[item].type === 'nested-style') {
      timesReferred = countPropReferences(style[item].content, timesReferred)
    }
  })
  return timesReferred
}
