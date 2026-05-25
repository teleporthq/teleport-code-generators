import { generateMiddlewareFile } from '../src/auth-generator'

// Guarding the regression where a guest checkout buyer lands on
// `/order-details/<order_number>` after Stripe redirect and the
// Next.js middleware bounces them to `/sign-in?callbackUrl=...`
// before the page's page-load workflow can run the
// `userId OR anonymousUserId` SQL ownership clause.
//
// `generateMiddlewareFile` is the canonical entry point for the
// generated `middleware.js`. These tests pin the contract: any
// page that ships row-owner metadata AND no role requirement is
// considered self-guarded by SQL and MUST NOT be added to the
// route-level `protectedRoutes` table. Role-gated pages keep their
// middleware protection regardless of row ownership — role
// membership cannot be reproduced by a row-level WHERE clause.

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

describe('generateMiddlewareFile: row-owned self-guarded pages', () => {
  it('skips a row-owned page with empty allowedRoles', () => {
    const code = generateMiddlewareFile({
      ...baseAuth,
      pageProtection: {
        OD: {
          requiresAuth: true,
          allowedRoles: [],
          pageName: 'order-details',
          route: '/order-details',
          rowOwnerColumn: 'user_id',
          rowOwnerTable: 'teleport_orders',
          rowOwnerDifferentiator: 'order_number',
        },
      },
    } as any)

    // /order-details must NOT appear in protectedRoutes — the
    // page-load SQL `user_id = userId OR user_id = anonymousUserId`
    // is the source of truth for ownership.
    expect(code).not.toContain('"/order-details"')
  })

  it('still protects a row-owned page that requires a specific role', () => {
    // Role gating is an absolute check that the row-level SQL
    // ownership clause cannot reproduce: a non-admin shouldn't get
    // to enumerate admin-only pages even if the SQL would refuse
    // their rows. Keep middleware in place for these.
    const code = generateMiddlewareFile({
      ...baseAuth,
      pageProtection: {
        AD: {
          requiresAuth: true,
          allowedRoles: ['admin'],
          pageName: 'admin-order-details',
          route: '/admin/orders/[id]',
          rowOwnerColumn: 'user_id',
          rowOwnerTable: 'teleport_orders',
        },
      },
    } as any)

    expect(code).toContain('"/admin/orders/[id]"')
    expect(code).toContain('"admin"')
  })

  it('keeps non-row-owned pages protected as before', () => {
    // The pure regression guard: orders-list ("collection" view,
    // no rowOwnerColumn) keeps requiresAuth so a logged-out
    // visitor can't see the empty-but-existing /orders-list shell.
    const code = generateMiddlewareFile({
      ...baseAuth,
      pageProtection: {
        OL: {
          requiresAuth: true,
          allowedRoles: [],
          pageName: 'orders-list',
          route: '/orders-list',
        },
      },
    } as any)

    expect(code).toContain('"/orders-list"')
  })

  it('honours folder-level role gating even when a child page is row-owned', () => {
    // A folder that adds the `staff` role to its children imposes
    // a hard gate the SQL ownership check cannot mirror — staff
    // membership is not encoded on the row. The page must stay in
    // protectedRoutes with the merged role.
    const code = generateMiddlewareFile({
      ...baseAuth,
      pageProtection: {
        TD: {
          requiresAuth: true,
          allowedRoles: [],
          pageName: 'ticket-details',
          route: '/tickets/[id]',
          rowOwnerColumn: 'user_id',
        },
      },
      folderProtection: {
        STAFF: {
          requiresAuth: true,
          allowedRoles: ['staff'],
          folderName: 'staff',
          parentId: null,
          children: { TD: 'page' },
        },
      },
    } as any)

    expect(code).toContain('"/tickets/[id]"')
    expect(code).toContain('"staff"')
  })

  it('skips a row-owned page even when wrapped in a role-less folder', () => {
    // A "logged-in only" folder that lists everyone — no
    // distinguishing role — should not re-promote a row-owned
    // page back into protectedRoutes. The SQL still guards it
    // per-row and the page-load workflow lets the guest in via
    // the anonymous fallback.
    const code = generateMiddlewareFile({
      ...baseAuth,
      pageProtection: {
        OD: {
          requiresAuth: true,
          allowedRoles: [],
          pageName: 'order-details',
          route: '/order-details',
          rowOwnerColumn: 'user_id',
        },
      },
      folderProtection: {
        USERS: {
          requiresAuth: true,
          allowedRoles: [],
          folderName: 'users',
          parentId: null,
          children: { OD: 'page' },
        },
      },
    } as any)

    expect(code).not.toContain('"/order-details"')
  })

  it('treats `rowOwnerColumn` as the sole signal — pages without it stay protected', () => {
    // Defensive: an empty-string rowOwnerColumn or a missing key
    // must not opt into the bypass; only a non-empty column name
    // counts as "self-guarded by SQL".
    const code = generateMiddlewareFile({
      ...baseAuth,
      pageProtection: {
        ZZ: {
          requiresAuth: true,
          allowedRoles: [],
          pageName: 'something',
          route: '/something',
          rowOwnerColumn: '',
        },
      },
    } as any)

    expect(code).toContain('"/something"')
  })
})
