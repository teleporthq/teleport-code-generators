import { compileGeneratedMiddleware } from './_helpers/run-generated-middleware'

/**
 * Guest checkout regression, end to end through the GENERATED middleware.
 *
 * The e-commerce list/details pair deliberately shares a static base — the
 * order history is served from `/orders` and a single order from
 * `/orders/[order_number]` — so a reader can drop the last path segment to get
 * back to the listing. The listing legitimately requires auth (a guest has no
 * order history), the details page does not: its page-load SQL matches
 * `user_id = <session user>` OR `user_id = <anonymous localStorage UUID>`, and
 * a guest order is stamped with the latter.
 *
 * `generateMiddlewareFile` already skipped row-owned self-guarded pages from
 * `protectedRoutes`, but that was not enough: the middleware matches a request
 * against every protected route as a PREFIX, so `/orders/ORD-42` matched the
 * listing's `/orders` entry and every guest was redirected to
 * `/sign-in?callbackUrl=/orders/ORD-42` — right after paying, and right after
 * the COD "order placed" toast. Buyers with a stale session cookie never saw
 * it, which is why it looked intermittent.
 *
 * The fix emits the self-guarded page's full route pattern and waives ONLY
 * inherited, role-free protection for paths that pattern matches.
 */

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

const ordersListProtection = {
  requiresAuth: true,
  allowedRoles: [] as string[],
  pageName: 'orders-list',
  route: '/orders',
}

const orderDetailsProtection = {
  requiresAuth: true,
  allowedRoles: [] as string[],
  pageName: 'order-details',
  route: '/orders',
  routePattern: '/orders/[order_number]',
  rowOwnerColumn: 'user_id',
  rowOwnerTable: 'teleport_orders',
  rowOwnerDifferentiator: 'order_number',
}

const storeAuth = (overrides: Record<string, unknown> = {}) =>
  ({
    ...baseAuth,
    pageProtection: {
      OL: ordersListProtection,
      OD: orderDetailsProtection,
      ADMIN: {
        requiresAuth: true,
        allowedRoles: ['admin'],
        pageName: 'admin',
        route: '/admin',
      },
    },
    ...overrides,
  } as any)

describe('generated middleware: guest access to a row-owned order-details route', () => {
  const run = compileGeneratedMiddleware(storeAuth())

  it('lets an anonymous buyer reach the order they just placed', async () => {
    // The single path both checkout branches land on: the COD branch navigates
    // here directly, and Stripe/PayPal return to `<this>?payment=success`
    // (`nextUrl.pathname` excludes the query, so the decision is made here).
    expect(await run('/orders/ORD-42')).toEqual({ kind: 'next' })
  })

  it('matches the same order route with a trailing slash', async () => {
    // Next.js serves both forms; matching the raw pathname would make the
    // slashed variant miss the self-guarded pattern and inherit the listing's
    // protection.
    expect(await run('/orders/ORD-42/')).toEqual({ kind: 'next' })
  })

  it('URL-encoded order numbers still resolve to the details route', async () => {
    expect(await run('/orders/ORD%2F42')).toEqual({ kind: 'next' })
  })

  it('still forces sign-in on the orders LISTING itself', async () => {
    const result = await run('/orders')
    expect(result.kind).toBe('redirect')
    expect(result.location).toContain('/sign-in')
  })

  it('does not waive protection for a deeper path the details page never serves', async () => {
    // `/orders/[order_number]` compiles to a single-segment matcher, so a
    // crafted `/orders/ORD-42/anything` keeps the listing's protection.
    const result = await run('/orders/ORD-42/edit')
    expect(result.kind).toBe('redirect')
    expect(result.location).toContain('/sign-in')
  })

  it('keeps the admin subtree gated', async () => {
    expect((await run('/admin')).kind).toBe('redirect')
    expect((await run('/admin/orders')).kind).toBe('redirect')
  })

  it('lets a signed-in buyer reach their order history', async () => {
    expect(await run('/orders', { sessionUser: { id: 'u-1', role: 'user' } })).toEqual({
      kind: 'next',
    })
  })

  it('still bounces a non-admin off the admin subtree', async () => {
    const result = await run('/admin/orders', { sessionUser: { id: 'u-1', role: 'user' } })
    expect(result.kind).toBe('redirect')
  })
})

