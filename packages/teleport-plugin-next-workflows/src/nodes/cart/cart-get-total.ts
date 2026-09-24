import { RegionalPricing } from '@teleporthq/teleport-shared'
import { NodeHandlerGenerator, handlerToString } from '../types'

// AMBIENT, not imported: the handler ships as a serialized function with no
// module scope, and the shared regional-pricing helpers are spliced into its
// body by `generateHandler` below. See `commerce-tracking.ts` for why an import
// would compile to a module reference that throws in the browser.
declare function __rpQuote(input: Record<string, unknown>): any
declare function __rpNormalizeConfig(rows: unknown): Record<string, unknown>
declare function __rpReadCheckoutDestination(countryCodes: unknown): Record<string, string> | null

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
    // The voucher the shopper applied, mirrored from the same localStorage the
    // storefront provider reads. The place-order workflow uses ONLY its `id`,
    // to re-read the row from the database — this copy is never trusted for
    // pricing, because the merchant can edit or disable a voucher after it was
    // applied. Absent on a storefront exported before vouchers existed, which
    // correctly resolves to "no voucher".
    let voucher: Record<string, unknown> | null = null
    // Shipping zones + tax jurisdictions: the rows and store defaults the
    // provider priced the page from, mirrored for exactly this moment. Present
    // only on a store with regional pricing.
    let regionalSnapshot: Record<string, any> | null = null
    try {
      const voucherRaw = localStorage.getItem('workflow_voucher')
      if (voucherRaw) {
        const parsedVoucher = JSON.parse(voucherRaw)
        if (parsedVoucher && typeof parsedVoucher === 'object' && parsedVoucher.code) {
          voucher = parsedVoucher
        }
      }
    } catch (_voucherErr) {
      /* ignore — malformed or unavailable storage reads as no voucher */
    }
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
        if (
          parsed &&
          typeof parsed === 'object' &&
          parsed.regional &&
          typeof parsed.regional === 'object'
        ) {
          regionalSnapshot = parsed.regional
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
    // What the per-product discounts took off this cart, NET. Purely
    // informational: the line prices below are ALREADY marked down, so this is
    // never subtracted from anything — it is what the order row records as
    // `product_discount_amount` for reporting.
    let productDiscount = 0

    for (const item of cart) {
      const qty = item.quantity || 1
      const price = item.price || 0
      net += qty * price
      gross += qty * grossUnitPrice(price)
      itemCount += qty
      // Rounded per UNIT before multiplying, matching the order line's own
      // arithmetic so the two agree to the cent.
      const unitDiscount = Number(item.discountAmount)
      if (isFinite(unitDiscount) && unitDiscount > 0) {
        productDiscount += qty * round(unitDiscount)
      }
    }

    let roundedGross = round(gross)
    let tax = round(gross - net)

    // Re-priced HERE, at submit, for the address on the checkout form right
    // now — with the same rule and the same rows the provider displayed from —
    // rather than trusting a figure computed before the buyer's last edit.
    let regional: Record<string, unknown> | null = null
    if (regionalSnapshot) {
      const store =
        regionalSnapshot.store && typeof regionalSnapshot.store === 'object'
          ? regionalSnapshot.store
          : {}
      const destination = __rpReadCheckoutDestination(regionalSnapshot.countryCodes)
      let selectedRateId: string | null = null
      try {
        selectedRateId = localStorage.getItem('workflow_shipping_rate') || null
      } catch (_rateErr) {
        selectedRateId = null
      }
      const quote = __rpQuote({
        // Null while the provider is still loading the rows: the store's single
        // flat fee and default rate, which is also what the page is showing.
        config: regionalSnapshot.rows ? __rpNormalizeConfig(regionalSnapshot.rows) : null,
        store,
        items: cart,
        destination,
        // Priced as a delivery; the place-order workflow knows whether the
        // buyer picked store pickup and drops the shipping figures then.
        fulfillment: store.deliveryEnabled === true ? 'delivery' : 'pickup',
        selectedRateId,
        currency: regionalSnapshot.currency,
      })
      tax = quote.goodsTax
      roundedGross = quote.goodsGross
      regional = {
        status: quote.status,
        destination: quote.destination,
        zoneName: quote.zone ? quote.zone.name : '',
        rateName: quote.rateName,
        codAvailable: quote.codAvailable,
        goodsNet: quote.goodsNet,
        goodsTax: quote.goodsTax,
        goodsGross: quote.goodsGross,
        shippingNet: quote.shippingNet,
        shippingTax: quote.shippingTax,
        shippingGross: quote.shippingGross,
        taxRate: quote.taxRate,
        taxIncluded: quote.taxIncluded,
        taxDecimals: quote.taxDecimals,
        breakdown: quote.breakdown,
        lines: quote.lines,
      }
    }

    const result: Record<string, unknown> = {
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
      // on top of them (double-taxing every invoice otherwise). On a store with
      // regional pricing it is the destination's added tax, same definition.
      tax,
      // Goods total the buyer actually owes, tax included and shipping
      // excluded. Equals the Subtotal the cart page printed — same per-unit
      // rounding, same source of truth.
      total: roundedGross,
      itemCount,
      // NET sum of the per-product markdowns already reflected in the prices
      // above. Recorded on the order for reporting; never subtracted again.
      productDiscountTotal: round(productDiscount),
      deliveryConfig,
      taxConfig: { storefrontTaxRate },
      voucher,
    }
    // Absent on a store without regional pricing, which is what tells the
    // place-order workflow to price shipping from `deliveryConfig` as before.
    if (regional) {
      result.regional = regional
    }
    return result
  } catch (_err) {
    return {
      subtotal: 0,
      tax: 0,
      total: 0,
      itemCount: 0,
      productDiscountTotal: 0,
      deliveryConfig: null,
      taxConfig: { storefrontTaxRate: 0 },
      voucher: null,
    }
  }
}
export const cartGetTotal: NodeHandlerGenerator = {
  nodeType: 'cart-get-total',
  executionEnv: 'client',
  generateHandler(): string {
    // Spliced INTO the function body rather than appended after it, so the
    // emitted handler stays one function expression — the shape every caller
    // (and every test that evaluates it) expects.
    const source = handlerToString(cart_get_total)
    const bodyStart = source.indexOf('{') + 1
    return (
      source.slice(0, bodyStart) +
      RegionalPricing.generateRegionalPricingHelperCode() +
      source.slice(bodyStart)
    )
  },
}
