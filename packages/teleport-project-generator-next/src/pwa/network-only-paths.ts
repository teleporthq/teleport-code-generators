import { ProjectUIDL, UIDLInstallableWebApp } from '@teleporthq/teleport-types'

/**
 * Never answered from the cache, whatever the project: every API route and
 * the admin panel. The page data Next.js fetches (`/_next/data`) follows the
 * page it is for, which the worker matches against these patterns.
 */
const ALWAYS_NETWORK_ONLY = ['/api', '/admin']

/** The store's payment pages (`/pay/<provider>`) render a live checkout session. */
const STORE_NETWORK_ONLY = ['/pay']

const isDynamicSegment = (segment: string): boolean =>
  segment.includes('[') || segment === '*' || segment.startsWith(':')

/**
 * A route as the prefix pattern the worker matches: lower-case, no trailing
 * slash, cut at the first dynamic segment (`/orders/[id]` → `/orders`). The
 * worker treats a pattern as that path and everything beneath it — except `/`,
 * which only ever means the home page. A route that is dynamic from its first
 * segment has no static prefix to match and yields nothing: making every page
 * of the site network-only would disable the app to protect one route.
 */
export const toNetworkOnlyPattern = (route: string): string | null => {
  const path = route.trim().split(/[?#]/)[0]
  if (!path) {
    return null
  }

  const segments = (path.startsWith('/') ? path : `/${path}`).split('/')
  const dynamicIndex = segments.findIndex(isDynamicSegment)
  if (dynamicIndex === 1) {
    return null
  }

  const staticSegments = dynamicIndex === -1 ? segments : segments.slice(0, dynamicIndex)
  const pattern = staticSegments.join('/').toLowerCase().replace(/\/+$/, '')
  return pattern || '/'
}

const authenticationRoutes = (uidl: ProjectUIDL): string[] => {
  const auth = uidl.authentication
  if (!auth?.enabled) {
    return []
  }

  const protectedRoutes = Object.values(auth.pageProtection || {}).reduce<string[]>(
    (routes, protection) => {
      routes.push(protection.route)
      if (protection.routePattern) {
        routes.push(protection.routePattern)
      }
      return routes
    },
    []
  )
  const authPages = [auth.authPages?.signIn, auth.authPages?.signUp]
    .filter((page): page is NonNullable<typeof page> => !!page)
    .map((page) => page.route)

  return [...protectedRoutes, ...authPages]
}

/**
 * Everything the installable app must fetch from the network every time: the
 * fixed prefixes, the routes the authentication settings protect (the same
 * list the generated middleware guards), the sign-in / sign-up pages, and the
 * private pages the editor knows about (cart, checkout, orders, account…).
 */
export const collectNetworkOnlyPatterns = (
  uidl: ProjectUIDL,
  app: UIDLInstallableWebApp
): string[] => {
  const routes = [
    ...ALWAYS_NETWORK_ONLY,
    ...(uidl.ecommerceSettings ? STORE_NETWORK_ONLY : []),
    ...authenticationRoutes(uidl),
    ...app.networkOnlyPaths,
  ]

  const patterns = new Set<string>()
  routes.forEach((route) => {
    const pattern = typeof route === 'string' ? toNetworkOnlyPattern(route) : null
    if (pattern) {
      patterns.add(pattern)
    }
  })
  // A pattern covers everything beneath it, so `/admin` makes `/admin/orders` redundant.
  // `/` is the exception: it only ever means the home page.
  const covers = (pattern: string, other: string) =>
    pattern !== '/' && other.startsWith(`${pattern}/`)
  const all = Array.from(patterns)
  return all.filter((pattern) => !all.some((other) => covers(other, pattern))).sort()
}
