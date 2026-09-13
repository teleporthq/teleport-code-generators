import * as types from '@babel/types'
import { UIDLDependency } from '@teleporthq/teleport-types'
import { GenericUtils } from '@teleporthq/teleport-shared'
import { ResolvedDataSourceCache } from './types'

/** Identifiers the emitted page imports from `utils/tq-cache/client`. */
export const CACHE_CLIENT_IMPORTS = [
  'tqCacheKey',
  'tqCacheGet',
  'tqCacheSet',
  'tqCacheSetVersion',
  'tqMarkHydrated',
  'tqCacheRevalidate',
]

/** Local identifiers used inside the generated `fetchData` body. */
const KEY_VAR = '__tqKey'
const HIT_VAR = '__tqHit'

export const cachedValueVarFor = (index: number): string => `ds_${index}_cached`

/**
 * Registers the client runtime's named imports on the page.
 *
 * Each identifier is its own dependency entry because that is how the
 * import-statements plugin keys them; they share one path, so they collapse
 * into a single `import { … } from '…/utils/tq-cache/client'`.
 */
export const registerCacheClientImports = (
  dependencies: Record<string, UIDLDependency>,
  folderPath: string[] | undefined
): void => {
  const path = `${GenericUtils.generatePageToRootPrefix({ folderPath })}utils/tq-cache/client`

  CACHE_CLIENT_IMPORTS.forEach((identifier) => {
    if (!dependencies[identifier]) {
      dependencies[identifier] = {
        type: 'local',
        path,
        meta: { namedImport: true },
      }
    }
  })
}

/**
 * `const __tqKey = tqCacheKey(params)` +
 * `const __tqHit = tqCacheGet(SCOPE, __tqKey)` +
 * `if (__tqHit !== undefined) return Promise.resolve(__tqHit)`
 *
 * The early return is what keeps a hit from ever touching the network — and,
 * just as importantly, from raising the in-flight flag that would paint the
 * loading slot. `loading-state` deliberately attaches its bookkeeping to the
 * network chain BELOW this, never to the `Promise.resolve`.
 */
const buildCachePeekPreamble = (scope: string): types.Statement[] => [
  types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier(KEY_VAR),
      types.callExpression(types.identifier('tqCacheKey'), [types.identifier('params')])
    ),
  ]),
  types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier(HIT_VAR),
      types.callExpression(types.identifier('tqCacheGet'), [
        types.stringLiteral(scope),
        types.identifier(KEY_VAR),
      ])
    ),
  ]),
  types.ifStatement(
    types.binaryExpression('!==', types.identifier(HIT_VAR), types.identifier('undefined')),
    types.blockStatement([
      types.returnStatement(
        types.callExpression(
          types.memberExpression(types.identifier('Promise'), types.identifier('resolve')),
          [types.identifier(HIT_VAR)]
        )
      ),
    ])
  ),
]

/**
 * The terminal `.then` of a cached fetch: record the version the server
 * answered with (which purges the scope if it moved) and store the rows.
 *
 * `tqCacheSet` returns the value it was given, so the promise still resolves to
 * exactly what the uncached chain resolved to — `response?.data`.
 */
export const buildCacheStoreThen = (
  cache: ResolvedDataSourceCache
): types.ArrowFunctionExpression => {
  const responseData = types.optionalMemberExpression(
    types.identifier('response'),
    types.identifier('data'),
    false,
    true
  )
  const responseVersion = types.optionalMemberExpression(
    types.identifier('response'),
    types.identifier('version'),
    false,
    true
  )

  return types.arrowFunctionExpression(
    [types.identifier('response')],
    types.blockStatement([
      types.expressionStatement(
        types.callExpression(types.identifier('tqCacheSetVersion'), [
          types.stringLiteral(cache.scope),
          types.cloneNode(responseVersion, true),
        ])
      ),
      types.returnStatement(
        types.callExpression(types.identifier('tqCacheSet'), [
          types.stringLiteral(cache.scope),
          types.identifier(KEY_VAR),
          responseData,
          types.numericLiteral(cache.ttlSeconds),
          types.cloneNode(responseVersion, true),
        ])
      ),
    ])
  )
}

/** Wraps a network chain in the peek preamble, producing the cached body. */
export const buildCachedFetchBody = (
  networkChain: types.Expression,
  cache: ResolvedDataSourceCache
): types.BlockStatement =>
  types.blockStatement([
    ...buildCachePeekPreamble(cache.scope),
    types.returnStatement(networkChain),
  ])

