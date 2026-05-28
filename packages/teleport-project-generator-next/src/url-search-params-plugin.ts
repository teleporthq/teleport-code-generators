import * as types from '@babel/types'
import type {
  ComponentPlugin,
  UIDLDependency,
  UIDLStateDefinition,
} from '@teleporthq/teleport-types'
import { Constants, StringUtils } from '@teleporthq/teleport-shared'
import { USE_ROUTER_HOOK } from './internationalization/locale-mapper-component'

// Matches the default name used by `createReactComponentPlugin` when adding
// its AST chunk to the structure. Hardcoded to the literal rather than
// imported so we avoid a cross-package dist path dependency.
const REACT_COMPONENT_CHUNK_NAME = 'jsx-component'

const USE_EFFECT_DEPENDENCY: UIDLDependency = Constants.USE_STATE_DEPENDENCY

// Strict JS identifier (Latin only is fine: UIDL URL keys are limited to the
// subset Next.js supports as a query param key, which the GUI guarantees to
// be at minimum URL-safe; but the *generated* code must be valid JS, and
// `__nextQuery.foo-bar` parses as a subtraction). Anything off-pattern goes
// through bracket notation: `__nextQuery['foo-bar']`.
const VALID_JS_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/

const accessKeyOf = (object: types.Expression, paramKey: string): types.MemberExpression => {
  if (VALID_JS_IDENTIFIER.test(paramKey)) {
    return types.memberExpression(object, types.identifier(paramKey))
  }
  return types.memberExpression(object, types.stringLiteral(paramKey), true)
}

// Shared by the internationalization plugin — duplicated here as a local
// helper to avoid an import cycle. Checks whether the component body already
// contains `const router = useRouter()` so we do not emit a duplicate when
// another plugin (internationalization) has already added it.
const hasUseRouterDeclaration = (body: types.Statement[]): boolean =>
  body.some(
    (statement) =>
      statement.type === 'VariableDeclaration' &&
      statement.declarations.some(
        (declaration) =>
          declaration.id.type === 'Identifier' &&
          declaration.id.name === 'router' &&
          declaration.init?.type === 'CallExpression' &&
          declaration.init.callee.type === 'Identifier' &&
          declaration.init.callee.name === 'useRouter'
      )
  )

// True if the deps array of a useEffect contains a bare `Identifier` named
// `stateKey`. One of two signals used to recognise an existing write-back
// effect; the other is "body contains `router.replace`".
const effectDepsContainStateId = (depsArr: types.ArrayExpression, stateKey: string): boolean =>
  depsArr.elements.some((el) => el?.type === 'Identifier' && el.name === stateKey)

// True if the deps array contains a `router.query.<paramKey>` (or
// `router.query['<paramKey>']`) member expression. One of two signals used
// to recognise an existing read-back effect; the other is the setter call.
const effectDepsContainRouterQueryKey = (
  depsArr: types.ArrayExpression,
  paramKey: string
): boolean =>
  depsArr.elements.some((el) => {
    if (!el || el.type !== 'MemberExpression') {
      return false
    }
    if (el.object.type !== 'MemberExpression') {
      return false
    }
    if (
      el.object.object.type !== 'Identifier' ||
      el.object.object.name !== 'router' ||
      el.object.property.type !== 'Identifier' ||
      el.object.property.name !== 'query'
    ) {
      return false
    }
    if (!el.computed && el.property.type === 'Identifier') {
      return el.property.name === paramKey
    }
    if (el.computed && el.property.type === 'StringLiteral') {
      return el.property.value === paramKey
    }
    return false
  })

// True if the useEffect callback body contains a `router.replace(...)` call.
// The load-bearing side effect of a write-back; pairing this with the deps
// check protects against false positives (some other effect that happens to
// watch the same state but does not write the URL).
const effectBodyHasRouterReplace = (fn: types.ArrowFunctionExpression): boolean => {
  if (fn.body.type !== 'BlockStatement') {
    return false
  }
  return fn.body.body.some(
    (s) =>
      s.type === 'ExpressionStatement' &&
      s.expression.type === 'CallExpression' &&
      s.expression.callee.type === 'MemberExpression' &&
      s.expression.callee.object.type === 'Identifier' &&
      s.expression.callee.object.name === 'router' &&
      s.expression.callee.property.type === 'Identifier' &&
      s.expression.callee.property.name === 'replace'
  )
}

