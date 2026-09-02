import * as types from '@babel/types'

/**
 * Resetting a paginated list back to page 1 when its FILTER or SORT changes.
 *
 * Without this a visitor on page 5 who picks a category with twelve results
 * fetches page 5 of twelve rows and is shown an empty grid, with only
 * "Previous" to get out of it. The search input never had this bug: its
 * debounce effect REPLACES the whole `{ page, debouncedQuery }` state, and so
 * has always dropped the page back to 1 as a side effect.
 *
 * ⛔ Why the guard is a signature and not the usual `useRef(true)` skip-first:
 * URL-driven dependencies (`router.query.categoryFilter`) are `undefined` on
 * the first render and only take their real value once the router hydrates.
 * A skip-first guard would treat that hydration as a change and reset the page
 * of a deep link like `?page=3&categoryFilter=Rings` back to 1 — the very
 * sharing case the page-in-URL feature exists to support. Comparing a
 * serialised signature instead means the first OBSERVED value is recorded
 * rather than acted on, whatever render it arrives in, and any later genuine
 * change resets exactly once.
 */

export interface PageResetDeps {
  /** Bare identifiers: state-bound filter destinations and dynamic-sort deps. */
  stateIds: string[]
  /** Emitted as `props.<id>` — props are never destructured into scope. */
  propIds: string[]
  /** Emitted as `router.query.<key>`. */
  urlSearchParamKeys: string[]
}

/** True when there is nothing that could ever change the filtering of this list. */
export const hasNoPageResetDeps = (deps: PageResetDeps): boolean =>
  deps.stateIds.length === 0 && deps.propIds.length === 0 && deps.urlSearchParamKeys.length === 0

const routerQueryAccess = (key: string): types.MemberExpression =>
  types.memberExpression(
    types.memberExpression(types.identifier('router'), types.identifier('query')),
    types.identifier(key)
  )

/**
 * The expressions the effect both depends on and hashes into its signature.
 *
 * Kept in one place so the two can never drift: a value in the signature but
 * not the deps would be read stale, and one in the deps but not the signature
 * would re-run the effect without being able to explain why it changed.
 */
const buildTrackedExpressions = (deps: PageResetDeps): types.Expression[] => {
  const tracked: types.Expression[] = []
  const seen = new Set<string>()
  for (const id of deps.stateIds) {
    if (seen.has(id)) {
      continue
    }
    seen.add(id)
    tracked.push(types.identifier(id))
  }
  for (const id of deps.propIds) {
    const key = `props.${id}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    tracked.push(types.memberExpression(types.identifier('props'), types.identifier(id)))
  }
  for (const key of deps.urlSearchParamKeys) {
    tracked.push(routerQueryAccess(key))
  }
  return tracked
}

/**
 * Builds the reset effect.
 *
 * @param refVar          name of the `useRef` holding the last seen signature
 * @param buildResetStatement  how this usage writes page 1 — the combined
 *                        `{ page, debouncedQuery }` state and the standalone
 *                        page state need different setters
 */
export const buildFilterSortPageResetEffect = (
  refVar: string,
  deps: PageResetDeps,
  buildResetStatement: () => types.Statement
): types.ExpressionStatement => {
  const body: types.Statement[] = []
  const hasRouterDeps = deps.urlSearchParamKeys.length > 0

  // Reading `router.query` before the router is ready would hash `undefined`
  // for every URL-driven filter and record a signature that is about to change
  // on its own.
  if (hasRouterDeps) {
    body.push(
      types.ifStatement(
        types.unaryExpression(
          '!',
          types.memberExpression(types.identifier('router'), types.identifier('isReady')),
          true
        ),
        types.returnStatement()
      )
    )
  }

  const refCurrent = types.memberExpression(types.identifier(refVar), types.identifier('current'))

  // `?? null` so a missing URL param serialises as `null` rather than dropping
  // out of the array and shifting every later entry.
  const signatureEntries = buildTrackedExpressions(deps).map((expr) =>
    expr.type === 'MemberExpression' && expr.object.type === 'MemberExpression'
      ? types.logicalExpression('??', expr, types.nullLiteral())
      : expr
  )

  body.push(
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('__sig'),
        types.callExpression(
          types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
          [types.arrayExpression(signatureEntries)]
        )
      ),
    ]),
    types.ifStatement(
      types.binaryExpression('===', types.cloneNode(refCurrent, true), types.identifier('__sig')),
      types.returnStatement()
    ),
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('__first'),
        types.binaryExpression('===', types.cloneNode(refCurrent, true), types.nullLiteral())
      ),
    ]),
    types.expressionStatement(
      types.assignmentExpression('=', types.cloneNode(refCurrent, true), types.identifier('__sig'))
    ),
    types.ifStatement(types.identifier('__first'), types.returnStatement()),
    buildResetStatement()
  )

  const effectDeps = buildTrackedExpressions(deps)
  if (hasRouterDeps) {
    effectDeps.push(types.memberExpression(types.identifier('router'), types.identifier('isReady')))
  }

  return types.expressionStatement(
    types.callExpression(types.identifier('useEffect'), [
      types.arrowFunctionExpression([], types.blockStatement(body)),
      types.arrayExpression(effectDeps),
    ])
  )
}

/** `const <refVar> = useRef(null)` — the signature store for the effect above. */
export const buildPageResetRefDeclaration = (refVar: string): types.VariableDeclaration =>
  types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier(refVar),
      types.callExpression(types.identifier('useRef'), [types.nullLiteral()])
    ),
  ])
