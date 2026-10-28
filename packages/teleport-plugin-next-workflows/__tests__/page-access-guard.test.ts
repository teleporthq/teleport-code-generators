import { generatePageAccessGuardModule } from '../src/page-access-guard-generator'

// `utils/auth/page-access.js` is EXECUTED here with a stubbed `next-auth/jwt`
// and a stubbed entitlement module: the server half of page protection is
// proven on behaviour. Without a session the page redirects to sign-in (in the
// visitor's language, keeping where they were going); a session without the
// role or the subscription gets a 404; every failure — no app secret, a
// database error, no entitlement query in the project — refuses.

const SESSION_COOKIE = '__Host-next-auth.session-token'

const baseAuth = (pageProtection: Record<string, unknown>): any => ({
  enabled: true,
  dataSourceId: null,
  dataSourceType: null,
  passwordAuthEnabled: true,
  providers: [],
  roles: ['admin', 'member'],
  tables: {},
  pageProtection,
  folderProtection: {},
  authPages: { signIn: { pageId: 'sign-in', pageName: 'sign-in', route: '/sign-in' } },
  callbackBaseUrl: '',
  envKeys: {},
  customUserProperties: [],
})

const ADMIN_PAGE = {
  dashboard: { requiresAuth: true, allowedRoles: ['admin'], pageName: 'd', route: '/dashboard' },
}
const MEMBERS_PAGE = {
  members: {
    requiresAuth: true,
    allowedRoles: [] as string[],
    pageName: 'm',
    route: '/members',
    requiresSubscription: true,
    subscriptionProductIds: ['prod-1'],
  },
}

interface Entitlement {
  entitled?: boolean
  throws?: boolean
  calls: Array<{ userId: string; productIds: string[] }>
}

const loadGuard = (
  auth: any,
  options: {
    token?: Record<string, unknown> | null
    secret?: string
    entitlement?: Entitlement
    revoked?: boolean
  }
) => {
  const { token = null, secret = 'app-secret', entitlement, revoked = false } = options
  const fakeRequire = (name: string): unknown => {
    // The shared reader's session-stamp check: see auth-password-security.test.ts.
    if (name === '../../utils/auth/session-revocation') {
      return { liveSessionToken: async (live: unknown) => (revoked ? null : live) }
    }
    if (name === 'next-auth/jwt') {
      return {
        getToken: async (params: { cookieName?: string; secret: string }) =>
          params.secret === secret && params.cookieName === SESSION_COOKIE ? token : null,
      }
    }
    if (name === './subscriber-access' && entitlement) {
      return {
        isSubscriberEntitled: async (userId: string, productIds: string[]) => {
          entitlement.calls.push({ userId, productIds })
          if (entitlement.throws) {
            throw new Error('connection refused')
          }
          return entitlement.entitled === true
        },
      }
    }
    throw new Error('unexpected require: ' + name)
  }
  const moduleObj: { exports: any } = { exports: {} }
  // tslint:disable-next-line:function-constructor
  new Function(
    'require',
    'module',
    'exports',
    'process',
    'console',
    generatePageAccessGuardModule(auth)
  )(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    { env: secret ? { NEXTAUTH_SECRET: secret } : {} },
    { error: (): void => undefined }
  )
  return moduleObj.exports.guardPageAccess as (context: any, policy: any) => Promise<any>
}

const contextFor = (
  resolvedUrl: string,
  options: { signedIn?: boolean; locale?: string; defaultLocale?: string } = {}
) => {
  const headers: Record<string, string> = {}
  return {
    req: {
      headers: {
        cookie: options.signedIn === false ? '' : `${SESSION_COOKIE}=jwe`,
        'x-forwarded-proto': 'https',
      },
      cookies: options.signedIn === false ? {} : { [SESSION_COOKIE]: 'jwe' },
    },
    res: { setHeader: (key: string, value: string) => (headers[key] = value) },
    resolvedUrl,
    locale: options.locale,
    defaultLocale: options.defaultLocale,
    headers,
  }
}

const ADMIN_POLICY = { requiresAuth: true, allowedRoles: ['admin'] }
const MEMBER_POLICY = {
  requiresAuth: true,
  allowedRoles: [] as string[],
  requiresSubscription: true,
  subscriptionProductIds: ['prod-1'],
}

