import { generateMiddlewareFile } from '../src/auth-generator'
import {
  compileGeneratedMiddleware,
  extractProtectedRoutes,
  extractSelfGuardedRoutes,
  MiddlewareFetchCall,
} from './_helpers/run-generated-middleware'

// Subscriber-only pages. The middleware decides in this order: session (else
// sign-in), role (else the role denial), then — for a page whose protection
// carries `requiresSubscription` — the app's own /api/auth/subscriber-access
// route, asked with the visitor's cookie. Anything but `entitled: true` sends
// the visitor to the route's suggested product page, else the products
// listing, else the home page, with `?subscription_required=1` — never to a
// page that is itself subscriber-gated.

const baseAuth: any = {
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
}

const membersPage = (over: Record<string, unknown> = {}) => ({
  requiresAuth: true,
  allowedRoles: [],
  pageName: 'members',
  route: '/members',
  requiresSubscription: true,
  subscriptionProductIds: ['prod-1', 'prod-2'],
  ...over,
})

const withPages = (pageProtection: Record<string, unknown>): any => ({
  ...baseAuth,
  pageProtection,
})

const member = { id: 'u1', role: 'user' }

describe('generateMiddlewareFile: subscriber-only pages', () => {
  it('carries the subscription requirement into the route table', () => {
    const code = generateMiddlewareFile(withPages({ M: membersPage() }))
    expect(extractProtectedRoutes(code)['/members']).toEqual({
      requiresAuth: true,
      allowedRoles: [],
      requiresSubscription: true,
      subscriptionProductIds: ['prod-1', 'prod-2'],
    })
  })

  it('keeps a row-owned subscriber page under middleware protection', () => {
    // A subscription is an entitlement the page-load SQL cannot reproduce.
    const code = generateMiddlewareFile(
      withPages({
        M: membersPage({
          route: '/lessons',
          routePattern: '/lessons/[slug]',
          rowOwnerColumn: 'user_id',
          rowOwnerTable: 'teleport_lessons',
          rowOwnerDifferentiator: 'slug',
        }),
      })
    )
    expect(extractProtectedRoutes(code)['/lessons']?.requiresSubscription).toBe(true)
    expect(extractSelfGuardedRoutes(code)).toEqual([])
  })

  it('merges two pages on one key permissively, like roles', () => {
    const shared = generateMiddlewareFile(
      withPages({
        A: membersPage({ route: '/club', subscriptionProductIds: ['prod-1'] }),
        B: membersPage({ route: '/club', subscriptionProductIds: ['prod-2'] }),
      })
    )
    expect(extractProtectedRoutes(shared)['/club'].subscriptionProductIds).toEqual([
      'prod-1',
      'prod-2',
    ])

    const anyWins = generateMiddlewareFile(
      withPages({
        A: membersPage({ route: '/club', subscriptionProductIds: ['prod-1'] }),
        B: membersPage({ route: '/club', subscriptionProductIds: [] }),
      })
    )
    expect(anyWins && extractProtectedRoutes(anyWins)['/club'].subscriptionProductIds).toEqual([])

    const mixed = generateMiddlewareFile(
      withPages({
        A: membersPage({ route: '/club' }),
        B: { requiresAuth: true, allowedRoles: [], pageName: 'club-list', route: '/club' },
      })
    )
    expect(extractProtectedRoutes(mixed)['/club'].requiresSubscription).toBeUndefined()
  })

  it('a role-gated folder keeps the page subscriber-only', () => {
    const code = generateMiddlewareFile({
      ...withPages({ M: membersPage() }),
      folderProtection: {
        F: {
          requiresAuth: true,
          allowedRoles: ['staff'],
          folderName: 'staff-area',
          parentId: null,
          children: { M: 'page' },
        },
      },
    })
    expect(extractProtectedRoutes(code)['/members']).toEqual({
      requiresAuth: true,
      allowedRoles: ['staff'],
      requiresSubscription: true,
      subscriptionProductIds: ['prod-1', 'prod-2'],
    })
  })
})

