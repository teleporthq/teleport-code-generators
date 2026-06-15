import * as types from '@babel/types'
import { StringUtils } from '@teleporthq/teleport-shared'

/**
 * Shared AST builders for binding a piece of component state to a URL search
 * param with a loop-free, two-way sync. Used by:
 *
 *  - `teleport-plugin-common/.../ast-utils.ts` (`createStateHookAST`) for the
 *    initial value of a state with `urlSearchParamBinding`.
 *  - `teleport-project-generator-next/.../url-search-params-plugin.ts` for the
 *    state-level write-back / read-back effects.
 *  - `teleport-plugin-next-data-source/.../pagination-plugin.ts` for the
 *    array-mapper search input bound to a URL key (`searchUrlParamKey`).
 *
 * Keeping the three call sites on one implementation guarantees the category
 * filter, sort selector, and search input all behave identically.
 */

// Strict JS identifier. UIDL URL keys are guaranteed URL-safe by the GUI, but
// the *generated* code must be valid JS, and `__nextQuery.foo-bar` parses as a
// subtraction. Anything off-pattern goes through bracket notation:
// `__nextQuery['foo-bar']`.
const VALID_JS_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/

// `object.key` for identifier-safe keys (readability), `object['key']`
// otherwise (validity).
export const accessKeyOf = (object: types.Expression, paramKey: string): types.MemberExpression => {
  if (VALID_JS_IDENTIFIER.test(paramKey)) {
    return types.memberExpression(object, types.identifier(paramKey))
  }
  return types.memberExpression(object, types.stringLiteral(paramKey), true)
}

/**
 * The initial-value expression for a URL-bound piece of state:
 *
 *   (typeof window !== 'undefined'
 *     ? new URLSearchParams(window.location.search).get('<key>')
 *     : null) ?? <fallback>
 *
 * We deliberately read `window.location.search` rather than Next.js'
 * `router.query` because on statically-generated pages `router.query` is empty
 * on the first render and only hydrates after `router.isReady` flips — by which
 * point React's `useState` initializer has already captured the fallback.
 * `window.location` is populated synchronously on direct loads and client-side
 * navigations, and the `typeof window` guard keeps SSR on the declared default.
 */
export const buildUrlSearchParamInitExpr = (
  paramKey: string,
  fallback: types.Expression
): types.Expression => {
  const urlSearchParamsExpr = types.newExpression(types.identifier('URLSearchParams'), [
    types.memberExpression(
      types.memberExpression(types.identifier('window'), types.identifier('location')),
      types.identifier('search')
    ),
  ])
  const readParamExpr = types.callExpression(
    types.memberExpression(urlSearchParamsExpr, types.identifier('get')),
    [types.stringLiteral(paramKey)]
  )
  const browserGuard = types.binaryExpression(
    '!==',
    types.unaryExpression('typeof', types.identifier('window')),
    types.stringLiteral('undefined')
  )
  return types.logicalExpression(
    '??',
    types.conditionalExpression(browserGuard, readParamExpr, types.nullLiteral()),
    fallback
  )
}

/**
 * The statements that push a value onto the URL via a shallow `router.replace`.
 * Emitted shape (for value `selectedCategory` bound to key `categoryFilter`):
 *
 *   if (typeof window === 'undefined') return
 *   if (!router.isReady) return
 *   const __nextQuery = { ...router.query }
 *   if (<value> === '' || <value> == null) {
 *     delete __nextQuery.categoryFilter
 *   } else {
 *     __nextQuery.categoryFilter = String(<value>)
 *   }
 *   if (__nextQuery.categoryFilter === router.query.categoryFilter) return
 *   router.replace({ pathname: router.pathname, query: __nextQuery }, undefined, { shallow: true })
 *
 * Notes:
 * - `router.isReady` gate avoids replacing with the same value during the SSG
 *   hydration race.
 * - the equality short-circuit prevents replaces that would not change the URL
 *   (typing the same value, mount-equal-to-URL, and — crucially — the
 *   read-back firing `setState` with the value just written).
 * - `shallow: true` keeps `getStaticProps` from re-running on URL change.
 *
 * `valueExpr` is cloned at every use site so callers may pass a shared
 * member-expression (e.g. `ds_0_state.debouncedQuery`) without Babel choking on
 * reused nodes.
 *
 * `defaultValue`: when a non-empty default is supplied, the key is ALSO deleted
 * (rather than written) when the value equals that default — keeping the URL
 * clean for a state whose "resting" value is non-empty (e.g. `sortBy` defaults
 * to `"name-asc"`, so `?sortBy=name-asc` is never written). Empty / omitted
 * defaults keep the original `value === '' || value == null` condition, so the
 * empty-default category/search write-backs are byte-for-byte unchanged.
 */
