import type { UIDLAuthentication, UIDLAuthPageProtection } from '@teleporthq/teleport-types'
import { resolveAdminPanelRoles } from './table-access'

/**
 * Which pages of a generated site a visitor may open, decided at build time
 * from the project's authentication settings, for the SERVER half of page
 * protection.
 *
 * The generated middleware (`generateMiddlewareFile` in
 * teleport-plugin-next-workflows/src/auth-generator.ts) is the first net, but
 * not one that holds on its own: a Next 12 Pages-Router app with i18n serves
 * `/_next/data/<build>/<page>.json` without running it (CVE-2026-44573), its
 * matcher skips every path that merely starts with "api", and a request that
 * reaches a page around it gets the page's data. So every page the middleware
 * gates also checks the session in its own `getServerSideProps`
 * (`utils/auth/page-access.js`), with the policy decided here.
 *
 * ⛔ The route table below MUST stay the one the middleware builds — same
 * merges, same self-guarded waivers, same admin default — or a page and its
 * middleware disagree about who may read it. A test compiles the middleware
 * and compares (`page-access-route-table.test.ts` in the workflows package).
 */

/** What a page demands of the visitor. Every policy needs a session. */
export interface PageAccessPolicy {
  requiresAuth: boolean
  allowedRoles: string[]
  requiresSubscription?: boolean
  subscriptionProductIds?: string[]
}

export interface ProtectedRouteTable {
  /** Route key (a static path) → its merged protection, as the middleware holds it. */
  protectedRoutes: Record<string, PageAccessPolicy>
  /** Route patterns whose page-load SQL is the access control. */
  selfGuardedRoutes: string[]
  /** The sign-in / sign-up routes, always reachable. */
  authRoutes: string[]
}

/** Where the generated guard module lives, and what a page imports from it. */
export const PAGE_ACCESS_MODULE_FOLDER: ReadonlyArray<string> = ['utils', 'auth']
export const PAGE_ACCESS_MODULE_NAME = 'page-access'
export const PAGE_ACCESS_GUARD_FUNCTION = 'guardPageAccess'

type Protection = Partial<UIDLAuthPageProtection>

// A row-owned details page's own SQL is its access control (it serves a guest
// buyer the order they own by an anonymous id), unless a role or a
// subscription — absolute gates no WHERE clause reproduces — is asked for.
const isRowOwnedSelfGuardedPage = (protection: Protection | undefined): boolean => {
  if (!protection || !protection.rowOwnerColumn) {
    return false
  }
  if (protection.requiresSubscription) {
    return false
  }
  return (protection.allowedRoles || []).length === 0
}

const subscriptionFieldsOf = (
  protection: Pick<PageAccessPolicy, 'requiresSubscription' | 'subscriptionProductIds'> | undefined
): Pick<PageAccessPolicy, 'requiresSubscription' | 'subscriptionProductIds'> => {
  if (!protection || !protection.requiresSubscription) {
    return {}
  }
  return {
    requiresSubscription: true,
    subscriptionProductIds: Array.from(
      new Set((protection.subscriptionProductIds || []).map((id) => String(id).trim()))
    ).filter((id) => id.length > 0),
  }
}

// Two pages on one route key: subscriber-gated only when every one is, the
// product list the union (an "any subscription" page makes it "any").
const mergeSubscriptionFields = (
  existing: PageAccessPolicy | undefined,
  incoming: Protection | undefined
): Pick<PageAccessPolicy, 'requiresSubscription' | 'subscriptionProductIds'> => {
  const next = subscriptionFieldsOf(incoming as PageAccessPolicy)
  if (!existing) {
    return next
  }
  if (!existing.requiresSubscription || !next.requiresSubscription) {
    return {}
  }
  const existingIds = existing.subscriptionProductIds || []
  const nextIds = next.subscriptionProductIds || []
  return {
    requiresSubscription: true,
    subscriptionProductIds:
      existingIds.length === 0 || nextIds.length === 0
        ? []
        : Array.from(new Set([...existingIds, ...nextIds])),
  }
}

