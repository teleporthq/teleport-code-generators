import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { UIDLInitialPathsData, PagePaginationOptions } from '@teleporthq/teleport-types'

export const generateInitialPathsAST = (
  initialData: UIDLInitialPathsData,
  resourceImportName: string,
  resource: UIDLInitialPathsData['resource'],
  pagination?: PagePaginationOptions,
  dynamicRouteAttribute?: string,
  /** What the read hands the resource after its params (`{ as: 'visitor' }`). */
  readArguments: types.Expression[] = [],
  /** Lists only the records `prerenderedRecords` picks; otherwise every one. */
  newestRecordsOnly = true
) => {
  const computedResourceAST = computePropsAST(
    initialData,
    resourceImportName,
    resource,
    pagination,
    dynamicRouteAttribute,
    readArguments,
    newestRecordsOnly
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

/** How many of a details page's records a publish builds; the rest are built on their first visit. */
export const PRERENDERED_RECORDS = 50

/**
 * `prerenderedRecords(items)`, emitted beside a details page's
 * `getStaticPaths`: the records whose pages a publish builds — the newest
 * PRERENDERED_RECORDS by when they were published or created, records without
 * a date after the dated ones in the source's order.
 *
 * Building every record's page made a publish as slow as its record count: a
 * 486-article help center spent 8.5 of its 9 minutes building article pages,
 * about 0.9 s each. Every other record's page is built on its first visit —
 * `fallback: 'blocking'` serves it complete, to a visitor or a crawler alike —
 * and cached, as Next.js recommends for sites with many data-driven pages.
 */
export const PRERENDERED_RECORDS_CODE = `function prerenderedRecords(items) {
  const timeOf = (item) => {
    const value = item
      ? [item.publishedAt, item.published_at, item.createdAt, item.created_at].find((date) => date != null)
      : null
    const time = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN
    return Number.isNaN(time) ? -Infinity : time
  }
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({ item, index, time: timeOf(item) }))
    .sort((a, b) => (a.time === b.time ? a.index - b.index : b.time > a.time ? 1 : -1))
    .slice(0, ${PRERENDERED_RECORDS})
    .map((entry) => entry.item)
}`

/**
 * `paths` for a details page: one entry per record a publish builds
 * (`prerenderedRecords`), keyed on the URL attribute.
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
  dynamicRouteAttribute?: string,
  newestRecordsOnly = true
): types.Expression => {
  const items = types.logicalExpression(
    '||',
    ASTUtils.generateMemberExpressionASTFromPath([
      'response',
      ...ASTUtils.parseValuePath(initialData.exposeAs?.valuePath || []),
    ]),
    types.arrayExpression()
  )

  const prerendered = newestRecordsOnly
    ? types.callExpression(types.identifier('prerenderedRecords'), [items])
    : items

  const differentiators = methodCall(prerendered, 'map', [
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
  dynamicRouteAttribute?: string,
  readArguments: types.Expression[] = [],
  newestRecordsOnly = true
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
          ...readArguments,
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
          : generatePathsFromItemsAST(initialData, dynamicRouteAttribute, newestRecordsOnly),
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
