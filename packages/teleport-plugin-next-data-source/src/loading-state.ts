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
}

export function getLoadingStateVars(index: number): LoadingStateVars {
  return {
    isFetchingVar: `ds_${index}_isFetching`,
    setIsFetchingVar: `setDs_${index}_isFetching`,
    inFlightRefVar: `ds_${index}_fetchesInFlight`,
  }
}

/**
 * `const ds_N_fetchesInFlight = useRef(0)`
 * `const [ds_N_isFetching, setDs_N_isFetching] = useState(false)`
 *
 * Both are stable across renders (a ref object and a `useState` setter), which
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

  return true
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
 *     ds_N_fetchesInFlight.current += 1
 *     setDs_N_isFetching(true)
 *     return fetch(...).then(...).finally(() => {
 *       ds_N_fetchesInFlight.current -= 1
 *       if (ds_N_fetchesInFlight.current <= 0) {
 *         ds_N_fetchesInFlight.current = 0
 *         setDs_N_isFetching(false)
 *       }
 *     })
 *   }
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

  return types.blockStatement([
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
      types.callExpression(types.memberExpression(fetchExpression, types.identifier('finally')), [
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
