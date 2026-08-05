import * as types from '@babel/types'
import type {
  ComponentPlugin,
  UIDLDependency,
  UIDLStateDefinition,
} from '@teleporthq/teleport-types'
import { Constants, JSIdentifiers, StringUtils } from '@teleporthq/teleport-shared'
import { URLSearchParamSync } from '@teleporthq/teleport-plugin-common'
import { USE_ROUTER_HOOK } from './internationalization/locale-mapper-component'

// Matches the default name used by `createReactComponentPlugin` when adding
// its AST chunk to the structure. Hardcoded to the literal rather than
// imported so we avoid a cross-package dist path dependency.
const REACT_COMPONENT_CHUNK_NAME = 'jsx-component'

const USE_EFFECT_DEPENDENCY: UIDLDependency = Constants.USE_STATE_DEPENDENCY

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
): Array<{ stateKey: string; paramKey: string; defaultValue: string }> => {
  if (!stateDefinitions) {
    return []
  }
  const seenParamKeys = new Set<string>()
  const entries: Array<{ stateKey: string; paramKey: string; defaultValue: string }> = []
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
    // A non-empty STRING default (e.g. the sort dropdown's `name-asc`) is the
    // canonical value for a missing `?key=`. Threading it into the effects
    // makes the read-back resolve an absent key back to this default instead
    // of `''` — otherwise the default state is clobbered to `''` the instant
    // the router hydrates, causing an extra (unsorted) data fetch. Numbers /
    // booleans / arrays are never URL-bound defaults in practice and stay
    // empty here, preserving the pre-default byte-for-byte output.
    const defaultValue = typeof def.defaultValue === 'string' ? def.defaultValue : ''
    entries.push({ stateKey, paramKey: binding.key, defaultValue })
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
      for (const { stateKey, paramKey, defaultValue } of urlBoundStateKeys) {
        const setterName = StringUtils.createStateStoringFunction(stateKey)
        // The effects READ the state, so they must use the same binding
        // `createStateHookAST` declared — sanitised, because a UIDL state may
        // legally be named `class`. A no-op for every ordinary name.
        const stateBinding = JSIdentifiers.createSafeJSIdentifier(stateKey)
        // Only a non-empty default changes behavior; an empty default keeps
        // the effects byte-identical to the pre-default builder.
        const defaultValueExpr = defaultValue !== '' ? types.stringLiteral(defaultValue) : undefined
        const hasWriteBack = hasUseEffectMatching(
          body.body,
          (deps, fn) =>
            effectDepsContainStateId(deps, stateBinding) && effectBodyHasRouterReplace(fn)
        )
        if (!hasWriteBack) {
          // State dropdowns read AND depend on the same bare state identifier
          // (e.g. `selectedCategory`); the search input (pagination plugin)
          // passes a `ds_N_state.debouncedQuery` member expression instead.
          effectsToInsert.push(
            URLSearchParamSync.buildUrlWriteBackEffect(
              paramKey,
              types.identifier(stateBinding),
              types.identifier(stateBinding),
              defaultValueExpr
            )
          )
        }

        const hasReadBack = hasUseEffectMatching(
          body.body,
          (deps, fn) =>
            effectDepsContainRouterQueryKey(deps, paramKey) && effectBodyCallsSetter(fn, setterName)
        )
        if (!hasReadBack) {
          effectsToInsert.push(
            URLSearchParamSync.buildUrlReadBackEffect(paramKey, setterName, defaultValueExpr)
          )
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
