import * as types from '@babel/types'
import { findCachedFetchNetworkChain } from './cache/ast'

/**
 * ------------------------------------------------------------------
 * Refetch loading state for array-mapper `DataProvider`s
 * ------------------------------------------------------------------
 *
 * `DataProvider` (from `@teleporthq/react-components`) renders its LOADING
 * slot only when it has no data to show:
 *
 *   case "idle":
 *   case "loading":
 *     return props.persistDataDuringLoading && data
 *       ? renderSuccess(data, true)
 *       : renderLoading()
 *
 * Every generated array-mapper list ships `persistDataDuringLoading={true}`,
 * and that flag is load-bearing on the FIRST paint: when the page prefetches
 * rows in `getStaticProps` and hands them over as `initialData`, the provider
 * deliberately skips its first client fetch and therefore never leaves the
 * `idle` status. Without the flag that page would render the loading slot
 * forever instead of the prefetched rows.
 *
 * The side effect is that once the provider owns data, EVERY later refetch is
 * invisible: changing the category filter, the sort order or the search term
 * re-runs the query while the stale rows stay on screen, so the buyer gets no
 * feedback until the new rows pop in. (Page changes and search changes also
 * remount the provider through its `key`, which resets `data` — but a filter
 * or sort change keeps the same key, so nothing at all happens visually.)
 *
 * The provider does pass an `isLoading` flag as the second argument of
 * `renderSuccess`, but it is `true` for the `idle` status as well — i.e.
 * permanently true on any page that skipped its first fetch because it had
 * `initialData` — so it cannot be used to decide what to paint.
 *
 * Fix: track the in-flight fetches of each data source in the PAGE component
 * and hand `persistDataDuringLoading` the negated flag. `fetchData` is the one
 * function the generator owns and the provider calls exactly once per fetch, so
 * it is where the flag is raised (`true` when the request starts) and lowered
 * (`false` once it settles, success or failure). While a refetch is in flight
 * `persistDataDuringLoading` is `false`, so the provider falls through to
 * `renderLoading()` and the array mapper's designed loading state shows; when
 * the request settles the flag drops back to `true` and the rows return.
 *
 * Why not branch inside `renderSuccess` instead: the loading JSX would have to
 * be duplicated into the success render prop, and `styled-jsx` only scopes JSX
 * that lives inside the component's returned tree — every workaround that
 * hoists the loading markup into a shared local helper silently loses its
 * `jsx-<hash>` class and therefore all of its styles.
 *
 * Nothing changes for a provider that is idle or mounting: `isFetching` starts
 * at `false`, so the server render and the first client render are identical
 * (no hydration mismatch) and the `initialData` fast path is untouched.
 */

export interface LoadingStateVars {
  /** Boolean state: `true` while at least one fetch for this data source is in flight. */
  isFetchingVar: string
  /** Setter for `isFetchingVar`. */
  setIsFetchingVar: string
  /**
   * Ref holding the number of fetches currently in flight. A boolean alone is
   * not enough: two controls changed in quick succession (e.g. category then
   * sort) start two overlapping requests, and the first one to settle would
   * otherwise lower the flag while the second is still running — flashing the
   * stale rows back for the rest of the second request.
   */
  inFlightRefVar: string
  /**
   * Ref counting the requests STARTED, so a response can tell whether a newer
   * request has overtaken it. `DataProvider` keeps whatever resolves last:
   * two controls changed in quick succession (a "Clear all" emptying several
   * filter states, one state write after another) start two requests, and
   * when the older, slower one settles after the newer it painted the OLDER
   * rows over the newer — a list showing two products for a URL that filters
   * nothing. Each request notes its sequence number and, if overtaken, hands
   * over the newest settled rows instead of its own.
   */
  fetchSeqRefVar: string
  /** Ref holding the rows of the newest request that settled — what an overtaken one resolves with. */
  latestDataRefVar: string
}

export function getLoadingStateVars(index: number): LoadingStateVars {
  return {
    isFetchingVar: `ds_${index}_isFetching`,
    setIsFetchingVar: `setDs_${index}_isFetching`,
    inFlightRefVar: `ds_${index}_fetchesInFlight`,
    fetchSeqRefVar: `ds_${index}_fetchSeq`,
    latestDataRefVar: `ds_${index}_latestData`,
  }
}

