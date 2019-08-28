import * as types from '@babel/types'

export const setResourceRequireCall = (attrAST: types.JSXAttribute, path: string) => {
  attrAST.value = types.jsxExpressionContainer(
    types.callExpression(types.identifier('require'), [types.stringLiteral(path)])
  )
}

export const setResourceURIObject = (attrAST: types.JSXAttribute) => {
  // If original value is inside a JSXExpressionContainer, it is extracted to be placed as an object property below
  // source={ props.url } becomes source={ uri: props.url }
  // The second case is for static string values
  // source="https://url..." becomes source={ uri: "https://url..." }
  const originalValue =
    attrAST.value.type === 'JSXExpressionContainer'
      ? ((attrAST.value as types.JSXExpressionContainer).expression as types.MemberExpression)
      : (attrAST.value as types.StringLiteral)

  attrAST.value = types.jsxExpressionContainer(
    types.objectExpression([types.objectProperty(types.identifier('uri'), originalValue)])
  )
}
