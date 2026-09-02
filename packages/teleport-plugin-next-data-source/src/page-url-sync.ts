import * as types from '@babel/types'
import { URLQueryWriter } from '@teleporthq/teleport-plugin-common'

/**
 * Keeping the current page and the `?page=` query in step.
 *
 * ## Why one effect and not the read-back / write-back PAIR
 *
 * Every other URL-bound control (the category dropdown, the sort select, the
 * search box) uses two independent effects from `URLSearchParamSync`, each
 * bailing when the value it would write is already there. That works because
 * both sides start out agreeing: the state is SEEDED from
 * `window.location.search` in its `useState` initializer, so by the time the
 * effects run there is nothing to reconcile.
 *
 * The page cannot be seeded that way, for a reason that only shows up in a
 * browser: a statically generated page is rendered on the server with page 1,
 * and React does NOT repair mismatched ATTRIBUTES when it hydrates — it keeps
 * the server's DOM and warns. A client that seeded page 3 renders "Previous" as
 * enabled, the server rendered it disabled, and the disabled one is what stays
 * on screen. Worse, it stays for good: React's later re-renders diff against the
 * client's own first render, which already said enabled, so nothing ever
 * repaints it. The rows would be page 3's with no way back to page 2.
 *
 * Adopting the URL in an effect instead makes the page change from 1 to 3 a
 * real state transition, which React renders normally. But a naive PAIR of
 * effects then races: on the render where the router becomes ready, the
 * write-back sees page 1, deletes `?page=3` from the URL, and the read-back it
 * was supposed to cooperate with reads back the page it just erased.
 *
 * So one effect owns both directions and decides which side moved:
 *
 *   • the URL moved (a deep link, a `<Link>`, browser back/forward) ⇒ adopt it
 *   • the page moved (a click, or the filter reset) ⇒ write it
 *
 * The previously seen URL value is what separates the two, so neither direction
 * has to guess. Page 1 is written as the ABSENCE of the key, so an unpaginated
 * visit keeps a clean URL and a filter reset takes `?page=` back off it.
 *
 * ⚠️ A deep-linked page 2+ therefore costs one extra fetch: the provider mounts
 * on page 1 and refetches when this effect adopts the URL. Correctness over the
 * round trip — the alternative leaves a control the visitor cannot use.
 */

// Strict JS identifier check, mirroring `URLSearchParamSync`: a key like
// `foo-bar` has to go through bracket notation or the emitted code is a
// subtraction.
const VALID_JS_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/

const accessKeyOf = (object: types.Expression, paramKey: string): types.MemberExpression =>
  VALID_JS_IDENTIFIER.test(paramKey)
    ? types.memberExpression(object, types.identifier(paramKey))
    : types.memberExpression(object, types.stringLiteral(paramKey), true)

const routerQueryAccess = (paramKey: string): types.MemberExpression =>
  accessKeyOf(
    types.memberExpression(types.identifier('router'), types.identifier('query')),
    paramKey
  )

/** `const <refVar> = useRef(null)` — the last `?page=` value this effect saw. */
export const buildPageUrlRefDeclaration = (refVar: string): types.VariableDeclaration =>
  types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier(refVar),
      types.callExpression(types.identifier('useRef'), [types.nullLiteral()])
    ),
  ])

export interface PageUrlSyncOptions {
  paramKey: string
  /** Ref holding the previously seen URL page. */
  refVar: string
  /** How this usage reads its current page. */
  currentPageExpr: () => types.Expression
  /** How this usage writes a page back. */
  buildSetPageStatement: (pageExpr: types.Expression) => types.Expression
}

/**
 * Emitted shape (for `?page=`, a combined `{ page, debouncedQuery }` state):
 *
 *   useEffect(() => {
 *     if (!router.isReady) return
 *     const __urlValue = router.query.page
 *     const __raw = typeof __urlValue === 'string' ? __urlValue
 *       : Array.isArray(__urlValue) ? __urlValue[0] || '' : ''
 *     const __urlPage = Math.max(1, parseInt(__raw, 10) || 1)
 *     const __statePage = ds_0_state.page
 *     const __seenUrlPage = ds_0_pageUrlRef.current
 *     if (__tqQuerySyncRef.current.inFlight === 0 &&
 *         __seenUrlPage !== __urlPage && __urlPage !== __statePage) {
 *       ds_0_pageUrlRef.current = __urlPage
 *       setDs_0_state(state => state.page === __urlPage ? state : { ...state, page: __urlPage })
 *       return
 *     }
 *     ds_0_pageUrlRef.current = __urlPage
 *     if (__urlPage === __statePage) return
 *     __tqWriteQueryParam('page', __statePage <= 1 ? undefined : __statePage)
 *   }, [router.query.page, router.isReady, ds_0_state.page])
 *
 * The write goes through `URLQueryWriter` rather than spreading `router.query`
 * here. This effect and a filter's write-back fire in the SAME flush on every
 * filter change (the reset moves the page), and two effects each merging into
 * their own stale snapshot of `router.query` erase each other's keys — see
 * `url-query-writer.ts` for why that then never settles.
 */
