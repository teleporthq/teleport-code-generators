import {
  CartCurrency,
  CartLinePricing,
  DiscountEngine,
  ProductDiscounts,
  ProductOptions,
} from '@teleporthq/teleport-shared'
import { NodeHandlerGenerator, handlerToString } from '../types'
import {
  STALLED_RESERVATION_RELEASE,
  STOCK_RESERVATION_KEY,
  buildStalledReservationCandidatesQuery,
  buildStalledReservationReleaseQueries,
} from '../../ecommerce/place-order-guards'
import { cartGetTotal } from './cart-get-total'

// AMBIENT, not imported — see cart-get-total.ts. `__cartPricingSettings` is
// bound by the route's preamble (see cart-pricing-preamble.ts); the pricing
// helpers and `__runCartTotal` are spliced into the handler by
// `generateHandler` below.
declare const __cartPricingSettings: any
// Spliced in by `generateHandler`: the statement that releases the stock of
// orders whose checkout never reached a payment page (place-order-guards.ts),
// in the forms tried in turn: logging each order with the ledger's record
// columns, logging on an older ledger, and for a store with no ledger.
declare const __stalledReservationReleaseQueries: string[]
// The orders a pass may release, read first (unlocked) so their metadata is
// parsed here: a malformed row is skipped and logged, never cast in SQL.
declare const __stalledReservationCandidatesQuery: string
declare const __stalledReservationKey: string
declare const __stalledReservationBatchSize: number
declare function __clPriceLine(
  item: any,
  product: any,
  variant: any,
  nowMs: number,
  withWeight: boolean
): any
declare function __clVariantLabel(variantOptions: unknown, options: unknown): string
declare function __clVariantSwatches(variantOptions: unknown, options: unknown): unknown[]
declare function __runCartTotal(storage: unknown, document: unknown): Promise<any>
declare function __ccCode(value: unknown): string
declare function __ccCurrencies(lines: unknown): string[]
declare function __ccMixedCartMessage(codes: string[]): string

/**
 * Prices the order on the SERVER, from the database, with the storefront's own
 * rules — what the order is recorded at and charged. Nothing the browser says
 * about a price is an input: the cart contributes only what the buyer chose
 * (product, variant, options, quantity), the checkout form the address it
 * ships to, and the buyer's picks (shipping rate, discount set). Every price,
 * markdown, tax and fee is read from the product rows, the store's settings
 * (`utils/ecommerce/cart-pricing-settings.js`, baked at export) and the rows
 * the checkout's own server steps read: automatic discounts, the shopper's
 * order count, and the voucher and gift card the database re-confirmed.
 *
 * The totals come from `cart-get-total` itself — the handler the buyer's
 * summary is priced by — run over those rows instead of the browser's copies,
 * so the two can only disagree when something changed underneath the buyer
 * (and the place-order workflow then shows the new figure before charging it).
 *
 * Every line is priced in its product's currency, and nothing converts between
 * currencies: a cart whose products name more than one is refused (the
 * add-to-cart node refuses the mix already; a cart merged at sign-in, or a
 * product whose currency changed after it was added, still reaches here).
 *
 * Result: `cart-get-total`'s result — its `currency` is the order's, read off
 * the product rows — plus `priced: true` and `lines` (the cart lines as priced
 * here, what the order lines record). An order that cannot be priced answers
 * `priced: false` with a `reason` for the buyer — never `error`, which the
 * runtime treats as fatal — and the workflow refuses it.
 *
 * The payment method is decided here too, from the store's own methods
 * (`paymentMethods` in the same settings): cash on delivery only where the
 * store takes it, otherwise one of its enabled online providers. An empty
 * method is refused — never read as cash on delivery — and so is a checkout
 * that does not say which method it chose. The accepted method travels in
 * the result (`paymentMethod`), so the order is assembled from the method
 * checked here rather than whatever a later request says.
 *
 * `stockDeltas` is what the order takes from stock — the units per product
 * (variantless lines) and per variant, duplicates summed — read off the lines
 * priced here, for the statement that reserves them with the order.
 *
 * `pricedForm` / `pricedShipToDifferent` are the checkout form and the
 * ship-to-different flag this step priced shipping and tax for. The assemble
 * step builds the order's addresses from them, so the address an order
 * records is always the one it was priced (and its zone decided) for.
 */
