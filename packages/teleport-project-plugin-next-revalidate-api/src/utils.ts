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
        types.blockStatement([
          types.tryStatement(
            types.blockStatement([
              ...paths.map((dynamicPath) => {
                const expression = ASTUtils.getExpressionFromUIDLExpressionNode({
                  type: 'expr',
                  content: '`' + appendDataToObjectExpression(dynamicPath) + '`',
                }) as types.TemplateLiteral

                return types.expressionStatement(
                  types.awaitExpression(
                    types.callExpression(
                      types.memberExpression(
                        types.identifier('res'),
                        types.identifier('revalidate')
                      ),
                      [expression]
                    )
                  )
                )
              }),
            ]),
            types.catchClause(
              types.identifier('error'),
              types.blockStatement([
                types.expressionStatement(
                  types.callExpression(
                    types.memberExpression(types.identifier('console'), types.identifier('log')),
                    [types.stringLiteral('Failed in clearing cache')]
                  )
                ),
                types.expressionStatement(
                  types.callExpression(
                    types.memberExpression(types.identifier('console'), types.identifier('log')),
                    [types.identifier('error')]
                  )
                ),
              ])
            )
          ),
          types.breakStatement(),
        ]),
      ])
    }
  )

  switchCases.push(
    types.switchCase(null, [
      types.throwStatement(
        types.newExpression(types.identifier('Error'), [
          types.stringLiteral('Invalid content typ, received'),
          types.identifier('contentType'),
        ])
      ),
    ])
  )

  return types.arrowFunctionExpression(
    [types.identifier('data'), types.identifier('contentType')],
    types.blockStatement([types.switchStatement(types.identifier('contentType'), switchCases)]),
    true
  )
}
