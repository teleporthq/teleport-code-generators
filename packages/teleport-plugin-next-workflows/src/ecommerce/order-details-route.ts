// Where the buyer lands after a successful payment.
//
// ## ⛔ THE DEFECT (run c133d485)
//
// `buildPaymentMetadataBuilder` used to hard-code the redirect as
// `'/order-details/' + orderNumber + '?payment=success'`. The order-details page
// is a DETAILS page under whatever folder the site map put it in — this project
// routed it at `/orders/[order_number]` — so every Stripe / PayPal return landed
// on `/order-details/ORD-1?payment=success`, a 404, right after the customer
// paid. The COD path was unaffected because it navigates through
// `navigation-go-to-page`, which resolves the page's REAL route.
//
// Worse, the AI had already written the correct URL: the generated node emitted
// `successUrl: "/orders/" + encodeURIComponent(orderNumber) + "?payment=success"`
// and the rewriter — whose job is to replace positional `params[14]` lookups with
// shape-walking — overwrote it with the hard-coded one. A rewrite that fixes one
// bug must not import another.
//
// The prefix is therefore READ from the project, from the same field the runtime
// navigation node trusts (`targetPage.staticUrl`, the details page's route
// without its dynamic segment), with the literal route as a second source, the
// URL THE NODE ITSELF ALREADY DECLARES as a third, and the old constant only as
// a last resort.
//
// ## ⭐ WHY THE NODE'S OWN URL IS A SOURCE
//
// The place-order workflow is built by the GUI, which bakes the redirect from
// the live document (`resolvePagePath` -> `getResolvedPageUrl`) — so the node
// arrives here already carrying the right answer, `ensureUniquePageUrl`
// suffixes (`/orders1`) and editor renames included. Falling back to the
// constant while that string is sitting in the code we are about to replace is
// how a rewrite imports a 404: the two sources above depend on finding a
// `navigation-go-to-page` node, and an AI-authored or online-payment-only
// checkout need not have one. Reading it costs nothing and closes that hole.
//
// It is deliberately the THIRD source, not the first: `targetPage.staticUrl` is
// the runtime's own resolution of the real route, so where the two disagree the
// project wins and the paid path can never diverge from the COD path.

import { ProjectUIDL } from '@teleporthq/teleport-types'

/** Only used when the project contains no order-details navigation at all. */
export const DEFAULT_ORDER_DETAILS_PREFIX = '/order-details'

const ORDERS_TABLE = 'teleport_orders'
const ORDER_DETAILS_PAGE_NAME_RE = /^order[-_\s]?details$/i

interface TargetPageConfig {
  pageName?: unknown
  staticUrl?: unknown
  isDetailsPage?: unknown
  rowOwnerTable?: unknown
}

interface WorkflowNodeLike {
  type?: string
  config?: {
    pageId?: unknown
    targetPage?: TargetPageConfig | null
  }
}

/** `/orders`, `/shop/orders` — a route prefix, never a trailing slash. */
const normalisePrefix = (value: string): string | null => {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.charAt(0) !== '/') {
    return null
  }
  // A dynamic segment is the differentiator's slot, not part of the prefix.
  if (trimmed.indexOf('[') >= 0) {
    return null
  }
  const withoutTrailingSlash = trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : trimmed
  return withoutTrailingSlash.length > 0 ? withoutTrailingSlash : null
}

/**
 * `/orders/[order_number]` -> `/orders`. Returns null when the route carries no
 * dynamic segment (then it is not a details route and `staticUrl` is the answer).
 */
const prefixFromDynamicRoute = (route: string): string | null => {
  const trimmed = route.trim()
  if (trimmed.charAt(0) !== '/' || trimmed.indexOf('[') < 0) {
    return null
  }
  const segments = trimmed.split('/').filter((segment) => segment.length > 0)
  const kept: string[] = []
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].charAt(0) === '[') {
      break
    }
    kept.push(segments[i])
  }
  return kept.length > 0 ? '/' + kept.join('/') : null
}

const targetsOrderDetails = (targetPage: TargetPageConfig): boolean => {
  if (targetPage.isDetailsPage !== true) {
    return false
  }
  if (targetPage.rowOwnerTable === ORDERS_TABLE) {
    return true
  }
  return (
    typeof targetPage.pageName === 'string' && ORDER_DETAILS_PAGE_NAME_RE.test(targetPage.pageName)
  )
}

const collectWorkflowNodes = (uidl: ProjectUIDL): WorkflowNodeLike[] => {
  const out: WorkflowNodeLike[] = []
  const workflows = uidl.workflows
  if (!workflows) {
    return out
  }
  const push = (graphs: unknown): void => {
    if (!graphs || typeof graphs !== 'object') {
      return
    }
    const values = Object.values(graphs as Record<string, { nodes?: unknown }>)
    for (let i = 0; i < values.length; i++) {
      const nodes = values[i] && values[i].nodes
      if (Array.isArray(nodes)) {
        for (let j = 0; j < nodes.length; j++) {
          out.push(nodes[j] as WorkflowNodeLike)
        }
      }
    }
  }
  push(workflows.workflows)
  push((workflows as { customNodes?: unknown }).customNodes)
  return out
}

/**
 * The order-details prefix a `general-custom-js` handler already declares, read
 * from the `successUrl` string literal it builds — `successUrl: "/orders/" +
 * encodeURIComponent(orderNumber) + "?payment=success"` -> `/orders`. Null when
 * the handler has no such literal (or an unusable one).
 *
 * Pure; never throws.
 */
export const readSuccessUrlPrefix = (code: string): string | null => {
  if (typeof code !== 'string' || code.length === 0) {
    return null
  }
  const match = /successUrl\s*:\s*(['"])([^'"\n]*)\1/.exec(code)
  if (!match) {
    return null
  }
  const literal = match[2]
  // The literal is the PREFIX plus its separator; the order number is
  // concatenated after it. A literal that already carries a whole URL (a query
  // string, a dynamic slot) is not a prefix and is refused rather than trimmed.
  if (literal.indexOf('?') >= 0 || literal.indexOf('[') >= 0) {
    return null
  }
  const prefix = normalisePrefix(literal)
  // A bare '/' is the site root, not a details-page folder — taking it would
  // build `successUrl: "//" + orderNumber`, a protocol-relative URL.
  return prefix === null || prefix === '/' ? null : prefix
}

/**
 * The URL prefix the order-details page is served at, WITHOUT its dynamic
 * segment and without a trailing slash — e.g. `/orders`. Pure; never throws.
 */
export const resolveOrderDetailsRoutePrefix = (uidl: ProjectUIDL): string => {
  let fromRoute: string | null = null

  const nodes = collectWorkflowNodes(uidl)
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (!node || node.type !== 'navigation-go-to-page' || !node.config) {
      continue
    }
    const targetPage = node.config.targetPage
    if (!targetPage || typeof targetPage !== 'object' || !targetsOrderDetails(targetPage)) {
      continue
    }
    // `staticUrl` is what `navigation-go-to-page` itself uses for a details page,
    // so the paid path and the COD path can never disagree.
    if (typeof targetPage.staticUrl === 'string') {
      const prefix = normalisePrefix(targetPage.staticUrl)
      if (prefix) {
        return prefix
      }
    }
    // Second source: the literal route with its `[column]` slot still attached.
    if (fromRoute === null && typeof node.config.pageId === 'string') {
      fromRoute = prefixFromDynamicRoute(node.config.pageId)
    }
  }

  return fromRoute ?? DEFAULT_ORDER_DETAILS_PREFIX
}