const selfGuardedRoutePatternOf = (protection: Protection): string => {
  if (protection.routePattern) {
    return protection.routePattern
  }
  const base = protection.route || ''
  const differentiator = protection.rowOwnerDifferentiator
  if (!base || !differentiator) {
    return base
  }
  return base === '/' ? `/[${differentiator}]` : `${base}/[${differentiator}]`
}

/** The middleware's route table, built the way `generateMiddlewareFile` builds it. */
export const buildProtectedRouteTable = (auth: UIDLAuthentication): ProtectedRouteTable => {
  const protectedRoutes: Record<string, PageAccessPolicy> = {}
  const selfGuardedPageIds = new Set<string>()
  const pageProtection = (auth.pageProtection || {}) as Record<string, Protection>

  for (const [pageId, protection] of Object.entries(pageProtection)) {
    if (isRowOwnedSelfGuardedPage(protection)) {
      selfGuardedPageIds.add(pageId)
      continue
    }
    const existing = protectedRoutes[protection.route]
    protectedRoutes[protection.route] = {
      requiresAuth: !!existing?.requiresAuth || !!protection.requiresAuth,
      allowedRoles: Array.from(
        new Set([...(existing?.allowedRoles || []), ...(protection.allowedRoles || [])])
      ),
      ...mergeSubscriptionFields(existing, protection),
    }
  }

  for (const folder of Object.values(auth.folderProtection || {})) {
    if (!folder || !folder.children) {
      continue
    }
    for (const [childId, childType] of Object.entries(folder.children)) {
      const pageProt = pageProtection[childId]
      if (childType !== 'page' || !pageProt) {
        continue
      }
      const folderRoles = folder.allowedRoles || []
      if (isRowOwnedSelfGuardedPage(pageProt) && folderRoles.length === 0) {
        continue
      }
      selfGuardedPageIds.delete(childId)
      const existingEntry = protectedRoutes[pageProt.route]
      protectedRoutes[pageProt.route] = {
        requiresAuth: true,
        allowedRoles: Array.from(new Set([...(existingEntry?.allowedRoles || []), ...folderRoles])),
        ...(existingEntry
          ? subscriptionFieldsOf(existingEntry)
          : subscriptionFieldsOf(pageProt as PageAccessPolicy)),
      }
    }
  }

  const selfGuardedRoutes = Array.from(
    new Set(
      Array.from(selfGuardedPageIds)
        .map((pageId) => selfGuardedRoutePatternOf(pageProtection[pageId]))
        .filter((pattern) => !!pattern)
    )
  )

  const authRoutes: string[] = []
  if (auth.authPages?.signIn) {
    authRoutes.push(auth.authPages.signIn.route)
  }
  if (auth.authPages?.signUp) {
    authRoutes.push(auth.authPages.signUp.route)
  }
  for (const route of authRoutes) {
    delete protectedRoutes[route]
  }

  // `/admin` itself, and every admin page without an entry of its own, admit
  // the admin panel's roles.
  const sawAdminRoute = Object.keys(protectedRoutes).some(
    (key) => key === '/admin' || key.indexOf('/admin/') === 0
  )
  if (sawAdminRoute && !protectedRoutes['/admin']) {
    const panelRoles = resolveAdminPanelRoles(auth)
    protectedRoutes['/admin'] = {
      requiresAuth: true,
      allowedRoles: panelRoles.length > 0 ? panelRoles : ['admin'],
    }
  }

  return { protectedRoutes, selfGuardedRoutes, authRoutes }
}

// The middleware's own route-pattern matcher, ported as is: "[param]" is one
// segment, every other character literal.
const compileRoutePattern = (pattern: string): RegExp => {
  const escaped = String(pattern).replace(/[.*+?^${}()|\\]/g, '\\$&')
  const source = escaped
    .replace(/\[\[\.\.\.[^\]]*\]\]/g, '.+')
    .replace(/\[\.\.\.[^\]]*\]/g, '.+')
    .replace(/\[[^\]]*\]/g, '[^/]+')
  return new RegExp('^' + source + '$')
}

