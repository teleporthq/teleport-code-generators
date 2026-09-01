import * as types from '@babel/types'

/**
 * Infinite scroll: the list APPENDS pages instead of replacing them.
 *
 * The accumulation lives inside the generated `fetchData` closure rather than
 * around the provider. `DataProvider` renders whatever `fetchData` resolves
 * with, so returning "every page fetched so far, in order" is enough to make it
 * append — no change to the runtime component library, and the existing
 * `persistDataDuringLoading` keeps the rows already on screen while the next
 * page is in flight.
 *
 * A `useRef` holds the pages rather than a state, because writing accumulated
 * rows into state from inside `fetchData` would re-render the provider mid-fetch
 * and re-enter it. The ref is keyed by a SIGNATURE of every fetch param except
 * the page, so a filter, sort or search change starts a fresh list instead of
 * interleaving rows from two different queries.
 */

// tslint:disable:no-any

export interface InfiniteScrollVars {
  accumRefVar: string
  hasMoreFlagVar: string
  setHasMoreFlagVar: string
  hasMoreVar: string
  sentinelRefVar: string
}

export const getInfiniteScrollVars = (index: number): InfiniteScrollVars => ({
  accumRefVar: `ds_${index}_accumRef`,
  hasMoreFlagVar: `ds_${index}_hasMoreFlag`,
  setHasMoreFlagVar: `setDs_${index}_hasMoreFlag`,
  hasMoreVar: `ds_${index}_hasMore`,
  sentinelRefVar: `ds_${index}_sentinelRef`,
})

/**
 * The three declarations behind an appending list:
 *
 *   const ds_0_accumRef = useRef({ sig: '', pages: {} })
 *   const [ds_0_hasMoreFlag, setDs_0_hasMoreFlag] = useState(true)
 *   const ds_0_hasMore = ds_0_hasMoreFlag && (ds_0_maxPages === 0 || <page> < ds_0_maxPages)
 *
 * Two independent signals for "is there more", because either can be missing.
 * `hasMoreFlag` comes from the last response being a SHORT page, which is the
 * only end-of-data signal available from a data source that cannot count.
 * `maxPages` comes from the count endpoint and is the one that stops a request
 * being made at all; it is `0` while unknown, hence the explicit escape.
 */
export const buildInfiniteScrollDeclarations = (
  vars: InfiniteScrollVars,
  maxPagesVar: string,
  currentPageExpr: types.Expression,
  includeSentinel: boolean
): types.Statement[] => {
  const declarations: types.Statement[] = [
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier(vars.accumRefVar),
        types.callExpression(types.identifier('useRef'), [
          types.objectExpression([
            types.objectProperty(types.identifier('sig'), types.stringLiteral('')),
            types.objectProperty(types.identifier('pages'), types.objectExpression([])),
          ]),
        ])
      ),
    ]),
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.arrayPattern([
          types.identifier(vars.hasMoreFlagVar),
          types.identifier(vars.setHasMoreFlagVar),
        ]),
        types.callExpression(types.identifier('useState'), [types.booleanLiteral(true)])
      ),
    ]),
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier(vars.hasMoreVar),
        types.logicalExpression(
          '&&',
          types.identifier(vars.hasMoreFlagVar),
          types.logicalExpression(
            '||',
            types.binaryExpression('===', types.identifier(maxPagesVar), types.numericLiteral(0)),
            types.binaryExpression(
              '<',
              types.cloneNode(currentPageExpr, true) as types.Expression,
              types.identifier(maxPagesVar)
            )
          )
        )
      ),
    ]),
  ]

  if (includeSentinel) {
    declarations.push(
      types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier(vars.sentinelRefVar),
          types.callExpression(types.identifier('useRef'), [types.nullLiteral()])
        ),
      ])
    )
  }

  return declarations
}

/**
 * The `.then(...)` tail that accumulates a page and reports whether more exist.
 *
 * Returned as the resolved value of `fetchData`, so `DataProvider` stores the
 * whole accumulated list as its data.
 */
