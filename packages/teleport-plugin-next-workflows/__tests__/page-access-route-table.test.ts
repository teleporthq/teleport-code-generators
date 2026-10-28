import { PageAccess } from '@teleporthq/teleport-shared'
import { generateMiddlewareFile } from '../src/auth-generator'
import {
  compileGeneratedMiddleware,
  extractProtectedRoutes,
  extractSelfGuardedRoutes,
} from './_helpers/run-generated-middleware'

// The server half of page protection decides at build time which pages check
// the session in their own getServerSideProps (`PageAccess` in
// teleport-shared). It MUST agree with the middleware it backs up: same route
// table, and for every page the same verdict a guest gets from the compiled
// middleware — protected (redirected) or let through. A change to one that the
// other does not mirror fails here.

const baseAuth = (over: Record<string, unknown>): any => ({
  enabled: true,
  dataSourceId: 'ds-1',
  dataSourceType: 'postgres',
  passwordAuthEnabled: true,
  providers: [],
  roles: ['admin', 'staff', 'member'],
  tables: {},
  pageProtection: {},
  folderProtection: {},
  authPages: {
    signIn: { pageId: 'sign-in', pageName: 'sign-in', route: '/sign-in' },
    signUp: { pageId: 'sign-up', pageName: 'sign-up', route: '/sign-up' },
  },
  callbackBaseUrl: '',
  envKeys: {},
  customUserProperties: [],
  ...over,
})

const page = (route: string, over: Record<string, unknown> = {}) => ({
  requiresAuth: true,
  allowedRoles: [] as string[],
  pageName: route,
  route,
  ...over,
})

const FIXTURES: Record<string, any> = {
  'plain and role-gated pages, an admin subtree, a protected home': baseAuth({
    pageProtection: {
      home: page('/', { allowedRoles: ['member'] }),
      dash: page('/dashboard'),
      users: page('/admin/users', { allowedRoles: ['admin'] }),
      staff: page('/admin/tasks', { allowedRoles: ['admin', 'staff'] }),
      open: page('/brochure', { requiresAuth: false }),
    },
  }),
  'a row-owned list/details pair and a role-gated row-owned page': baseAuth({
    pageProtection: {
      list: page('/orders'),
      details: page('/orders', {
        routePattern: '/orders/[order_number]',
        rowOwnerColumn: 'user_id',
        rowOwnerTable: 'teleport_orders',
        rowOwnerDifferentiator: 'order_number',
      }),
      legacy: page('/receipts', {
        rowOwnerColumn: 'user_id',
        rowOwnerDifferentiator: 'receipt_id',
      }),
      adminDetails: page('/admin/orders', {
        allowedRoles: ['admin'],
        routePattern: '/admin/orders/[id]',
        rowOwnerColumn: 'user_id',
        rowOwnerDifferentiator: 'id',
      }),
    },
  }),
  'subscriber pages merged on one key, and a row-owned subscriber page': baseAuth({
    pageProtection: {
      a: page('/members', { requiresSubscription: true, subscriptionProductIds: ['p1'] }),
      b: page('/members', { requiresSubscription: true, subscriptionProductIds: ['p2', ' p1 '] }),
      c: page('/vip', { requiresSubscription: true, subscriptionProductIds: [] }),
      d: page('/lessons', {
        routePattern: '/lessons/[slug]',
        rowOwnerColumn: 'user_id',
        rowOwnerDifferentiator: 'slug',
        requiresSubscription: true,
        subscriptionProductIds: ['p3'],
      }),
      e: page('/mixed', { requiresSubscription: true }),
      f: page('/mixed'),
    },
  }),
  'folders: a role folder pulls a row-owned page back, a role-less one does not': baseAuth({
    pageProtection: {
      p1: page('/team/reports', {
        routePattern: '/team/reports/[id]',
        rowOwnerColumn: 'user_id',
        rowOwnerDifferentiator: 'id',
      }),
      p2: page('/mine', { routePattern: '/mine/[id]', rowOwnerColumn: 'user_id' }),
      p3: page('/team/board', { requiresSubscription: true, subscriptionProductIds: ['p9'] }),
      p4: page('/admin-panel-home', { route: '/admin' }),
    },
    folderProtection: {
      team: {
        requiresAuth: true,
        allowedRoles: ['staff'],
        folderName: 'team',
        parentId: null,
        children: { p1: 'page', p3: 'page', missing: 'page', sub: 'folder' },
      },
      mine: {
        requiresAuth: true,
        allowedRoles: [],
        folderName: 'mine',
        parentId: null,
        children: { p2: 'page' },
      },
      panel: {
        requiresAuth: true,
        allowedRoles: ['admin', 'staff'],
        folderName: 'admin-panel',
        parentId: null,
        children: { p4: 'page' },
      },
    },
  }),
  'protected sign-in / auth pages and an admin page without roles of its own': baseAuth({
    pageProtection: {
      signIn: page('/sign-in'),
      settings: page('/auth/settings'),
      reports: page('/admin/reports'),
    },
  }),
}

