import { UIDLAuthentication } from '@teleporthq/teleport-types'
import { generateMiddlewareFile } from '../src/auth-generator'
import {
  compileGeneratedMiddleware,
  extractProtectedRoutes,
} from './_helpers/run-generated-middleware'

/**
 * An internal tool that owns its project admits its staff to the tool's own
 * admin pages (the dashboard first among them), keeps the built-in entities
 * admin only, and redirects the home page into the dashboard
 * (`homeRedirect`). Two things must follow from the ADMIN FOLDER's protection,
 * never from whichever page happens to come first:
 *  - the `/admin` catch-all, which guards `/admin` itself and every admin page
 *    the middleware has no entry for (one an owner added without protection);
 *  - where a role denial lands: never `/` when `/` leads straight back into a
 *    page the visitor may not open — that is a redirect loop.
 */

const page = (route: string, allowedRoles: string[]) => ({
  requiresAuth: true,
  allowedRoles,
  pageName: route,
  route,
})

const toolAuth = (homeRedirect?: string): UIDLAuthentication => ({
  enabled: true,
  dataSourceId: 'ds-1',
  dataSourceType: 'teleport',
  passwordAuthEnabled: true,
  providers: [],
  roles: ['admin', 'staff', 'user'],
  tables: {},
  // The dashboard is the first admin route, as the GUI emits it.
  pageProtection: {
    'p-dashboard': page('/admin/dashboard', ['admin', 'staff']),
    'p-tasks': page('/admin/tasks', ['admin', 'staff']),
    'p-users': page('/admin/users', ['admin']),
  },
  folderProtection: {
    'f-admin': {
      requiresAuth: true,
      allowedRoles: ['admin'],
      folderName: 'admin-panel',
      parentId: 'pages',
      children: { 'p-dashboard': 'page', 'f-tasks': 'folder', 'f-users': 'folder' },
    },
    'f-tasks': {
      requiresAuth: true,
      allowedRoles: ['admin', 'staff'],
      folderName: 'tasks',
      parentId: 'f-admin',
      children: { 'p-tasks': 'page' },
    },
    'f-users': {
      requiresAuth: true,
      allowedRoles: ['admin'],
      folderName: 'users',
      parentId: 'f-admin',
      children: { 'p-users': 'page' },
    },
  },
  authPages: {
    signIn: { pageId: 'p-sign-in', pageName: 'sign-in', route: '/auth/sign-in' },
  },
  callbackBaseUrl: '/api/auth/callback',
  envKeys: {},
  customUserProperties: [],
  ...(homeRedirect ? { homeRedirect } : {}),
})

const ORIGIN = 'https://tool.test'

describe('the /admin catch-all', () => {
  it("admits the admin folder's roles, not the first admin page's", () => {
    const routes = extractProtectedRoutes(generateMiddlewareFile(toolAuth('/admin/dashboard')))
    expect(routes['/admin']).toEqual({ requiresAuth: true, allowedRoles: ['admin'] })
  })

  it('keeps staff out of an admin page the middleware has no entry for', async () => {
    const run = compileGeneratedMiddleware(toolAuth('/admin/dashboard'))
    const staff = { id: 's1', role: 'staff' }
    expect(await run('/admin/reports', { sessionUser: staff, origin: ORIGIN })).toMatchObject({
      kind: 'redirect',
    })
    expect(await run('/admin/tasks', { sessionUser: staff, origin: ORIGIN })).toEqual({
      kind: 'next',
    })
    expect(
      await run('/admin/reports', { sessionUser: { id: 'a1', role: 'admin' }, origin: ORIGIN })
    ).toEqual({ kind: 'next' })
  })
})

describe('a role denial when the home page redirects into the admin panel', () => {
  const run = compileGeneratedMiddleware(toolAuth('/admin/dashboard'))
  const signInLocation = (callbackUrl: string) =>
    `${ORIGIN}/auth/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}&error=forbidden`

  it('sends a signed-in account the tool does not admit to sign-in, explained — never to "/"', async () => {
    const user = { id: 'u1', role: 'user' }
    // "/" would redirect to the dashboard, which denies the role again: a loop.
    expect(await run('/admin/dashboard', { sessionUser: user, origin: ORIGIN })).toEqual({
      kind: 'redirect',
      location: signInLocation('/admin/dashboard'),
    })
    expect(await run('/admin/users', { sessionUser: user, origin: ORIGIN })).toEqual({
      kind: 'redirect',
      location: signInLocation('/admin/users'),
    })
  })

  it('still sends staff denied an admin-only page home, where the dashboard admits them', async () => {
    expect(
      await run('/admin/users', { sessionUser: { id: 's1', role: 'staff' }, origin: ORIGIN })
    ).toEqual({ kind: 'redirect', location: `${ORIGIN}/` })
  })

  it('leaves a project whose home is not redirected as it was', () => {
    const code = generateMiddlewareFile(toolAuth())
    expect(code).toContain('function roleDeniedRedirect(request, pathname) {')
    expect(code).toContain('return roleDeniedRedirect(request, pathname);')
    expect(code).not.toContain('homeRedirect')
    expect(code).not.toContain("'forbidden'")
  })
})
