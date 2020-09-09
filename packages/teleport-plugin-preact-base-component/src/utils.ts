import * as types from '@babel/types'

export const createDOMInjectionNode = (content: string, t = types) => {
  return t.jsxElement(
    t.jsxOpeningElement(
      t.jsxIdentifier('span'),
      [
        t.jsxAttribute(
          t.jsxIdentifier('dangerouslySetInnerHTML'),
          t.jsxExpressionContainer(
            t.objectExpression([t.objectProperty(t.identifier('__html'), t.stringLiteral(content))])
          )
        ),
      ],
      true
    ),
    null,
    [],
    true
  )
}
