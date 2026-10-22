/* tslint:disable:function-constructor */
import type { UIDLAuthentication } from '@teleporthq/teleport-types'
import {
  generateTableAccessHelperCode,
  pageDataReadsNoRowOf,
  pageReadsAsStore,
} from '../../src/utils/table-access'

/**
 * A page's own data — what its getStaticProps / getServerSideProps read to
 * render it — reaches whoever opens the page, and anyone who asks
 * `/_next/data` for it. So it is read as a visitor is served the store's
 * tables, except on an admin page nobody but the store's trusted readers may
 * open.
 */

const authWith = (
  pageProtection: UIDLAuthentication['pageProtection'],
  folderProtection: UIDLAuthentication['folderProtection'] = {}
): UIDLAuthentication => ({
  enabled: true,
  dataSourceId: 'ds-1',
  dataSourceType: 'teleport',
  passwordAuthEnabled: true,
  providers: [],
  roles: ['admin', 'staff', 'user'],
  tables: {},
  pageProtection,
  folderProtection,
  authPages: {},
  callbackBaseUrl: '/api/auth/callback',
  envKeys: {},
  customUserProperties: [],
})

const page = (route: string, allowedRoles: string[], extra: Record<string, unknown> = {}) => ({
  requiresAuth: true,
  allowedRoles,
  pageName: route.split('/').pop() || 'home',
  route,
  ...extra,
})

// The store template's shape: an admin panel folder admitting admins, a staff
// screen, members-only pages and a row-owned order page.
const STORE_AUTH = authWith(
  {
    'p-users': page('/admin/users', ['admin']),
    'p-orders-update': page('/admin/orders/update', ['admin'], {
      routePattern: '/admin/orders/update/[id]',
    }),
    'p-dashboard': page('/admin/dashboard', ['admin', 'staff']),
    'p-profile': page('/profile', [], { routePattern: '/profile/[id]' }),
    'p-order': page('/orders', [], {
      routePattern: '/orders/[order_number]',
      rowOwnerColumn: 'user_id',
    }),
  },
  {
    'f-admin': {
      requiresAuth: true,
      allowedRoles: ['admin'],
      folderName: 'admin-panel',
      parentId: 'pages',
      children: { 'p-users': 'page', 'p-orders-update': 'page', 'p-dashboard': 'page' },
    },
  } as never
)

describe('pageReadsAsStore', () => {
  it('reads an admin page only trusted readers open as the store', () => {
    expect(pageReadsAsStore({ pageId: 'p-users' }, STORE_AUTH)).toBe(true)
    expect(pageReadsAsStore({ pageId: 'p-orders-update' }, STORE_AUTH)).toBe(true)
    // An admin page without protection of its own falls under /admin.
    expect(pageReadsAsStore({ route: '/admin/new-report' }, STORE_AUTH)).toBe(true)
  })

  it('reads every other page as a visitor', () => {
    // A staff screen: staff are not the store's trusted readers.
    expect(pageReadsAsStore({ pageId: 'p-dashboard' }, STORE_AUTH)).toBe(false)
    // Members-only, and row-owned: whoever signs in gets the page data.
    expect(pageReadsAsStore({ pageId: 'p-profile' }, STORE_AUTH)).toBe(false)
    expect(pageReadsAsStore({ pageId: 'p-order' }, STORE_AUTH)).toBe(false)
    // Public pages.
    expect(pageReadsAsStore({ route: '/' }, STORE_AUTH)).toBe(false)
    expect(pageReadsAsStore({ route: '/products' }, STORE_AUTH)).toBe(false)
    expect(pageReadsAsStore({ route: '/administration' }, STORE_AUTH)).toBe(false)
  })

  it('reads an admin page as a visitor when nothing gates it, or nobody is a trusted reader', () => {
    expect(pageReadsAsStore({ route: '/admin/users' }, undefined)).toBe(false)
    expect(pageReadsAsStore({ route: '/admin/users' }, authWith({}))).toBe(false)
    // Signed-in members of any role may open it: none of them is trusted.
    const anyMember = authWith({ 'p-users': page('/admin/users', []) })
    expect(pageReadsAsStore({ pageId: 'p-users' }, anyMember)).toBe(false)
    // A page left public beside a protected panel answers to its own entry.
    const publicReport = authWith(
      {
        'p-users': page('/admin/users', ['admin']),
        'p-report': { ...page('/admin/report', []), requiresAuth: false },
      },
      STORE_AUTH.folderProtection
    )
    expect(pageReadsAsStore({ pageId: 'p-report' }, publicReport)).toBe(false)
  })
})