/**
 * `const ds_N_fetchesInFlight = useRef(0)`
 * `const ds_N_fetchSeq = useRef(0)`
 * `const ds_N_latestData = useRef(undefined)`
 * `const [ds_N_isFetching, setDs_N_isFetching] = useState(false)`
 *
 * All are stable across renders (ref objects and a `useState` setter), which
 * is what lets the wrapped `fetchData` keep its empty `useCallback` dependency
 * array — a changing `fetchData` identity would retrigger the provider's fetch
 * effect on every render.
 */
export function buildLoadingStateDeclarations(vars: LoadingStateVars): types.Statement[] {
  return [
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier(vars.inFlightRefVar),
        types.callExpression(types.identifier('useRef'), [types.numericLiteral(0)])
      ),
    ]),
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier(vars.fetchSeqRefVar),
        types.callExpression(types.identifier('useRef'), [types.numericLiteral(0)])
      ),
    ]),
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier(vars.latestDataRefVar),
        types.callExpression(types.identifier('useRef'), [types.identifier('undefined')])
      ),
    ]),
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.arrayPattern([
          types.identifier(vars.isFetchingVar),
          types.identifier(vars.setIsFetchingVar),
        ]),
        types.callExpression(types.identifier('useState'), [types.booleanLiteral(false)])
      ),
    ]),
  ]
}

/**
 * Wires the refetch loading state into a single `DataProvider` JSX element.
 *
 * No-ops (returning `false`, so the caller emits no state declarations) when
 * the provider cannot benefit from it:
 *   - no `renderLoading` slot — the array mapper has no loading state designed,
 *     so falling through to it would blank the list out instead of showing
 *     something; keeping the stale rows is the better of the two.
 *   - `fetchData` missing, not memoized, or not an expression-bodied promise
 *     chain — see `findMemoizedFetchDataArrow`.
 *   - already wired — keeps a second pass over the same AST idempotent.
 */
export function applyLoadingStateToDataProvider(
  // tslint:disable-next-line:no-any
  dataProvider: any,
  vars: LoadingStateVars
): boolean {
  const attributes = dataProvider?.openingElement?.attributes
  if (!Array.isArray(attributes)) {
    return false
  }

  if (!findAttribute(attributes, 'renderLoading')) {
    return false
  }

  const fetchDataAttr = findAttribute(attributes, 'fetchData')
  if (!fetchDataAttr) {
    return false
  }

  const fetchArrow = findMemoizedFetchDataArrow(fetchDataAttr)
  if (!fetchArrow) {
    return false
  }

  if (fetchArrow.body.type === 'CallExpression') {
    fetchArrow.body = buildTrackedFetchBody(fetchArrow.body, vars)
  } else if (fetchArrow.body.type === 'BlockStatement') {
    if (!injectTrackingIntoCachedBody(fetchArrow.body, vars)) {
      return false
    }
  } else {
    return false
  }

  setPersistDataDuringLoading(attributes, vars)

  return true
}

/**
 * Adds the in-flight bookkeeping to a CACHED `fetchData` body.
 *
 * The body already returns early with `Promise.resolve(hit)` on a cache hit, so
 * the tracking is attached to the network chain BELOW that — never to the early
 * return. That is the whole point: a hit must not raise `isFetching`, because
 * `persistDataDuringLoading={!isFetching}` would then drop the provider into its
 * loading slot for a frame and produce exactly the skeleton flash the cache
 * exists to remove.
 *
 * Returns `false` when the body is not the shape this module knows how to wrap,
 * so the caller emits no state declarations rather than half-wiring it.
 */
function injectTrackingIntoCachedBody(body: types.BlockStatement, vars: LoadingStateVars): boolean {
  // Idempotent: a second pass over the same AST must not double-count.
  if (containsIdentifier(body, vars.setIsFetchingVar)) {
    return false
  }

  const networkChain = findCachedFetchNetworkChain(body)
  if (!networkChain) {
    return false
  }

  const tracked = buildTrackedFetchBody(networkChain.statement.argument as types.Expression, vars)
  body.body.splice(networkChain.index, 1, ...tracked.body)
  markCacheHitAsNewest(body, vars)

  return true
}

/**
 * A cache hit answers synchronously with the rows of THIS request, so it is
 * the newest settled result too: it advances the sequence and records its rows,
 * or an older network request still in flight would resolve after it and paint
 * over it. Adds the two statements at the head of the hit branch — before its
 * `return Promise.resolve(__tqHit)` — and nothing else, so the flag the branch
 * deliberately never raises stays untouched.
 */