async function cart_price_order(config: any, context: any) {
  const noStock = () => ({
    productIds: [] as string[],
    productQtys: [] as number[],
    variantIds: [] as string[],
    variantQtys: [] as number[],
  })
  const refuse = (reason: string) => ({
    priced: false,
    reason,
    lines: [] as unknown[],
    stockDeltas: noStock(),
  })
  const settings =
    typeof __cartPricingSettings !== 'undefined' && __cartPricingSettings
      ? __cartPricingSettings
      : null
  if (!settings || !settings.dataSourceId) {
    return refuse('This store cannot price the order right now. Please try again later.')
  }

  const methods =
    settings.paymentMethods && typeof settings.paymentMethods === 'object'
      ? settings.paymentMethods
      : null
  if (!methods || !Object.prototype.hasOwnProperty.call(config, 'paymentMethod')) {
    return refuse('This store cannot take the order right now. Please try again later.')
  }
  const paymentMethod = typeof config.paymentMethod === 'string' ? config.paymentMethod.trim() : ''
  if (!paymentMethod) {
    return refuse('Choose a payment method to place your order.')
  }
  if (paymentMethod === 'cash_on_delivery') {
    if (methods.cashOnDelivery !== true) {
      return refuse("This store doesn't take payment on delivery. Choose another payment method.")
    }
  } else if (!Array.isArray(methods.providers) || methods.providers.indexOf(paymentMethod) === -1) {
    return refuse("This payment method isn't available. Choose another payment method.")
  }

  const readRows = (value: any): any[] => {
    if (Array.isArray(value)) {
      return value
    }
    if (value && typeof value === 'object') {
      if (Array.isArray(value.result)) {
        return value.result
      }
      if (Array.isArray(value.rows)) {
        return value.rows
      }
    }
    return []
  }

  const rawItems: any[] = Array.isArray(config.items)
    ? config.items
    : config.items && Array.isArray(config.items.items)
    ? config.items.items
    : []
  const chosen: any[] = []
  for (const item of rawItems) {
    if (!item || typeof item !== 'object' || !item.productId) {
      continue
    }
    const quantity = Math.floor(Number(item.quantity))
    chosen.push({
      ...item,
      productId: String(item.productId),
      variantId: item.variantId ? String(item.variantId) : null,
      quantity: isFinite(quantity) && quantity >= 1 ? quantity : 1,
    })
  }
  if (chosen.length === 0) {
    return refuse('Your cart is empty.')
  }

  const baseUrl = (context && context.__baseUrl) || ''
  const internalHeaders = (context && context.__internalHeaders) || {}
  const env = (globalThis as any).process && (globalThis as any).process.env
  const select = async (tableName: string, filters: unknown[], limit: number) => {
    const response = await fetch(baseUrl + '/api/data/' + settings.dataSourceId + '/select', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-data-secret': (env && env.NEXTAUTH_SECRET) || '',
        ...internalHeaders,
      },
      body: JSON.stringify({ tableName, filters, limit }),
    })
    if (!response.ok) {
      throw new Error('Could not read ' + tableName)
    }
    const body = await response.json()
    return Array.isArray(body && body.rows) ? body.rows : []
  }

  // Orders that reserved stock but never reached a payment page get no
  // provider event, and on a store without scheduled workflows nothing else
  // runs for them: each checkout releases the ones past their hold first, at
  // most one pass per instance every five minutes, never awaited where the
  // runtime keeps it alive: a long-running server, or Vercel's waitUntil when
  // the app has one. A Vercel function without it waits for the pass (one
  // bounded statement). A pass that releases a full batch lets the next
  // checkout run another at once, so a backlog drains at least as fast as
  // checkouts add to it. A failed pass is retried by the first checkout after
  // those five minutes.
  if (settings.releaseStalledReservations === true) {
    const scope = globalThis as any
    const sweepAt = Date.now()
    if (!scope.__tqReservationSweepAt || sweepAt - scope.__tqReservationSweepAt > 5 * 60 * 1000) {
      scope.__tqReservationSweepAt = sweepAt
      const releaseWith = (query: string, params: unknown[]) =>
        fetch(baseUrl + '/api/data/' + settings.dataSourceId + '/raw-query', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-data-secret': (env && env.NEXTAUTH_SECRET) || '',
            ...internalHeaders,
          },
          body: JSON.stringify({ query, params }),
        })
      const pass = (async () => {
        const listed: any = await releaseWith(__stalledReservationCandidatesQuery, [])
        const listing = await listed.json().catch(() => null)
        if (!listed || !listed.ok || !listing || !Array.isArray(listing.rows)) {
          return
        }
        const readable: string[] = []
        const warned = scope.__tqUnreadableReservations || (scope.__tqUnreadableReservations = {})
        for (const candidate of listing.rows) {
          const id = String((candidate && candidate.id) || '')
          let parsed: any = null
          try {
            parsed = JSON.parse(String((candidate && candidate.metadata) || ''))
          } catch (_error) {
            // Once per order and instance: its stock stays held for the
            // merchant, and every other order is still released.
            if (id && !warned[id]) {
              warned[id] = true
              // tslint:disable-next-line:no-console
              console.warn(
                '[checkout] order ' +
                  id +
                  ' has metadata that is not valid JSON: its reserved stock is not released automatically.'
              )
            }
            continue
          }
          if (
            id &&
            parsed &&
            typeof parsed === 'object' &&
            Array.isArray(parsed[__stalledReservationKey])
          ) {
            readable.push(id)
          }
          if (readable.length >= __stalledReservationBatchSize) {
            break
          }
        }
        if (readable.length === 0) {
          return
        }
        for (const query of __stalledReservationReleaseQueries) {
          const response: any = await releaseWith(query, [readable])
          const result = await response.json().catch(() => null)
          if (response && response.ok) {
            const row = result && Array.isArray(result.rows) ? result.rows[0] : null
            if (row && Number(row.released) >= __stalledReservationBatchSize) {
              scope.__tqReservationSweepAt = 0
            }
            return
          }
          // Only a ledger without the log's columns (42703) or without the
          // table (42P01) moves on to the next form; anything else waits for
          // the next pass.
          const code = String((result && result.code) || '')
          if (code !== '42703' && code !== '42P01') {
            return
          }
        }
      })().then(
        () => undefined,
        () => undefined
      )
      if (env && env.VERCEL) {
        if (typeof scope.__tqWaitUntil === 'function') {
          scope.__tqWaitUntil(pass)
        } else {
          await pass
        }
      }
    }
  }

  const productIds: string[] = []
  for (const line of chosen) {
    if (productIds.indexOf(line.productId) === -1) {
      productIds.push(line.productId)
    }
  }
  let products: any[]
  let variants: any[]
  let regionalRows: Record<string, unknown[]> | null = null
  try {
    products = await select(
      'teleport_products',
      [{ field: 'id', operator: '=', value: productIds }],
      productIds.length
    )
    const needsVariants = chosen.some((line) => line.variantId)
    variants = needsVariants
      ? await select(
          'teleport_product_variants',
          [{ field: 'product_id', operator: '=', value: productIds }],
          1000
        )
      : []
    if (settings.regional) {
      regionalRows = {
        zones: await select('teleport_shipping_zones', [], 1000),
        rates: await select('teleport_shipping_rates', [], 1000),
        taxRates: await select('teleport_tax_rates', [], 1000),
      }
    }
  } catch (_readErr) {
    return refuse('The order could not be priced right now. Please try again in a moment.')
  }

  const productById: Record<string, any> = {}
  for (const row of products) {
    if (row && row.id != null) {
      productById[String(row.id)] = row
    }
  }
  const variantById: Record<string, any> = {}
  for (const row of variants) {
    if (row && row.id != null) {
      variantById[String(row.id)] = row
    }
  }

  const now = Date.now()
  const unavailable = ['draft', 'archived', 'inactive', 'deleted']
  const lines: any[] = []
  for (const line of chosen) {
    const product = productById[line.productId]
    if (!product || unavailable.indexOf(String(product.status || '').toLowerCase()) !== -1) {
      return refuse('A product in your cart is no longer available. Please review your cart.')
    }
    let variant: any = null
    if (line.variantId) {
      variant = variantById[line.variantId]
      // A variant prices only its own product: a cheaper variant of another
      // product must never stand in for the one in the cart.
      if (!variant || String(variant.product_id) !== line.productId) {
        return refuse(
          'A product option in your cart is no longer available. Please review your cart.'
        )
      }
    }
    const priced = __clPriceLine(line, product, variant, now, !!settings.regional)
    lines.push({
      ...line,
      name: product.name || line.name || '',
      variant: variant ? __clVariantLabel(product.variant_options, variant.options) : '',
      variantSwatches: variant ? __clVariantSwatches(product.variant_options, variant.options) : [],
      ...priced,
      currency: __ccCode(product.currency),
    })
  }
  const currencies = __ccCurrencies(lines)
  if (currencies.length > 1) {
    return refuse(__ccMixedCartMessage(currencies))
  }

  // What the checkout's own server steps confirmed.
  const orderRows = readRows(config.customerOrders)
  const orderCount = orderRows.length > 0 && orderRows[0] ? parseInt(orderRows[0].count, 10) : NaN
  const customer = isNaN(orderCount) ? null : { isFirstOrder: orderCount === 0 }
  const voucherCheck =
    config.voucherCheck && typeof config.voucherCheck === 'object' ? config.voucherCheck : null
  const voucherRow = voucherCheck && voucherCheck.voucherRow ? voucherCheck.voucherRow : null
  const giftCardCheck =
    config.giftCardCheck && typeof config.giftCardCheck === 'object' ? config.giftCardCheck : null
  const giftCardRow =
    giftCardCheck && giftCardCheck.ok === 'true' && giftCardCheck.giftCardRow
      ? giftCardCheck.giftCardRow
      : null
  // The buyer's own picks, from their summary: which shipping rate, and which
  // set of discounts when several could apply but not together.
  const clientTotal =
    config.clientTotal && typeof config.clientTotal === 'object' ? config.clientTotal : {}
  const selectedRateId =
    clientTotal.regional && clientTotal.regional.selectedRateId
      ? String(clientTotal.regional.selectedRateId)
      : ''
  const discountChoice =
    clientTotal.discounts && typeof clientTotal.discounts.choice === 'string'
      ? clientTotal.discounts.choice
      : ''

  const cartSettings: Record<string, unknown> = {
    deliveryConfig: settings.deliveryConfig,
    taxConfig: settings.taxConfig,
    vouchersEnabled: settings.vouchersEnabled,
    subscriptions: settings.subscriptions,
    paymentKinds: settings.paymentKinds,
    customer,
  }
  if (settings.regional && regionalRows) {
    cartSettings.regional = {
      store: settings.regional.store,
      currency: settings.regional.currency,
      countryCodes: settings.regional.countryCodes,
      rows: regionalRows,
    }
  }
  if (settings.discounts) {
    cartSettings.discounts = {
      enabled: true,
      automaticDiscounts: settings.discounts.automaticDiscounts,
      rows: readRows(config.discountRows),
      customer,
    }
  }
  if (settings.giftCards) {
    cartSettings.giftCards = {
      enabled: true,
      currency: settings.giftCards.currency,
      recurringTender: settings.giftCards.recurringTender,
    }
  }
  const stored: Record<string, string> = {
    workflow_cart: JSON.stringify(lines),
    workflow_cart_settings: JSON.stringify(cartSettings),
    workflow_discount_choice: discountChoice,
    workflow_shipping_rate: selectedRateId,
  }
  if (voucherRow) {
    stored.workflow_voucher = JSON.stringify(voucherRow)
  }
  if (giftCardRow) {
    stored.workflow_gift_card = JSON.stringify({
      id: giftCardRow.id,
      last4: giftCardRow.last4 || String(giftCardRow.code || '').slice(-4),
      balance: giftCardRow.balance,
      currency: giftCardRow.currency,
    })
  }
  const storage = {
    getItem: (key: string) =>
      Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null,
  }

  // The address the order ships to, answered the way the checkout form's
  // fields would be: the shipping block only while "ship to a different
  // address" is ticked, the billing address otherwise — the same address the
  // order records.
  const form = config.form && typeof config.form === 'object' ? config.form : {}
  const shipToDifferent = String(config.shipToDifferent) === 'true'
  const fields: Record<string, unknown> = {
    billingCountry: form.billingCountry,
    state: form.state,
    shippingCountry: shipToDifferent ? form.shippingCountry : undefined,
    shippingState: shipToDifferent ? form.shippingState : undefined,
  }
  const formDocument = {
    querySelector: (selector: string) => {
      const match = /^\[name="([A-Za-z]+)"\]$/.exec(String(selector))
      if (!match || fields[match[1]] === undefined) {
        return null
      }
      const value = fields[match[1]]
      return { value: value == null ? '' : String(value) }
    },
  }

  const total = await __runCartTotal(storage, formDocument)
  let expectedCount = 0
  for (const line of lines) {
    expectedCount += Number(line.quantity) || 0
  }
  // `cart-get-total` answers zeros when it fails; a result without its own
  // fields, or one that did not count every line, was never priced.
  if (
    !total ||
    typeof total !== 'object' ||
    !('isDigitalOnly' in total) ||
    total.itemCount !== expectedCount
  ) {
    return refuse('The order could not be priced right now. Please try again in a moment.')
  }
  // A variant line draws on its variant's stock, never its product's; lines
  // drawing on the same row add up (two lines of 3 are 6 units).
  const stockDeltas = noStock()
  for (const line of lines) {
    const ids = line.variantId ? stockDeltas.variantIds : stockDeltas.productIds
    const qtys = line.variantId ? stockDeltas.variantQtys : stockDeltas.productQtys
    const id = String(line.variantId || line.productId)
    const units = Math.floor(Number(line.quantity))
    const qty = isFinite(units) && units >= 1 ? units : 1
    const at = ids.indexOf(id)
    if (at === -1) {
      ids.push(id)
      qtys.push(qty)
    } else {
      qtys[at] += qty
    }
  }
  // The address the order was priced for, exactly as this step read it: the
  // order records its shipping address from here, never from a form a later
  // request hands the assemble step (which could name another country).
  return {
    ...total,
    priced: true,
    reason: '',
    lines,
    paymentMethod,
    stockDeltas,
    pricedForm: form,
    pricedShipToDifferent: shipToDifferent ? 'true' : 'false',
  }
}

