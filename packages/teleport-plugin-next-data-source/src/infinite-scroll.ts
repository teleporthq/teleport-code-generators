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
 *
 * `fetchData` records the query and the page the list stands on BEFORE it
 * requests them (`latest`), and only the answer to that request changes the
 * list. A filter, sort or search change made past page 1 fires the old page
 * under the new query first, then page 1 once the page is reset: kept, the
 * stray page sat in the list, the page counter said 1, and the next "Load
 * more" fetched a page already on show. `DataProvider` also renders whichever
 * answer arrives LAST, so a late answer to an earlier query must not replace
 * the list either.
 *
 * On a page, the list starts from the rows `getStaticProps` already fetched
 * (`buildFirstPageDeclaration`, `buildFirstPageSeedEffect`): the server HTML
 * carries them instead of the loading state, the accumulator holds them as
 * page 1, and the browser's first request is page 2.
 */

// tslint:disable:no-any

export interface InfiniteScrollVars {
  accumRefVar: string
  hasMoreFlagVar: string
  setHasMoreFlagVar: string
  hasMoreVar: string
  sentinelRefVar: string
  firstPageVar: string
}

export const getInfiniteScrollVars = (index: number): InfiniteScrollVars => ({
  accumRefVar: `ds_${index}_accumRef`,
  hasMoreFlagVar: `ds_${index}_hasMoreFlag`,
  setHasMoreFlagVar: `setDs_${index}_hasMoreFlag`,
  hasMoreVar: `ds_${index}_hasMore`,
  sentinelRefVar: `ds_${index}_sentinelRef`,
  firstPageVar: `ds_${index}_firstPage`,
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
            types.objectProperty(types.identifier('latest'), types.nullLiteral()),
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

const isIndexSegment = (segment: string): boolean => /^\d+$/.test(segment)

const readSegment = (object: types.Expression, segment: string): types.OptionalMemberExpression =>
  isIndexSegment(segment)
    ? types.optionalMemberExpression(object, types.numericLiteral(Number(segment)), true, true)
    : types.isValidIdentifier(segment)
    ? types.optionalMemberExpression(object, types.identifier(segment), false, true)
    : types.optionalMemberExpression(object, types.stringLiteral(segment), true, true)

/** `payload?.data?.items` for `['data', 'items']`. */
const readAtPath = (payload: types.Expression, path: string[]): types.Expression =>
  path.reduce<types.Expression>((object, segment) => readSegment(object, segment), payload)

/**
 * A copy of `node` with `value` at `path`, every level around it kept:
 * `{ ...payload, data: { ...payload?.data, items: value } }`. An index segment
 * copies the list it indexes instead of spreading it into an object.
 */
const writeAtPath = (
  node: types.Expression,
  path: string[],
  value: types.Expression
): types.Expression => {
  if (path.length === 0) {
    return value
  }
  const [segment, ...rest] = path
  const child = writeAtPath(readSegment(types.cloneNode(node, true), segment), rest, value)
  if (isIndexSegment(segment)) {
    return types.callExpression(
      types.memberExpression(types.identifier('Object'), types.identifier('assign')),
      [
        types.arrayExpression([
          types.spreadElement(
            types.logicalExpression('||', types.cloneNode(node, true), types.arrayExpression([]))
          ),
        ]),
        types.objectExpression([
          types.objectProperty(types.numericLiteral(Number(segment)), child),
        ]),
      ]
    )
  }
  return types.objectExpression([
    types.spreadElement(types.cloneNode(node, true)),
    types.objectProperty(
      types.isValidIdentifier(segment) ? types.identifier(segment) : types.stringLiteral(segment),
      child
    ),
  ])
}

/** `JSON.stringify({ ...params, page: 0 })`: everything that identifies the query but the page. */
const buildQuerySignature = (paramsVar: string = 'params'): types.CallExpression =>
  types.callExpression(
    types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
    [
      types.objectExpression([
        types.spreadElement(types.identifier(paramsVar)),
        types.objectProperty(types.identifier('page'), types.numericLiteral(0)),
      ]),
    ]
  )

/** `Number(params.page) || 1` */
const buildRequestedPage = (): types.LogicalExpression =>
  types.logicalExpression(
    '||',
    types.callExpression(types.identifier('Number'), [
      types.memberExpression(types.identifier('params'), types.identifier('page')),
    ]),
    types.numericLiteral(1)
  )

const accumCurrentOf = (vars: InfiniteScrollVars): types.MemberExpression =>
  types.memberExpression(types.identifier(vars.accumRefVar), types.identifier('current'))

/**
 * What `fetchData` runs before its request: the query and the page the list
 * now stands on.
 *
 *   ds_0_accumRef.current.latest = { sig: JSON.stringify({ ...params, page: 0 }), page: Number(params.page) || 1 }
 */
export const buildAccumulatingRequestMark = (vars: InfiniteScrollVars): types.Statement =>
  types.expressionStatement(
    types.assignmentExpression(
      '=',
      types.memberExpression(accumCurrentOf(vars), types.identifier('latest')),
      types.objectExpression([
        types.objectProperty(types.identifier('sig'), buildQuerySignature()),
        types.objectProperty(types.identifier('page'), buildRequestedPage()),
      ])
    )
  )

/**
 * The rows inside a server payload: the payload itself, or what sits at
 * `itemsPath` in one that wraps them. `<rows>?.length > 0` is how the caller
 * asks whether the server found any.
 */
export const buildServerRowsExpression = (
  payload: types.Expression,
  itemsPath?: string[]
): types.Expression => (itemsPath?.length ? readAtPath(payload, itemsPath) : payload)

/**
 * The first page the list starts from, when its page already fetched it:
 *
 *   const ds_0_firstPage = useMemo(() => <starts> ? props?.items_ds_0 : undefined, [<instance deps>])
 *
 * Handed to `DataProvider` as `initialData`, so the server HTML holds the rows
 * rather than the loading state, and the provider skips its own fetch of page 1.
 *
 * ⛔ Frozen for the provider's lifetime. `DataProvider` copies `initialData`
 * into what it shows every time the value changes, so a value that moved with
 * the page — the paged lists' `page === 1 ? … : undefined`, fine for them since
 * they remount per page — would wipe the appended rows on the first scroll.
 * `instanceDeps` are what remounts the provider (its `key`): nothing for a list
 * without search, the applied query for one with search.
 */
export const buildFirstPageDeclaration = (
  vars: InfiniteScrollVars,
  startsFromServerRows: types.Expression,
  serverPayload: types.Expression,
  instanceDeps: types.Expression[]
): types.Statement =>
  types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier(vars.firstPageVar),
      types.callExpression(types.identifier('useMemo'), [
        types.arrowFunctionExpression(
          [],
          types.conditionalExpression(
            startsFromServerRows,
            serverPayload,
            types.identifier('undefined')
          )
        ),
        types.arrayExpression(instanceDeps),
      ])
    ),
  ])

