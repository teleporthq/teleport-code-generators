import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'

export const generateResponseWithStatus = (
  status: number,
  revalidationStatus: boolean
): types.ReturnStatement => {
  return types.returnStatement(
    types.callExpression(
      types.memberExpression(
        types.callExpression(
          types.memberExpression(types.identifier('res'), types.identifier('status')),
          [types.numericLiteral(status)]
        ),
        types.identifier('json')
      ),
      [
        types.objectExpression([
          types.objectProperty(
            types.identifier('revalidated'),
            types.booleanLiteral(revalidationStatus)
          ),
        ]),
      ]
    )
  )
}

export const appendDataToObjectExpression = (expression: string): string => {
  const regex = /\${(.*?)}/g
  const result = expression.replace(regex, (_, p1) => `\${data.${p1}}`)
  return result
}

export const generateCallbackExpression = (
  routeMappings: Record<string, string[]>
): types.ArrowFunctionExpression => {
  const switchCases: types.SwitchCase[] = Object.entries(routeMappings).map(
    ([contentType, paths]) => {
      return types.switchCase(types.stringLiteral(contentType), [
        ...paths.map((dynamicPath) => {
          const expression = ASTUtils.getExpressionFromUIDLExpressionNode({
            type: 'expr',
            content: '`' + appendDataToObjectExpression(dynamicPath) + '`',
          }) as types.TemplateLiteral

          return types.expressionStatement(
            types.callExpression(
              types.memberExpression(types.identifier('res'), types.identifier('revalidate')),
              [expression]
            )
          )
        }),
        types.breakStatement(),
      ])
    }
  )

  switchCases.push(
    types.switchCase(null, [
      types.throwStatement(
        types.newExpression(types.identifier('Error'), [
          types.stringLiteral('Invalid content type'),
        ])
      ),
    ])
  )

  return types.arrowFunctionExpression(
    [types.identifier('data'), types.identifier('contentType')],
    types.blockStatement([types.switchStatement(types.identifier('contentType'), switchCases)])
  )
}
