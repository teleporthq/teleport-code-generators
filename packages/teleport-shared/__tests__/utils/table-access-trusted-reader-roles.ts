/* tslint:disable:function-constructor */
import type { UIDLAuthentication } from '@teleporthq/teleport-types'
import {
  generateTableAccessHelperCode,
  resolveTrustedReaderRoles,
} from '../../src/utils/table-access'

/**
 * Who may read the store's private tables (accounts, sent emails, orders,
 * gift cards …) from a browser: the roles the generated admin panel's FOLDER
 * admits. Some admin pages also admit another role (staff screens: the
 * dashboard, a table's list and views), and a role on one of those pages must
 * never become a reader of every protected table.
 */

const authWith = (
  pageProtection: UIDLAuthentication['pageProtection'],
  folderProtection: UIDLAuthentication['folderProtection']
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

const page = (route: string, allowedRoles: string[]) => ({
  requiresAuth: true,
  allowedRoles,
  pageName: route.split('/').pop() || 'home',
  route,
})

const folder = (
  folderName: string,
  allowedRoles: string[],
  parentId: string | null,
  children: Record<string, 'page' | 'folder'>
) => ({ requiresAuth: true, allowedRoles, folderName, parentId, children })

// An admin panel whose folder admits admins, some of whose screens (and their
// entity folder) admit staff too, and whose built-in entities stay admin only.
const STAFF_SCREENS_AUTH = authWith(
  {
    'p-dashboard': page('/admin/dashboard', ['admin', 'staff']),
    'p-tasks': page('/admin/tasks', ['admin', 'staff']),
    'p-tasks-create': page('/admin/tasks/create', ['admin', 'staff']),
    'p-tasks-board': page('/admin/tasks/board', ['admin', 'staff']),
    'p-users': page('/admin/users', ['admin']),
    'p-sent-emails': page('/admin/sent-emails', ['admin']),
  },
  {
    'f-admin': folder('admin-panel', ['admin'], 'pages', {
      'p-dashboard': 'page',
      'f-tasks': 'folder',
      'f-users': 'folder',
      'f-sent-emails': 'folder',
    }),
    'f-tasks': folder('tasks', ['admin', 'staff'], 'f-admin', {
      'p-tasks': 'page',
      'p-tasks-create': 'page',
      'p-tasks-board': 'page',
    }),
    'f-users': folder('users', ['admin'], 'f-admin', { 'p-users': 'page' }),
    'f-sent-emails': folder('sent-emails', ['admin'], 'f-admin', { 'p-sent-emails': 'page' }),
  }
)

describe('resolveTrustedReaderRoles', () => {
  it("trusts the admin folder's roles, never the staff an admin page admits", () => {
    expect(resolveTrustedReaderRoles(STAFF_SCREENS_AUTH)).toEqual(['admin'])
  })

  it('answers what it always did for an admin panel without staff pages', () => {
    const storeAuth = authWith(
      {
        'p-dashboard': page('/admin/dashboard', ['admin']),
        'p-orders': page('/admin/orders', ['admin']),
      },
      { 'f-admin': folder('admin-panel', ['admin'], 'pages', { 'p-dashboard': 'page' }) }
    )
    expect(resolveTrustedReaderRoles(storeAuth)).toEqual(['admin'])
  })

  it('falls back to the roles EVERY admin page admits when the folder records none', () => {
    const pages = STAFF_SCREENS_AUTH.pageProtection
    expect(resolveTrustedReaderRoles(authWith(pages, {}))).toEqual(['admin'])
    const roleless = authWith(pages, {
      'f-admin': folder('admin-panel', [], 'pages', { 'p-dashboard': 'page' }),
    })
    expect(resolveTrustedReaderRoles(roleless)).toEqual(['admin'])
  })

  it('ignores pages outside the admin panel, and trusts nobody without one', () => {
    const noPanel = authWith(
      {
        'p-profile': page('/profile', ['user']),
        'p-administration': page('/administration', ['staff']),
      },
      { 'f-members': folder('members', ['user'], null, {}) }
    )
    expect(resolveTrustedReaderRoles(noPanel)).toEqual([])
    expect(resolveTrustedReaderRoles(undefined)).toEqual([])
  })
})

describe('the emitted guard with those roles', () => {
  const bootGuard = (trustedReaderRoles: string[]) => {
    let session: { role: string } | null = null
    const guardRead = new Function(
      'process',
      '__tqSessionToken',
      `${generateTableAccessHelperCode({ trustedReaderRoles })}
return __taGuardRead`
    )({ env: { NEXTAUTH_SECRET: 'server-secret' } }, async () =>
      session ? { sub: 'u1', role: session.role } : null
    ) as (req: unknown, tableName: string, rawQuery: string | null) => Promise<unknown>
    return async (role: string, tableName: string) => {
      session = { role }
      return guardRead({ headers: {} }, tableName, null)
    }
  }

  it('refuses staff admitted to some admin pages every account, email and order', async () => {
    const readAs = bootGuard(resolveTrustedReaderRoles(STAFF_SCREENS_AUTH))
    for (const table of [
      'users',
      'teleport_sent_emails',
      'teleport_orders',
      'teleport_gift_cards',
    ]) {
      expect(await readAs('staff', table)).toMatchObject({ status: 403 })
      expect(await readAs('admin', table)).toBeNull()
    }
  })
})

describe('the emitted guard compares the app secret with the shared security runtime', () => {
  const boot = (runtime: unknown, projectRoot?: string) => {
    const required: string[] = []
    const presentsAppSecret = new Function(
      'process',
      'require',
      `${generateTableAccessHelperCode({ trustedReaderRoles: [], projectRoot })}
return __taPresentsAppSecret`
    )({ env: { NEXTAUTH_SECRET: 'server-secret' } }, (id: string) => {
      required.push(id)
      if (runtime && id.endsWith('/utils/security-runtime')) {
        return runtime
      }
      throw new Error("Cannot find module '" + id + "'")
    }) as (req: unknown) => boolean
    return { presentsAppSecret, required }
  }
  const presenting = (secret?: string) => ({
    headers: secret === undefined ? {} : { 'x-internal-data-secret': secret },
  })

  it("asks the runtime's safeEqual, required from the folder the route sits in", () => {
    const calls: unknown[][] = []
    const runtime = {
      safeEqual: (a: unknown, b: unknown) => {
        calls.push([a, b])
        return a === b
      },
    }
    const dataApi = boot(runtime)
    expect(dataApi.presentsAppSecret(presenting('server-secret'))).toBe(true)
    expect(dataApi.presentsAppSecret(presenting('guessed-secret'))).toBe(false)
    expect(calls).toEqual([
      ['server-secret', 'server-secret'],
      ['guessed-secret', 'server-secret'],
    ])
    // pages/api/data/[...params].js by default; a fetcher two folders down.
    expect(dataApi.required).toEqual([
      '../../../utils/security-runtime',
      '../../../utils/security-runtime',
    ])
    const fetcher = boot(runtime, '../..')
    expect(fetcher.presentsAppSecret(presenting('server-secret'))).toBe(true)
    expect(fetcher.required).toEqual(['../../utils/security-runtime'])
  })

  it('matches no secret without the runtime, and loads nothing for a request presenting none', () => {
    const missing = boot(null)
    expect(missing.presentsAppSecret(presenting())).toBe(false)
    expect(missing.required).toEqual([])
    expect(missing.presentsAppSecret(presenting('server-secret'))).toBe(false)
    expect(missing.required).toEqual(['../../../utils/security-runtime'])
  })
})