// True if the useEffect callback body calls a function named `setterName`.
// Pairs with the read-back deps check so we don't confuse an unrelated
// `useEffect(..., [router.query.foo, router.isReady])` with our generated
// read-back (e.g. if a future plugin watches the same query param).
const effectBodyCallsSetter = (fn: types.ArrowFunctionExpression, setterName: string): boolean => {
  if (fn.body.type !== 'BlockStatement') {
    return false
  }
  return fn.body.body.some(
    (s) =>
      s.type === 'ExpressionStatement' &&
      s.expression.type === 'CallExpression' &&
      s.expression.callee.type === 'Identifier' &&
      s.expression.callee.name === setterName
  )
}

// Iterates `useEffect(...)` statements and runs `matcher` with the deps
// array AND the arrow callback so callers can combine deps-based and
// body-based signals. Returns true on the first match.
const hasUseEffectMatching = (
  body: types.Statement[],
  matcher: (deps: types.ArrayExpression, fn: types.ArrowFunctionExpression) => boolean
): boolean =>
  body.some((statement) => {
    if (statement.type !== 'ExpressionStatement') {
      return false
    }
    if (statement.expression.type !== 'CallExpression') {
      return false
    }
    if (statement.expression.callee.type !== 'Identifier') {
      return false
    }
    if (statement.expression.callee.name !== 'useEffect') {
      return false
    }
    const fnArg = statement.expression.arguments.find(
      (a): a is types.ArrowFunctionExpression => a.type === 'ArrowFunctionExpression'
    )
    const depsArg = statement.expression.arguments.find(
      (a): a is types.ArrayExpression => a.type === 'ArrayExpression'
    )
    if (!fnArg || !depsArg) {
      return false
    }
    return matcher(depsArg, fnArg)
  })

// Builds the URL write-back useEffect for a single state def. Emitted shape
// (for `selectedCategory` bound to URL key `categoryFilter`):
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
// Notes:
// 1. `router.isReady` gate: on the very first SSG render `router.query` is
//    empty, so without this gate every state initialized from
//    `window.location.search` would immediately `router.replace` itself with
//    the same value, racing with Next's own hydration. `router.isReady`
//    is also in the deps array — once it flips to true, the effect re-runs
//    with the now-hydrated `router.query` and decides correctly whether to
//    replace.
// 2. The equality check after building `__nextQuery` short-circuits replaces
//    that would not change the URL — important when the user types the same
//    value, when the state mounts equal to URL, and when the URL-read effect
//    fires `setState` with the same value the user just picked.
// 3. `shallow: true` keeps `getStaticProps` from re-running just because the
//    URL bar changed; the data-source `useMemo` reacts to the state, not the
//    URL.
// 4. Bracket vs dot notation for `paramKey`: identifier-safe keys use dot
//    notation for readability; anything else (hyphens, dots, leading digits)
//    goes through `__nextQuery['the-key']` so the emitted code is valid JS.
const buildUrlWriteBackEffect = (stateKey: string, paramKey: string): types.ExpressionStatement => {
  const nextQuery = types.identifier('__nextQuery')
  const stateId = types.identifier(stateKey)
  const routerQueryParam = accessKeyOf(
    types.memberExpression(types.identifier('router'), types.identifier('query')),
    paramKey
  )
  const nextQueryParam = accessKeyOf(nextQuery, paramKey)

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
        nextQuery,
        types.objectExpression([
          types.spreadElement(
            types.memberExpression(types.identifier('router'), types.identifier('query'))
          ),
        ])
      ),
    ]),
    // if (state === '' || state == null) { delete __nextQuery.key } else { __nextQuery.key = String(state) }
    types.ifStatement(
      types.logicalExpression(
        '||',
        types.binaryExpression('===', stateId, types.stringLiteral('')),
        types.binaryExpression('==', stateId, types.nullLiteral())
      ),
      types.blockStatement([
        types.expressionStatement(
          types.unaryExpression('delete', nextQueryParam) as unknown as types.Expression
        ),
      ]),
      types.blockStatement([
        types.expressionStatement(
          types.assignmentExpression(
            '=',
            nextQueryParam,
            types.callExpression(types.identifier('String'), [stateId])
          )
        ),
      ])
    ),
    // if (__nextQuery.key === router.query.key) return
    types.ifStatement(
      types.binaryExpression('===', nextQueryParam, routerQueryParam),
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
            types.objectProperty(types.identifier('query'), nextQuery),
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
        stateId,
        types.memberExpression(types.identifier('router'), types.identifier('isReady')),
      ]),
    ])
  )
}

