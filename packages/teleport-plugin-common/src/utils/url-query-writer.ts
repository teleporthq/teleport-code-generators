import * as types from '@babel/types'

/**
 * The ONE place a generated page is allowed to write `router.query` from.
 *
 * ## The defect this exists to make impossible
 *
 * Every URL-bound control used to own a `useEffect` that did
 *
 *     const __nextQuery = { ...router.query }   // its own snapshot
 *     __nextQuery.categoryFilter = 'Rings'
 *     router.replace({ pathname, query: __nextQuery }, undefined, { shallow: true })
 *
 * `router.query` is a per-render SHALLOW COPY that Next rebuilds only when the
 * router itself re-renders (`makePublicRouterInstance` — "makes sure query is
 * not stateful"), and `router.replace` updates it asynchronously. So two
 * controls writing in the same flush both spread the SAME pre-change object,
 * and whichever `replace` commits last silently drops the key the other had
 * just added — or resurrects one it had just deleted.
 *
 * That is not a rare interleaving; it is the common one. Changing a filter
 * resets the page, so the filter's write-back and the page's write-back always
 * fire together.
 *
 * ⛔ And the damage does not stop at a wrong URL. Each control also has a
 * READ-BACK effect that pushes `router.query` back into React state. Once a key
 * is erased, the read-back clears that control's state, the write-back
 * re-asserts it, the next landing erases it again — and because each round
 * reads the other side's PRE-flush value, the pair computes
 * `(state, url) -> (url, state)`: a swap. A swap has no fixed point off the
 * diagonal, so it never converges. The observed symptom was a products list
 * that re-fetched and flickered forever after picking a category while on
 * page 5.
 *
 * ## The fix
 *
 * Nobody spreads `router.query` any more. All writers go through one function
 * that merges into `pending` — the last query this component ASKED for —
 * falling back to `router.query` only when nothing is in flight. The second
 * write of a flush therefore builds on the first's payload instead of racing
 * it, no key is ever lost, and with no key lost there is nothing for a
 * read-back to disagree about.
 *
 * `pending` is dropped once every replace it was built from has settled, so an
 * external navigation (a Link, browser back/forward) is never merged into a
 * stale snapshot.
 *
 * @see `buildUrlWriteBackEffect` in `./url-search-param-sync` and
 *      `buildPageUrlSyncEffect` in `teleport-plugin-next-data-source` — the two
 *      callers, in two different packages, which is why this lives here.
 */

/** `useRef` holding `{ pending, inFlight }`. Shared by every writer in a component. */
export const QUERY_SYNC_REF_ID = '__tqQuerySyncRef'

/** The write function every URL-bound control calls. */
export const QUERY_WRITER_ID = '__tqWriteQueryParam'

const refCurrent = (): types.MemberExpression =>
  types.memberExpression(types.identifier(QUERY_SYNC_REF_ID), types.identifier('current'))

const refField = (field: 'pending' | 'inFlight'): types.MemberExpression =>
  types.memberExpression(refCurrent(), types.identifier(field))

/**
 * `__tqQuerySyncRef.current.inFlight === 0` — "the URL is settled".
 *
 * The page-URL effect uses it to gate its ADOPT branch: while a replace this
 * component issued is still landing, `router.query` is a value the page is on
 * its way OUT of, and adopting it would undo the move that is in flight.
 */
export const buildQuerySettledExpr = (): types.BinaryExpression =>
  types.binaryExpression('===', refField('inFlight'), types.numericLiteral(0))

/** `__tqWriteQueryParam('<paramKey>', <valueExpr>)` — `undefined` removes the key. */
export const buildQueryWriteCall = (
  paramKey: string,
  valueExpr: types.Expression
): types.ExpressionStatement =>
  types.expressionStatement(
    types.callExpression(types.identifier(QUERY_WRITER_ID), [
      types.stringLiteral(paramKey),
      valueExpr,
    ])
  )

/**
 * True when a previous plugin already emitted the declarations.
 *
 * Both `createNextUrlSearchParamsPlugin` and
 * `createNextArrayMapperPaginationPlugin` can be the first to need them on the
 * same component, and neither knows whether the other ran.
 */
export const hasQuerySyncDeclarations = (body: types.Statement[]): boolean =>
  body.some(
    (statement) =>
      statement.type === 'VariableDeclaration' &&
      statement.declarations.some(
        (declarator) =>
          declarator.id.type === 'Identifier' && declarator.id.name === QUERY_SYNC_REF_ID
      )
  )

/**
 * Emitted shape:
 *
 *   const __tqQuerySyncRef = useRef({ pending: null, inFlight: 0 })
 *   const __tqWriteQueryParam = (key, value) => {
 *     const base = __tqQuerySyncRef.current.pending || router.query
 *     const next = { ...base }
 *     if (value === undefined || value === null || value === '') { delete next[key] }
 *     else { next[key] = String(value) }
 *     if (next[key] === base[key]) return
 *     __tqQuerySyncRef.current.pending = next
 *     __tqQuerySyncRef.current.inFlight += 1
 *     const settle = () => {
 *       __tqQuerySyncRef.current.inFlight -= 1
 *       if (__tqQuerySyncRef.current.inFlight <= 0) {
 *         __tqQuerySyncRef.current.inFlight = 0
 *         __tqQuerySyncRef.current.pending = null
 *       }
 *     }
 *     Promise.resolve(
 *       router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true })
 *     ).then(settle, settle)
 *   }
 *
 * Notes on the details that are load-bearing:
 *
 * - `next[key] === base[key]` is the ONLY bail. Comparing against the pending
 *   query rather than `router.query` is what makes a re-render during an
 *   in-flight replace a no-op instead of a duplicate write.
 * - Bracket access, so a URL key that is not a JS identifier (`foo-bar`) works
 *   without the callers having to care.
 * - `String(value)` here rather than at each call site — a number page and a
 *   string category then serialise identically.
 * - `Promise.resolve(...)` wraps the `replace` because a stubbed router in a
 *   test may return a plain value; `.then(settle, settle)` releases the pending
 *   query on a rejected (cancelled) navigation too, so one failed replace cannot
 *   freeze every later write against a stale base.
 * - `shallow: true` keeps `getStaticProps` out of it: the data is driven by the
 *   params memo, not by the URL.
 */
