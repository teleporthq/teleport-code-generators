import {
  generateSessionTokenResolverCode,
  generateCommonJsSessionTokenResolverCode,
} from '../src/session-cookie-resolver'
import { generateWorkflowAuthHelperFile } from '../src/workflow-auth-generator'
import { generateDataAPIRoute } from '../src/data-api-route-generator'
import { generateAccountDeleteRoute } from '../src/account-delete-route-generator'
import { generateMiddlewareFile } from '../src/auth-generator'

/**
 * "Failed to load dashboard data. Please refresh." on a signed-in user's home
 * page.
 *
 * ## ⛔ THE REPORTED DEFECT
 *
 * A published project answered 401 `Unauthenticated` from its page-load
 * workflow while `/api/auth/session` on the SAME page resolved the same user.
 * Measured on the live deployment: 50 concurrent POSTs to one workflow route
 * returned 33 × 401 and 17 × 200; 40 concurrent `/api/auth/session` calls
 * returned the user 40/40.
 *
 * next-auth v4 picks the session cookie name from an env var:
 *
 * ```js
 * secureCookie = process.env.NEXTAUTH_URL?.startsWith('https://') ?? !!process.env.VERCEL
 * cookieName   = secureCookie ? '__Secure-next-auth.session-token' : 'next-auth.session-token'
 * ```
 *
 * A generated project ships `NEXTAUTH_URL=http://localhost:3000` and repairs it
 * from the request inside `/api/auth/[...nextauth]` only — process-locally. So
 * every serverless instance that had not served an auth request first looked for
 * the NON-secure cookie on an https deployment, found nothing, and reported a
 * signed-in caller as anonymous. Hence the coin flip.
 *
 * These tests boot the emitted resolver against a `getToken` that behaves like
 * the real one — it returns a token only when asked for the cookie the request
 * actually carries.
 */

interface ResolverModule {
  __tqCookieNamesPresent(req: unknown): Record<string, true>
  __tqRequestIsSecure(req: unknown): boolean
  __tqSessionTokenCandidates(req: unknown): Array<{ cookieName?: string; secureCookie: boolean }>
  __tqResolveSessionToken(
    getToken: unknown,
    req: unknown,
    secret: string | undefined
  ): Promise<unknown>
  __tqSessionToken(req: unknown): Promise<unknown>
}

const EXPORTS =
  '\n;module.exports = { __tqCookieNamesPresent: __tqCookieNamesPresent,' +
  ' __tqRequestIsSecure: __tqRequestIsSecure,' +
  ' __tqSessionTokenCandidates: __tqSessionTokenCandidates,' +
  ' __tqResolveSessionToken: __tqResolveSessionToken };\n'

const CJS_EXPORTS = EXPORTS.replace(
  '__tqResolveSessionToken: __tqResolveSessionToken }',
  '__tqResolveSessionToken: __tqResolveSessionToken, __tqSessionToken: __tqSessionToken }'
)

/** Boots the emitted snippet in isolation and hands back its helpers. */
function bootResolver(): ResolverModule {
  const moduleObj: { exports: Partial<ResolverModule> } = { exports: {} }
  // tslint:disable-next-line:function-constructor
  new Function('module', 'exports', generateSessionTokenResolverCode() + EXPORTS)(
    moduleObj,
    moduleObj.exports
  )
  return moduleObj.exports as ResolverModule
}

/** Boots the CommonJS variant, with `next-auth/jwt` and `process.env` stubbed. */
function bootCommonJsResolver(params: {
  secret?: string
  getToken?: unknown
  nextAuthPresent?: boolean
}): ResolverModule {
  const moduleObj: { exports: Partial<ResolverModule> } = { exports: {} }
  const fakeRequire = (name: string): unknown => {
    if (name === 'next-auth/jwt') {
      if (params.nextAuthPresent === false) {
        throw new Error("Cannot find module 'next-auth/jwt'")
      }
      return { getToken: params.getToken }
    }
    throw new Error(`unexpected require(${name})`)
  }
  // tslint:disable-next-line:function-constructor
  new Function(
    'require',
    'module',
    'exports',
    'process',
    generateCommonJsSessionTokenResolverCode() + CJS_EXPORTS
  )(fakeRequire, moduleObj, moduleObj.exports, { env: { NEXTAUTH_SECRET: params.secret } })
  return moduleObj.exports as ResolverModule
}