describe('generated middleware: self-guard waiver stays narrow', () => {
  it('does not waive protection when the ancestor route demands a role', async () => {
    // A staff-only subtree is an absolute gate the row-level WHERE clause
    // cannot reproduce, so the guest must NOT slip through it.
    const run = compileGeneratedMiddleware(
      storeAuth({
        pageProtection: {
          STAFF_LIST: {
            requiresAuth: true,
            allowedRoles: ['staff'],
            pageName: 'staff-orders',
            route: '/staff-orders',
          },
          STAFF_DETAILS: {
            requiresAuth: true,
            allowedRoles: [],
            pageName: 'staff-order-details',
            route: '/staff-orders',
            routePattern: '/staff-orders/[order_number]',
            rowOwnerColumn: 'user_id',
            rowOwnerDifferentiator: 'order_number',
          },
        },
      })
    )

    const result = await run('/staff-orders/ORD-42')
    expect(result.kind).toBe('redirect')
    expect(result.location).toContain('/sign-in')
  })

  it("does not waive a page's OWN exact protection", async () => {
    // Contrived but load-bearing: if some other protected page is published at
    // exactly the path a self-guarded pattern matches, that page's own entry
    // wins. Only INHERITED protection is waivable.
    const run = compileGeneratedMiddleware(
      storeAuth({
        pageProtection: {
          OL: ordersListProtection,
          OD: orderDetailsProtection,
          CLASH: {
            requiresAuth: true,
            allowedRoles: [],
            pageName: 'orders-archive',
            route: '/orders/archive',
          },
        },
      })
    )

    const result = await run('/orders/archive')
    expect(result.kind).toBe('redirect')
    expect(result.location).toContain('/sign-in')
  })

  it('reconstructs the pattern for UIDLs emitted before `routePattern` existed', async () => {
    // Older projects carry only `route` + `rowOwnerDifferentiator`. As long as
    // the route is the real static base, the pattern is derivable.
    const run = compileGeneratedMiddleware(
      storeAuth({
        pageProtection: {
          OL: ordersListProtection,
          OD: {
            requiresAuth: true,
            allowedRoles: [],
            pageName: 'order-details',
            route: '/orders',
            rowOwnerColumn: 'user_id',
            rowOwnerDifferentiator: 'order_number',
          },
        },
      })
    )

    expect(await run('/orders/ORD-42')).toEqual({ kind: 'next' })
    expect((await run('/orders')).kind).toBe('redirect')
  })

  it('leaves projects without any self-guarded page completely unchanged', async () => {
    const run = compileGeneratedMiddleware({
      ...baseAuth,
      pageProtection: {
        ACCOUNT: {
          requiresAuth: true,
          allowedRoles: [],
          pageName: 'account',
          route: '/account',
        },
      },
    } as any)

    expect((await run('/account')).kind).toBe('redirect')
    expect((await run('/account/settings')).kind).toBe('redirect')
    expect(await run('/about')).toEqual({ kind: 'next' })
  })
})

describe('generated middleware: two pages claiming one route key', () => {
  it('merges their rules instead of letting document order pick a winner', async () => {
    // A list/details pair shares its static base by design, and a user can also
    // point two pages at the same custom URL. One prefix key gates the whole
    // subtree, so the stricter rule has to survive — otherwise whichever page
    // the document happened to list last silently decided the access rules.
    const run = compileGeneratedMiddleware({
      ...baseAuth,
      pageProtection: {
        PUBLIC_ISH: {
          requiresAuth: true,
          allowedRoles: [],
          pageName: 'reports',
          route: '/reports',
        },
        ADMIN_ONLY: {
          requiresAuth: true,
          allowedRoles: ['admin'],
          pageName: 'reports-admin',
          route: '/reports',
        },
      },
    } as any)

    expect((await run('/reports', { sessionUser: { id: 'u-1', role: 'user' } })).kind).toBe(
      'redirect'
    )
    expect(await run('/reports', { sessionUser: { id: 'u-2', role: 'admin' } })).toEqual({
      kind: 'next',
    })
  })
})
