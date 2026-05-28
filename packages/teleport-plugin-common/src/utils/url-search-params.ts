import * as types from '@babel/types'
import type { UIDLSearchParamsDefinition } from '@teleporthq/teleport-types'

/**
 * Builds the Next.js-style prelude nodes for a page that declares URL search
 * params. Emits:
 *
 *   const router = useRouter()
 *
 * The returned `registry` carries per-key defaults so `createDynamicValueExpression`
 * can fall back to the declared default via `router?.query?.<key> ?? '<default>'`.
 */
export const buildNextJsUrlSearchParamsPrelude = (
  searchParams: UIDLSearchParamsDefinition | undefined
): {
  statements: types.Statement[]
  registry: Record<string, { defaultValue?: string }>
  prefixMap: Record<string, string>
} => {
  if (!searchParams || searchParams.length === 0) {
    return { statements: [], registry: {}, prefixMap: {} }
  }
  const registry: Record<string, { defaultValue?: string }> = {}
  for (const entry of searchParams) {
    registry[entry.key] = {
      defaultValue: entry.defaultValue,
    }
  }
  // const router = useRouter()
  const routerDecl = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('router'),
      types.callExpression(types.identifier('useRouter'), [])
    ),
  ])
  return {
    statements: [routerDecl],
    registry,
    prefixMap: { urlSearchParams: 'router.query' },
  }
}

/**
 * Builds the static-export prelude for a page that declares URL search params.
 * Emits:
 *
 *   const __urlSearchParams =
 *     typeof window !== 'undefined'
 *       ? Object.fromEntries(new URLSearchParams(window.location.search).entries())
 *       : {}
 *   useEffect(() => {
 *     if (typeof window === 'undefined') return
 *     const handler = () =>
 *       setUrlSearchParams(
 *         Object.fromEntries(new URLSearchParams(window.location.search).entries())
 *       )
 *     window.addEventListener('popstate', handler)
 *     return () => window.removeEventListener('popstate', handler)
 *   }, [])
 *
 * For simplicity the snippet stays at the "read on mount" level — the listing
 * renders with the current query params. Implementations that want live
 * re-filtering on popstate can subscribe via the returned hook shape.
 */
export const buildStaticUrlSearchParamsPrelude = (
  searchParams: UIDLSearchParamsDefinition | undefined
): {
  statements: types.Statement[]
  registry: Record<string, { defaultValue?: string }>
  prefixMap: Record<string, string>
} => {
  if (!searchParams || searchParams.length === 0) {
    return { statements: [], registry: {}, prefixMap: {} }
  }
  const registry: Record<string, { defaultValue?: string }> = {}
  for (const entry of searchParams) {
    registry[entry.key] = {
      defaultValue: entry.defaultValue,
    }
  }
  // const __urlSearchParams = typeof window !== 'undefined'
  //   ? Object.fromEntries(new URLSearchParams(window.location.search).entries())
  //   : {}
  const decl = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('__urlSearchParams'),
      types.conditionalExpression(
        types.binaryExpression(
          '!==',
          types.unaryExpression('typeof', types.identifier('window')),
          types.stringLiteral('undefined')
        ),
        types.callExpression(
          types.memberExpression(types.identifier('Object'), types.identifier('fromEntries')),
          [
            types.callExpression(
              types.memberExpression(
                types.newExpression(types.identifier('URLSearchParams'), [
                  types.memberExpression(
                    types.memberExpression(
                      types.identifier('window'),
                      types.identifier('location')
                    ),
                    types.identifier('search')
                  ),
                ]),
                types.identifier('entries')
              ),
              []
            ),
          ]
        ),
        types.objectExpression([])
      )
    ),
  ])
  return {
    statements: [decl],
    registry,
    prefixMap: { urlSearchParams: '__urlSearchParams' },
  }
}
