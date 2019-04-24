import * as t from '@babel/types'
import { cammelCaseToDashCase } from '../../shared/utils/string-utils'
import { stringAsTemplateLiteral } from '../../shared/utils/ast-jsx-utils'

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
    style = `${style};
    ${cammelCaseToDashCase(item)}: ${styles[item]}`
  })
  return style
}