export const buildAccumulatingResponseHandler = (
  vars: InfiniteScrollVars,
  perPage: number
): types.ArrowFunctionExpression => {
  const accumCurrent = (): types.MemberExpression =>
    types.memberExpression(types.identifier(vars.accumRefVar), types.identifier('current'))
  const accumPages = (): types.MemberExpression =>
    types.memberExpression(accumCurrent(), types.identifier('pages'))

  return types.arrowFunctionExpression(
    [types.identifier('response')],
    types.blockStatement([
      types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('rows'),
          types.logicalExpression(
            '||',
            types.optionalMemberExpression(
              types.identifier('response'),
              types.identifier('data'),
              false,
              true
            ),
            types.arrayExpression([])
          )
        ),
      ]),
      types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('page'),
          types.logicalExpression(
            '||',
            types.callExpression(types.identifier('Number'), [
              types.memberExpression(types.identifier('params'), types.identifier('page')),
            ]),
            types.numericLiteral(1)
          )
        ),
      ]),
      // Everything that identifies the QUERY, with the page zeroed out: two
      // fetches that differ only by page belong to the same accumulated list.
      types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('sig'),
          types.callExpression(
            types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
            [
              types.objectExpression([
                types.spreadElement(types.identifier('params')),
                types.objectProperty(types.identifier('page'), types.numericLiteral(0)),
              ]),
            ]
          )
        ),
      ]),
      types.ifStatement(
        types.binaryExpression(
          '!==',
          types.memberExpression(accumCurrent(), types.identifier('sig')),
          types.identifier('sig')
        ),
        types.blockStatement([
          types.expressionStatement(
            types.assignmentExpression(
              '=',
              accumCurrent(),
              types.objectExpression([
                types.objectProperty(types.identifier('sig'), types.identifier('sig'), false, true),
                types.objectProperty(types.identifier('pages'), types.objectExpression([])),
              ])
            )
          ),
        ])
      ),
      types.expressionStatement(
        types.assignmentExpression(
          '=',
          types.memberExpression(accumPages(), types.identifier('page'), true),
          types.identifier('rows')
        )
      ),
      // A page that came back short is the last one. This is the only
      // end-of-data signal a data source that cannot count ever gives.
      types.expressionStatement(
        types.callExpression(types.identifier(vars.setHasMoreFlagVar), [
          types.binaryExpression(
            '>=',
            types.memberExpression(types.identifier('rows'), types.identifier('length')),
            types.numericLiteral(perPage)
          ),
        ])
      ),
      // Every page held so far, flattened in page order — a numeric sort, so
      // page 10 does not land between 1 and 2. This is what DataProvider stores
      // as its data, and so what the list renders.
      types.returnStatement(
        types.callExpression(
          types.memberExpression(
            types.callExpression(
              types.memberExpression(
                types.callExpression(
                  types.memberExpression(
                    types.callExpression(
                      types.memberExpression(types.identifier('Object'), types.identifier('keys')),
                      [accumPages()]
                    ),
                    types.identifier('map')
                  ),
                  [types.identifier('Number')]
                ),
                types.identifier('sort')
              ),
              [
                types.arrowFunctionExpression(
                  [types.identifier('a'), types.identifier('b')],
                  types.binaryExpression('-', types.identifier('a'), types.identifier('b'))
                ),
              ]
            ),
            types.identifier('reduce')
          ),
          [
            types.arrowFunctionExpression(
              [types.identifier('acc'), types.identifier('p')],
              types.callExpression(
                types.memberExpression(types.identifier('acc'), types.identifier('concat')),
                [types.memberExpression(accumPages(), types.identifier('p'), true)]
              )
            ),
            types.arrayExpression([]),
          ]
        )
      ),
    ])
  )
}