/**
 * Makes the server rows page 1 of the accumulator whenever the provider is
 * handed them instead of fetching:
 *
 *   useEffect(() => {
 *     if (ds_0_firstPage === undefined) return
 *     const rows = ds_0_firstPage || []
 *     const sig = JSON.stringify({ ...ds_0_params, page: 0 })
 *     ds_0_accumRef.current = { sig, pages: { 1: rows }, latest: { sig, page: 1 } }
 *     setDs_0_hasMoreFlag(rows.length >= 20)
 *   }, [ds_0_firstPage])
 *
 * Without it the accumulator never sees page 1 (the provider skipped that
 * fetch), and the answer to page 2 would REPLACE the rows on screen with page 2
 * alone. The signature is the one `fetchData` computes for the same params, so
 * the next page appends to these rows while a filter, sort or search change
 * still starts a fresh list; `latest` keeps an answer still in flight from an
 * earlier query from changing anything. A short first page is the last one, as
 * it would be had it been fetched.
 */
export const buildFirstPageSeedEffect = (
  vars: InfiniteScrollVars,
  paramsVar: string,
  perPage: number,
  itemsPath?: string[]
): types.Statement =>
  types.expressionStatement(
    types.callExpression(types.identifier('useEffect'), [
      types.arrowFunctionExpression(
        [],
        types.blockStatement([
          types.ifStatement(
            types.binaryExpression(
              '===',
              types.identifier(vars.firstPageVar),
              types.identifier('undefined')
            ),
            types.returnStatement()
          ),
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.identifier('rows'),
              types.logicalExpression(
                '||',
                buildServerRowsExpression(types.identifier(vars.firstPageVar), itemsPath),
                types.arrayExpression([])
              )
            ),
          ]),
          types.variableDeclaration('const', [
            types.variableDeclarator(types.identifier('sig'), buildQuerySignature(paramsVar)),
          ]),
          types.expressionStatement(
            types.assignmentExpression(
              '=',
              accumCurrentOf(vars),
              types.objectExpression([
                types.objectProperty(types.identifier('sig'), types.identifier('sig'), false, true),
                types.objectProperty(
                  types.identifier('pages'),
                  types.objectExpression([
                    types.objectProperty(types.numericLiteral(1), types.identifier('rows')),
                  ])
                ),
                types.objectProperty(
                  types.identifier('latest'),
                  types.objectExpression([
                    types.objectProperty(
                      types.identifier('sig'),
                      types.identifier('sig'),
                      false,
                      true
                    ),
                    types.objectProperty(types.identifier('page'), types.numericLiteral(1)),
                  ])
                ),
              ])
            )
          ),
          types.expressionStatement(
            types.callExpression(types.identifier(vars.setHasMoreFlagVar), [
              types.binaryExpression(
                '>=',
                types.memberExpression(types.identifier('rows'), types.identifier('length')),
                types.numericLiteral(perPage)
              ),
            ])
          ),
        ])
      ),
      types.arrayExpression([types.identifier(vars.firstPageVar)]),
    ])
  )

