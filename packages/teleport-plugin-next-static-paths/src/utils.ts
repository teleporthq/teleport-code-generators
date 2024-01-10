import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { UIDLInitialPathsData, PagePaginationOptions } from '@teleporthq/teleport-types'

export const generateInitialPathsAST = (
  initialData: UIDLInitialPathsData,
  resourceImportName: string,
  resource: UIDLInitialPathsData['resource'],
  pagination?: PagePaginationOptions
) => {
  const computedResourceAST = computePropsAST(initialData, resourceImportName, resource, pagination)

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
  initialData: UIDLInitialPathsData,
  resourceImportName: string,
  resource: UIDLInitialPathsData['resource'],
  pagination?: PagePaginationOptions
) => {
  const funcParams: types.ObjectProperty[] = Object.keys(resource?.params || {}).reduce(
    (acc: types.ObjectProperty[], item) => {
      const prop = resource.params[item]
      acc.push(types.objectProperty(types.stringLiteral(item), ASTUtils.resolveObjectValue(prop)))

      return acc
    },
    []
  )

  const declerationAST = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('response'),
      types.awaitExpression(
        types.callExpression(types.identifier(resourceImportName), [
          types.objectExpression(funcParams),
        ])
      )
    ),
  ])

  const paginationASTs = []
  // TODO: When pagination is used totalCountPath is mandatory
  if (pagination && pagination?.totalCountPath) {
    const { type, path } = pagination.totalCountPath || {}
    if (type === 'headers') {
      // We need to parse the headers as JSON because they are returned as a map.
      const parseHeadersAST = types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('headers'),
          types.callExpression(
            types.memberExpression(types.identifier('Object'), types.identifier('fromEntries')),
            [types.identifier('response')]
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
                types.logicalExpression(
                  '||',
                  ASTUtils.generateMemberExpressionASTFromPath([
                    'response',
                    ...(initialData.exposeAs?.valuePath || []),
                  ]),
                  types.arrayExpression()
                ),
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
                                    ...(initialData.exposeAs?.itemValuePath || []),
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
      types.objectProperty(
        types.identifier('fallback'),
        types.stringLiteral('blocking'),
        false,
        false
      ),
    ])
  )

  return [
    types.tryStatement(
      types.blockStatement([declerationAST, ...paginationASTs, returnAST]),
      types.catchClause(
        types.identifier('error'),
        types.blockStatement([
          types.returnStatement(
            types.objectExpression([
              types.objectProperty(types.identifier('paths'), types.arrayExpression([])),
              types.objectProperty(types.identifier('fallback'), types.stringLiteral('blocking')),
            ])
          ),
        ])
      )
    ),
  ]
}