function markCacheHitAsNewest(body: types.BlockStatement, vars: LoadingStateVars): void {
  const hit = body.body.find(
    (statement): statement is types.IfStatement =>
      statement.type === 'IfStatement' &&
      statement.test.type === 'BinaryExpression' &&
      statement.test.left.type === 'Identifier' &&
      statement.test.left.name === CACHE_HIT_IDENTIFIER &&
      statement.consequent.type === 'BlockStatement'
  )
  if (!hit || hit.consequent.type !== 'BlockStatement') {
    return
  }
  hit.consequent.body.unshift(
    types.expressionStatement(types.updateExpression('++', refCurrent(vars.fetchSeqRefVar), true)),
    types.expressionStatement(
      types.assignmentExpression(
        '=',
        refCurrent(vars.latestDataRefVar),
        types.identifier(CACHE_HIT_IDENTIFIER)
      )
    )
  )
}

/** The identifier the cache wiring binds a hit to — see `cache/ast.ts`. */
const CACHE_HIT_IDENTIFIER = '__tqHit'
/** The rows a tracked request resolved with, inside its own `then`. */
const TRACKED_ROWS_IDENTIFIER = '__tqRows'
/** This request's sequence number. */
const TRACKED_SEQ_IDENTIFIER = '__tqSeq'

function refCurrent(refVar: string): types.MemberExpression {
  return types.memberExpression(types.identifier(refVar), types.identifier('current'))
}

// tslint:disable-next-line:no-any
function containsIdentifier(node: any, name: string): boolean {
  if (!node || typeof node !== 'object') {
    return false
  }
  if (node.type === 'Identifier' && node.name === name) {
    return true
  }
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') {
      continue
    }
    const value = node[key]
    if (Array.isArray(value)) {
      if (value.some((entry) => containsIdentifier(entry, name))) {
        return true
      }
    } else if (value && typeof value === 'object' && containsIdentifier(value, name)) {
      return true
    }
  }
  return false
}

// tslint:disable-next-line:no-any
function findAttribute(attributes: any[], name: string): types.JSXAttribute | undefined {
  return attributes.find(
    // tslint:disable-next-line:no-any
    (attr: any) => attr?.type === 'JSXAttribute' && attr.name?.name === name
  )
}

/**
 * The `useCallback(fn, [])`-wrapped arrow behind a `fetchData` attribute, or
 * `undefined` when the value has any other shape.
 *
 * Requiring the memoized form is a safety condition, not a convenience.
 * `DataProvider` refetches whenever the `fetchData` identity changes
 * (`useEffect(..., [params, fetchData])`), so wrapping a fetcher that is
 * re-created on every render with something that sets state would build a
 * self-sustaining loop: fetch → setState → render → new fetcher identity →
 * fetch. The array-mapper providers this plugin owns are always memoized; the
 * few unmemoized `fetchData` values other plugins emit are left exactly as they
 * are today.
 */
function findMemoizedFetchDataArrow(
  attribute: types.JSXAttribute
): types.ArrowFunctionExpression | undefined {
  const value = attribute.value
  if (!value || value.type !== 'JSXExpressionContainer') {
    return undefined
  }

  const expression = value.expression
  if (
    expression.type !== 'CallExpression' ||
    expression.callee.type !== 'Identifier' ||
    expression.callee.name !== 'useCallback' ||
    expression.arguments[0]?.type !== 'ArrowFunctionExpression'
  ) {
    return undefined
  }

  return expression.arguments[0] as types.ArrowFunctionExpression
}

/**
 * Turns `(params) => fetch(...).then(...)` into
 *
 *   (params) => {
 *     const __tqSeq = ++ds_N_fetchSeq.current
 *     ds_N_fetchesInFlight.current += 1
 *     setDs_N_isFetching(true)
 *     return fetch(...).then(...).then((__tqRows) => {
 *       if (__tqSeq !== ds_N_fetchSeq.current) {
 *         return ds_N_latestData.current !== undefined ? ds_N_latestData.current : __tqRows
 *       }
 *       ds_N_latestData.current = __tqRows
 *       return __tqRows
 *     }).finally(() => {
 *       ds_N_fetchesInFlight.current -= 1
 *       if (ds_N_fetchesInFlight.current <= 0) {
 *         ds_N_fetchesInFlight.current = 0
 *         setDs_N_isFetching(false)
 *       }
 *     })
 *   }
 *
 * The `then` is the stale guard (see `fetchSeqRefVar`): a request overtaken by
 * a newer one resolves with the newest settled rows rather than its own, so
 * the provider — which keeps whatever resolves LAST — never paints older rows
 * over newer ones. An overtaken request whose successor has not settled yet
 * resolves with its own rows; the successor then replaces them.
 *
 * `finally` (rather than a `then` pair) keeps the flag honest when the request
 * rejects: the provider switches to its error status and the loading state must
 * not stay on screen. The counter is clamped at 0 so a late settle from a
 * provider instance that was remounted through its `key` can never drive it
 * negative and wedge the flag on.
 *
 * `fetchExpression` is the `fetch(...).then(...).then(...)` chain the generator
 * emitted, so `.finally` is always available on it — the caller only reaches
 * here for a call-expression body.
 */