describe('guardPageAccess (utils/auth/page-access.js)', () => {
  it('sends a visitor without a session to sign-in, keeping the page as callbackUrl', async () => {
    const guard = loadGuard(baseAuth(ADMIN_PAGE), { token: null })
    const context = contextFor('/dashboard?tab=2', { signedIn: false })

    expect(await guard(context, ADMIN_POLICY)).toEqual({
      redirect: { destination: '/sign-in?callbackUrl=%2Fdashboard', permanent: false },
    })
    expect(context.headers['Cache-Control']).toBe('private, no-store')
  })

  it('puts the visitor’s language back on the redirect', async () => {
    const guard = loadGuard(baseAuth(ADMIN_PAGE), { token: null })
    const context = contextFor('/dashboard', { signedIn: false, locale: 'es', defaultLocale: 'en' })

    expect((await guard(context, ADMIN_POLICY)).redirect.destination).toBe(
      '/es/sign-in?callbackUrl=%2Fes%2Fdashboard'
    )
  })

  it('never puts an off-site address in the callbackUrl', async () => {
    const guard = loadGuard(baseAuth(ADMIN_PAGE), { token: null })
    const context = contextFor('//evil.test/x', { signedIn: false })

    expect((await guard(context, ADMIN_POLICY)).redirect.destination).toBe(
      '/sign-in?callbackUrl=%2F'
    )
  })

  it('refuses every session when the app secret is missing', async () => {
    const guard = loadGuard(baseAuth(ADMIN_PAGE), {
      token: { id: 'u1', role: 'admin' },
      secret: '',
    })

    expect((await guard(contextFor('/dashboard'), ADMIN_POLICY)).redirect).toBeDefined()
  })

  it('treats a session revoked by a password change as no session', async () => {
    const guard = loadGuard(baseAuth(ADMIN_PAGE), {
      token: { id: 'u2', role: 'admin', __sessionStamp: 'stamp' },
      revoked: true,
    })
    expect((await guard(contextFor('/dashboard'), ADMIN_POLICY)).redirect).toBeDefined()
  })

  it('answers 404 to a session without the role and lets the role through', async () => {
    const member = loadGuard(baseAuth(ADMIN_PAGE), { token: { id: 'u1', role: 'member' } })
    expect(await member(contextFor('/dashboard'), ADMIN_POLICY)).toEqual({ notFound: true })

    const admin = loadGuard(baseAuth(ADMIN_PAGE), { token: { id: 'u2', role: 'admin' } })
    expect(await admin(contextFor('/dashboard'), ADMIN_POLICY)).toBeNull()
  })

  it('reads the role from roleName or roles the way the workflow routes do', async () => {
    const byRoleName = loadGuard(baseAuth(ADMIN_PAGE), { token: { id: 'u1', roleName: 'admin' } })
    expect(await byRoleName(contextFor('/dashboard'), ADMIN_POLICY)).toBeNull()
    const byRoles = loadGuard(baseAuth(ADMIN_PAGE), { token: { id: 'u1', roles: ['admin'] } })
    expect(await byRoles(contextFor('/dashboard'), ADMIN_POLICY)).toBeNull()
  })

  it('lets an entitled subscriber through, asking the entitlement query with the session user', async () => {
    const entitlement: Entitlement = { entitled: true, calls: [] }
    const guard = loadGuard(baseAuth(MEMBERS_PAGE), { token: { sub: 'u7' }, entitlement })

    expect(await guard(contextFor('/members'), MEMBER_POLICY)).toBeNull()
    expect(entitlement.calls).toEqual([{ userId: 'u7', productIds: ['prod-1'] }])
  })

  it('answers 404 to a session without the subscription, and when the check fails', async () => {
    const notEntitled: Entitlement = { entitled: false, calls: [] }
    const guard = loadGuard(baseAuth(MEMBERS_PAGE), {
      token: { id: 'u1' },
      entitlement: notEntitled,
    })
    expect(await guard(contextFor('/members'), MEMBER_POLICY)).toEqual({ notFound: true })

    const broken: Entitlement = { throws: true, calls: [] }
    const failing = loadGuard(baseAuth(MEMBERS_PAGE), { token: { id: 'u1' }, entitlement: broken })
    expect(await failing(contextFor('/members'), MEMBER_POLICY)).toEqual({ notFound: true })
  })

  it('refuses a subscription policy in a project that emitted no entitlement query', async () => {
    // No subscriber-only page: the module never requires ./subscriber-access.
    const guard = loadGuard(baseAuth(ADMIN_PAGE), { token: { id: 'u1', role: 'admin' } })
    expect(await guard(contextFor('/members'), MEMBER_POLICY)).toEqual({ notFound: true })
  })
})