describe('the generated middleware on a subscriber-only page', () => {
  const run = compileGeneratedMiddleware(withPages({ M: membersPage() }), {
    subscriptionFallbackRoute: '/products',
  })

  it('sends a guest to sign-in before asking about any subscription', async () => {
    const fetchCalls: MiddlewareFetchCall[] = []
    const result = await run('/members', { fetchCalls })
    expect(result.kind).toBe('redirect')
    expect(result.location).toBe('https://shop.test/sign-in?callbackUrl=%2Fmembers')
    expect(fetchCalls.some((call) => call.url.includes('subscriber-access'))).toBe(false)
  })

  it('asks the subscriber-access route with the cookie and the product ids, and lets an entitled member through', async () => {
    const fetchCalls: MiddlewareFetchCall[] = []
    const result = await run('/members', {
      sessionUser: member,
      subscriberAccess: { entitled: true },
      fetchCalls,
    })
    expect(result).toEqual({ kind: 'next' })
    const access = fetchCalls.find((call) => call.url.includes('/api/auth/subscriber-access'))
    expect(access?.url).toBe(
      'https://shop.test/api/auth/subscriber-access?products=prod-1%2Cprod-2'
    )
    expect(access?.cookie).toBe('next-auth.session-token=stub')
  })

  it('redirects a non-subscriber to the product page the route suggests, flagged', async () => {
    const result = await run('/members', {
      sessionUser: member,
      subscriberAccess: { entitled: false, redirectTo: '/products/coffee-club' },
    })
    expect(result.location).toBe('https://shop.test/products/coffee-club?subscription_required=1')
  })

  it('falls back to the products listing, then the home page', async () => {
    const listing = await run('/members', {
      sessionUser: member,
      subscriberAccess: { entitled: false },
    })
    expect(listing.location).toBe('https://shop.test/products?subscription_required=1')

    const home = compileGeneratedMiddleware(withPages({ M: membersPage() }))
    const result = await home('/members', {
      sessionUser: member,
      subscriberAccess: { entitled: false },
    })
    expect(result.location).toBe('https://shop.test/?subscription_required=1')
  })

  it('fails closed on a failed or refused check, and never loops', async () => {
    const refused = await run('/members', {
      sessionUser: member,
      subscriberAccess: { status: 500 },
    })
    expect(refused.location).toBe('https://shop.test/products?subscription_required=1')
    const down = await run('/members', { sessionUser: member, subscriberAccess: { throws: true } })
    expect(down.location).toBe('https://shop.test/products?subscription_required=1')
    const junk = await run('/members', {
      sessionUser: member,
      subscriberAccess: { entitled: 'yes' as unknown as boolean },
    })
    expect(junk.kind).toBe('redirect')
  })

  it('never lands on another subscriber-only page, nor off-site', async () => {
    const gatedEverywhere = compileGeneratedMiddleware(
      withPages({
        M: membersPage(),
        P: membersPage({ route: '/products', subscriptionProductIds: [] }),
        H: membersPage({ route: '/', subscriptionProductIds: [] }),
      }),
      { subscriptionFallbackRoute: '/products' }
    )
    const suggestedGated = await gatedEverywhere('/members', {
      sessionUser: member,
      subscriberAccess: { entitled: false, redirectTo: '/products/coffee-club' },
    })
    // The product page inherits the gated "/products" prefix; so do the
    // listing and the home page — sign-in is the only loop-free landing left.
    expect(suggestedGated.location).toBe('https://shop.test/sign-in?callbackUrl=%2Fmembers')

    const offSite = await run('/members', {
      sessionUser: member,
      subscriberAccess: { entitled: false, redirectTo: 'https://evil.example/' },
    })
    expect(offSite.location).toBe('https://shop.test/products?subscription_required=1')
    const protocolRelative = await run('/members', {
      sessionUser: member,
      subscriberAccess: { entitled: false, redirectTo: '//evil.example/' },
    })
    expect(protocolRelative.location).toBe('https://shop.test/products?subscription_required=1')
  })

  it('checks the role before the subscription, and leaves other pages alone', async () => {
    const roleGated = compileGeneratedMiddleware(
      withPages({ M: membersPage({ allowedRoles: ['vip'] }) })
    )
    const fetchCalls: MiddlewareFetchCall[] = []
    const denied = await roleGated('/members', {
      sessionUser: member,
      subscriberAccess: { entitled: true },
      fetchCalls,
    })
    expect(denied.location).toBe('https://shop.test/')
    expect(fetchCalls.some((call) => call.url.includes('subscriber-access'))).toBe(false)

    const plain = await run('/about', { fetchCalls })
    expect(plain).toEqual({ kind: 'next' })
    const api = await run('/api/auth/subscriber-access', { sessionUser: member, fetchCalls })
    expect(api).toEqual({ kind: 'next' })
  })

  it('keeps the visitor in their language', async () => {
    const result = await run('/members', {
      sessionUser: member,
      subscriberAccess: { entitled: false, redirectTo: '/products/coffee-club' },
      locale: 'es',
      defaultLocale: 'en',
    })
    expect(result.location).toBe(
      'https://shop.test/es/products/coffee-club?subscription_required=1'
    )
  })

  it('does not ask about a subscription on a page that needs none', async () => {
    const fetchCalls: MiddlewareFetchCall[] = []
    const plainAuth = compileGeneratedMiddleware(
      withPages({
        A: { requiresAuth: true, allowedRoles: [], pageName: 'account', route: '/account' },
      })
    )
    expect(await plainAuth('/account', { sessionUser: member, fetchCalls })).toEqual({
      kind: 'next',
    })
    expect(fetchCalls.some((call) => call.url.includes('subscriber-access'))).toBe(false)
  })
})
