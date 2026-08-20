import { ProjectUIDL } from '@teleporthq/teleport-types'
import {
  DEFAULT_ORDER_DETAILS_PREFIX,
  readSuccessUrlPrefix,
  resolveOrderDetailsRoutePrefix,
} from '../src/ecommerce/order-details-route'
import { __testables, rewriteLowStockCustomHandlers } from '../src/ecommerce-customhandler-rewriter'

const { buildPaymentMetadataBuilder } = __testables

/**
 * ⛔ THE REPORTED DEFECT (run c133d485): a completed Stripe checkout redirected to
 * `/order-details/ORD-1?payment=success` — a 404 — because the payment-metadata
 * rewrite hard-coded that prefix while the site map routed the order-details page
 * at `/orders/[order_number]`. The COD path was fine: it navigates through
 * `navigation-go-to-page`, which reads the page's real route. Both paths must now
 * read the SAME field.
 */

const goToOrderDetails = (overrides: Record<string, unknown> = {}) => ({
  id: 'nav-1',
  type: 'navigation-go-to-page',
  config: {
    pageId: '/orders/[order_number]',
    targetPage: {
      pageId: 'TQ_Spm9dxZZx6',
      pageName: 'order-details',
      staticUrl: '/orders',
      isDetailsPage: true,
      differentiatorColumn: 'order_number',
      rowOwnerTable: 'teleport_orders',
      ...overrides,
    },
  },
})

const uidlWithNodes = (nodes: unknown[]): ProjectUIDL =>
  ({
    workflows: { workflows: { placeOrder: { id: 'placeOrder', nodes } } },
  } as unknown as ProjectUIDL)

describe('resolveOrderDetailsRoutePrefix', () => {
  it('reads the prefix from the order-details navigation node', () => {
    expect(resolveOrderDetailsRoutePrefix(uidlWithNodes([goToOrderDetails()]))).toBe('/orders')
  })

  it('recognises the page by its orders row-owner table even when the name differs', () => {
    const uidl = uidlWithNodes([
      goToOrderDetails({ pageName: 'purchase-receipt', staticUrl: '/account/receipts' }),
    ])
    expect(resolveOrderDetailsRoutePrefix(uidl)).toBe('/account/receipts')
  })

  it('recognises the page by name when no row-owner table is stamped', () => {
    const uidl = uidlWithNodes([
      goToOrderDetails({ rowOwnerTable: undefined, staticUrl: '/shop/orders' }),
    ])
    expect(resolveOrderDetailsRoutePrefix(uidl)).toBe('/shop/orders')
  })

  it('falls back to the literal route, minus its dynamic segment, when staticUrl is unusable', () => {
    const uidl = uidlWithNodes([goToOrderDetails({ staticUrl: '' })])
    expect(resolveOrderDetailsRoutePrefix(uidl)).toBe('/orders')
  })

  it('never returns a staticUrl that still carries a dynamic segment', () => {
    const uidl = uidlWithNodes([goToOrderDetails({ staticUrl: '/orders/[order_number]' })])
    // Unusable as a prefix, so the pageId fallback answers instead.
    expect(resolveOrderDetailsRoutePrefix(uidl)).toBe('/orders')
  })

  it('strips a trailing slash', () => {
    const uidl = uidlWithNodes([goToOrderDetails({ staticUrl: '/orders/' })])
    expect(resolveOrderDetailsRoutePrefix(uidl)).toBe('/orders')
  })

  it('ignores navigation to OTHER details pages', () => {
    const uidl = uidlWithNodes([
      {
        id: 'nav-2',
        type: 'navigation-go-to-page',
        config: {
          pageId: '/products/[slug]',
          targetPage: {
            pageName: 'product-details',
            staticUrl: '/products',
            isDetailsPage: true,
            rowOwnerTable: 'teleport_products',
          },
        },
      },
    ])
    expect(resolveOrderDetailsRoutePrefix(uidl)).toBe(DEFAULT_ORDER_DETAILS_PREFIX)
  })

  it('ignores a NON-details page that happens to be named order-details', () => {
    const uidl = uidlWithNodes([
      goToOrderDetails({ isDetailsPage: false, rowOwnerTable: undefined, staticUrl: '/nope' }),
    ])
    expect(resolveOrderDetailsRoutePrefix(uidl)).toBe(DEFAULT_ORDER_DETAILS_PREFIX)
  })

  it('also scans custom workflow nodes', () => {
    const uidl = {
      workflows: {
        workflows: {},
        customNodes: { checkout: { id: 'checkout', nodes: [goToOrderDetails()] } },
      },
    } as unknown as ProjectUIDL
    expect(resolveOrderDetailsRoutePrefix(uidl)).toBe('/orders')
  })

  it('returns the default for a project with no workflows at all', () => {
    expect(resolveOrderDetailsRoutePrefix({} as ProjectUIDL)).toBe(DEFAULT_ORDER_DETAILS_PREFIX)
    expect(resolveOrderDetailsRoutePrefix({ workflows: {} } as unknown as ProjectUIDL)).toBe(
      DEFAULT_ORDER_DETAILS_PREFIX
    )
  })

  it('survives malformed nodes', () => {
    const uidl = uidlWithNodes([null, 'nope', { type: 'navigation-go-to-page' }, { config: {} }])
    expect(resolveOrderDetailsRoutePrefix(uidl)).toBe(DEFAULT_ORDER_DETAILS_PREFIX)
  })
})

