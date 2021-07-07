import * as types from '@babel/types'

export const createDOMInjectionNode = (content: string) => {
  return types.jsxElement(
    types.jsxOpeningElement(
      types.jsxIdentifier('span'),
      [
        types.jsxAttribute(
          types.jsxIdentifier('dangerouslySetInnerHTML'),
          types.jsxExpressionContainer(
            types.objectExpression([
              types.objectProperty(types.identifier('__html'), types.stringLiteral(content)),
            ])
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
