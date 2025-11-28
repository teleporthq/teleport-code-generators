import * as types from '@babel/types'
import { ArrayMapperPaginationInfo } from './array-mapper-pagination'

export function generateTotalPagesState(
  info: ArrayMapperPaginationInfo
): types.VariableDeclaration {
  const totalStateVar = `pagination_${info.paginationNodeId}_total`
  const setTotalStateVar = `setPagination_${info.paginationNodeId}_total`

  return types.variableDeclaration('const', [
    types.variableDeclarator(
      types.arrayPattern([types.identifier(totalStateVar), types.identifier(setTotalStateVar)]),
      types.callExpression(types.identifier('useState'), [types.numericLiteral(0)])
    ),
  ])
}

export function generateTotalPagesCalculation(
  info: ArrayMapperPaginationInfo
): types.VariableDeclaration {
  const totalStateVar = `pagination_${info.paginationNodeId}_total`
  const totalPagesVar = `pagination_${info.paginationNodeId}_totalPages`

  return types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier(totalPagesVar),
      types.callExpression(
        types.memberExpression(types.identifier('Math'), types.identifier('ceil')),
        [
          types.binaryExpression(
            '/',
            types.identifier(totalStateVar),
            types.numericLiteral(info.perPage)
          ),
        ]
      )
    ),
  ])
}

export function wrapFetchDataWithTotalExtraction(
  fetchDataExpr: types.ArrowFunctionExpression,
  setTotalStateVar: string
): types.ArrowFunctionExpression {
  // Wrap the existing fetchData to extract total from response
  const wrappedBody = types.blockStatement([
    types.returnStatement(
      types.callExpression(
        types.memberExpression(
          types.callExpression(fetchDataExpr.body as types.Expression, []),
          types.identifier('then')
        ),
        [
          types.arrowFunctionExpression(
            [types.identifier('response')],
            types.blockStatement([
              types.ifStatement(
                types.logicalExpression(
                  '&&',
                  types.identifier('response'),
                  types.memberExpression(types.identifier('response'), types.identifier('total'))
                ),
                types.blockStatement([
                  types.expressionStatement(
                    types.callExpression(types.identifier(setTotalStateVar), [
                      types.memberExpression(
                        types.identifier('response'),
                        types.identifier('total')
                      ),
                    ])
                  ),
                ])
              ),
              types.returnStatement(
                types.conditionalExpression(
                  types.memberExpression(types.identifier('response'), types.identifier('data')),
                  types.memberExpression(types.identifier('response'), types.identifier('data')),
                  types.identifier('response')
                )
              ),
            ])
          ),
        ]
      )
    ),
  ])

  return types.arrowFunctionExpression(fetchDataExpr.params, wrappedBody)
}
