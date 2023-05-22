import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { InitialPathsData, PagePaginationOptions } from '@teleporthq/teleport-types'

export const generateInitialPathsAST = (
  initialData: InitialPathsData,
  propsPrefix: string = '',
  pagination?: PagePaginationOptions
) => {
  const computedResourceAST = computePropsAST(initialData, propsPrefix, pagination)

  return types.exportNamedDeclaration(
    (() => {
      const node = types.functionDeclaration(
        types.identifier('getStaticPaths'),
        [],
        types.blockStatement([...computedResourceAST]),
        false,
        true
      )

      node.async = true
      return node
    })()
  )
}

const computePropsAST = (
  initialData: InitialPathsData,
  propsPrefix: string = '',
  pagination?: PagePaginationOptions
) => {
  const resourceASTs = ASTUtils.generateRemoteResourceASTs(initialData.resource, propsPrefix)

  const paginationASTs = []
  if (pagination) {
    const itemsCountAST = types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('totalCount'),
        ASTUtils.generateMemberExpressionASTFromPath(['response', ...pagination.totalCountPath])
      ),
    ])

    const pagesCountAST = types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('pagesCount'),
        types.callExpression(
          types.memberExpression(types.identifier('Math'), types.identifier('ceil'), false),
          [
            types.binaryExpression(
              '/',
              types.identifier('totalCount'),
              types.numericLiteral(pagination.pageSize)
            ),
          ]
        )
      ),
    ])

    paginationASTs.push(itemsCountAST)
    paginationASTs.push(pagesCountAST)
  }

  const returnAST = types.returnStatement(
    types.objectExpression([
      types.objectProperty(
        types.identifier('paths'),
        pagination
          ? types.callExpression(
              types.memberExpression(types.identifier('Array'), types.identifier('from')),
              [
                types.objectExpression([
                  types.objectProperty(types.identifier('length'), types.identifier('pagesCount')),
                ]),
                types.arrowFunctionExpression(
                  [types.identifier('_'), types.identifier('i')],
                  types.objectExpression([
                    types.objectProperty(
                      types.identifier('params'),
                      types.objectExpression([
                        types.objectProperty(
                          types.identifier('page'),
                          types.callExpression(
                            types.memberExpression(
                              types.binaryExpression(
                                '+',
                                types.identifier('i'),
                                types.numericLiteral(1)
                              ),
                              types.identifier('toString')
                            ),
                            []
                          )
                        ),
                      ])
                    ),
                  ])
                ),
              ]
            )
          : types.callExpression(
              types.memberExpression(
                ASTUtils.generateMemberExpressionASTFromPath([
                  'response',
                  ...initialData.exposeAs.valuePath,
                ]),
                types.identifier('map'),
                false
              ),
              [
                types.arrowFunctionExpression(
                  [types.identifier('item')],
                  types.blockStatement([
                    types.returnStatement(
                      types.objectExpression([
                        types.objectProperty(
                          types.identifier('params'),
                          types.objectExpression([
                            types.objectProperty(
                              types.identifier(initialData.exposeAs.name),
                              types.callExpression(
                                types.memberExpression(
                                  ASTUtils.generateMemberExpressionASTFromPath([
                                    'item',
                                    ...initialData.exposeAs.itemValuePath,
                                  ]),
                                  types.identifier('toString')
                                ),
                                []
                              ),
                              false,
                              false
                            ),
                          ]),
                          false,
                          false
                        ),
                      ])
                    ),
                  ])
                ),
              ]
            ),
        false,
        false
      ),
      types.objectProperty(types.identifier('fallback'), types.booleanLiteral(false), false, false),
    ])
  )

  return [...resourceASTs, ...paginationASTs, returnAST]
}