/**
 * The `.then(...)` tail that accumulates a page and reports whether more exist.
 *
 * Returned as the resolved value of `fetchData`, so `DataProvider` stores the
 * whole accumulated list as its data: the pages of the query on show, first
 * to the page it stands on. An answer to anything but the latest request
 * (`buildAccumulatingRequestMark`) is not kept, and gets the list as it is.
 *
 * `itemsPath` is where the rows sit inside a payload that wraps them
 * (`{ items: [...], total }`): the rows are read there and the accumulated list
 * is put back there, so the page keeps reading it through the same path. The
 * wrapper itself counted as one "row" before, which ended the list after its
 * first page and rendered nothing.
 */
export const buildAccumulatingResponseHandler = (
  vars: InfiniteScrollVars,
  perPage: number,
  itemsPath?: string[]
): types.ArrowFunctionExpression => {
  const accumCurrent = (): types.MemberExpression => accumCurrentOf(vars)
  const accumPages = (): types.MemberExpression =>
    types.memberExpression(accumCurrent(), types.identifier('pages'))
  const latestOf = (key: string): types.MemberExpression =>
    types.memberExpression(types.identifier('latest'), types.identifier(key))
  const payload = (): types.OptionalMemberExpression =>
    types.optionalMemberExpression(
      types.identifier('response'),
      types.identifier('data'),
      false,
      true
    )
  const rowsPath = itemsPath?.length ? itemsPath : undefined

  // Every page held up to `last`, flattened in page order — a numeric sort, so
  // page 10 does not land between 1 and 2.
  const accumulatedRows = types.callExpression(
    types.memberExpression(
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
              types.identifier('filter')
            ),
            [
              types.arrowFunctionExpression(
                [types.identifier('p')],
                types.binaryExpression('<=', types.identifier('p'), types.identifier('last'))
              ),
            ]
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

  return types.arrowFunctionExpression(
    [types.identifier('response')],
    types.blockStatement([
      types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('rows'),
          types.logicalExpression(
            '||',
            rowsPath ? readAtPath(payload(), rowsPath) : payload(),
            types.arrayExpression([])
          )
        ),
      ]),
      types.variableDeclaration('const', [
        types.variableDeclarator(types.identifier('page'), buildRequestedPage()),
      ]),
      // Everything that identifies the QUERY, with the page zeroed out: two
      // fetches that differ only by page belong to the same accumulated list.
      types.variableDeclaration('const', [
        types.variableDeclarator(types.identifier('sig'), buildQuerySignature()),
      ]),
      // The request the list stands on now, recorded when it was made.
      types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('latest'),
          types.logicalExpression(
            '||',
            types.memberExpression(accumCurrent(), types.identifier('latest')),
            types.objectExpression([
              types.objectProperty(types.identifier('sig'), types.identifier('sig'), false, true),
              types.objectProperty(types.identifier('page'), types.identifier('page'), false, true),
            ])
          )
        ),
      ]),
      // Only its answer is kept: an earlier query's, or a page past the one a
      // filter / sort / search change restarted the list at, changes nothing.
      types.ifStatement(
        types.logicalExpression(
          '&&',
          types.binaryExpression('===', types.identifier('sig'), latestOf('sig')),
          types.binaryExpression('<=', types.identifier('page'), latestOf('page'))
        ),
        types.blockStatement([
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
                  types.memberExpression(accumCurrent(), types.identifier('sig')),
                  types.identifier('sig')
                )
              ),
              types.expressionStatement(
                types.assignmentExpression('=', accumPages(), types.objectExpression([]))
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
          types.ifStatement(
            types.binaryExpression('===', types.identifier('page'), latestOf('page')),
            types.blockStatement([
              types.expressionStatement(
                types.callExpression(types.identifier(vars.setHasMoreFlagVar), [
                  types.binaryExpression(
                    '>=',
                    types.memberExpression(types.identifier('rows'), types.identifier('length')),
                    types.numericLiteral(perPage)
                  ),
                ])
              ),
            ])
          ),
        ])
      ),
      // The pages of the query on show, up to the page the list stands on; all
      // of them while the latest query has not answered yet.
      types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('last'),
          types.conditionalExpression(
            types.binaryExpression(
              '===',
              types.memberExpression(accumCurrent(), types.identifier('sig')),
              latestOf('sig')
            ),
            latestOf('page'),
            types.identifier('Infinity')
          )
        ),
      ]),
      // This is what DataProvider stores as its data, and so what the list renders.
      types.returnStatement(
        rowsPath ? writeAtPath(payload(), rowsPath, accumulatedRows) : accumulatedRows
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

const styleAttribute = (entries: Record<string, string | number>): types.JSXAttribute =>
  types.jsxAttribute(
    types.jsxIdentifier('style'),
    types.jsxExpressionContainer(
      types.objectExpression(
        Object.entries(entries).map(([key, value]) =>
          types.objectProperty(
            types.identifier(key),
            typeof value === 'number' ? types.numericLiteral(value) : types.stringLiteral(value)
          )
        )
      )
    )
  )

const sentinelTag = (
  tag: string,
  attributes: types.JSXAttribute[],
  children: types.JSXElement[] = []
): types.JSXElement =>
  types.jsxElement(
    types.jsxOpeningElement(types.jsxIdentifier(tag), attributes, children.length === 0),
    children.length === 0 ? null : types.jsxClosingElement(types.jsxIdentifier(tag)),
    children,
    children.length === 0
  )

/** Parents whose content is phrasing only: a `<div>` in one closes it in the parser. */
const PHRASING_PARENTS: ReadonlySet<string> = new Set([
  'p',
  'span',
  'a',
  'button',
  'label',
  'legend',
  'caption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'em',
  'b',
  'i',
  'small',
])

/**
 * `<div ref={ds_N_sentinelRef} aria-hidden="true" style={{ height: '1px' }} />`
 *
 * An invisible one-pixel row after the list. It is generated rather than
 * authored because it is not a control — there is nothing to style or click,
 * only a position in the document for the observer to watch.
 *
 * It takes the element its parent may hold: a table section holds rows, a
 * list holds items, a paragraph holds phrasing. A `<div>` among a table's
 * rows is moved out of the table by the parser, so the server's markup and
 * the client's tree differ and React's hydration fails on every such list.
 */
export const buildSentinelElement = (
  vars: InfiniteScrollVars,
  parentTag: string | null = null
): types.JSXElement => {
  const observed = [
    types.jsxAttribute(
      types.jsxIdentifier('ref'),
      types.jsxExpressionContainer(types.identifier(vars.sentinelRefVar))
    ),
    types.jsxAttribute(types.jsxIdentifier('aria-hidden'), types.stringLiteral('true')),
  ]
  const emptyCell = () => sentinelTag('td', [styleAttribute({ padding: 0, border: 0 })])
  switch (parentTag) {
    case 'tbody':
    case 'thead':
    case 'tfoot':
      return sentinelTag('tr', [...observed, styleAttribute({ height: '1px' })], [emptyCell()])
    case 'table':
      return sentinelTag(
        'tbody',
        [...observed, styleAttribute({ height: '1px' })],
        [sentinelTag('tr', [], [emptyCell()])]
      )
    case 'tr':
      return sentinelTag('td', [...observed, styleAttribute({ height: '1px', padding: 0 })])
    case 'ul':
    case 'ol':
    case 'menu':
      return sentinelTag('li', [...observed, styleAttribute({ height: '1px', listStyle: 'none' })])
    default:
      if (parentTag && PHRASING_PARENTS.has(parentTag)) {
        return sentinelTag('span', [
          ...observed,
          styleAttribute({ display: 'block', height: '1px' }),
        ])
      }
      return sentinelTag('div', [...observed, styleAttribute({ height: '1px' })])
  }
}
