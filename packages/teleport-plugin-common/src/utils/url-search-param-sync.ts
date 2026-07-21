import * as types from '@babel/types'

// Shared builders for two-way `<state> ⇄ ?key=` URL search-param syncing.
//
// Used by BOTH:
//   • `createNextUrlSearchParamsPlugin` (teleport-project-generator-next) for
//     page/component state defs that declare `urlSearchParamBinding` — e.g.
//     the products-list `selectedCategory` / `sortBy` dropdowns.
//   • `createNextArrayMapperPaginationPlugin` (teleport-plugin-next-data-source)
//     for the products-list search input, whose query lives in a
//     pagination-managed state (`ds_N_searchQuery` / `ds_N_state.debouncedQuery`)
//     rather than a UIDL state def, so it cannot ride the plugin above.
//
// Both emit the SAME loop-free read-back / write-back effect shapes, so the
// builders live here to keep the two call sites byte-identical and the
// loop-prevention reasoning in one place.

// Strict JS identifier (Latin only is fine: UIDL URL keys are limited to the
// subset Next.js supports as a query param key, which the GUI guarantees to
// be at minimum URL-safe; but the *generated* code must be valid JS, and
// `__nextQuery.foo-bar` parses as a subtraction). Anything off-pattern goes
// through bracket notation: `__nextQuery['foo-bar']`.
const VALID_JS_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/

// `object.<paramKey>` for identifier-safe keys, `object['param-key']` otherwise,
// so the emitted code is always valid JS regardless of the URL key shape.
const accessKeyOf = (object: types.Expression, paramKey: string): types.MemberExpression => {
  if (VALID_JS_IDENTIFIER.test(paramKey)) {
    return types.memberExpression(object, types.identifier(paramKey))
  }
  return types.memberExpression(object, types.stringLiteral(paramKey), true)
}

const routerQueryAccess = (paramKey: string): types.MemberExpression =>
  accessKeyOf(
    types.memberExpression(types.identifier('router'), types.identifier('query')),
    paramKey
  )

// Clones an expression so it can be slotted into multiple positions of the
// emitted AST — Babel does not support sharing the same node reference across
// the tree, and callers pass arbitrary value/dependency expressions.
const clone = (expr: types.Expression): types.Expression =>
  types.cloneNode(expr, /* deep */ true) as types.Expression