export const buildPageUrlSyncEffect = (options: PageUrlSyncOptions): types.ExpressionStatement => {
  const refCurrent = (): types.MemberExpression =>
    types.memberExpression(types.identifier(options.refVar), types.identifier('current'))

  const rememberUrlPage = (): types.Statement =>
    types.expressionStatement(
      types.assignmentExpression('=', refCurrent(), types.identifier('__urlPage'))
    )

  const effectBody = types.blockStatement([
    types.ifStatement(
      types.unaryExpression(
        '!',
        types.memberExpression(types.identifier('router'), types.identifier('isReady'))
      ),
      types.returnStatement(null)
    ),
    types.variableDeclaration('const', [
      types.variableDeclarator(types.identifier('__urlValue'), routerQueryAccess(options.paramKey)),
    ]),
    // `router.query[key]` is `string | string[] | undefined` in Next's typings.
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('__raw'),
        types.conditionalExpression(
          types.binaryExpression(
            '===',
            types.unaryExpression('typeof', types.identifier('__urlValue')),
            types.stringLiteral('string')
          ),
          types.identifier('__urlValue'),
          types.conditionalExpression(
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
      ),
    ]),
    // A missing, unparseable or out-of-range param all mean page 1 — which is
    // also the value written as no key at all, so the two sides agree.
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('__urlPage'),
        types.callExpression(
          types.memberExpression(types.identifier('Math'), types.identifier('max')),
          [
            types.numericLiteral(1),
            types.logicalExpression(
              '||',
              types.callExpression(types.identifier('parseInt'), [
                types.identifier('__raw'),
                types.numericLiteral(10),
              ]),
              types.numericLiteral(1)
            ),
          ]
        )
      ),
    ]),
    types.variableDeclaration('const', [
      types.variableDeclarator(types.identifier('__statePage'), options.currentPageExpr()),
    ]),
    types.variableDeclaration('const', [
      types.variableDeclarator(types.identifier('__seenUrlPage'), refCurrent()),
    ]),
    // The URL is the side that moved: a deep link (nothing seen yet), a
    // same-path navigation, or browser back/forward.
    types.ifStatement(
      types.logicalExpression(
        '&&',
        // ⛔ Only when nothing this component asked for is still landing.
        // Mid-flight, `router.query` holds a page the visitor is on their way
        // OUT of (the filter reset writes page 1 while `?page=5` is still in the
        // bar), and adopting it would put them straight back on it.
        URLQueryWriter.buildQuerySettledExpr(),
        types.logicalExpression(
          '&&',
          types.binaryExpression(
            '!==',
            types.identifier('__seenUrlPage'),
            types.identifier('__urlPage')
          ),
          types.binaryExpression(
            '!==',
            types.identifier('__urlPage'),
            types.identifier('__statePage')
          )
        )
      ),
      types.blockStatement([
        rememberUrlPage(),
        types.expressionStatement(options.buildSetPageStatement(types.identifier('__urlPage'))),
        types.returnStatement(null),
      ])
    ),
    rememberUrlPage(),
    types.ifStatement(
      types.binaryExpression('===', types.identifier('__urlPage'), types.identifier('__statePage')),
      types.returnStatement(null)
    ),
    // The page is the side that moved: a control click, or the filter reset.
    // The write goes through the shared query writer so it merges into the last
    // query this component asked for — the filter's own write-back may still be
    // in flight in this very flush. Page 1 is written as the ABSENCE of the key,
    // which the writer expresses as `undefined`.
    URLQueryWriter.buildQueryWriteCall(
      options.paramKey,
      types.conditionalExpression(
        types.binaryExpression('<=', types.identifier('__statePage'), types.numericLiteral(1)),
        types.identifier('undefined'),
        types.identifier('__statePage')
      )
    ),
  ])

  return types.expressionStatement(
    types.callExpression(types.identifier('useEffect'), [
      types.arrowFunctionExpression([], effectBody),
      types.arrayExpression([
        routerQueryAccess(options.paramKey),
        types.memberExpression(types.identifier('router'), types.identifier('isReady')),
        options.currentPageExpr(),
      ]),
    ])
  )
}