function buildTrackedFetchBody(
  fetchExpression: types.Expression,
  vars: LoadingStateVars
): types.BlockStatement {
  const inFlightCount = types.memberExpression(
    types.identifier(vars.inFlightRefVar),
    types.identifier('current')
  )

  const settleHandler = types.arrowFunctionExpression(
    [],
    types.blockStatement([
      types.expressionStatement(
        types.assignmentExpression(
          '-=',
          types.cloneNode(inFlightCount, true),
          types.numericLiteral(1)
        )
      ),
      types.ifStatement(
        types.binaryExpression('<=', types.cloneNode(inFlightCount, true), types.numericLiteral(0)),
        types.blockStatement([
          types.expressionStatement(
            types.assignmentExpression(
              '=',
              types.cloneNode(inFlightCount, true),
              types.numericLiteral(0)
            )
          ),
          types.expressionStatement(
            types.callExpression(types.identifier(vars.setIsFetchingVar), [
              types.booleanLiteral(false),
            ])
          ),
        ])
      ),
    ])
  )

  const latestData = refCurrent(vars.latestDataRefVar)
  const staleGuard = types.arrowFunctionExpression(
    [types.identifier(TRACKED_ROWS_IDENTIFIER)],
    types.blockStatement([
      types.ifStatement(
        types.binaryExpression(
          '!==',
          types.identifier(TRACKED_SEQ_IDENTIFIER),
          refCurrent(vars.fetchSeqRefVar)
        ),
        types.blockStatement([
          types.returnStatement(
            types.conditionalExpression(
              types.binaryExpression(
                '!==',
                types.cloneNode(latestData, true),
                types.identifier('undefined')
              ),
              types.cloneNode(latestData, true),
              types.identifier(TRACKED_ROWS_IDENTIFIER)
            )
          ),
        ])
      ),
      types.expressionStatement(
        types.assignmentExpression(
          '=',
          types.cloneNode(latestData, true),
          types.identifier(TRACKED_ROWS_IDENTIFIER)
        )
      ),
      types.returnStatement(types.identifier(TRACKED_ROWS_IDENTIFIER)),
    ])
  )
  const guardedFetch = types.callExpression(
    types.memberExpression(fetchExpression, types.identifier('then')),
    [staleGuard]
  )

  return types.blockStatement([
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier(TRACKED_SEQ_IDENTIFIER),
        types.updateExpression('++', refCurrent(vars.fetchSeqRefVar), true)
      ),
    ]),
    types.expressionStatement(
      types.assignmentExpression(
        '+=',
        types.cloneNode(inFlightCount, true),
        types.numericLiteral(1)
      )
    ),
    types.expressionStatement(
      types.callExpression(types.identifier(vars.setIsFetchingVar), [types.booleanLiteral(true)])
    ),
    types.returnStatement(
      types.callExpression(types.memberExpression(guardedFetch, types.identifier('finally')), [
        settleHandler,
      ])
    ),
  ])
}

/** `persistDataDuringLoading={!ds_N_isFetching}`, replacing any existing value. */
// tslint:disable-next-line:no-any
function setPersistDataDuringLoading(attributes: any[], vars: LoadingStateVars): void {
  const attribute = types.jsxAttribute(
    types.jsxIdentifier('persistDataDuringLoading'),
    types.jsxExpressionContainer(
      types.unaryExpression('!', types.identifier(vars.isFetchingVar), true)
    )
  )

  const existingIndex = attributes.findIndex(
    // tslint:disable-next-line:no-any
    (attr: any) => attr?.type === 'JSXAttribute' && attr.name?.name === 'persistDataDuringLoading'
  )

  if (existingIndex === -1) {
    attributes.push(attribute)
    return
  }

  attributes[existingIndex] = attribute
}