// Builds the URL→state read-back useEffect for a single state def. Emitted
// shape (for `selectedCategory` bound to URL key `categoryFilter`):
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
// - On `<Link>` or `router.push` shallow navigations that land on the same
//   path with a different query (or browser back/forward, which can change
//   the query without remounting the page), `router.query` updates but the
//   state hook does not. Without this effect, the list filter would be
//   stuck on whatever the user last picked even though the URL has moved on.
// - The functional `setState((prev) => prev === next ? prev : next)` form
//   guarantees React bails out when the URL value matches state, which
//   prevents an infinite write-back ↔ read-back loop: when the user picks a
//   new category, state→URL fires once, URL→state observes the matching
//   value and returns `prev`, so React doesn't re-render or fire any deps.
// - `router.query[key]` can be either `string` (single value) or `string[]`
//   (when the URL has duplicate keys) per Next.js's typings; the helper
//   normalizes both to a string before comparing, defaulting to `''` for the
//   missing-key case so the comparison aligns with the write-back's
//   `state === ''` empty-check.
const buildUrlReadBackEffect = (stateKey: string, paramKey: string): types.ExpressionStatement => {
  const setterName = StringUtils.createStateStoringFunction(stateKey)
  const urlValueId = types.identifier('__urlValue')
  const nextValueId = types.identifier('__nextValue')
  const prevParam = types.identifier('prev')
  const routerQueryParam = accessKeyOf(
    types.memberExpression(types.identifier('router'), types.identifier('query')),
    paramKey
  )

  const normalizeArg = types.conditionalExpression(
    // typeof __urlValue === 'string' ? __urlValue
    types.binaryExpression(
      '===',
      types.unaryExpression('typeof', urlValueId),
      types.stringLiteral('string')
    ),
    urlValueId,
    types.conditionalExpression(
      // Array.isArray(__urlValue) ? (__urlValue[0] || '') : ''
      types.callExpression(
        types.memberExpression(types.identifier('Array'), types.identifier('isArray')),
        [urlValueId]
      ),
      types.logicalExpression(
        '||',
        types.memberExpression(urlValueId, types.numericLiteral(0), true),
        types.stringLiteral('')
      ),
      types.stringLiteral('')
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
    types.variableDeclaration('const', [types.variableDeclarator(urlValueId, routerQueryParam)]),
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
        routerQueryParam,
        types.memberExpression(types.identifier('router'), types.identifier('isReady')),
      ]),
    ])
  )
}

// Collect state keys that need URL write-back. Accepts the raw
// stateDefinitions record (page-level state defs are merged into the
// component UIDL by the project generator before plugins run, so this same
// key reads correctly for both component- and page-level plugins).
//
// Dedupes by URL paramKey: if the GUI ever ships a UIDL where two state defs
// bind to the same URL key (an unusual but possible configuration), only the
// first wins. Emitting two effects writing to the same URL key would create
// a "ping-pong" race where each setter's write-back overwrites the other on
// every render — far worse than just dropping the second binding.
const collectUrlBoundStateKeys = (
  stateDefinitions: Record<string, UIDLStateDefinition> | undefined
): Array<{ stateKey: string; paramKey: string }> => {
  if (!stateDefinitions) {
    return []
  }
  const seenParamKeys = new Set<string>()
  const entries: Array<{ stateKey: string; paramKey: string }> = []
  for (const [rawKey, def] of Object.entries(stateDefinitions)) {
    const binding = def.urlSearchParamBinding
    if (!binding || typeof binding.key !== 'string' || binding.key === '') {
      continue
    }
    if (seenParamKeys.has(binding.key)) {
      continue
    }
    seenParamKeys.add(binding.key)
    // Mirror createStateHookAST which uses the storing-function helper to
    // derive identifier-safe state names — the raw key from UIDL is already
    // identifier-safe by GUI contract, but normalize to keep parity with the
    // hook emission.
    const stateKey = StringUtils.createStateOrPropStoringValue(rawKey) || rawKey
    entries.push({ stateKey, paramKey: binding.key })
  }
  return entries
}