describe('pageDataReadsNoRowOf', () => {
  it('names the protected and the feed tables, however spelled', () => {
    expect(pageDataReadsNoRowOf('public.teleport_orders')).toBe(true)
    expect(pageDataReadsNoRowOf('"teleport_gift_cards"')).toBe(true)
    expect(pageDataReadsNoRowOf('teleport_products')).toBe(false)
    expect(pageDataReadsNoRowOf('teleport_blog_posts')).toBe(false)
  })

  it('leaves out the members: a page reads their public profiles', () => {
    expect(pageDataReadsNoRowOf('users')).toBe(false)
    expect(pageDataReadsNoRowOf('public."users"')).toBe(false)
  })
})

describe('the emitted guard, reading a page for a visitor', () => {
  const bootGuard = () => {
    const sessionReads: unknown[] = []
    const guardRead = new Function(
      'process',
      '__tqSessionToken',
      `${generateTableAccessHelperCode({ trustedReaderRoles: ['admin'] })}
return __taGuardRead`
    )(
      { env: { NEXTAUTH_SECRET: 'server-secret' } },
      async (req: { headers?: { cookie?: string } }) => {
        sessionReads.push(req)
        // A browser's session cookie, here simply the role it signs in.
        const role = req?.headers?.cookie
        return role ? { sub: 'u1', role } : null
      }
    ) as (req: unknown, tableName: string, rawQuery: string | null) => Promise<unknown>
    return { guardRead, sessionReads }
  }
  const pageRead = { query: {}, method: 'GET', headers: {}, __tqVisitorView: true }

  it("runs the page's own statement, which a browser may not send", async () => {
    const { guardRead } = bootGuard()
    const statement = 'SELECT * FROM category_tiles'
    expect(await guardRead(pageRead, 'category_tiles', statement)).toBeNull()
    expect(await guardRead({ headers: {} }, 'category_tiles', statement)).toMatchObject({
      status: 403,
    })
  })

  it("lets it read the members' public profiles, through the structured read only", async () => {
    const { guardRead, sessionReads } = bootGuard()
    expect(await guardRead(pageRead, 'users', null)).toBeNull()
    expect(await guardRead(pageRead, 'public.users', null)).toBeNull()
    // A statement cannot be projected onto the public profile.
    expect(await guardRead(pageRead, 'users', 'SELECT email FROM users')).toEqual({
      status: 401,
      message: 'Unauthenticated',
    })
    expect(sessionReads).toEqual([])
    // A browser still reads the table only as a trusted role.
    expect(await guardRead({ headers: {} }, 'users', null)).toMatchObject({ status: 401 })
    expect(await guardRead({ headers: { cookie: 'user' } }, 'users', null)).toMatchObject({
      status: 403,
    })
    expect(await guardRead({ headers: { cookie: 'admin' } }, 'users', null)).toBeNull()
  })

  it('refuses it every other protected table, as nobody signed in', async () => {
    const { guardRead, sessionReads } = bootGuard()
    expect(await guardRead(pageRead, 'teleport_orders', null)).toEqual({
      status: 401,
      message: 'Unauthenticated',
    })
    expect(
      await guardRead(pageRead, 'teleport_products', 'SELECT * FROM teleport_products, users')
    ).toEqual({ status: 401, message: 'Unauthenticated' })
    expect(sessionReads).toEqual([])
    // The store's own server code reads them.
    expect(await guardRead({ __tqServerCall: true }, 'teleport_orders', null)).toBeNull()
  })
})