describe('buildPaymentMetadataBuilder — successUrl uses the resolved prefix', () => {
  const run = (prefix: string) => {
    const code = buildPaymentMetadataBuilder(prefix)
    const fn = new Function(code + '\nreturn customHandler;')() as (params: unknown[]) => {
      successUrl: string
    }
    return fn([{ id: 'uuid-1', total_amount: 10 }, { result: 'ORD-1' }])
  }

  it('builds the redirect under the project route, not the hard-coded one', () => {
    expect(run('/orders').successUrl).toBe('/orders/ORD-1?payment=success')
    expect(run('/account/receipts').successUrl).toBe('/account/receipts/ORD-1?payment=success')
  })

  it('encodes the order number so an exotic token can never break the URL', () => {
    const code = buildPaymentMetadataBuilder('/orders')
    const fn = new Function(code + '\nreturn customHandler;')() as (params: unknown[]) => {
      successUrl: string
    }
    const result = fn([{ id: 'uuid-1', total_amount: 10, order_number: 'ORD 1/2' }])
    expect(result.successUrl).toBe('/orders/ORD%201%2F2?payment=success')
  })
})

/**
 * ⛔ THE HOLE THE TWO SOURCES ABOVE STILL LEFT: both depend on finding a
 * `navigation-go-to-page` node that targets the order-details page. A project
 * whose checkout has no such node — an AI-authored one, or an online-payment-
 * only flow — fell straight through to `/order-details`, the very 404 this file
 * exists to prevent, while the correct route was sitting in the `successUrl` of
 * the node about to be replaced.
 */
describe('readSuccessUrlPrefix — the URL the node itself already declares', () => {
  const handler = (literal: string) =>
    `function customHandler(params) {\n  return {\n    successUrl: ${literal} + encodeURIComponent(orderNumber) + '?payment=success',\n  };\n}`

  it('reads the prefix the GUI baked in, double- or single-quoted', () => {
    expect(readSuccessUrlPrefix(handler('"/orders/"'))).toBe('/orders')
    expect(readSuccessUrlPrefix(handler("'/shop/orders/'"))).toBe('/shop/orders')
  })

  it('reads a prefix with no trailing slash', () => {
    expect(readSuccessUrlPrefix(handler('"/orders"'))).toBe('/orders')
  })

  it('refuses anything that is not a bare prefix', () => {
    expect(readSuccessUrlPrefix(handler('"/orders/[order_number]/"'))).toBeNull()
    expect(readSuccessUrlPrefix(handler('"/orders/?payment=success"'))).toBeNull()
    expect(readSuccessUrlPrefix(handler('"orders/"'))).toBeNull()
    // A bare root would build `successUrl: "//" + orderNumber` — a
    // protocol-relative URL pointing at another host.
    expect(readSuccessUrlPrefix(handler('"/"'))).toBeNull()
  })

  it('returns null when there is no successUrl literal to read', () => {
    expect(readSuccessUrlPrefix('function customHandler(params) { return {}; }')).toBeNull()
    expect(readSuccessUrlPrefix('')).toBeNull()
    expect(readSuccessUrlPrefix(undefined as unknown as string)).toBeNull()
  })
})

describe('the rewrite keeps the route the project or the node already knows', () => {
  const AI_METADATA_NODE = (successUrl: string) => ({
    id: 'meta-1',
    type: 'general-custom-js',
    config: {
      code: `function customHandler(params) {
  var order = params[14] || {};
  return {
    successUrl: '${successUrl}' + order.order_number + '?payment=success',
    metadataJson: JSON.stringify({ orderId: order.id })
  };
}`,
    },
  })

  const successUrlOf = (uidl: ProjectUIDL): string => {
    rewriteLowStockCustomHandlers(uidl)
    const nodes = (
      uidl.workflows as unknown as {
        workflows: Record<string, { nodes: Array<{ config?: { code?: string } }> }>
      }
    ).workflows.placeOrder.nodes
    const rewritten = nodes.find((node) => (node.config?.code ?? '').includes('successUrl'))
    const fn = new Function(rewritten!.config!.code + '\nreturn customHandler;')() as (
      params: unknown[]
    ) => { successUrl: string }
    return fn([{ id: 'uuid-1', total_amount: 10 }, { result: 'ORD-1' }]).successUrl
  }

  it('THE REPORTED DEFECT: the project route wins over the old hard-coded one', () => {
    const uidl = uidlWithNodes([goToOrderDetails(), AI_METADATA_NODE('/order-details/')])
    expect(successUrlOf(uidl)).toBe('/orders/ORD-1?payment=success')
  })

  it('falls back to the URL the node declares when the project has no navigation node', () => {
    const uidl = uidlWithNodes([AI_METADATA_NODE('/orders/')])
    expect(successUrlOf(uidl)).toBe('/orders/ORD-1?payment=success')
  })

  it('the PROJECT still wins when the two disagree — the paid path must match the COD path', () => {
    const uidl = uidlWithNodes([
      goToOrderDetails({ staticUrl: '/account/receipts' }),
      AI_METADATA_NODE('/orders/'),
    ])
    expect(successUrlOf(uidl)).toBe('/account/receipts/ORD-1?payment=success')
  })

  it('keeps the last-resort constant when neither source says anything', () => {
    const uidl = uidlWithNodes([AI_METADATA_NODE('/')])
    expect(successUrlOf(uidl)).toBe('/order-details/ORD-1?payment=success')
  })
})