// Builds the state→URL write-back useEffect. Emitted shape (for a value of
// `selectedCategory` bound to URL key `categoryFilter`):
//
//   useEffect(() => {
//     if (typeof window === 'undefined') return
//     if (!router.isReady) return
//     const __nextQuery = { ...router.query }
//     if (selectedCategory === '' || selectedCategory == null) {
//       delete __nextQuery.categoryFilter
//     } else {
//       __nextQuery.categoryFilter = String(selectedCategory)
//     }
//     if (__nextQuery.categoryFilter === router.query.categoryFilter) return
//     router.replace(
//       { pathname: router.pathname, query: __nextQuery },
//       undefined,
//       { shallow: true }
//     )
//   }, [selectedCategory, router.isReady])
//
// `valueExpr` is the expression read each render and pushed to the URL (a bare
// state identifier for dropdowns, `ds_N_state.debouncedQuery` for the search
// input). `depExpr` is the effect dependency that re-triggers the write-back
// when that value changes — usually the same expression as `valueExpr`.
//
// `defaultValueExpr` (optional) is the state's default value. When supplied
// (only for bindings whose default is a non-empty value, e.g. the sort
// dropdown's `name-asc`), the current value being EQUAL TO THE DEFAULT also
// deletes the key — so the canonical/default view keeps a clean, param-free
// URL instead of stickily writing `?sortBy=name-asc` on first load. This is
// the write-back half of the default-aware pairing that keeps the URL⇄state
// sync loop-free: the read-back below resolves a missing key back to the same
// default, so the two never disagree. Omitting it (empty-default bindings like
// `selectedCategory` / the search input) yields byte-identical output to the
// pre-default builder.
//
// Notes:
// 1. `router.isReady` gate: on the very first SSG render `router.query` is
//    empty, so without this gate any value initialized from
//    `window.location.search` would immediately `router.replace` itself with
//    the same value, racing with Next's own hydration. `router.isReady` is
//    also in the deps array — once it flips to true, the effect re-runs with
//    the now-hydrated `router.query` and decides correctly whether to replace.
// 2. The equality check after building `__nextQuery` short-circuits replaces
//    that would not change the URL — important when the user re-enters the
//    same value, when the value mounts equal to the URL, and when the
//    read-back effect fires its setter with the value just pushed.
// 3. `shallow: true` keeps `getStaticProps` from re-running just because the
//    URL bar changed; the data-source `useMemo` reacts to the state, not the
//    URL.
// 4. Empty / null value deletes the key entirely so the URL never keeps a
//    sticky `?key=` empty param.
export const buildUrlWriteBackEffect = (
  paramKey: string,
  valueExpr: types.Expression,
  depExpr: types.Expression,
  defaultValueExpr?: types.Expression
): types.ExpressionStatement => {
  // value === '' || value == null  [|| value === <default>]
  let deleteCondition: types.Expression = types.logicalExpression(
    '||',
    types.binaryExpression('===', clone(valueExpr), types.stringLiteral('')),
    types.binaryExpression('==', clone(valueExpr), types.nullLiteral())
  )
  if (defaultValueExpr) {
    deleteCondition = types.logicalExpression(
      '||',
      deleteCondition,
      types.binaryExpression('===', clone(valueExpr), clone(defaultValueExpr))
    )
  }

  const effectBody = types.blockStatement([
    // if (typeof window === 'undefined') return
    types.ifStatement(
      types.binaryExpression(
        '===',
        types.unaryExpression('typeof', types.identifier('window')),
        types.stringLiteral('undefined')
      ),
      types.returnStatement(null)
    ),
    // if (!router.isReady) return
    types.ifStatement(
      types.unaryExpression(
        '!',
        types.memberExpression(types.identifier('router'), types.identifier('isReady'))
      ),
      types.returnStatement(null)
    ),
    // const __nextQuery = { ...router.query }
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('__nextQuery'),
        types.objectExpression([
          types.spreadElement(
            types.memberExpression(types.identifier('router'), types.identifier('query'))
          ),
        ])
      ),
    ]),
    // if (value === '' || value == null [|| value === <default>]) { delete __nextQuery.key }
    // else { __nextQuery.key = String(value) }
    types.ifStatement(
      deleteCondition,
      types.blockStatement([
        types.expressionStatement(
          types.unaryExpression(
            'delete',
            accessKeyOf(types.identifier('__nextQuery'), paramKey)
          ) as unknown as types.Expression
        ),
      ]),
      types.blockStatement([
        types.expressionStatement(
          types.assignmentExpression(
            '=',
            accessKeyOf(types.identifier('__nextQuery'), paramKey),
            types.callExpression(types.identifier('String'), [clone(valueExpr)])
          )
        ),
      ])
    ),
    // if (__nextQuery.key === router.query.key) return
    types.ifStatement(
      types.binaryExpression(
        '===',
        accessKeyOf(types.identifier('__nextQuery'), paramKey),
        routerQueryAccess(paramKey)
      ),
      types.returnStatement(null)
    ),
    // router.replace({ pathname: router.pathname, query: __nextQuery }, undefined, { shallow: true })
    types.expressionStatement(
      types.callExpression(
        types.memberExpression(types.identifier('router'), types.identifier('replace')),
        [
          types.objectExpression([
            types.objectProperty(
              types.identifier('pathname'),
              types.memberExpression(types.identifier('router'), types.identifier('pathname'))
            ),
            types.objectProperty(types.identifier('query'), types.identifier('__nextQuery')),
          ]),
          types.identifier('undefined'),
          types.objectExpression([
            types.objectProperty(types.identifier('shallow'), types.booleanLiteral(true)),
          ]),
        ]
      )
    ),
  ])

  return types.expressionStatement(
    types.callExpression(types.identifier('useEffect'), [
      types.arrowFunctionExpression([], effectBody),
      types.arrayExpression([
        clone(depExpr),
        types.memberExpression(types.identifier('router'), types.identifier('isReady')),
      ]),
    ])
  )
}

