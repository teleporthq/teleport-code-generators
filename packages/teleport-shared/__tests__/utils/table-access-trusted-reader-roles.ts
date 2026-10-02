/* tslint:disable:function-constructor */
import type { UIDLAuthentication } from '@teleporthq/teleport-types'
import {
  generateTableAccessHelperCode,
  resolveTrustedReaderRoles,
} from '../../src/utils/table-access'

/**
 * Who may read the store's private tables (accounts, sent emails, orders,
 * gift cards …) from a browser: the roles the generated admin panel's FOLDER
 * admits. An internal tool admits its staff to the tool's own pages — the
 * dashboard and each table's list and views — and a role on one of those
 * pages must never become a reader of every protected table.
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

// What `authenticationToUIDL` emits for an internal tool that owns its shell:
// the admin folder admits admins, the tool's screens (and their entity folder)
// admit staff too, and the built-in entities stay admin only.
const INTERNAL_TOOL_AUTH = authWith(
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
  it("trusts the admin folder's roles, never the staff an internal tool admits to its pages", () => {
    expect(resolveTrustedReaderRoles(INTERNAL_TOOL_AUTH)).toEqual(['admin'])
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
    const pages = INTERNAL_TOOL_AUTH.pageProtection
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

  it("refuses an internal tool's staff every account, email and order", async () => {
    const readAs = bootGuard(resolveTrustedReaderRoles(INTERNAL_TOOL_AUTH))
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