/**
 * The IntersectionObserver that loads the next page when the sentinel scrolls
 * into view. Emitted only in auto mode (no Load More button).
 *
 * `rootMargin` starts the fetch a screenful early so the list rarely shows a
 * gap. The observer is rebuilt whenever `hasMore` or `maxPages` change and
 * disconnected on cleanup; when there is nothing more to load the effect exits
 * before observing, so a finished list costs nothing.
 */
export const buildSentinelObserverEffect = (
  vars: InfiniteScrollVars,
  maxPagesVar: string,
  buildAdvancePageStatement: () => types.Statement
): types.ExpressionStatement =>
  types.expressionStatement(
    types.callExpression(types.identifier('useEffect'), [
      types.arrowFunctionExpression(
        [],
        types.blockStatement([
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.identifier('el'),
              types.memberExpression(
                types.identifier(vars.sentinelRefVar),
                types.identifier('current')
              )
            ),
          ]),
          // No element yet, no observer support (older browsers, jsdom), or
          // nothing left to load.
          types.ifStatement(
            types.logicalExpression(
              '||',
              types.logicalExpression(
                '||',
                types.unaryExpression('!', types.identifier('el'), true),
                types.binaryExpression(
                  '===',
                  types.unaryExpression('typeof', types.identifier('IntersectionObserver')),
                  types.stringLiteral('undefined')
                )
              ),
              types.unaryExpression('!', types.identifier(vars.hasMoreVar), true)
            ),
            types.returnStatement()
          ),
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.identifier('observer'),
              types.newExpression(types.identifier('IntersectionObserver'), [
                types.arrowFunctionExpression(
                  [types.identifier('entries')],
                  types.blockStatement([
                    types.expressionStatement(
                      types.callExpression(
                        types.memberExpression(
                          types.identifier('entries'),
                          types.identifier('forEach')
                        ),
                        [
                          types.arrowFunctionExpression(
                            [types.identifier('entry')],
                            types.blockStatement([
                              types.ifStatement(
                                types.unaryExpression(
                                  '!',
                                  types.memberExpression(
                                    types.identifier('entry'),
                                    types.identifier('isIntersecting')
                                  ),
                                  true
                                ),
                                types.returnStatement()
                              ),
                              buildAdvancePageStatement(),
                            ])
                          ),
                        ]
                      )
                    ),
                  ])
                ),
                types.objectExpression([
                  types.objectProperty(
                    types.identifier('rootMargin'),
                    types.stringLiteral('200px')
                  ),
                ]),
              ])
            ),
          ]),
          types.expressionStatement(
            types.callExpression(
              types.memberExpression(types.identifier('observer'), types.identifier('observe')),
              [types.identifier('el')]
            )
          ),
          types.returnStatement(
            types.arrowFunctionExpression(
              [],
              types.callExpression(
                types.memberExpression(
                  types.identifier('observer'),
                  types.identifier('disconnect')
                ),
                []
              )
            )
          ),
        ])
      ),
      types.arrayExpression([types.identifier(vars.hasMoreVar), types.identifier(maxPagesVar)]),
    ])
  )

/**
 * `<div ref={ds_N_sentinelRef} aria-hidden="true" style={{ height: '1px' }} />`
 *
 * An invisible one-pixel row after the list. It is generated rather than
 * authored because it is not a control — there is nothing to style or click,
 * only a position in the document for the observer to watch.
 */
export const buildSentinelElement = (vars: InfiniteScrollVars): types.JSXElement =>
  types.jsxElement(
    types.jsxOpeningElement(
      types.jsxIdentifier('div'),
      [
        types.jsxAttribute(
          types.jsxIdentifier('ref'),
          types.jsxExpressionContainer(types.identifier(vars.sentinelRefVar))
        ),
        types.jsxAttribute(types.jsxIdentifier('aria-hidden'), types.stringLiteral('true')),
        types.jsxAttribute(
          types.jsxIdentifier('style'),
          types.jsxExpressionContainer(
            types.objectExpression([
              types.objectProperty(types.identifier('height'), types.stringLiteral('1px')),
            ])
          )
        ),
      ],
      true
    ),
    null,
    [],
    true
  )