// Builds the URL→state read-back useEffect. Emitted shape (for setter
// `setSelectedCategory` bound to URL key `categoryFilter`):
//
//   useEffect(() => {
//     if (!router.isReady) return
//     const __urlValue = router.query.categoryFilter
//     const __nextValue =
//       typeof __urlValue === 'string' ? __urlValue : Array.isArray(__urlValue) ? (__urlValue[0] || '') : ''
//     setSelectedCategory((prev) => (prev === __nextValue ? prev : __nextValue))
//   }, [router.query.categoryFilter, router.isReady])
//
// Why pair this with the write-back effect:
// - On `<Link>` / `router.push` shallow navigations that land on the same path
//   with a different query (or browser back/forward, which can change the query
//   without remounting the page), `router.query` updates but the state hook does
//   not. Without this effect, the control would be stuck on whatever the user
//   last picked even though the URL has moved on.
// - The functional `setState((prev) => prev === next ? prev : next)` form
//   guarantees React bails out when the URL value matches state, which prevents
//   an infinite write-back ↔ read-back loop: when the user picks a new value,
//   state→URL fires once, URL→state observes the matching value and returns
//   `prev`, so React does not re-render or fire any deps.
// - `router.query[key]` can be either `string` (single value) or `string[]`
//   (duplicate keys) per Next.js's typings; the helper normalizes both to a
//   string before comparing, defaulting to `''` for the missing-key case so the
//   comparison aligns with the write-back's `value === ''` empty-check.
//
// `defaultValueExpr` (optional) is the state's default value. When supplied
// (bindings with a non-empty default such as the sort dropdown's `name-asc`),
// an ABSENT or EMPTY URL value resolves to the default rather than `''` — via a
// trailing `(<normalized>) || <default>`. This is what makes the default sort
// "stick" on first load: without it the read-back would clobber the default
// state (`name-asc`) with `''` the instant the router hydrates with no `?sortBy`
// key, forcing an extra unsorted fetch and losing the ordering. It also keeps
// browser back/forward to the param-free URL restoring the default view.
// Omitting it reproduces the pre-default `''` fallback byte-for-byte.
export const buildUrlReadBackEffect = (
  paramKey: string,
  setterName: string,
  defaultValueExpr?: types.Expression
): types.ExpressionStatement => {
  const normalizeArg = types.conditionalExpression(
    // typeof __urlValue === 'string' ? __urlValue
    types.binaryExpression(
      '===',
      types.unaryExpression('typeof', types.identifier('__urlValue')),
      types.stringLiteral('string')
    ),
    types.identifier('__urlValue'),
    types.conditionalExpression(
      // Array.isArray(__urlValue) ? (__urlValue[0] || '') : ''
      types.callExpression(
        types.memberExpression(types.identifier('Array'), types.identifier('isArray')),
        [types.identifier('__urlValue')]
      ),
      types.logicalExpression(
        '||',
        types.memberExpression(types.identifier('__urlValue'), types.numericLiteral(0), true),
        types.stringLiteral('')
      ),
      types.stringLiteral('')
    )
  )

  // With a default, an absent/empty normalized value (falsy `''`) falls through
  // to the default: `(<normalized>) || <default>`. Without one, the bare
  // normalized expression is emitted unchanged.
  const nextValueExpr: types.Expression = defaultValueExpr
    ? types.logicalExpression('||', normalizeArg, clone(defaultValueExpr))
    : normalizeArg

  const effectBody = types.blockStatement([
    // if (!router.isReady) return
    types.ifStatement(
      types.unaryExpression(
        '!',
        types.memberExpression(types.identifier('router'), types.identifier('isReady'))
      ),
      types.returnStatement(null)
    ),
    // const __urlValue = router.query.<paramKey>
    types.variableDeclaration('const', [
      types.variableDeclarator(types.identifier('__urlValue'), routerQueryAccess(paramKey)),
    ]),
    // const __nextValue = (normalized) [|| <default>]
    types.variableDeclaration('const', [
      types.variableDeclarator(types.identifier('__nextValue'), nextValueExpr),
    ]),
    // setState((prev) => prev === __nextValue ? prev : __nextValue)
    types.expressionStatement(
      types.callExpression(types.identifier(setterName), [
        types.arrowFunctionExpression(
          [types.identifier('prev')],
          types.conditionalExpression(
            types.binaryExpression(
              '===',
              types.identifier('prev'),
              types.identifier('__nextValue')
            ),
            types.identifier('prev'),
            types.identifier('__nextValue')
          )
        ),
      ])
    ),
  ])

  return types.expressionStatement(
    types.callExpression(types.identifier('useEffect'), [
      types.arrowFunctionExpression([], effectBody),
      types.arrayExpression([
        routerQueryAccess(paramKey),
        types.memberExpression(types.identifier('router'), types.identifier('isReady')),
      ]),
    ])
  )
}
