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
    const { type, path } = pagination.totalCountPath || {}
    if (type === 'headers') {
      // By default, 'resourceASTs' contains two elements. The first one is the 'fetch' call
      // and the second one is the 'json' call. We need to remove the 'json' call because
      // we are not using it when we are taking the total count from the headers.
      resourceASTs.pop()

      // We need to parse the headers as JSON because they are returned as a map.
      const parseHeadersAST = types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('headers'),
          types.callExpression(
            types.memberExpression(types.identifier('Object'), types.identifier('fromEntries')),
            [types.memberExpression(types.identifier('data'), types.identifier('headers'))]
          )
        ),
      ])
      paginationASTs.push(parseHeadersAST)
    }

    const itemsCountAST = types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('totalCount'),
        type === 'body'
          ? ASTUtils.generateMemberExpressionASTFromPath(['response', ...path])
          : ASTUtils.generateMemberExpressionASTFromPath(['headers', ...path])
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
