import * as types from '@babel/types'

/**
 * The client-side "how many rows match?" fetch that drives `ds_N_maxPages`.
 *
 * One builder for every caller, because the two hand-written copies had already
 * drifted: the search-enabled list sent the query, the columns and the filters,
 * while the paginated-only list fetched a bare `/api/<file>-count` with NO
 * params at all — so a filtered list counted the WHOLE table and "Next" stayed
 * enabled long past the end of the filtered results.
 *
 * The endpoint deliberately receives no `sorts` and no `limit`: ordering cannot
 * change how many rows match, and a limit would count the page rather than the
 * result set.
 */

interface CountEffectOptions {
  /** `<fileName>-count` is the generated API route. */
  fileName: string
  /** Divisor for the page count; the mapper's resolved `perPage`. */
  perPage: number
  /** Name of the `setDs_N_maxPages` setter. */
  setMaxPagesVar: string
  /**
   * Params sent to the count endpoint: the search query (when the list has
   * one), `queryColumns`, and the filter array. Built by the caller because
   * only it knows how this usage's filter destinations resolve to expressions.
   */
  urlParams: types.ObjectProperty[]
  /** Dependencies that should re-run the count. */
  deps: types.Expression[]
  /**
   * Name of the `useRef(0)` counting the count requests STARTED. Each request
   * notes its sequence number and a response overtaken by a newer request is
   * dropped: two filter changes in quick succession start two counts, and the
   * older, slower one landing last painted a page strip for a result set the
   * list no longer shows.
   */
  countSeqRefVar: string
}

/** `const ds_N_countSeq = useRef(0)` */
export const buildCountSeqDeclaration = (countSeqRefVar: string): types.Statement =>
  types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier(countSeqRefVar),
      types.callExpression(types.identifier('useRef'), [types.numericLiteral(0)])
    ),
  ])

const COUNT_SEQ_LOCAL = '__tqCountSeq'

const refCurrent = (refVar: string): types.MemberExpression =>
  types.memberExpression(types.identifier(refVar), types.identifier('current'))

/**
 * `data.count === 0 ? 0 : Math.ceil(data.count / perPage)`
 *
 * Zero is special-cased rather than left to `Math.ceil(0 / n)` so the intent —
 * "no results at all", which numbered pagination renders as an empty strip — is
 * visible in the generated code.
 */
const buildMaxPagesExpression = (perPage: number): types.Expression =>
  types.conditionalExpression(
    types.binaryExpression(
      '===',
      types.memberExpression(types.identifier('data'), types.identifier('count')),
      types.numericLiteral(0)
    ),
    types.numericLiteral(0),
    types.callExpression(
      types.memberExpression(types.identifier('Math'), types.identifier('ceil')),
      [
        types.binaryExpression(
          '/',
          types.memberExpression(types.identifier('data'), types.identifier('count')),
          types.numericLiteral(perPage)
        ),
      ]
    )
  )

/**
 * `const __tqCountSeq = ++ds_N_countSeq.current` — the request's sequence
 * number, taken before the fetch starts.
 */
const buildCountSeqCapture = (countSeqRefVar: string): types.Statement =>
  types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier(COUNT_SEQ_LOCAL),
      types.updateExpression('++', refCurrent(countSeqRefVar), true)
    ),
  ])

/** `if (__tqCountSeq !== ds_N_countSeq.current) return` — a newer count is in flight. */
const buildStaleCountGuard = (countSeqRefVar: string): types.Statement =>
  types.ifStatement(
    types.binaryExpression('!==', types.identifier(COUNT_SEQ_LOCAL), refCurrent(countSeqRefVar)),
    types.returnStatement()
  )

export const buildCountFetchStatement = (
  options: Pick<
    CountEffectOptions,
    'fileName' | 'perPage' | 'setMaxPagesVar' | 'urlParams' | 'countSeqRefVar'
  >
): types.Statement =>
  types.expressionStatement(
    types.callExpression(
      types.memberExpression(
        types.callExpression(
          types.memberExpression(
            types.callExpression(types.identifier('fetch'), [
              types.templateLiteral(
                [
                  types.templateElement({
                    raw: `/api/${options.fileName}-count?`,
                    cooked: `/api/${options.fileName}-count?`,
                  }),
                  types.templateElement({ raw: '', cooked: '' }),
                ],
                [
                  types.newExpression(types.identifier('URLSearchParams'), [
                    types.objectExpression(options.urlParams),
                  ]),
                ]
              ),
            ]),
            types.identifier('then')
          ),
          [
            types.arrowFunctionExpression(
              [types.identifier('res')],
              types.callExpression(
                types.memberExpression(types.identifier('res'), types.identifier('json')),
                []
              )
            ),
          ]
        ),
        types.identifier('then')
      ),
      [
        types.arrowFunctionExpression(
          [types.identifier('data')],
          types.blockStatement([
            buildStaleCountGuard(options.countSeqRefVar),
            types.ifStatement(
              types.logicalExpression(
                '&&',
                types.identifier('data'),
                types.binaryExpression('in', types.stringLiteral('count'), types.identifier('data'))
              ),
              types.blockStatement([
                types.expressionStatement(
                  types.callExpression(types.identifier(options.setMaxPagesVar), [
                    buildMaxPagesExpression(options.perPage),
                  ])
                ),
              ])
            ),
          ])
        ),
      ]
    )
  )

/**
 * The whole `useEffect(...)` wrapper.
 *
 * ⛔ No skip-on-mount guard, on purpose: a page seeds `maxPages` from the
 * build-time `getStaticProps` count, and that snapshot goes stale the moment
 * rows are added after the build — leaving "Next" disabled on a list that has
 * grown. Re-counting on mount is what corrects it.
 */
export const buildCountFetchEffect = (options: CountEffectOptions): types.ExpressionStatement =>
  types.expressionStatement(
    types.callExpression(types.identifier('useEffect'), [
      types.arrowFunctionExpression(
        [],
        types.blockStatement([
          buildCountSeqCapture(options.countSeqRefVar),
          buildCountFetchStatement(options),
        ])
      ),
      types.arrayExpression(options.deps),
    ])
  )