/**
 * A `getToken` that behaves like next-auth's: it only returns the session when
 * asked for the cookie name the request is actually carrying. `undefined`
 * cookieName falls back to next-auth's own env-derived default, which is the
 * behaviour this fix exists to stop relying on.
 */
function realisticGetToken(envDerivedDefault: string) {
  return async (params: { req: { headers?: Record<string, string> }; cookieName?: string }) => {
    const asked = params.cookieName || envDerivedDefault
    const raw = (params.req && params.req.headers && params.req.headers.cookie) || ''
    const names = raw.split(';').map((part) => part.split('=')[0].trim())
    return names.indexOf(asked) !== -1 ? { id: 'user-1', sub: 'user-1' } : null
  }
}

const httpsReq = (cookie: string) => ({
  headers: { cookie, 'x-forwarded-proto': 'https' },
})

describe('the emitted session-cookie resolver', () => {
  const resolver = bootResolver()

  describe('__tqCookieNamesPresent', () => {
    it('does not report the plain cookie as present when only the secure one is', () => {
      // The whole defect in one assertion: "next-auth.session-token" is a
      // SUBSTRING of "__Secure-next-auth.session-token", so a naive indexOf
      // reports both and getToken then decodes a cookie that is not there.
      const present = resolver.__tqCookieNamesPresent({
        headers: { cookie: '__Secure-next-auth.session-token=abc; other=1' },
      })
      expect(present['__Secure-next-auth.session-token']).toBe(true)
      expect(present['next-auth.session-token']).toBeUndefined()
    })

    it('reads a chunked cookie by its .0 head', () => {
      const present = resolver.__tqCookieNamesPresent({
        headers: {
          cookie: '__Secure-next-auth.session-token.0=a; __Secure-next-auth.session-token.1=b',
        },
      })
      expect(present['__Secure-next-auth.session-token.0']).toBe(true)
    })

    it('reads an Edge Headers object and a parsed cookie jar', () => {
      const edge = {
        headers: { get: (n: string) => (n === 'cookie' ? 'authjs.session-token=z' : null) },
        cookies: { getAll: () => [{ name: 'authjs.session-token', value: 'z' }] },
      }
      expect(resolver.__tqCookieNamesPresent(edge)['authjs.session-token']).toBe(true)
    })

    it('never throws on a malformed or absent request', () => {
      for (const req of [undefined, null, {}, { headers: null }, { headers: { cookie: 42 } }]) {
        expect(() => resolver.__tqCookieNamesPresent(req)).not.toThrow()
      }
    })
  })

  describe('__tqRequestIsSecure', () => {
    it('reads x-forwarded-proto, taking the client-facing hop of a proxy chain', () => {
      expect(resolver.__tqRequestIsSecure({ headers: { 'x-forwarded-proto': 'https' } })).toBe(true)
      expect(resolver.__tqRequestIsSecure({ headers: { 'x-forwarded-proto': 'https,http' } })).toBe(
        true
      )
      expect(resolver.__tqRequestIsSecure({ headers: { 'x-forwarded-proto': 'http' } })).toBe(false)
    })

    it('reads an array-valued header, an Edge nextUrl, and an encrypted socket', () => {
      expect(resolver.__tqRequestIsSecure({ headers: { 'x-forwarded-proto': ['https'] } })).toBe(
        true
      )
      expect(resolver.__tqRequestIsSecure({ headers: {}, nextUrl: { protocol: 'https:' } })).toBe(
        true
      )
      expect(resolver.__tqRequestIsSecure({ headers: {}, socket: { encrypted: true } })).toBe(true)
    })

    it('is false — never "unknown" — for a plain local request', () => {
      expect(resolver.__tqRequestIsSecure({ headers: {} })).toBe(false)
      expect(resolver.__tqRequestIsSecure(undefined)).toBe(false)
    })
  })

  describe('__tqSessionTokenCandidates', () => {
    it('names the secure cookie the https request is actually carrying', () => {
      expect(
        resolver.__tqSessionTokenCandidates(httpsReq('__Secure-next-auth.session-token=abc'))
      ).toEqual([{ cookieName: '__Secure-next-auth.session-token', secureCookie: true }])
    })

    it('names the plain cookie on a local http request', () => {
      expect(
        resolver.__tqSessionTokenCandidates({
          headers: { cookie: 'next-auth.session-token=abc' },
        })
      ).toEqual([{ cookieName: 'next-auth.session-token', secureCookie: false }])
    })

    it('tries the protocol-matching cookie FIRST when a site carries both', () => {
      const both = httpsReq('next-auth.session-token=old; __Secure-next-auth.session-token=new')
      expect(resolver.__tqSessionTokenCandidates(both)[0]).toEqual({
        cookieName: '__Secure-next-auth.session-token',
        secureCookie: true,
      })
    })

    it('recognises the Auth.js cookie names too', () => {
      expect(
        resolver.__tqSessionTokenCandidates(httpsReq('__Secure-authjs.session-token=abc'))
      ).toEqual([{ cookieName: '__Secure-authjs.session-token', secureCookie: true }])
    })

    it('falls back to the request protocol when no known cookie is present', () => {
      // A project may configure a custom cookie name in authOptions; letting
      // getToken apply its own defaults is the only correct answer there — but
      // with the REQUEST's protocol, not a localhost env var.
      expect(resolver.__tqSessionTokenCandidates(httpsReq('unrelated=1'))).toEqual([
        { secureCookie: true },
      ])
      expect(resolver.__tqSessionTokenCandidates({ headers: {} })).toEqual([
        { secureCookie: false },
      ])
    })
  })

  describe('__tqResolveSessionToken', () => {
    it('THE DEFECT: resolves the session that the env-derived default would miss', async () => {
      // Exactly the deployed setup: browser holds the secure cookie, the lambda
      // holds NEXTAUTH_URL=http://localhost:3000 so next-auth's own default is
      // the plain name.
      const getToken = realisticGetToken('next-auth.session-token')
      const req = httpsReq('__Secure-next-auth.session-token=abc')

      // What the old code did — one call, no cookieName — still returns null…
      expect(await getToken({ req } as never)).toBeNull()
      // …and the resolver finds the session.
      expect(await resolver.__tqResolveSessionToken(getToken, req, 'secret')).toEqual({
        id: 'user-1',
        sub: 'user-1',
      })
    })

    it('still resolves on plain http, where the old default happened to be right', async () => {
      const getToken = realisticGetToken('next-auth.session-token')
      const req = { headers: { cookie: 'next-auth.session-token=abc' } }
      expect(await resolver.__tqResolveSessionToken(getToken, req, 'secret')).toEqual({
        id: 'user-1',
        sub: 'user-1',
      })
    })

    it('returns null for a genuinely anonymous caller', async () => {
      const getToken = realisticGetToken('next-auth.session-token')
      expect(await resolver.__tqResolveSessionToken(getToken, httpsReq(''), 'secret')).toBeNull()
    })

    it('tries the other cookie when the first candidate does not decode', async () => {
      // A site reached over both protocols: the stale plain cookie is present
      // but only the secure one decodes.
      const getToken = realisticGetToken('next-auth.session-token')
      const req = {
        headers: {
          cookie: 'next-auth.session-token=stale; __Secure-next-auth.session-token=live',
          'x-forwarded-proto': 'http',
        },
      }
      expect(await resolver.__tqResolveSessionToken(getToken, req, 'secret')).toEqual({
        id: 'user-1',
        sub: 'user-1',
      })
    })

    it('returns null rather than throwing when getToken throws', async () => {
      const throwing = async () => {
        throw new Error('JWEDecryptionFailed')
      }
      await expect(
        resolver.__tqResolveSessionToken(
          throwing,
          httpsReq('__Secure-next-auth.session-token=a'),
          'secret'
        )
      ).resolves.toBeNull()
    })

    it('returns null without calling getToken when there is no secret', async () => {
      const getToken = jest.fn()
      expect(await resolver.__tqResolveSessionToken(getToken, httpsReq('x=1'), '')).toBeNull()
      expect(getToken).not.toHaveBeenCalled()
    })

    it('returns null when getToken is not a function', async () => {
      expect(await resolver.__tqResolveSessionToken(null, httpsReq('x=1'), 'secret')).toBeNull()
    })
  })

  describe('the CommonJS wrapper', () => {
    it('reads NEXTAUTH_SECRET itself and resolves the secure cookie', async () => {
      const cjs = bootCommonJsResolver({
        secret: 'server-secret',
        getToken: realisticGetToken('next-auth.session-token'),
      })
      expect(await cjs.__tqSessionToken(httpsReq('__Secure-next-auth.session-token=abc'))).toEqual({
        id: 'user-1',
        sub: 'user-1',
      })
    })

    it('is null when NEXTAUTH_SECRET is unset', async () => {
      const cjs = bootCommonJsResolver({
        getToken: realisticGetToken('next-auth.session-token'),
      })
      expect(
        await cjs.__tqSessionToken(httpsReq('__Secure-next-auth.session-token=abc'))
      ).toBeNull()
    })

    it('is null — not a crash — for a project generated without next-auth', async () => {
      const cjs = bootCommonJsResolver({ secret: 'server-secret', nextAuthPresent: false })
      await expect(
        cjs.__tqSessionToken(httpsReq('__Secure-next-auth.session-token=abc'))
      ).resolves.toBeNull()
    })
  })
})

