import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { UIDLInitialPathsData, PagePaginationOptions } from '@teleporthq/teleport-types'

export const generateInitialPathsAST = (
  initialData: UIDLInitialPathsData,
  resourceImportName: string,
  resource: UIDLInitialPathsData['resource'],
  pagination?: PagePaginationOptions,
  dynamicRouteAttribute?: string
) => {
  const computedResourceAST = computePropsAST(
    initialData,
    resourceImportName,
    resource,
    pagination,
    dynamicRouteAttribute
  )

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

const methodCall = (
  target: types.Expression,
  method: string,
  args: types.Expression[]
): types.CallExpression =>
  types.callExpression(types.memberExpression(target, types.identifier(method), false), args)

/**
 * `paths` for a details page: one entry per record, keyed on the URL attribute.
 *
 * Emitted as read the differentiator off every record, DROP the unusable ones,
 * DEDUPE, then build the params — rather than mapping records straight to
 * params. A database primary key or slug is never empty and never repeats, so
 * for a table-backed page the two filters remove nothing and the resulting
 * `paths` is exactly what it has always been.
 *
 * They matter for a source that is not a table. A record whose differentiator
 * is missing used to reach `undefined.toString()`, which threw — and the throw
 * is swallowed by the `try/catch` around the whole function, so ONE bad record
 * silently cost the page EVERY pre-rendered path, not just its own. A repeated
 * differentiator produced duplicate entries for a route that can only resolve
 * to one of them. Both are ordinary in a REST payload, a spreadsheet or a CSV
 * file, so neither can be allowed to take the build's output with it.
 *
 * Dropped records are not lost: `fallback: 'blocking'` still serves them on
 * demand if their route is ever requested.
 */
const generatePathsFromItemsAST = (
  initialData: UIDLInitialPathsData,
  dynamicRouteAttribute?: string
): types.Expression => {
  const items = types.logicalExpression(
    '||',
    ASTUtils.generateMemberExpressionASTFromPath([
      'response',
      ...ASTUtils.parseValuePath(initialData.exposeAs?.valuePath || []),
    ]),
    types.arrayExpression()
  )

  const differentiators = methodCall(items, 'map', [
    types.arrowFunctionExpression(
      [types.identifier('item')],
      ASTUtils.generateMemberExpressionASTFromPath([
        'item',
        ...(initialData.exposeAs?.itemValuePath || []),
      ]) as types.Expression
    ),
  ])

  // value !== null && value !== undefined && String(value) !== ''
  const isUsable = types.logicalExpression(
    '&&',
    types.logicalExpression(
      '&&',
      types.binaryExpression('!==', types.identifier('value'), types.nullLiteral()),
      types.binaryExpression('!==', types.identifier('value'), types.identifier('undefined'))
    ),
    types.binaryExpression(
      '!==',
      types.callExpression(types.identifier('String'), [types.identifier('value')]),
      types.stringLiteral('')
    )
  )

  const usable = methodCall(differentiators, 'filter', [
    types.arrowFunctionExpression([types.identifier('value')], isUsable),
  ])

  const unique = methodCall(usable, 'filter', [
    types.arrowFunctionExpression(
      [types.identifier('value'), types.identifier('index'), types.identifier('all')],
      types.binaryExpression(
        '===',
        methodCall(types.identifier('all'), 'indexOf', [types.identifier('value')]),
        types.identifier('index')
      )
    ),
  ])

  return methodCall(unique, 'map', [
    types.arrowFunctionExpression(
      [types.identifier('value')],
      types.objectExpression([
        types.objectProperty(
          types.identifier('params'),
          types.objectExpression([
            types.objectProperty(
              types.identifier(dynamicRouteAttribute || initialData.exposeAs.name),
              methodCall(types.identifier('value'), 'toString', []),
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
}

const computePropsAST = (
  initialData: UIDLInitialPathsData,
  resourceImportName: string,
  resource: UIDLInitialPathsData['resource'],
  pagination?: PagePaginationOptions,
  dynamicRouteAttribute?: string
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
          : generatePathsFromItemsAST(initialData, dynamicRouteAttribute),
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