export const cartPriceOrder: NodeHandlerGenerator = {
  nodeType: 'cart-price-order',
  executionEnv: 'server',
  generateHandler(): string {
    // Spliced INTO the function body, so the emitted handler stays one function
    // expression: the line pricing rule and its helpers, and `cart-get-total`'s
    // own handler run over the storage and form this node builds.
    const source = handlerToString(cart_price_order)
    const bodyStart = source.indexOf('{') + 1
    return (
      source.slice(0, bodyStart) +
      `\nvar __stalledReservationReleaseQueries = ${JSON.stringify(
        buildStalledReservationReleaseQueries()
      )};\nvar __stalledReservationCandidatesQuery = ${JSON.stringify(
        buildStalledReservationCandidatesQuery()
      )};\nvar __stalledReservationKey = ${JSON.stringify(
        STOCK_RESERVATION_KEY
      )};\nvar __stalledReservationBatchSize = ${STALLED_RESERVATION_RELEASE.batchSize};\n` +
      ProductDiscounts.generateProductDiscountHelperCode() +
      '\n' +
      ProductOptions.generateProductOptionsHelperCode() +
      '\n' +
      DiscountEngine.generateDiscountEngineHelperCode() +
      '\n' +
      CartLinePricing.generateCartLinePricingHelperCode() +
      '\n' +
      CartCurrency.generateCartCurrencyHelperCode() +
      '\nvar __runCartTotal = function (localStorage, document) { return (' +
      cartGetTotal.generateHandler() +
      ')(); };\n' +
      source.slice(bodyStart)
    )
  },
}