describe('every generated route that reads a session uses the resolver', () => {
  const usesResolver = (code: string) => {
    expect(code).toContain('__tqResolveSessionToken')
    // The env-derived default is what produced the 401 — no route may call
    // getToken without naming the cookie.
    expect(code).not.toMatch(/getToken\(\{\s*req/)
  }

  it('the workflow auth guard', () => {
    usesResolver(generateWorkflowAuthHelperFile())
  })

  it('the data API route, when it guards the auth users table', () => {
    const code = generateDataAPIRoute({ authUsersTableName: 'users' })
    usesResolver(code)
    expect(code).toContain('__tqSessionToken(req)')
  })

  it('the data API route emits no resolver when there is no users table to guard', () => {
    const code = generateDataAPIRoute({})
    expect(code).not.toContain('__tqResolveSessionToken')
    expect(code).not.toContain("require('next-auth/jwt')")
  })

  it('the account-delete route', () => {
    usesResolver(generateAccountDeleteRoute({ authUsersTableName: 'users' }))
  })
})

/**
 * ⛔ THE SNIPPET IS INLINED INTO FILES OF THREE DIFFERENT SHAPES — a CommonJS
 * route, an ESM middleware, and an `export default` API route. A syntax error in
 * it would not surface until a project failed to build, so every emitted file is
 * parsed here.
 */
/** The smallest authentication config that produces a protected route. */
const MIDDLEWARE_AUTH = {
  enabled: true,
  dataSourceId: 'ds-1',
  dataSourceType: 'postgres',
  passwordAuthEnabled: true,
  providers: [],
  roles: ['admin'],
  tables: {},
  folderProtection: {},
  authPages: {
    signIn: { pageId: 'sign-in', pageName: 'sign-in', route: '/sign-in' },
    signUp: { pageId: 'sign-up', pageName: 'sign-up', route: '/sign-up' },
  },
  callbackBaseUrl: '',
  envKeys: {},
  customUserProperties: [],
  pageProtection: {
    HOME: { requiresAuth: true, allowedRoles: [], pageName: 'Dashboard', route: '/' },
  },
} as never

describe('every file the resolver is inlined into still parses', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { parse } = require('@babel/parser')
  const parses = (code: string) =>
    parse(code, { sourceType: 'unambiguous', allowReturnOutsideFunction: true })

  it('the shared snippet, on its own', () => {
    expect(() => parses(generateSessionTokenResolverCode())).not.toThrow()
    expect(() => parses(generateCommonJsSessionTokenResolverCode())).not.toThrow()
  })

  it('the workflow auth guard (CommonJS)', () => {
    expect(() => parses(generateWorkflowAuthHelperFile())).not.toThrow()
  })

  it('the data API route (CommonJS)', () => {
    expect(() => parses(generateDataAPIRoute({ authUsersTableName: 'users' }))).not.toThrow()
  })

  it('the account-delete route (CommonJS)', () => {
    expect(() => parses(generateAccountDeleteRoute({ authUsersTableName: 'users' }))).not.toThrow()
  })

  it('the auth middleware (ESM, Edge runtime)', () => {
    const code = generateMiddlewareFile(MIDDLEWARE_AUTH)
    expect(() => parses(code)).not.toThrow()
    expect(code).toContain('__tqResolveSessionToken(getToken, request, secret)')
  })
})