export const buildQuerySyncDeclarations = (): types.Statement[] => {
  const key = types.identifier('key')
  const value = types.identifier('value')

  const nextAtKey = (): types.MemberExpression =>
    types.memberExpression(types.identifier('next'), types.cloneNode(key, true), true)

  const settleBody = types.blockStatement([
    types.expressionStatement(
      types.assignmentExpression('-=', refField('inFlight'), types.numericLiteral(1))
    ),
    types.ifStatement(
      types.binaryExpression('<=', refField('inFlight'), types.numericLiteral(0)),
      types.blockStatement([
        types.expressionStatement(
          types.assignmentExpression('=', refField('inFlight'), types.numericLiteral(0))
        ),
        types.expressionStatement(
          types.assignmentExpression('=', refField('pending'), types.nullLiteral())
        ),
      ])
    ),
  ])

  const writerBody = types.blockStatement([
    // const base = __tqQuerySyncRef.current.pending || router.query
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('base'),
        types.logicalExpression(
          '||',
          refField('pending'),
          types.memberExpression(types.identifier('router'), types.identifier('query'))
        )
      ),
    ]),
    // const next = { ...base }
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('next'),
        types.objectExpression([types.spreadElement(types.identifier('base'))])
      ),
    ]),
    types.ifStatement(
      types.logicalExpression(
        '||',
        types.logicalExpression(
          '||',
          types.binaryExpression(
            '===',
            types.cloneNode(value, true),
            types.identifier('undefined')
          ),
          types.binaryExpression('===', types.cloneNode(value, true), types.nullLiteral())
        ),
        types.binaryExpression('===', types.cloneNode(value, true), types.stringLiteral(''))
      ),
      types.blockStatement([
        types.expressionStatement(
          types.unaryExpression('delete', nextAtKey()) as unknown as types.Expression
        ),
      ]),
      types.blockStatement([
        types.expressionStatement(
          types.assignmentExpression(
            '=',
            nextAtKey(),
            types.callExpression(types.identifier('String'), [types.cloneNode(value, true)])
          )
        ),
      ])
    ),
    // if (next[key] === base[key]) return
    types.ifStatement(
      types.binaryExpression(
        '===',
        nextAtKey(),
        types.memberExpression(types.identifier('base'), types.cloneNode(key, true), true)
      ),
      types.returnStatement(null)
    ),
    types.expressionStatement(
      types.assignmentExpression('=', refField('pending'), types.identifier('next'))
    ),
    types.expressionStatement(
      types.assignmentExpression('+=', refField('inFlight'), types.numericLiteral(1))
    ),
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('settle'),
        types.arrowFunctionExpression([], settleBody)
      ),
    ]),
    types.expressionStatement(
      types.callExpression(
        types.memberExpression(
          types.callExpression(
            types.memberExpression(types.identifier('Promise'), types.identifier('resolve')),
            [
              types.callExpression(
                types.memberExpression(types.identifier('router'), types.identifier('replace')),
                [
                  types.objectExpression([
                    types.objectProperty(
                      types.identifier('pathname'),
                      types.memberExpression(
                        types.identifier('router'),
                        types.identifier('pathname')
                      )
                    ),
                    types.objectProperty(types.identifier('query'), types.identifier('next')),
                  ]),
                  types.identifier('undefined'),
                  types.objectExpression([
                    types.objectProperty(types.identifier('shallow'), types.booleanLiteral(true)),
                  ]),
                ]
              ),
            ]
          ),
          types.identifier('then')
        ),
        [types.identifier('settle'), types.identifier('settle')]
      )
    ),
  ])

  return [
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier(QUERY_SYNC_REF_ID),
        types.callExpression(types.identifier('useRef'), [
          types.objectExpression([
            types.objectProperty(types.identifier('pending'), types.nullLiteral()),
            types.objectProperty(types.identifier('inFlight'), types.numericLiteral(0)),
          ]),
        ])
      ),
    ]),
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier(QUERY_WRITER_ID),
        types.arrowFunctionExpression([key, value], writerBody)
      ),
    ]),
  ]
}

/**
 * Inserts the declarations once, immediately after `const router = useRouter()`
 * when that is already in the body (it is a plain closure over `router`, so the
 * order only matters for readability — nothing reads it before an effect runs).
 *
 * @returns `true` when it inserted, so the caller can register the `useRef`
 *          import dependency only when it is actually needed.
 */
export const ensureQuerySyncDeclarations = (body: types.Statement[]): boolean => {
  if (hasQuerySyncDeclarations(body)) {
    return false
  }
  const routerIndex = body.findIndex(
    (statement) =>
      statement.type === 'VariableDeclaration' &&
      statement.declarations.some(
        (declarator) =>
          declarator.id.type === 'Identifier' &&
          declarator.id.name === 'router' &&
          declarator.init?.type === 'CallExpression' &&
          declarator.init.callee.type === 'Identifier' &&
          declarator.init.callee.name === 'useRouter'
      )
  )
  body.splice(routerIndex === -1 ? 0 : routerIndex + 1, 0, ...buildQuerySyncDeclarations())
  return true
}
