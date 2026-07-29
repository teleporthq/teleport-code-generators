import { UIDLAuthentication } from '@teleporthq/teleport-types'
import { generateMiddlewareFile } from '../../src/auth-generator'

/**
 * Loads the middleware `generateMiddlewareFile` emits and runs it against a
 * synthetic request, so tests can assert on BEHAVIOUR ("does a guest reach
 * /orders/ORD-42?") instead of grepping the generated source.
 *
 * The emitted file is an ES module that imports `next/server` and
 * `next-auth/jwt`; neither is installed in this package, so the loader strips
 * the module boundary and injects the pieces the middleware actually uses.
 * `getToken` always resolves to `null` — the generated code then falls back to
 * cookie presence plus `/api/auth/session`, which the fetch stub answers, so
 * both the authenticated and the anonymous path stay exercisable.
 */

export interface MiddlewareResult {
  kind: 'next' | 'redirect'
  /** Only set for `kind: 'redirect'`. */
  location?: string
}

export interface MiddlewareSessionUser {
  id?: string
  role?: string
}

export interface MiddlewareRequestOptions {
  /** Session user the stubbed `/api/auth/session` returns; omit for a guest. */
  sessionUser?: MiddlewareSessionUser | null
  origin?: string
}

interface RawMiddlewareResult {
  __kind: 'next' | 'redirect'
  __location?: string
}

type MiddlewareFn = (request: unknown) => Promise<RawMiddlewareResult>

type MiddlewareFactory = (
  nextResponse: unknown,
  getToken: unknown,
  fetchImpl: unknown
) => MiddlewareFn

const stripModuleSyntax = (code: string): string =>
  code
    .replace("import { NextResponse } from 'next/server';", '')
    .replace("import { getToken } from 'next-auth/jwt';", '')
    .replace('export default middleware;', '')
    .replace('export const config = {', 'const config = {')

/**
 * The route table the generated middleware gates on. Parsed out of the emitted
 * source so assertions can target the actual map instead of substring-matching
 * a file that also contains comments and the self-guarded route list.
 */
export const extractProtectedRoutes = (
  code: string
): Record<string, { requiresAuth: boolean; allowedRoles: string[] }> => {
  // Non-greedy up to the first `};`. `JSON.stringify(…, null, 2)` never emits
  // that sequence inside the object, so the first hit is the real terminator —
  // and the empty-map case (`= {};`) is covered by the same pattern.
  const match = code.match(/const protectedRoutes = (\{[\s\S]*?\});/)
  if (!match) {
    throw new Error('generated middleware has no protectedRoutes declaration')
  }
  return JSON.parse(match[1])
}

/** Route patterns whose page-load SQL is the access control. */
export const extractSelfGuardedRoutes = (code: string): string[] => {
  const match = code.match(/const selfGuardedRoutes = (\[[\s\S]*?\]);/)
  if (!match) {
    throw new Error('generated middleware has no selfGuardedRoutes declaration')
  }
  return JSON.parse(match[1])
}

const NEXT_RESPONSE_STUB = {
  next: (): RawMiddlewareResult => ({ __kind: 'next' }),
  redirect: (url: URL): RawMiddlewareResult => ({
    __kind: 'redirect',
    __location: String(url),
  }),
}

/**
 * Compiles the middleware once for an auth config. Reuse the returned function
 * across requests in a test to avoid re-generating the file per assertion.
 */
export const compileGeneratedMiddleware = (auth: UIDLAuthentication) => {
  const factory = new Function(
    'NextResponse',
    'getToken',
    'fetch',
    `${stripModuleSyntax(generateMiddlewareFile(auth))}; return middleware;`
  ) as unknown as MiddlewareFactory

  return async (
    pathname: string,
    options: MiddlewareRequestOptions = {}
  ): Promise<MiddlewareResult> => {
    const origin = options.origin || 'https://shop.test'
    const sessionUser = options.sessionUser ?? null
    const cookieHeader = sessionUser ? 'next-auth.session-token=stub' : ''

    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ user: sessionUser }),
    })

    const getTokenStub = async (): Promise<null> => null
    const middleware = factory(NEXT_RESPONSE_STUB, getTokenStub, fetchImpl)
    const result = await middleware({
      nextUrl: { pathname },
      url: `${origin}${pathname}`,
      cookies: {
        get: (name: string) =>
          sessionUser && name === 'next-auth.session-token' ? { name, value: 'stub' } : undefined,
      },
      headers: { get: (name: string) => (name === 'cookie' ? cookieHeader : '') },
    })

    return result.__kind === 'redirect'
      ? { kind: 'redirect', location: result.__location }
      : { kind: 'next' }
  }
}
