import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { PagePaginationOptions, Resource } from '@teleporthq/teleport-types'

export const generateInitialPathsAST = (
  resource: Resource,
  propsPrefix: string = '',
  pagination?: PagePaginationOptions
) => {
  const computedResourceAST =
    resource.type === 'static'
      ? [computeStaticValuePropsAST(resource)]
      : computeRemoteValuePropsAST(resource, propsPrefix, pagination)

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

const computeStaticValuePropsAST = (resource: Resource) => {
  if (resource.type !== 'static') {
    return null
  }

  const resultAST = ASTUtils.generateStaticResourceAST(resource)

  return types.returnStatement(
    types.objectExpression([
      types.objectProperty(
        types.identifier('props'),
        types.objectExpression([
          types.objectProperty(types.identifier(resource.exposeAs.name), resultAST, false, false),
        ]),
        false,
        false
      ),
      types.objectProperty(types.identifier('revalidate'), types.numericLiteral(1), false, false),
    ])
  )
}

const computeRemoteValuePropsAST = (
  resource: Resource,
  propsPrefix: string = '',
  pagination?: PagePaginationOptions
) => {
  if (resource.type !== 'remote') {
    return null
  }
  const resourceASTs = ASTUtils.generateRemoteResourceASTs(resource, propsPrefix)

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
                types.memberExpression(
                  types.identifier('response'),
                  types.identifier('data'),
                  false
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
                              types.identifier(resource.exposeAs.name),
                              types.callExpression(
                                types.memberExpression(
                                  ASTUtils.generateMemberExpressionASTFromPath([
                                    'item',
                                    ...resource.exposeAs.valuePath,
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
