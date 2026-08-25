import { NodeHandlerGenerator, handlerToString } from '../types'

async function cart_get_total() {
  try {
    const raw = localStorage.getItem('workflow_cart')
    const cart: any[] = raw ? JSON.parse(raw) : []

    // Surface the runtime delivery + tax config alongside the totals so the
    // place-order workflow's assemble script can compute shipping from
    // CURRENT settings instead of values baked at workflow-build time.
    // Without this, changing `Settings → Delivery → deliveryPrice` in the
    // GUI updates the cart UI immediately (it reads
    // `ecommerce.Settings.Delivery.deliveryPrice` at render) but the order
    // INSERT keeps charging the old baked value until the buyer re-exports
    // their UIDL. Mirroring the config here lets the workflow stay in sync
    // without an export round-trip.
    //
    // `deliveryEnabled` / `storePickupEnabled` come from the same snapshot and
    // are what let the assemble script tell "this order is delivered" from
    // "this store only does pickup" — a fee may only be charged for the
    // former. They are OPTIONAL on the wire: a storefront exported before they
    // existed publishes neither, and the assemble script then falls back to
    // its own build-time snapshot rather than reading `false` into a store
    // that does deliver.
    let deliveryConfig: {
      deliveryPrice: number
      freeDeliveryEnabled: boolean
      freeDeliveryThreshold: number
      deliveryEnabled?: boolean
      storePickupEnabled?: boolean
    } | null = null
    // Percentage the storefront adds on top of the stored (net) product price.
    // EcommerceProvider mirrors it here from the merchant's invoice settings —
    // see `applyStorefrontTax` in `ecommerce-context-generator.ts`. Absent for
    // storefronts exported before storefront tax existed, which correctly
    // resolves to "no tax".
    let storefrontTaxRate = 0
    try {
      const settingsRaw = localStorage.getItem('workflow_cart_settings')
      if (settingsRaw) {
        const parsed = JSON.parse(settingsRaw)
        if (parsed && typeof parsed === 'object' && parsed.deliveryConfig) {
          deliveryConfig = {
            deliveryPrice: Number(parsed.deliveryConfig.deliveryPrice) || 0,
            freeDeliveryEnabled: !!parsed.deliveryConfig.freeDeliveryEnabled,
            freeDeliveryThreshold: Number(parsed.deliveryConfig.freeDeliveryThreshold) || 0,
          }
          // Copied only when actually present, so "absent" stays
          // distinguishable from "explicitly false" downstream.
          if (typeof parsed.deliveryConfig.deliveryEnabled === 'boolean') {
            deliveryConfig.deliveryEnabled = parsed.deliveryConfig.deliveryEnabled
          }
          if (typeof parsed.deliveryConfig.storePickupEnabled === 'boolean') {
            deliveryConfig.storePickupEnabled = parsed.deliveryConfig.storePickupEnabled
          }
        }
        if (parsed && typeof parsed === 'object' && parsed.taxConfig) {
          const parsedRate = Number(parsed.taxConfig.storefrontTaxRate)
          storefrontTaxRate = isFinite(parsedRate) && parsedRate > 0 ? parsedRate : 0
        }
      }
    } catch (_settingsErr) {
      /* ignore — fall back to absent deliveryConfig / no tax */
    }

    const round = (n: number) => Math.round(n * 100) / 100
    // Per-UNIT rounding, matching EcommerceProvider exactly, so the amount the
    // buyer is charged is the number the cart page printed for them.
    const grossUnitPrice = (price: number) =>
      storefrontTaxRate > 0 ? round(price * (1 + storefrontTaxRate / 100)) : price

    let net = 0
    let gross = 0
    let itemCount = 0

    for (const item of cart) {
      const qty = item.quantity || 1
      const price = item.price || 0
      net += qty * price
      gross += qty * grossUnitPrice(price)
      itemCount += qty
    }

    const roundedGross = round(gross)

    return {
      // NET goods total. Deliberately unchanged in meaning: two generations of
      // baked place-order workflows read this field and add shipping to it to
      // produce `teleport_orders.total_amount`. Making it gross here would make
      // an OLD baked workflow write a taxed order total while still emitting
      // untaxed payment line items — and Stripe Checkout totals the line items
      // and ignores the top-level amount, so the buyer would be undercharged.
      // Tax arrives additively instead, via `tax` below, which an old workflow
      // simply never reads.
      subtotal: round(net),
      // The tax the storefront adds on top, derived as gross − net rather than
      // recomputed from the rate, so `net line items + tax` reconciles to
      // `total` to the cent. Payment providers that total a `line_items` array
      // need this as its own line: the item lines carry NET prices, because
      // `teleport_order_items` stores net and the invoice route adds VAT back
      // on top of them (double-taxing every invoice otherwise).
      tax: round(gross - net),
      // Goods total the buyer actually owes, tax included and shipping
      // excluded. Equals the Subtotal the cart page printed — same per-unit
      // rounding, same source of truth.
      total: roundedGross,
      itemCount,
      deliveryConfig,
      taxConfig: { storefrontTaxRate },
    }
  } catch (_err) {
    return {
      subtotal: 0,
      tax: 0,
      total: 0,
      itemCount: 0,
      deliveryConfig: null,
      taxConfig: { storefrontTaxRate: 0 },
    }
  }
}
export const cartGetTotal: NodeHandlerGenerator = {
  nodeType: 'cart-get-total',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(cart_get_total)
  },
}