const normalizeMatchPath = (path: string): string =>
  path.length > 1 && path.endsWith('/') ? path.replace(/\/+$/, '') : path

const isUnder = (path: string, route: string): boolean =>
  path === route || path.startsWith(route + '/')

/**
 * The policy the middleware applies to a request for `route` (a page's route
 * as written — `/dashboard`, `/orders/[id]`), or null when it lets every
 * visitor through: no entry or ancestor covers it, it is a sign-in / sign-up
 * or `/auth/…` page, a self-guarded details page under a role-less ancestor,
 * or an entry that asks for nothing.
 */
export const resolveRouteAccessPolicy = (
  table: ProtectedRouteTable,
  route: string
): PageAccessPolicy | null => {
  const matchPath = normalizeMatchPath(route || '/')
  if (table.authRoutes.some((authRoute) => isUnder(matchPath, authRoute))) {
    return null
  }
  if (isUnder(matchPath, '/auth')) {
    return null
  }

  const { protectedRoutes } = table
  const exact = Object.prototype.hasOwnProperty.call(protectedRoutes, matchPath)
    ? protectedRoutes[matchPath]
    : null
  let matched = exact
  if (!matched) {
    const keys = Object.keys(protectedRoutes).sort((a, b) => b.length - a.length)
    const ancestor = keys.find((key) => matchPath.startsWith(key + '/'))
    matched = ancestor ? protectedRoutes[ancestor] : null
  }
  if (!matched) {
    return null
  }

  const allowedRoles = matched.allowedRoles || []
  if (
    !exact &&
    allowedRoles.length === 0 &&
    table.selfGuardedRoutes.some((pattern) => compileRoutePattern(pattern).test(matchPath))
  ) {
    return null
  }
  if (!matched.requiresAuth && allowedRoles.length === 0 && !matched.requiresSubscription) {
    return null
  }

  return {
    requiresAuth: true,
    allowedRoles: allowedRoles.slice(),
    ...subscriptionFieldsOf(matched),
  }
}

/**
 * The owner column of the row-owned (self-guarded) page the middleware lets
 * through at `route`, found with the middleware's own patterns
 * (`table.selfGuardedRoutes`), or null when no such page is served there.
 */
export const selfGuardedOwnerColumnAt = (
  auth: UIDLAuthentication,
  table: ProtectedRouteTable,
  route: string
): string | null => {
  const matchPath = normalizeMatchPath(route || '/')
  const pattern = table.selfGuardedRoutes.find((candidate) =>
    compileRoutePattern(candidate).test(matchPath)
  )
  if (!pattern) {
    return null
  }
  const protection = Object.values((auth.pageProtection || {}) as Record<string, Protection>).find(
    (candidate) =>
      isRowOwnedSelfGuardedPage(candidate) && selfGuardedRoutePatternOf(candidate) === pattern
  )
  return (protection && protection.rowOwnerColumn) || null
}

/** The route a generated page is served from: `/`, `/about`, `/orders/[id]`. */
export const pageServedRoute = (uidl: {
  outputOptions?: { folderPath?: string[]; fileName?: string }
}): string => {
  const { folderPath = [], fileName = '' } = uidl.outputOptions || {}
  const segments = [...(folderPath || []), fileName].filter((segment) => !!segment)
  if (segments[segments.length - 1] === 'index') {
    segments.pop()
  }
  return '/' + segments.join('/')
}

/**
 * The server-side check a page renders behind, or null for a page every
 * visitor may open — and for every page of a project whose authentication is
 * off (it ships no middleware, no session and no sign-in either).
 */
export const resolvePageAccessPolicy = (
  uidl: { outputOptions?: { folderPath?: string[]; fileName?: string } },
  auth: UIDLAuthentication | undefined | null
): PageAccessPolicy | null => {
  if (!auth || auth.enabled !== true) {
    return null
  }
  return resolveRouteAccessPolicy(buildProtectedRouteTable(auth), pageServedRoute(uidl))
}