export const buildUrlWriteBackStatements = (
  valueExpr: types.Expression,
  paramKey: string,
  defaultValue?: string
): types.Statement[] => {
  const cloneValue = (): types.Expression => types.cloneNode(valueExpr, /* deep */ true)
  const nextQueryId = (): types.Identifier => types.identifier('__nextQuery')
  const routerQueryParam = (): types.MemberExpression =>
    accessKeyOf(
      types.memberExpression(types.identifier('router'), types.identifier('query')),
      paramKey
    )
  const nextQueryParam = (): types.MemberExpression => accessKeyOf(nextQueryId(), paramKey)

  // value === '' || value == null  [ || value === '<default>' ]
  let emptyCondition: types.Expression = types.logicalExpression(
    '||',
    types.binaryExpression('===', cloneValue(), types.stringLiteral('')),
    types.binaryExpression('==', cloneValue(), types.nullLiteral())
  )
  if (typeof defaultValue === 'string' && defaultValue !== '') {
    emptyCondition = types.logicalExpression(
      '||',
      emptyCondition,
      types.binaryExpression('===', cloneValue(), types.stringLiteral(defaultValue))
    )
  }

  return [
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
        nextQueryId(),
        types.objectExpression([
          types.spreadElement(
            types.memberExpression(types.identifier('router'), types.identifier('query'))
          ),
        ])
      ),
    ]),
    // if (value === '' || value == null [|| value === default]) { delete __nextQuery.key }
    // else { __nextQuery.key = String(value) }
    types.ifStatement(
      emptyCondition,
      types.blockStatement([
        types.expressionStatement(
          types.unaryExpression('delete', nextQueryParam()) as unknown as types.Expression
        ),
      ]),
      types.blockStatement([
        types.expressionStatement(
          types.assignmentExpression(
            '=',
            nextQueryParam(),
            types.callExpression(types.identifier('String'), [cloneValue()])
          )
        ),
      ])
    ),
    // if (__nextQuery.key === router.query.key) return
    types.ifStatement(
      types.binaryExpression('===', nextQueryParam(), routerQueryParam()),
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
            types.objectProperty(types.identifier('query'), nextQueryId()),
          ]),
          types.identifier('undefined'),
          types.objectExpression([
            types.objectProperty(types.identifier('shallow'), types.booleanLiteral(true)),
          ]),
        ]
      )
    ),
  ]
}

/**
 * The URL write-back `useEffect` for a single bare-identifier state:
 *
 *   useEffect(() => { <write-back statements> }, [<stateKey>, router.isReady])
 */
export const buildUrlWriteBackEffect = (
  stateKey: string,
  paramKey: string,
  defaultValue?: string
): types.ExpressionStatement => {
  const effectBody = types.blockStatement(
    buildUrlWriteBackStatements(types.identifier(stateKey), paramKey, defaultValue)
  )
  return types.expressionStatement(
    types.callExpression(types.identifier('useEffect'), [
      types.arrowFunctionExpression([], effectBody),
      types.arrayExpression([
        types.identifier(stateKey),
        types.memberExpression(types.identifier('router'), types.identifier('isReady')),
      ]),
    ])
  )
}

