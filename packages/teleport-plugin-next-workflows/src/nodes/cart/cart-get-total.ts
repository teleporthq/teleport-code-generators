import { DiscountEngine, RegionalPricing } from '@teleporthq/teleport-shared'
import { NodeHandlerGenerator, handlerToString } from '../types'

// AMBIENT, not imported: the handler ships as a serialized function with no
// module scope, and the shared regional-pricing and discount-engine helpers
// are spliced into its body by `generateHandler` below. See
// `commerce-tracking.ts` for why an import would compile to a module reference
// that throws in the browser.
declare function __rpQuote(input: Record<string, unknown>): any
declare function __rpNormalizeConfig(rows: unknown): Record<string, unknown>
declare function __rpReadCheckoutDestination(countryCodes: unknown): Record<string, string> | null
declare function __deNormalizeRule(row: unknown, source: string): Record<string, unknown> | null
declare function __deLinesFromCart(items: unknown): unknown[]
declare function __deResolve(input: Record<string, unknown>): any
declare function __deTender(input: Record<string, unknown>): { applied: number; amountDue: number }
declare function __deBool(value: unknown, fallback: boolean): boolean

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
    // The discount engine's rule feed (`{ enabled, automaticDiscounts, rows,
    // customer }`), the shopper context the checkout page-load workflow wrote
    // (`{ isFirstOrder, resolvedAt }`) and the gift-card feature
    // (`{ enabled, currency }`), all mirrored by the provider for exactly this
    // moment. Each is absent on a store without the feature, and on a
    // storefront exported before it existed — which correctly resolves to the
    // flat voucher rule and no tender. Whether a stored voucher is honoured
    // at all travels the same way; absent means no objection.
    let discountsSnapshot: Record<string, any> | null = null
    let customerSnapshot: Record<string, any> | null = null
    let giftCardsSnapshot: Record<string, any> | null = null
    // Whether recurring products can be sold and by which providers — mirrored
    // at export, so the place-order script reads the CURRENT capability rather
    // than the list baked into it when the checkout page was built.
    let subscriptionsSnapshot: Record<string, any> | null = null
    let vouchersEnabled = true
    // The gift card the shopper applied — `{ id, last4, balance, currency }`
    // as the Apply Gift Card workflow left it. The place-order workflow uses
    // ONLY its `id`, to re-read and debit the row; the balance here decides
    // what the summary showed, never what is charged.
    let storedGiftCard: Record<string, any> | null = null
    // The set of discounts the shopper chose when several could apply but not
    // together — the checkout's chooser writes it; unknown reads as "the set
    // that saves the most". Literal key: a serialized handler cannot import
    // `DiscountEngine.DISCOUNT_CHOICE_STORAGE_KEY`.
    let discountChoice = ''
    try {
      discountChoice = localStorage.getItem('workflow_discount_choice') || ''
    } catch (_choiceErr) {
      discountChoice = ''
    }
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
        if (parsed && typeof parsed === 'object') {
          if (parsed.discounts && typeof parsed.discounts === 'object') {
            discountsSnapshot = parsed.discounts
          }
          if (parsed.customer && typeof parsed.customer === 'object') {
            customerSnapshot = parsed.customer
          }
          if (parsed.giftCards && typeof parsed.giftCards === 'object') {
            giftCardsSnapshot = parsed.giftCards
          }
          if (typeof parsed.vouchersEnabled === 'boolean') {
            vouchersEnabled = parsed.vouchersEnabled
          }
          if (parsed.subscriptions && typeof parsed.subscriptions === 'object') {
            subscriptionsSnapshot = parsed.subscriptions
          }
        }
      }
    } catch (_settingsErr) {
      /* ignore — fall back to absent deliveryConfig / no tax */
    }
    try {
      const giftCardRaw = localStorage.getItem('workflow_gift_card')
      if (giftCardRaw) {
        const parsedGiftCard = JSON.parse(giftCardRaw)
        if (parsedGiftCard && typeof parsedGiftCard === 'object' && parsedGiftCard.id) {
          storedGiftCard = parsedGiftCard
        }
      }
    } catch (_giftCardErr) {
      /* ignore — malformed or unavailable storage reads as no gift card */
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

    // The subscription in the basket (at most one — the add-to-cart node
    // refuses a second), whether its first charge is a free trial, and
    // whether every line is delivered without a parcel (a download or a gift
    // card). Read off the flags the add-to-cart node and the provider's
    // hydration stamp, so a storefront exported before them reads as neither.
    let hasRecurringLines = false
    let hasRecurringTrial = false
    let digitalLines = 0
    for (const item of cart) {
      if (item && __deBool(item.isRecurring, false)) {
        hasRecurringLines = true
        if (Math.floor(Number(item.trialDays)) > 0) hasRecurringTrial = true
      }
      if (item && (__deBool(item.isDigital, false) || __deBool(item.isGiftCard, false))) {
        digitalLines += 1
      }
    }
    const isDigitalOnly = cart.length > 0 && digitalLines === cart.length

    // Re-priced HERE, at submit, for the address on the checkout form right
    // now — with the same rule and the same rows the provider displayed from —
    // rather than trusting a figure computed before the buyer's last edit.
    let regional: Record<string, unknown> | null = null
    let regionalQuote: any = null
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
      regionalQuote = quote
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
        // A digital-only cart ships nothing, so the zone's fee is not charged
        // — the provider priced the page the same way.
        shippingNet: isDigitalOnly ? 0 : quote.shippingNet,
        shippingTax: isDigitalOnly ? 0 : quote.shippingTax,
        shippingGross: isDigitalOnly ? 0 : quote.shippingGross,
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
      // What the place-order workflow branches on: a subscription opens the
      // provider's checkout in subscription mode, a digital-only order is
      // charged no delivery and completes on payment.
      hasRecurringLines,
      isDigitalOnly,
    }
    // Absent on a store without regional pricing, which is what tells the
    // place-order workflow to price shipping from `deliveryConfig` as before.
    if (regional) {
      result.regional = regional
    }
    if (subscriptionsSnapshot) {
      result.subscriptions = subscriptionsSnapshot
    }

    // The discount engine and the gift-card tender, re-priced HERE, at submit,
    // exactly as the provider priced the summary: the same shared rule over the
    // same lines, rules and shopper context, so the amount the place-order
    // workflow compares against (`displayedAmountDue`) is the amount the buyer
    // was shown. Only for a store that mirrored either feature — a legacy
    // storefront's result keeps every key it ever had and gains none.
    const discountsEnabled = discountsSnapshot !== null && discountsSnapshot.enabled === true
    const giftCardsEnabled = giftCardsSnapshot !== null && giftCardsSnapshot.enabled === true
    if (discountsEnabled || giftCardsEnabled) {
      // The lines the engine prices: on a regional store already GROSS in the
      // destination's tax (rate 0), otherwise the stored NET lines with the
      // storefront rate — the provider's `regionalVoucherItems` projection.
      let engineItems: any[] = cart
      let engineTaxRate = storefrontTaxRate
      // The delivery fee that would be charged before any discount, priced the
      // way the provider's `computeShippingMeta` / regional quote prices it.
      let shippingPrice = 0
      if (regionalQuote) {
        engineTaxRate = 0
        shippingPrice = round(Number(regionalQuote.shippingGross) || 0)
        engineItems = cart.map((item: any, index: number) => {
          const key =
            item && item.id !== undefined && item.id !== null ? String(item.id) : String(index)
          const quoteLines: any[] = Array.isArray(regionalQuote.lines) ? regionalQuote.lines : []
          for (const line of quoteLines) {
            if (line && line.key === key) {
              return { ...item, price: line.unitGross }
            }
          }
          return item
        })
      } else if (deliveryConfig && deliveryConfig.deliveryEnabled === true) {
        const threshold = round(deliveryConfig.freeDeliveryThreshold)
        // Same half-cent epsilon as the provider, for the same IEEE-754 drift.
        const shippingIsFree =
          deliveryConfig.freeDeliveryEnabled && roundedGross + 0.005 >= threshold
        shippingPrice = shippingIsFree ? 0 : round(deliveryConfig.deliveryPrice)
      }
      // Nothing to ship on a digital-only cart: no fee, so nothing to waive —
      // the provider priced the page the same way.
      if (isDigitalOnly) {
        shippingPrice = 0
      }
      const customer = customerSnapshot || (discountsSnapshot && discountsSnapshot.customer) || null
      const rules: unknown[] = []
      if (
        discountsEnabled &&
        discountsSnapshot.automaticDiscounts === true &&
        Array.isArray(discountsSnapshot.rows)
      ) {
        // Exactly the rows the provider priced: the data route served only the
        // rules the DATABASE calls live, and the browser clock is not asked
        // again — the same clock re-prices the order server-side, so a rule
        // that has since ended is caught there and the feed re-read.
        for (const row of discountsSnapshot.rows) {
          if (!row || typeof row !== 'object' || row.status !== 'active') continue
          const rule = __deNormalizeRule(row, 'automatic')
          if (rule) rules.push(rule)
        }
      }
      const evaluation = __deResolve({
        rules,
        voucher: vouchersEnabled && voucher ? __deNormalizeRule(voucher, 'voucher') : null,
        lines: __deLinesFromCart(engineItems),
        taxRatePercent: engineTaxRate,
        shippingPrice,
        customer: {
          isFirstOrder:
            customer && typeof customer.isFirstOrder === 'boolean' ? customer.isFirstOrder : null,
        },
        // A store without the rule feed prices its voucher the way its baked
        // place-order workflow does: no conditions, no stacking.
        legacy: !discountsEnabled,
        choice: discountChoice,
      })
      const effectiveShipping = Math.max(0, round(shippingPrice - evaluation.shippingDiscount))
      const deliveryTotal = Math.max(
        0,
        round(roundedGross + effectiveShipping - evaluation.goodsDiscount)
      )
      if (discountsEnabled) {
        const appliedIds: string[] = []
        for (const entry of evaluation.applied) {
          appliedIds.push(String(entry.id))
        }
        result.discounts = {
          enabled: true,
          automaticDiscounts: discountsSnapshot.automaticDiscounts === true,
          rows: Array.isArray(discountsSnapshot.rows) ? discountsSnapshot.rows : null,
          customer,
          applied: evaluation.applied,
          goodsDiscount: evaluation.goodsDiscount,
          shippingDiscount: evaluation.shippingDiscount,
          // Order-column shaped: everything each source took, goods and waived
          // shipping alike, the way `automatic_discount_amount` records it.
          automaticDiscount: round(
            evaluation.automaticGoodsDiscount + evaluation.automaticShippingDiscount
          ),
          voucherDiscount: round(
            evaluation.voucherGoodsDiscount + evaluation.voucherShippingDiscount
          ),
          appliedIds,
          // The sets the shopper could choose between and the one applied, so
          // the place-order workflow prices the order with the same pick.
          options: evaluation.options,
          choice: evaluation.choice,
        }
      }
      let displayedAmountDue = deliveryTotal
      if (giftCardsEnabled) {
        let giftCard: Record<string, unknown> | null = null
        // A card is only ever redeemed in the store's own currency — the same
        // gate the provider's loader applies.
        const storeCurrency =
          typeof giftCardsSnapshot.currency === 'string' ? giftCardsSnapshot.currency : ''
        const cardCurrency = storedGiftCard ? String(storedGiftCard.currency || '') : ''
        if (storedGiftCard && cardCurrency.toUpperCase() === storeCurrency.toUpperCase()) {
          let hasGiftCardLines = false
          for (const item of cart) {
            if (item && __deBool(item.isGiftCard, false)) hasGiftCardLines = true
          }
          const balance = Number(storedGiftCard.balance)
          const tender = __deTender({
            balance: isFinite(balance) ? balance : 0,
            // On the DELIVERY total: the larger of the two shapes, so a pickup
            // order's amount due can only come out lower than what was shown.
            total: deliveryTotal,
            currency: storeCurrency,
            hasGiftCardLines,
            // A subscription is billed by the provider every cycle: the card
            // pays part of the first charge only, none of a free trial, and
            // nothing at all on a checkout that cannot reduce the first
            // charge (the provider mirrors whether this one can).
            hasRecurringLines,
            recurringTenderAllowed: giftCardsSnapshot.recurringTender === true,
            hasRecurringTrial,
          })
          // A card that pays nothing (no balance, a gift card in the basket) is
          // not in play — the provider hides it the same way.
          if (tender.applied > 0) {
            giftCard = {
              id: String(storedGiftCard.id),
              last4: String(storedGiftCard.last4 || ''),
              balance: isFinite(balance) ? balance : 0,
              amount: tender.applied,
              amountDue: tender.amountDue,
            }
            displayedAmountDue = tender.amountDue
          }
        }
        result.giftCard = giftCard
      }
      result.displayedAmountDue = displayedAmountDue
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
      '\n' +
      DiscountEngine.generateDiscountEngineHelperCode() +
      source.slice(bodyStart)
    )
  },
}