/**
 * Finds the `return <fetch(...)…>` statement inside a cached `fetchData` body.
 *
 * Shared with `loading-state` so both modules agree on what "the network chain"
 * means: the body also contains an early `return Promise.resolve(hit)`, and
 * attaching in-flight bookkeeping to THAT would flip the loading flag on every
 * cache hit — the exact flash this feature exists to remove.
 */
export const findCachedFetchNetworkChain = (
  body: types.BlockStatement
): { statement: types.ReturnStatement; index: number } | undefined => {
  for (let index = body.body.length - 1; index >= 0; index--) {
    const statement = body.body[index]
    if (statement.type !== 'ReturnStatement' || !statement.argument) {
      continue
    }
    if (
      statement.argument.type === 'CallExpression' &&
      callChainStartsWithFetch(statement.argument)
    ) {
      return { statement, index }
    }
  }
  return undefined
}

const callChainStartsWithFetch = (expression: types.Expression): boolean => {
  let current: types.Expression = expression
  while (current.type === 'CallExpression') {
    const { callee } = current
    if (callee.type === 'Identifier' && callee.name === 'fetch') {
      return true
    }
    if (callee.type === 'MemberExpression') {
      current = callee.object as types.Expression
      continue
    }
    return false
  }
  return false
}

/**
 * Hoists a cached provider's `params` into a component const and adds the
 * synchronous cache peek beside it.
 *
 * The peek is what removes the loading flash on a page or search change: those
 * change the provider's `key`, so it REMOUNTS with `data: undefined` and paints
 * `renderLoading()` before any promise — even an already-resolved one — can
 * resume. Feeding a hit into `initialData` makes the provider skip its first
 * fetch entirely and paint the cached rows on the very first frame.
 *
 * `sticky` is set because this value is handed to a mounted provider: once it
 * has been, TTL expiry must not flip it back to `undefined`, or the list would
 * blank out without refetching (its `params` never changed).
 *
 * Reference identity comes from the runtime's own map, not from this `useMemo`
 * — the memo only keeps the peek from re-running on unrelated renders.
 */
export const buildCachedParamsDeclarations = (params: {
  index: number
  paramsMemo: types.Expression
  cache: ResolvedDataSourceCache
}): {
  declarations: types.Statement[]
  paramsIdentifier: string
  cachedIdentifier: string
} => {
  const paramsIdentifier = `ds_${params.index}_params`
  const cachedIdentifier = cachedValueVarFor(params.index)

  return {
    paramsIdentifier,
    cachedIdentifier,
    declarations: [
      types.variableDeclaration('const', [
        types.variableDeclarator(types.identifier(paramsIdentifier), params.paramsMemo),
      ]),
      types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier(cachedIdentifier),
          types.callExpression(types.identifier('useMemo'), [
            types.arrowFunctionExpression(
              [],
              types.callExpression(types.identifier('tqCacheGet'), [
                types.stringLiteral(params.cache.scope),
                types.callExpression(types.identifier('tqCacheKey'), [
                  types.identifier(paramsIdentifier),
                ]),
                types.objectExpression([
                  types.objectProperty(types.identifier('sticky'), types.booleanLiteral(true)),
                ]),
              ])
            ),
            types.arrayExpression([types.identifier(paramsIdentifier)]),
          ])
        ),
      ]),
    ],
  }
}

/**
 * `useEffect(() => { tqMarkHydrated(); tqCacheRevalidate([...]) }, [])`
 *
 * One effect per page, covering every scope on it in a single request. Flipping
 * the hydration latch here rather than at import time is what keeps the first
 * client render byte-identical to the server render.
 */
export const buildCacheHydrationEffect = (scopes: string[]): types.Statement =>
  types.expressionStatement(
    types.callExpression(types.identifier('useEffect'), [
      types.arrowFunctionExpression(
        [],
        types.blockStatement([
          types.expressionStatement(types.callExpression(types.identifier('tqMarkHydrated'), [])),
          types.expressionStatement(
            types.callExpression(types.identifier('tqCacheRevalidate'), [
              types.arrayExpression(scopes.map((scope) => types.stringLiteral(scope))),
            ])
          ),
        ])
      ),
      types.arrayExpression([]),
    ])
  )
