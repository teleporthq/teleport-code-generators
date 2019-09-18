import * as t from '@babel/types'
import { camelCaseToDashCase } from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'
import { stringAsTemplateLiteral } from '@teleporthq/teleport-shared/dist/cjs/utils/ast-jsx-utils'
import { UIDLStyleValue } from '@teleporthq/teleport-types'

export const generateStyledComponent = (
  name: string,
  type: string,
  styles: Record<string, any>
) => {
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

const mapStyles = (styles: Record<string, any>) => {
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