// Every page route each fixture serves, plus the neighbours a prefix match can
// reach: sub-pages, look-alike prefixes, the home page.
const PROBE_ROUTES = [
  '/',
  '/dashboard',
  '/dashboard/[id]',
  '/dashboards',
  '/brochure',
  '/admin',
  '/admin/users',
  '/admin/tasks',
  '/admin/unlisted',
  '/admin/orders',
  '/admin/orders/[id]',
  '/admin/reports',
  '/orders',
  '/orders/[order_number]',
  '/orders/[order_number]/invoice',
  '/receipts',
  '/receipts/[receipt_id]',
  '/members',
  '/members/[slug]',
  '/vip',
  '/lessons',
  '/lessons/[slug]',
  '/mixed',
  '/team/reports',
  '/team/reports/[id]',
  '/team/board',
  '/mine',
  '/mine/[id]',
  '/sign-in',
  '/sign-in/[step]',
  '/sign-in-offers',
  '/sign-up',
  '/auth/settings',
  '/about',
]

/** A request path the middleware would see for a page route. */
const concretePath = (route: string): string => route.replace(/\[[^\]]+\]/g, 'sample-1')

describe('PageAccess mirrors the generated middleware', () => {
  for (const [name, auth] of Object.entries(FIXTURES)) {
    describe(name, () => {
      const middlewareCode = generateMiddlewareFile(auth)
      const table = PageAccess.buildProtectedRouteTable(auth)

      it('builds the same route table', () => {
        expect(table.protectedRoutes).toEqual(extractProtectedRoutes(middlewareCode))
        expect(table.selfGuardedRoutes).toEqual(extractSelfGuardedRoutes(middlewareCode))
      })

      it('protects a page exactly when the middleware redirects a guest from it', async () => {
        const middleware = compileGeneratedMiddleware(auth)
        for (const route of PROBE_ROUTES) {
          const verdict = await middleware(concretePath(route))
          const policy = PageAccess.resolveRouteAccessPolicy(table, route)
          expect({ route, protectedByPage: policy !== null }).toEqual({
            route,
            protectedByPage: verdict.kind === 'redirect',
          })
        }
      })
    })
  }

  it('resolves a page’s policy from the route it is served from', () => {
    const auth = FIXTURES['plain and role-gated pages, an admin subtree, a protected home']
    const policyOf = (folderPath: string[], fileName: string) =>
      PageAccess.resolvePageAccessPolicy({ outputOptions: { folderPath, fileName } }, auth)

    expect(policyOf([], 'index')).toEqual({ requiresAuth: true, allowedRoles: ['member'] })
    expect(policyOf(['admin'], 'users')).toEqual({ requiresAuth: true, allowedRoles: ['admin'] })
    expect(policyOf(['admin'], '[id]')).toEqual({ requiresAuth: true, allowedRoles: ['admin'] })
    expect(policyOf([], 'brochure')).toBeNull()
    expect(policyOf([], 'about')).toBeNull()
    expect(
      PageAccess.resolvePageAccessPolicy(
        { outputOptions: { fileName: 'dashboard' } },
        {
          ...auth,
          enabled: false,
        }
      )
    ).toBeNull()
  })

  it('also protects a page whose path starts with "api", which the middleware matcher skips', () => {
    const auth = baseAuth({
      pageProtection: { keys: page('/api-keys', { allowedRoles: ['admin'] }) },
    })
    expect(
      PageAccess.resolvePageAccessPolicy({ outputOptions: { fileName: 'api-keys' } }, auth)
    ).toEqual({ requiresAuth: true, allowedRoles: ['admin'] })
  })
})
