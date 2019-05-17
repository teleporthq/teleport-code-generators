import * as t from '@babel/types'
import { camelCaseToDashCase } from '@teleporthq/teleport-generator-shared/lib/utils/string-utils'
import { stringAsTemplateLiteral } from '@teleporthq/teleport-generator-shared/lib/utils/ast-jsx-utils'
import { UIDLStyleValue } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

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
      ${camelCaseToDashCase(item)}: ${styles[item]};`
    } else {
      style = `${style}
      ${item} {
        ${mapStyles(styles[item])}
      };`
    }
  })
  return style
}

export const countPropReferences = (
  style: Record<string, UIDLStyleValue>,
  timesReferred: number
) => {
  Object.keys(style).map((item) => {
    const styleAttr = style[item]
    if (styleAttr.type === 'dynamic' && styleAttr.content.referenceType === 'prop') {
      timesReferred++
    } else if (styleAttr.type === 'nested-style') {
      timesReferred = countPropReferences(styleAttr.content, timesReferred)
    }
  })
  return timesReferred
}
