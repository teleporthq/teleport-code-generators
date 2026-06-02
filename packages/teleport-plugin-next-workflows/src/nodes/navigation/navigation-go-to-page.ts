import { NodeHandlerGenerator, handlerToString } from '../types'

async function navigation_go_to_page(config: any, _context: Record<string, unknown>) {
  // The shared workflow runtime (`resolveConfig`) has already resolved any
  // `{ type: 'workflowContext', ... }` references inside `differentiator`,
  // `queryParams[].key` and `queryParams[].value`, so by this point those
  // fields are plain strings (or undefined when the upstream node failed).
  const targetPage = config.targetPage
  const differentiator = config.differentiator
  const queryParams = Array.isArray(config.queryParams) ? config.queryParams : []
  const openInNewTab = config.openInNewTab

  // Choose the base URL for navigation. Two shapes to handle:
  //
  // 1. DETAILS pages (e.g. /order-details/[order_number]): `targetPage.staticUrl`
  //    is the prefix without the dynamic segment (e.g. '/order-details') and
  //    the differentiator is appended below. `config.pageId` still holds the
  //    literal route with the `[col]` placeholder and would produce an
  //    unroutable URL, so staticUrl wins here.
  //
  // 2. NON-details pages: the project plugin's `runBefore` step has already
  //    rewritten `config.pageId` from a page id ('page_order_success') to
  //    its Next.js route ('/', '/products-list', '/order-success'). That is
  //    the authoritative value. `targetPage.staticUrl` is a mapper best-guess
  //    and can diverge from the real route — most notably, the home page
  //    ships with `staticUrl: '/home'` even though Next.js serves it at '/'
  //    (pages/index.js), so blindly preferring staticUrl would drop the user
  //    on an unrouted '/home' → 404. Prefer pageId for non-details pages.
  let url: string
  if (targetPage && targetPage.isDetailsPage) {
    url =
      typeof targetPage.staticUrl === 'string' && targetPage.staticUrl
        ? targetPage.staticUrl
        : config.pageId || '/'
    if (differentiator !== undefined && differentiator !== null && differentiator !== '') {
      url = url + '/' + encodeURIComponent(String(differentiator))
    }
    // If the differentiator is missing (misconfigured node, or upstream
    // workflow step failed), fall back to the static prefix — the user
    // lands on a 404 instead of '/.../undefined'.
  } else {
    // After `runBefore`, `config.pageId` is the real Next.js route (it starts
    // with '/'). If the route map couldn't resolve the page id — e.g. an auth
    // page such as sign-in that wasn't in the map — `config.pageId` is still
    // the raw page id (e.g. 'TQ_oiC1MlnMiO'), and navigating there 404s. The
    // mapper already stamped the real route on `targetPage.staticUrl`
    // ('/sign-in', …), so fall back to it whenever `config.pageId` is not
    // itself a route. We don't ALWAYS prefer staticUrl because the home page
    // ships `staticUrl: '/home'` while Next.js serves it at '/' — but the home
    // page's pageId always resolves to '/', so it takes the first branch.
    if (typeof config.pageId === 'string' && config.pageId.charAt(0) === '/') {
      url = config.pageId
    } else if (targetPage && typeof targetPage.staticUrl === 'string' && targetPage.staticUrl) {
      url = targetPage.staticUrl
    } else {
      url = (typeof config.pageId === 'string' && config.pageId) || '/'
    }
  }

  if (queryParams.length > 0) {
    const pairs = []
    for (let i = 0; i < queryParams.length; i++) {
      const qp = queryParams[i]
      if (!qp) {
        continue
      }
      const k = qp.key
      if (k === undefined || k === null || k === '') {
        continue
      }
      const v = qp.value
      const encodedKey = encodeURIComponent(String(k))
      const encodedValue = encodeURIComponent(v === undefined || v === null ? '' : String(v))
      pairs.push(encodedKey + '=' + encodedValue)
    }
    if (pairs.length > 0) {
      url += (url.indexOf('?') >= 0 ? '&' : '?') + pairs.join('&')
    }
  }

  if (openInNewTab) {
    window.open(url, '_blank')
  } else {
    window.location.href = url
  }

  return { __terminal: true }
}

export const navigationGoToPage: NodeHandlerGenerator = {
  nodeType: 'navigation-go-to-page',
  executionEnv: 'client',
  isTerminal: true,
  generateHandler(): string {
    return handlerToString(navigation_go_to_page)
  },
}