/**
 * Registers the `useRouter` dependency and injects `const router = useRouter()`
 * at the top of the component body whenever the UIDL declares page-level URL
 * search params that downstream dynamic references consume — i.e.
 * `uidl.searchParams` driving `referenceType: 'urlSearchParams'` bindings,
 * already handled by `buildNextJsUrlSearchParamsPrelude` /
 * `createDynamicValueExpression`.
 *
 * Also handles state-level `urlSearchParamBinding` by emitting two paired
 * `useEffect`s per such state:
 *
 *   1. **Write-back** (state → URL): when the user picks a new value, push
 *      it onto the URL via `router.replace(..., { shallow: true })`. Empty
 *      / null state deletes the key entirely so the URL doesn't keep a
 *      sticky `?key=` empty param.
 *   2. **Read-back** (URL → state): when the URL changes without the page
 *      remounting (shallow `router.push`, browser back/forward), sync the
 *      state to match. The functional setter form (`prev => prev === next
 *      ? prev : next`) prevents an infinite loop with the write-back effect.
 *
 * Without write-back the initial read (`createStateHookAST` →
 * `window.location.search`) hydrates the state on load, but user-driven
 * changes never propagate to the URL bar and cross-page deep links built
 * off the URL break. Without read-back the state goes stale on shallow
 * navigations that change the URL but keep the page mounted.
 *
 * Runs AFTER `createReactComponentPlugin` (so the component chunk exists)
 * and is idempotent with the internationalization plugin, which may have
 * already set `dependencies.useRouter` and emitted the same declaration.
 */
export const createNextUrlSearchParamsPlugin = (): ComponentPlugin => {
  const plugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure

    const hasSearchParams = !!uidl.searchParams && uidl.searchParams.length > 0
    const urlBoundStateKeys = collectUrlBoundStateKeys(uidl.stateDefinitions)

    if (!hasSearchParams && urlBoundStateKeys.length === 0) {
      return structure
    }

    const componentChunk = chunks.find((chunk) => chunk.name === REACT_COMPONENT_CHUNK_NAME)
    if (!componentChunk) {
      return structure
    }

    const declaration = componentChunk.content as types.VariableDeclaration
    const declarator = declaration.declarations[0] as types.VariableDeclarator
    const arrow = declarator.init as types.ArrowFunctionExpression
    const body = arrow.body as types.BlockStatement

    if (!dependencies.useRouter) {
      dependencies.useRouter = { ...USE_ROUTER_HOOK }
    }
    if (!hasUseRouterDeclaration(body.body)) {
      body.body.unshift(
        types.variableDeclaration('const', [
          types.variableDeclarator(
            types.identifier('router'),
            types.callExpression(types.identifier('useRouter'), [])
          ),
        ])
      )
    }

    if (urlBoundStateKeys.length > 0) {
      if (!dependencies.useEffect) {
        dependencies.useEffect = { ...USE_EFFECT_DEPENDENCY }
      }

      // Insert each pair of effects just before the return statement so they
      // run after every hook the rest of the body declares — keeping the
      // React hooks-order contract intact regardless of how many
      // useState/useRef/useEffect declarations came before them.
      //
      // The idempotency markers combine TWO signals so an unrelated effect
      // that happens to watch the same state or query key — added by a
      // future plugin — does not silently suppress write-back / read-back
      // emission.
      //   • Write-back match: deps contain `stateKey` AND body contains
      //     `router.replace(...)`.
      //   • Read-back match:  deps contain `router.query[paramKey]` AND
      //     body calls the state setter directly.
      const effectsToInsert: types.Statement[] = []
      for (const { stateKey, paramKey } of urlBoundStateKeys) {
        const setterName = StringUtils.createStateStoringFunction(stateKey)
        const hasWriteBack = hasUseEffectMatching(
          body.body,
          (deps, fn) => effectDepsContainStateId(deps, stateKey) && effectBodyHasRouterReplace(fn)
        )
        if (!hasWriteBack) {
          effectsToInsert.push(buildUrlWriteBackEffect(stateKey, paramKey))
        }

        const hasReadBack = hasUseEffectMatching(
          body.body,
          (deps, fn) =>
            effectDepsContainRouterQueryKey(deps, paramKey) && effectBodyCallsSetter(fn, setterName)
        )
        if (!hasReadBack) {
          effectsToInsert.push(buildUrlReadBackEffect(stateKey, paramKey))
        }
      }

      if (effectsToInsert.length > 0) {
        const returnIndex = body.body.findIndex((s) => s.type === 'ReturnStatement')
        const insertionIndex = returnIndex === -1 ? body.body.length : returnIndex
        body.body.splice(insertionIndex, 0, ...effectsToInsert)
      }
    }

    return structure
  }

  return plugin
}