/**
 * The URL→state read-back `useEffect`. Emitted shape (for `selectedCategory`
 * bound to key `categoryFilter`):
 *
 *   useEffect(() => {
 *     if (!router.isReady) return
 *     const __urlValue = router.query.categoryFilter
 *     const __nextValue =
 *       typeof __urlValue === 'string' ? __urlValue : Array.isArray(__urlValue) ? (__urlValue[0] || '') : ''
 *     setSelectedCategory((prev) => (prev === __nextValue ? prev : __nextValue))
 *   }, [router.query.categoryFilter, router.isReady])
 *
 * The functional `setState((prev) => prev === next ? prev : next)` form makes
 * React bail out when the URL value already matches state — which is what
 * prevents an infinite write-back ↔ read-back loop. `router.query[key]` may be
 * `string | string[]`; both normalize to a string (defaulting to `''`).
 *
 * `setterName` lets callers whose setter is not derivable from `stateKey` via
 * `createStateStoringFunction` (e.g. the data-source `setDs_0_searchQuery`)
 * pass it explicitly.
 *
 * `defaultValue`: a missing / empty URL key normalizes to this value instead of
 * `''`. This MUST mirror the write-back's `defaultValue` and the `useState`
 * init's `?? <default>`: when the write-back deletes the key for a non-empty
 * default (e.g. `sortBy` back to `"name-asc"`), the read-back has to resolve the
 * now-missing key back to `"name-asc"` — otherwise it would set the state to
 * `''`, blanking the controlled `<select>`. Empty / omitted defaults keep the
 * original `''` fallback so the category/search read-backs are unchanged.
 */
export const buildUrlReadBackEffect = (
  stateKey: string,
  paramKey: string,
  setterName: string = StringUtils.createStateStoringFunction(stateKey),
  defaultValue?: string
): types.ExpressionStatement => {
  const urlValueId = types.identifier('__urlValue')
  const nextValueId = types.identifier('__nextValue')
  const prevParam = types.identifier('prev')
  const routerQueryParam = (): types.MemberExpression =>
    accessKeyOf(
      types.memberExpression(types.identifier('router'), types.identifier('query')),
      paramKey
    )

  const hasDefault = typeof defaultValue === 'string' && defaultValue !== ''
  const fallback = (): types.StringLiteral => types.stringLiteral(hasDefault ? defaultValue! : '')
  // typeof __urlValue === 'string' ? <__urlValue | __urlValue || default>
  const stringCase: types.Expression = hasDefault
    ? types.logicalExpression('||', urlValueId, fallback())
    : urlValueId

  const normalizeArg = types.conditionalExpression(
    types.binaryExpression(
      '===',
      types.unaryExpression('typeof', urlValueId),
      types.stringLiteral('string')
    ),
    stringCase,
    types.conditionalExpression(
      // Array.isArray(__urlValue) ? (__urlValue[0] || <fallback>) : <fallback>
      types.callExpression(
        types.memberExpression(types.identifier('Array'), types.identifier('isArray')),
        [urlValueId]
      ),
      types.logicalExpression(
        '||',
        types.memberExpression(urlValueId, types.numericLiteral(0), true),
        fallback()
      ),
      fallback()
    )
  )

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
    types.variableDeclaration('const', [types.variableDeclarator(urlValueId, routerQueryParam())]),
    // const __nextValue = (normalized)
    types.variableDeclaration('const', [types.variableDeclarator(nextValueId, normalizeArg)]),
    // setState((prev) => prev === __nextValue ? prev : __nextValue)
    types.expressionStatement(
      types.callExpression(types.identifier(setterName), [
        types.arrowFunctionExpression(
          [prevParam],
          types.conditionalExpression(
            types.binaryExpression('===', prevParam, nextValueId),
            prevParam,
            nextValueId
          )
        ),
      ])
    ),
  ])

  return types.expressionStatement(
    types.callExpression(types.identifier('useEffect'), [
      types.arrowFunctionExpression([], effectBody),
      types.arrayExpression([
        routerQueryParam(),
        types.memberExpression(types.identifier('router'), types.identifier('isReady')),
      ]),
    ])
  )
}
