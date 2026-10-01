import { UIDLEcommerceSettings, UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import { EmailDate, ProductOptions, StorefrontTax } from '@teleporthq/teleport-shared'

// The settings payload every workflow-facing consumer shares: the
// /api/ecommerce/settings route bakes it as its response literal, and the
// generated ecommerce-context publishes the SAME object on
// `window.__teleportEcommerceSettings` so the `ecommerce-get-settings`
// workflow node (client-side, see teleport-plugin-next-workflows) can read it
// without a network round trip. Keep the two consumers on this ONE builder —
// the workflow node treats the baked global and the route response as
// interchangeable.
export const buildWorkflowEcommerceSettingsPayload = (
  settings: UIDLEcommerceSettings,
  invoiceSettings?: UIDLInvoiceSettings
): Record<string, unknown> => {
  const stockConfig = settings.stockManagementConfig
  return {
    guestCheckout: settings.guestCheckout,
    stockManagement: settings.stockManagement,
    allowBackorders: stockConfig?.allowBackorders ?? true,
    maxQuantityPerProduct: stockConfig?.maxQuantityPerProduct ?? null,
    lowStockThreshold: stockConfig?.lowStockThreshold ?? 5,
    outOfStockVisibility: stockConfig?.outOfStockVisibility ?? 'visible',
    cashOnDelivery: settings.cashOnDelivery,
    deliveryEnabled: settings.deliveryEnabled,
    storePickupEnabled: settings.storePickupEnabled,
    // Gates the checkout voucher UI and neutralises a voucher already sitting
    // in a shopper's browser when the merchant turns the feature off.
    vouchersEnabled: settings.vouchersEnabled === true,
    // The discount engine and gift cards, same rule as the Settings object the
    // pages read: present when the UIDL carries the block, i.e. the checkout
    // page (and the workflows it runs) were built with the feature.
    discountEngineEnabled: settings.discountEngine?.enabled === true,
    automaticDiscountsEnabled:
      settings.discountEngine?.enabled === true &&
      settings.discountEngine.automaticDiscounts === true,
    giftCardsEnabled: settings.giftCards?.enabled === true,
    // Storefront tax view — the same collapse the cart context uses:
    // `storefrontTaxRate` is 0 whenever nothing is added on top of the stored
    // net prices (tax included in price, no rate, or no invoice settings), so
    // consumers (e.g. the AI chat's pricing prompt) can branch on it alone.
    storefrontTaxRate: StorefrontTax.resolveStorefrontTaxRate(invoiceSettings),
    taxIncludedInPrice: invoiceSettings?.taxIncludedInPrice === true,
    defaultTaxRate:
      typeof invoiceSettings?.defaultTaxRate === 'number' ? invoiceSettings.defaultTaxRate : 0,
  }
}

export const generateEcommerceSettingsApiRoute = (
  settings: UIDLEcommerceSettings,
  invoiceSettings?: UIDLInvoiceSettings
): string => {
  const settingsPayload = JSON.stringify(
    buildWorkflowEcommerceSettingsPayload(settings, invoiceSettings)
  )

  return `export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  return res.status(200).json(${settingsPayload})
}
`
}

export const generateStockCheckApiRoute = (
  settings: UIDLEcommerceSettings,
  dataSourceType: string | null,
  dataSourceConfig: Record<string, unknown> | null
): string => {
  const dbImport = generateDbImport(dataSourceType, dataSourceConfig)
  const maxQty = settings.stockManagementConfig?.maxQuantityPerProduct ?? null
  const allowBackorders = settings.stockManagementConfig?.allowBackorders ?? false

  if (!dbImport) {
    return `export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  return res.status(200).json({ available: true, stock: null, maxQuantityPerProduct: ${
    maxQty === null ? 'null' : maxQty
  } })
}
`
  }

  return `${dbImport}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { productId, quantity, currentCartQuantity } = req.body
    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required' })
    }

    // The products table column is "quantity" (every other code path
    // — place-order decrement, admin update, low-stock SELECT —
    // uses this name). An earlier version of this endpoint shipped
    // "stock_quantity", which always returned NULL because the column
    // doesn't exist; the availability check then trivially passed.
    const result = await db.query(
      'SELECT quantity FROM teleport_products WHERE id = $1',
      [productId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' })
    }

    const stockQuantity = result.rows[0].quantity
    const requestedQty = quantity || 1
    const cartQty = currentCartQuantity || 0
    const maxQtyPerProduct = ${maxQty === null ? 'null' : maxQty}
    const allowBackorders = ${allowBackorders}

    let effectiveMax = null
    if (maxQtyPerProduct !== null && !allowBackorders && stockQuantity !== null) {
      effectiveMax = Math.min(maxQtyPerProduct, stockQuantity)
    } else if (maxQtyPerProduct !== null) {
      effectiveMax = maxQtyPerProduct
    } else if (!allowBackorders && stockQuantity !== null) {
      effectiveMax = stockQuantity
    }

    const available = effectiveMax === null || (cartQty + requestedQty) <= effectiveMax

    return res.status(200).json({
      available,
      stock: stockQuantity,
      requested: requestedQty,
      maxQuantityPerProduct: maxQtyPerProduct,
      effectiveMax,
    })
  } catch (error) {
    console.error('Stock check error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
`
}

// Read-only endpoint the storefront variant-picker widget calls to load a
// product's purchasable combinations (teleport_product_variants). Modeled on
// the store-locations route: `db` via generateDbImport, graceful inert fallback
// for non-DB sources. Accepts `?productId=<id>` or `?productIds=a,b,c` (batched
// for a products-list page). Returns rows verbatim; the widget resolves the
// selected combination + effective price/stock/image client-side.
export const generateProductVariantsApiRoute = (
  dataSourceType: string | null,
  dataSourceConfig: Record<string, unknown> | null
): string => {
  const dbImport = generateDbImport(dataSourceType, dataSourceConfig)
  if (!dbImport) {
    return `export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  return res.status(200).json({ variants: [] })
}
`
  }

  return `${dbImport}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    var idsParam = req.query.productIds || req.query.productId || ''
    var ids = String(idsParam)
      .split(',')
      .map(function (s) { return s.trim() })
      .filter(function (s) { return s.length > 0 })
    if (ids.length === 0) {
      return res.status(200).json({ variants: [] })
    }

    const result = await db.query(
      'SELECT id, product_id, options, price, sku, image_url, gallery_images, quantity, position FROM teleport_product_variants WHERE product_id = ANY($1) ORDER BY position ASC',
      [ids]
    )
    return res.status(200).json({ variants: result.rows })
  } catch (error) {
    console.error('Product variants fetch error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
`
}

export const generateStoreLocationsApiRoute = (
  dataSourceType: string | null,
  dataSourceConfig: Record<string, unknown> | null
): string => {
  const dbImport = generateDbImport(dataSourceType, dataSourceConfig)
  if (!dbImport) {
    return `export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  return res.status(200).json({ locations: [] })
}
`
  }

  return `${dbImport}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // \`is_active\` is the schema column (VARCHAR storing the literal string
    // 'true' / 'false' — see STORE_LOCATIONS_TABLE_SCHEMA). Older code looked
    // for a BOOLEAN \`active\` column that never existed, so every project
    // got back an empty list and the checkout page rendered "no locations".
    const result = await db.query(
      "SELECT id, name, address, city, state, zip, country, phone FROM teleport_store_locations WHERE is_active = 'true' ORDER BY name"
    )
    return res.status(200).json({ locations: result.rows })
  } catch (error) {
    console.error('Store locations error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
`
}

/**
 * The two routes that settle a payment from the provider's own answer (the
 * PayPal capture, the confirmation any provider's buyer comes back to) share
 * how they reach the store's webhook route: the settlement request carries
 * the runtime's internal-call token, so the webhook route reads the payment
 * from the provider with the store's credentials and runs what its webhook
 * runs. Nothing but a provider id comes from the buyer's request.
 */
const STORE_SETTLEMENT_CODE = `var paymentDrivers = null;
try { paymentDrivers = require('../../../../utils/payments'); } catch (_e) { paymentDrivers = null; }
var serverRuntime = null;
try { serverRuntime = require('../../../../utils/workflows/server-runtime'); } catch (_e) { serverRuntime = null; }

// The internal-call token travels only to this deployment's own origin: the
// host Vercel routed, NEXTAUTH_URL, or a development server on loopback.
// Anywhere else the Host header is the caller's to choose, so nothing is sent.
function settlementBaseUrl(req) {
  const base = serverRuntime.trustedBaseUrl(req)
  if (process.env.VERCEL) {
    return base
  }
  try {
    const host = new URL(base).hostname
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
      return base
    }
    return new URL(String(process.env.NEXTAUTH_URL || '')).origin === base ? base : ''
  } catch (_error) {
    return ''
  }
}

// Whether the webhook route at \`settleUrl\` settled the payment \`request\`
// names; it answers an error when the provider has nothing to settle yet.
async function settleWithStore(req, settleUrl, request) {
  if (!settleUrl || !serverRuntime) {
    return false
  }
  const baseUrl = settlementBaseUrl(req)
  if (!baseUrl) {
    return false
  }
  try {
    const response = await fetch(baseUrl + settleUrl, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, serverRuntime.internalRequestHeaders(req)),
      body: JSON.stringify({ teleportReconcile: request }),
    })
    return response.ok
  } catch (error) {
    console.error('Payment settlement request failed:', error && error.message)
    return false
  }
}
`

// Server-side endpoint the store's pages hit after PayPal sends the buyer
// back: `?payment=success&token={paypalOrderId}&PayerID=…` for an order (which
// PayPal does not pay until it is CAPTURED), `?subscription_id=I-…` for a
// subscription. The capture itself is the store's PayPal driver
// (`utils/payments`), which owns the credentials and the sandbox/live
// detection; capturing an order twice is answered as success.
//
// The payment is then SETTLED at once through the store's own PayPal webhook
// route (`settleUrl`), so an order is marked paid even when PayPal's webhook
// never arrives (a store on localhost, a Webhook ID of another app). The
// webhook PayPal sends later is a replay. `settleUrl` is null when no
// workflow receives PayPal's webhook: the capture alone runs.
export const generatePaypalCaptureApiRoute = (settleUrl: string | null): string => {
  return `${STORE_SETTLEMENT_CODE}
var SETTLE_URL = ${JSON.stringify(settleUrl)}
var SUBSCRIPTION_ID = /^I-[A-Z0-9]{6,40}$/

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const body = req.body || {}

  // A subscription the buyer approved: its mandate, then its first payment.
  const subscriptionId = typeof body.subscriptionId === 'string' ? body.subscriptionId.trim() : ''
  if (subscriptionId) {
    if (!SUBSCRIPTION_ID.test(subscriptionId)) {
      return res.status(400).json({ error: 'Invalid PayPal subscription id' })
    }
    const activated = await settleWithStore(req, SETTLE_URL, { kind: 'subscription', id: subscriptionId })
    const paid = await settleWithStore(req, SETTLE_URL, { kind: 'subscription-payment', id: subscriptionId })
    return res.status(200).json({ success: true, subscriptionId, settled: activated && paid })
  }

  const orderId = body.orderId || body.token
  if (!orderId || typeof orderId !== 'string') {
    return res.status(400).json({ error: 'Missing PayPal order id' })
  }

  const driver = paymentDrivers ? paymentDrivers.get('paypal') : null
  if (!driver) {
    return res.status(500).json({ error: 'This store has no PayPal payment driver' })
  }

  const result = await driver.confirmReturn({ query: { token: orderId } })
  if (!result.ok) {
    // An order the store closed (paid another way, or cancelled) is refused,
    // not failed: nothing was captured, and nothing should be.
    return res.status(result.closed ? 409 : 502).json({ error: result.error || 'PayPal capture failed' })
  }
  const settled = await settleWithStore(req, SETTLE_URL, { kind: 'order', id: orderId })
  return res.status(200).json({
    success: true,
    alreadyCaptured: !!result.alreadyCaptured,
    orderId,
    status: result.status || 'COMPLETED',
    settled,
  })
}
`
}

/** The longest checkout reference a provider hands out (Square's is two ids joined). */
const MAX_CHECKOUT_REFERENCE_LENGTH = 200

// Server-side endpoint the order page asks while it tells a buyer back from
// the provider that their payment is being confirmed: the checkout the order
// recorded (`payment_attempt_ref`) is read from the provider and settled
// through that provider's webhook route (`settleUrls`, by provider id), as
// its webhook would. A store the provider cannot reach (localhost, where
// Mollie is given no webhook address; a webhook set up wrong) still sees its
// orders paid, and a webhook arriving later is a replay.
//
// Anyone may ask: the answer comes from the provider, so a made-up reference
// settles nothing, and a real one only what the provider says happened.
export const generatePaymentConfirmApiRoute = (settleUrls: Record<string, string>): string => {
  return `${STORE_SETTLEMENT_CODE}
var SETTLE_URLS = ${JSON.stringify(settleUrls)}
var MAX_REFERENCE_LENGTH = ${MAX_CHECKOUT_REFERENCE_LENGTH}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const body = req.body || {}
  const provider = typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : ''
  const reference = typeof body.reference === 'string' ? body.reference.trim() : ''
  const settleUrl = Object.prototype.hasOwnProperty.call(SETTLE_URLS, provider) ? SETTLE_URLS[provider] : ''
  const driver = settleUrl && paymentDrivers ? paymentDrivers.get(provider) : null
  if (!driver || typeof driver.reconcileKinds !== 'function') {
    return res.status(400).json({ error: 'This store cannot confirm payments of that provider' })
  }
  const kinds = reference && reference.length <= MAX_REFERENCE_LENGTH ? driver.reconcileKinds(reference) : []
  if (!Array.isArray(kinds) || kinds.length === 0) {
    return res.status(400).json({ error: 'Unknown checkout reference' })
  }
  // In order: a subscription's mandate before its first payment.
  let settled = false
  for (const kind of kinds) {
    settled = (await settleWithStore(req, settleUrl, { kind, id: reference })) || settled
  }
  return res.status(200).json({ success: true, settled })
}
`
}

export const generateDeliveryPriceApiRoute = (settings: UIDLEcommerceSettings): string => {
  const config = settings.deliveryConfig

  if (!config) {
    return `export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  return res.status(200).json({ deliveryCost: 0, isFree: true })
}
`
  }

  return `export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { subtotal } = req.body
    const basePrice = ${config.deliveryPrice}
    const freeDeliveryEnabled = ${config.freeDeliveryEnabled}
    const freeDeliveryThreshold = ${config.freeDeliveryThreshold}

    let deliveryCost = basePrice
    let isFree = false

    if (freeDeliveryEnabled && typeof subtotal === 'number' && subtotal >= freeDeliveryThreshold) {
      deliveryCost = 0
      isFree = true
    }

    return res.status(200).json({
      deliveryCost,
      isFree,
      estimatedDays: ${
        config.estimatedDeliveryDays !== null ? config.estimatedDeliveryDays : 'null'
      },
    })
  } catch (error) {
    console.error('Delivery price error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
`
}

/**
 * The order-notification and low-stock-alert routes email the MERCHANT what
 * their request body says. Only the store's own server code calls them — the
 * order INSERT's auto-fire (data-create-item, presenting the internal-call
 * token of utils/workflows/server-runtime), the data API's low-stock auto-fire
 * and the legacy payment webhooks (both presenting the app secret) — so
 * anything else is refused: an open route let anyone send the merchant mail
 * with content of their choosing, from the store's own address. The secret is
 * compared in constant time, and with no NEXTAUTH_SECRET at all nothing
 * passes. The runtime module is required lazily and guarded: a project with no
 * server workflow has no such module and no caller presenting its token.
 */
const STORE_SERVER_CALLER_CODE = `// See STORE_SERVER_CALLER_CODE in ecommerce-api-routes-generator.ts.
function __isStoreServerCall(req) {
  var expected = process.env.NEXTAUTH_SECRET
  if (!expected) return false
  var given = req && req.headers ? req.headers['x-internal-data-secret'] : ''
  if (typeof given === 'string' && given) {
    var a = Buffer.from(given)
    var b = Buffer.from(String(expected))
    if (a.length === b.length && require('crypto').timingSafeEqual(a, b)) return true
  }
  try {
    var runtime = require('../../../utils/workflows/server-runtime')
    return !!(runtime && typeof runtime.isInternalCall === 'function' && runtime.isInternalCall(req))
  } catch (e) {
    return false
  }
}
`

const STORE_SERVER_CALLER_CHECK = `  if (!__isStoreServerCall(req)) {
    return res.status(401).json({ error: 'Unauthenticated' })
  }
`

export const generateOrderNotificationApiRoute = (
  settings: UIDLEcommerceSettings,
  dataSourceType: string | null = null,
  dataSourceConfig: Record<string, unknown> | null = null,
  invoiceSettings?: UIDLInvoiceSettings
): string => {
  const config = settings.orderNotificationConfig
  // `teleport_order_items` stores NET prices — the invoice route re-derives VAT
  // from them — so the merchant's copy of the order shows what the buyer PAID:
  // the line's own record where checkout wrote one, else the price grossed at
  // the rate the order recorded for it (or the store default), exactly like the
  // workflow-sent twin (`buildOrderEmailPayloadScript` in the editor).
  const storefrontTaxHelper =
    StorefrontTax.generateStorefrontTaxHelperCode(
      StorefrontTax.resolveStorefrontTaxRate(invoiceSettings)
    ) + StorefrontTax.generateOrderLineTaxHelperCode()
  if (!config || !config.provider) {
    return `export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  return res.status(200).json({ sent: false, reason: 'notifications_not_configured' })
}
`
  }

  const subjectTemplate = config.subject || 'New Order {{orderNumber}}'
  const bodyTemplate = config.body || 'A new order ({{orderNumber}}) was placed.'
  const notificationEmails = JSON.stringify(config.notificationEmails || [])
  // A template written before product options existed has no `{{configuration}}`
  // token in its item rows; its lines then carry the options in the product name.
  const bodyHasConfigurationToken = /\{\{\s*configuration\s*\}\}/.test(bodyTemplate)

  // The order-line fallback below is Postgres-only: it uses `$N` placeholders
  // and joins the teleport_* order tables, exactly like the checkout / cart
  // routes. For any other datasource the loader is omitted and the endpoint
  // behaves as before (it renders whatever `items` the caller passed).
  const dbImport = isPostgresCartDataSource(dataSourceType)
    ? generateDbImport(dataSourceType, dataSourceConfig)
    : null

  // Loads the order's persisted lines when the CALLER couldn't supply them.
  // The payment webhooks (Stripe `checkout.session.completed`, PayPal
  // `PAYMENT.CAPTURE.COMPLETED`) only know the provider's session/capture
  // payload — they have an orderId but no cart — so without this every
  // online-payment notification reached the merchant with an empty item list.
  // `teleport_order_items` is the authoritative snapshot written by checkout,
  // and the image is resolved variant-override-first, matching the
  // order-details page. Never throws: a failure degrades to "no items", which
  // is exactly the pre-existing behaviour.
  //
  // The paid-price record and the order's tax breakdown are read through
  // `to_jsonb(...) ->>` rather than named: a store provisioned before either
  // existed has no such column, and a named column that is absent fails the
  // whole statement — and with it every line of the email.
  //
  // The product options a line was bought with are read the same way, and
  // through the shared snapshot parser (`ProductOptions`), which reads both the
  // current snapshot and the compact form older checkouts wrote.
  //
  // A line is in its ORDER's currency: checkout never writes the line's own
  // column, which holds its USD default.
  const orderItemsLoader = dbImport
    ? `
${ProductOptions.generateProductOptionsHelperCode()}

const ORDER_ITEMS_QUERY =
  "SELECT oi.product_id, oi.product_name, oi.variant_label, oi.quantity, oi.unit_price, oi.total_price, " +
  "COALESCE(NULLIF(TRIM(o.currency), ''), oi.currency) AS currency, " +
  "to_jsonb(oi) ->> 'variant_id' AS variant_id, " +
  "to_jsonb(oi) ->> 'unit_price_paid' AS unit_price_paid, to_jsonb(oi) ->> 'total_price_paid' AS total_price_paid, " +
  "to_jsonb(oi) ->> 'tax_rate' AS tax_rate, to_jsonb(oi) ->> 'tax_included' AS tax_included, " +
  "to_jsonb(oi) ->> 'configuration' AS configuration, to_jsonb(oi) ->> 'configuration_label' AS configuration_label, " +
  "to_jsonb(o) ->> 'tax_breakdown' AS tax_breakdown, " +
  "COALESCE(NULLIF(v.image_url, ''), NULLIF(p.image_url, ''), '') AS image_url " +
  'FROM teleport_order_items oi ' +
  'LEFT JOIN teleport_orders o ON o.id = oi.order_id ' +
  'LEFT JOIN teleport_products p ON p.id = oi.product_id ' +
  'LEFT JOIN teleport_product_variants v ON v.id::text = oi.variant_id ' +
  'WHERE oi.order_id = $1 ORDER BY oi.created_at ASC'

// Resolves to { items, taxBreakdown }: the lines, and the order's own rate
// record (one per order, carried on every joined row).
async function loadOrderLines(orderId) {
  if (!orderId) return { items: [], taxBreakdown: null }
  try {
    const result = await db.query(ORDER_ITEMS_QUERY, [orderId])
    const rows = (result && result.rows) || []
    // \`p.image_url\` / \`v.image_url\` are stored verbatim, so a merchant who
    // reused a project asset gets its ID back here. An email has no origin to
    // resolve a bare id against — it would render as a broken thumbnail in
    // every inbox — so it becomes an absolute URL first, or nothing at all.
    // A failure is not worth losing the notification over: the lines still go
    // out, without pictures.
    var imageValues = rows.map(function (row) { return row.image_url })
    var assetUrlMap = {}
    try {
      assetUrlMap = await assetUrls.loadAssetUrlMapFromDb(db, imageValues)
    } catch (assetError) {
      assetUrlMap = {}
    }
    const items = rows.map(function (row) {
      const imageUrl = assetUrls.resolveMediaUrl(row.image_url, assetUrlMap) || ''
      const qty = Number(row.quantity) || 1
      const unit = Number(row.unit_price) || 0
      const total = row.total_price != null ? Number(row.total_price) : unit * qty
      const label = row.variant_label ? row.product_name + ' (' + row.variant_label + ')' : row.product_name
      // Every answer in full, one per line — what the merchant makes the order
      // from — and the short one-line label. '' for a line without options.
      // The compact form older checkouts wrote names no option, so its stored
      // label reads better than its keys.
      const snapshot = __poParseSnapshot(row.configuration)
      const storedLabel = String(row.configuration_label || '')
      const fromSnapshot =
        snapshot !== null && snapshot.entries.length > 0 && (snapshot.version === 1 || !storedLabel)
      return {
        configuration: fromSnapshot ? __poDetails(snapshot.entries) : storedLabel,
        configurationLabel: storedLabel || (fromSnapshot ? __poLabel(snapshot.entries) : ''),
        name: label || 'Item',
        sku: '',
        quantity: qty,
        unitPrice: unit,
        totalPrice: total,
        image: imageUrl,
        product_name: label || 'Item',
        unit_price: unit.toFixed(2),
        line_total: total.toFixed(2),
        currency: row.currency || '',
        image_url: imageUrl,
        // What the buyer paid, as checkout recorded it — see \`grossOrderItems\`.
        product_id: row.product_id != null ? String(row.product_id) : '',
        variant_id: row.variant_id != null ? String(row.variant_id) : '',
        unit_price_paid: row.unit_price_paid,
        total_price_paid: row.total_price_paid,
        tax_rate: row.tax_rate,
        tax_included: row.tax_included,
      }
    })
    return { items: items, taxBreakdown: rows.length > 0 ? rows[0].tax_breakdown || null : null }
  } catch (err) {
    console.error('[order-notification] could not load order items: ' + (err && err.message ? err.message : String(err)))
    return { items: [], taxBreakdown: null }
  }
}
`
    : `
async function loadOrderLines() {
  return { items: [], taxBreakdown: null }
}
`

  // Token resolution + subject/body rendering happens here at request
  // time; the actual dispatch is delegated to the shared
  // utils/ecommerce/email-sender module, which encapsulates the
  // provider switch + logging + error normalisation.
  return `var sender = require('../../../utils/ecommerce/email-sender')
${
  dbImport
    ? `var assetUrls = require('../../../utils/ecommerce/asset-urls')
`
    : ''
}${storefrontTaxHelper}

// Whether a row carries the paid price checkout recorded with the line.
function hasPaidRecord(item) {
  return !!item && item.unit_price_paid != null && item.unit_price_paid !== ''
}

// Prices one payload's item rows at what the buyer PAID. Returns the SAME array
// when nothing could move a price — the store adds no tax, the order recorded
// no rates and no line carries a record — so an untaxed project renders
// byte-identical output.
//
// A line is read from its record where checkout wrote one, else derived at the
// rate the order's \`tax_breakdown\` recorded for its product (an order priced
// by region), else at the store default. Lines with no product id (a caller's
// own list) resolve to the order's standard rate.
//
// Both spellings are re-priced because one payload feeds two renderers: the
// camelCase fields drive the {{itemsList}} <ul>, the snake_case ones a builder
// template's row block. A derived line total is the GROSS UNIT times the
// quantity, so the two figures on a row multiply out exactly.
function grossOrderItems(items, taxBreakdown) {
  if (!Array.isArray(items)) return []
  if (STOREFRONT_TAX_RATE <= 0 && !parseOrderLineTaxBreakdown(taxBreakdown) && !items.some(hasPaidRecord)) {
    return items
  }
  return items.map(function (item) {
    var row = Object.assign({}, item)
    var qty = Number(row.quantity) || 1
    var netUnit =
      Number(
        row.unitPrice != null
          ? row.unitPrice
          : row.unit_price != null
          ? row.unit_price
          : row.price
      ) || 0
    var tax = orderLineTaxOf(taxBreakdown, row.product_id, row.variant_id, row.tax_rate, row.tax_included)
    var grossUnit = paidAmountAt(row.unit_price_paid, netUnit, tax)
    var recordedTotal = row.total_price_paid == null || row.total_price_paid === '' ? NaN : Number(row.total_price_paid)
    var grossTotal = isFinite(recordedTotal) ? recordedTotal : Math.round(grossUnit * qty * 100) / 100
    if (row.unitPrice != null || row.price != null) row.unitPrice = grossUnit
    if (row.totalPrice != null) row.totalPrice = grossTotal
    if (row.price != null) row.price = grossUnit
    row.unit_price = grossUnit.toFixed(2)
    row.line_total = grossTotal.toFixed(2)
    return row
  })
}

// The product options each line was bought with, as both renderers read them:
// \`configuration\` — every answer, one per line — for a template's
// {{configuration}} token and the {{itemsList}} blob. Never null, so a line
// without options blanks the token instead of leaving it in the email. A
// caller's own lines (the checkout's cart) carry only the short label. A
// template written before options existed has no such token: there the short
// label is appended to the row's product name instead.
var BODY_HAS_CONFIGURATION_TOKEN = ${bodyHasConfigurationToken}
function withOrderLineConfiguration(items, fromOrder) {
  return items.map(function (item) {
    var label = String(item.configurationLabel || item.configuration_label || '')
    var text = fromOrder ? String(item.configuration || '') : label
    var row = Object.assign({}, item, { configuration: text })
    if (text && !BODY_HAS_CONFIGURATION_TOKEN) {
      row.product_name = String(row.product_name || row.name || 'Item') + ' — ' + clipText(label, 120)
    }
    return row
  })
}

// At most \`max\` characters, never splitting a character in two.
function clipText(text, max) {
  var chars = Array.from(String(text))
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('')
}

${EmailDate.generateEmailDateHelperCode('formatOrderDate')}
${dbImport ? `${dbImport}\n` : ''}${orderItemsLoader}
${STORE_SERVER_CALLER_CODE}
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
${STORE_SERVER_CALLER_CHECK}
  try {
    const {
      orderId,
      orderNumber,
      customerEmail,
      customerName,
      items,
      totalAmount,
      currency,
      paymentMethod,
      fulfillmentMethod,
      shippingAddress,
      orderDate,
      taxBreakdown,
    } = req.body

    const notificationEmails = ${notificationEmails}
    if (notificationEmails.length === 0) {
      console.log('[order-notification] skipped: no notification emails configured')
      return res.status(200).json({ sent: false, reason: 'no_notification_emails' })
    }

    // Build the canonical token payload from the request body.
    // Callers that already know the orderNumber (e.g. the
    // data-create-item handler firing on INSERT) pass it; if only
    // orderId is provided we fall back to that so the customer-
    // facing "Order ID" line still renders.
    const resolvedOrderNumber = orderNumber || orderId || ''
    // The caller's own snapshot of the cart, kept separate from the DB
    // fallback: it is the only source that is known-complete at the moment
    // this route runs — the data-create-item auto-fire reaches it while the
    // checkout is still writing the order lines.
    const callerItems = Array.isArray(items) && items.length > 0 ? items : null
    // Every source of lines is NET — a caller's cart (the data-create-item
    // auto-fire) and the order's persisted lines alike — so they are priced
    // HERE, once, whichever way they arrived: from the line's record, else at
    // the order's recorded rates (sent by the caller, or read with the lines).
    const loadedLines = callerItems ? null : await loadOrderLines(orderId)
    const itemsArr = withOrderLineConfiguration(
      grossOrderItems(
        callerItems || loadedLines.items,
        taxBreakdown || (loadedLines ? loadedLines.taxBreakdown : null)
      ),
      !callerItems
    )
    const itemsCount = itemsArr.reduce(function(sum, it) {
      var q = Number(it && it.quantity) || 1
      return sum + q
    }, 0) || itemsArr.length
    // Every caller reaches this route with a different date shape — the
    // data-create-item auto-fire sends none, the payment webhooks forward the
    // provider's ISO timestamp. A merge token carries only a field name, so
    // whatever lands in \`orderDate\` is what the merchant reads: format it here
    // rather than trusting the caller.
    const formattedDate = formatOrderDate(orderDate || new Date())

    // Escape HTML so a product name with "<" or "&" can't break the
    // markup or carry through as an XSS vector if the merchant
    // forwards the email body anywhere.
    function htmlEscape(v) {
      return String(v == null ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    }

    // Build a formatted HTML <ul> of items. Always renders when the
    // caller passes a non-empty items array. Each entry surfaces the
    // human-readable name, SKU (if present), per-unit price, and a
    // line total — the merchant typically wants all four when
    // following up with the warehouse.
    function formatMoney(n) {
      var v = Number(n)
      if (!isFinite(v)) return ''
      return v.toFixed(2)
    }
    var itemsListHtml = ''
    if (itemsArr.length > 0) {
      var parts = ['<ul style="margin:8px 0;padding-left:20px;list-style:none;">']
      for (var ii = 0; ii < itemsArr.length; ii++) {
        var it = itemsArr[ii] || {}
        var name = htmlEscape(it.name || it.productName || it.product_name || 'Item')
        var sku = it.sku || it.SKU || ''
        var skuFrag = sku ? ' <span style="color:#666;">(SKU: ' + htmlEscape(sku) + ')</span>' : ''
        var qty = Number(it.quantity) || 1
        var unit = formatMoney(it.unitPrice != null ? it.unitPrice : it.price)
        var total = formatMoney(it.totalPrice != null ? it.totalPrice : (Number(it.unitPrice != null ? it.unitPrice : it.price) || 0) * qty)
        // Thumbnail of the product's main image, matching the order-details
        // page (and the builder template's item rows). Only emitted when the
        // caller actually supplied a URL — an <img src=""> renders as a broken
        // image icon in most desktop clients.
        var imgUrl = it.image || it.image_url || it.imageUrl || it.thumbnail || ''
        var imgFrag = imgUrl
          ? '<img src="' + htmlEscape(imgUrl) + '" alt="" width="44" height="44" style="width:44px;height:44px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:10px;" />'
          : ''
        // The product options the line was bought with, one answer per line.
        var configurationFrag = it.configuration
          ? '<div style="color:#666;font-size:13px;margin:2px 0 0;">' +
            String(it.configuration).split(/\\r?\\n/).map(htmlEscape).join('<br>') +
            '</div>'
          : ''
        parts.push('<li style="margin:0 0 8px;">' + imgFrag + '<strong>' + name + '</strong>' + skuFrag +
          ' — ' + qty + ' × ' + unit +
          ' = <strong>' + total + '</strong>' + configurationFrag + '</li>')
      }
      parts.push('</ul>')
      itemsListHtml = parts.join('')
    }

    // Render shipping address as HTML (preserving merchant-supplied
    // line breaks). The caller passes a plain-text string with "\\n"
    // separators; we convert to <br> so the email renders the address
    // on multiple lines as the merchant intends.
    const shippingAddressHtml = (shippingAddress || '')
      .split(/\\r?\\n/)
      .map(htmlEscape)
      .filter(function(s) { return s.length > 0 })
      .join('<br>')

    const tokenPayload = {
      orderId: orderId || '',
      orderNumber: resolvedOrderNumber,
      customerName: customerName || '',
      customerEmail: customerEmail || '',
      totalAmount: typeof totalAmount === 'number' ? totalAmount.toFixed(2) : (totalAmount || '0.00'),
      currency: currency || '',
      paymentMethod: paymentMethod || '',
      fulfillmentMethod: fulfillmentMethod || '',
      itemsCount: itemsCount,
      itemsList: itemsListHtml,
      orderDate: formattedDate,
      shippingAddress: shippingAddressHtml,
    }

    const subject = sender.renderTemplate(${JSON.stringify(subjectTemplate)}, tokenPayload)
    // Expand the builder template's <!--tq:each items--> row block FIRST —
    // renderTemplate blanks every token it doesn't know, so an un-expanded row
    // block would render once with all per-item values empty. A raw-HTML
    // template has no such block and this is a pass-through.
    const expandedBody = sender.expandListBlocks(${JSON.stringify(
      bodyTemplate
    )}, { items: itemsArr })
    let html = sender.renderTemplate(expandedBody, tokenPayload)

    // Auto-inject the items list when the merchant's template renders no item
    // list of its own. Without this, merchants whose template only has
    // {{itemsCount}} see just a number ("Items: 3") with no line-item detail —
    // useless for fulfillment. Insertion point: right after the line that
    // mentions itemsCount if we can find it, otherwise appended at the end.
    // Skipped when there are no items, and skipped when the template already
    // renders them itself (via {{itemsList}} or a tq:each row block) —
    // injecting there produced a SECOND, unstyled copy of the list, landing
    // wherever the first "</p>" after "Items:" happened to be (in the builder
    // template, inside the shipping-address block).
    if (itemsListHtml && !sender.hasOwnItemList(${JSON.stringify(
      bodyTemplate
    )}) && html.length > 0) {
      const itemsHeader = '<p><strong>Items ordered:</strong></p>' + itemsListHtml
      const itemsCountAnchor = html.indexOf('Items:')
      if (itemsCountAnchor !== -1) {
        // Insert after the paragraph that contains "Items:"
        const paraEnd = html.indexOf('</p>', itemsCountAnchor)
        if (paraEnd !== -1) {
          html = html.slice(0, paraEnd + 4) + itemsHeader + html.slice(paraEnd + 4)
        } else {
          html = html + itemsHeader
        }
      } else {
        html = html + itemsHeader
      }
    }

    // Merchant notification — wrapped so a postmark failure (e.g. the
    // pending-approval domain restriction) does NOT abort the handler:
    // the order itself was already created by the time we got here, and
    // the sent-email ledger below still has to settle. The buyer's invoice
    // is not this route's concern — the checkout workflow's settled branch
    // and the payment webhooks generate it, whatever the payment method.
    let result
    try {
      result = await sender.sendNotificationEmail(notificationEmails, subject, html, {
        emailType: 'order-notification',
        source: 'order-notification',
        sourceRef: 'api/ecommerce/order-notification',
        payload: tokenPayload,
        orderId: orderId,
      })
    } catch (notifyErr) {
      console.error('[order-notification] merchant email FAILED: ' + (notifyErr && notifyErr.message ? notifyErr.message : String(notifyErr)))
      result = { sent: false, error: notifyErr && notifyErr.message ? notifyErr.message : 'merchant email failed' }
    }

    await sender.settleSentEmailLog()
    return res.status(200).json(result)
  } catch (error) {
    console.error('[order-notification] handler error: ' + (error && error.message ? error.message : String(error)))
    await sender.settleSentEmailLog()
    // The reason stays in the log above: it can be a database error, and the
    // caller needs only to know the notification was not sent.
    return res.status(500).json({ sent: false, error: 'Failed to send notification' })
  }
}
`
}

// Mirrors generateOrderNotificationApiRoute but is driven by
// stockManagementConfig.lowStockAlertConfig instead of
// orderNotificationConfig. Only emitted when the merchant turned
// stock alerts on AND configured a provider; otherwise the data-api
// short-circuits the auto-fire call below (so this endpoint never
// gets hit).
export const generateLowStockAlertApiRoute = (settings: UIDLEcommerceSettings): string => {
  const stockConfig = settings.stockManagementConfig
  const alertConfig = stockConfig?.lowStockAlertConfig
  // Four gates: (1) stock management toggled on, (2) per-product
  // alerts toggled on, (3) an alert-config block was saved,
  // (4) a provider name is picked. Missing ANY of them means the
  // generator emits an inert handler so the endpoint exists (the
  // data-api's auto-fire still POSTs to it) but never tries to
  // send mail. Inert handler returns 200 to keep the auto-fire
  // call from logging a useless error.
  if (
    !settings.stockManagement ||
    !stockConfig ||
    !stockConfig.lowStockAlerts ||
    !alertConfig ||
    !alertConfig.provider
  ) {
    return `export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  return res.status(200).json({ sent: false, reason: 'low_stock_alerts_not_configured' })
}
`
  }

  const subjectTemplate =
    alertConfig.subject || 'Low stock alert — {{productsCount}} product(s) below threshold'
  const bodyTemplate =
    alertConfig.body ||
    '<p>The following products are at or below the configured low-stock threshold:</p><p>{{productsList}}</p>'
  const notificationEmails = JSON.stringify(alertConfig.notificationEmails || [])
  const threshold = stockConfig.lowStockThreshold ?? 5

  return `var sender = require('../../../utils/ecommerce/email-sender')

function htmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Render a compact <ul> of the low-stock rows. Falls back to a
// placeholder line when the caller didn't pass any products — keeps
// the email valid even if the data-api auto-fire was triggered with
// an empty rowset (race condition with concurrent restocks).
function buildProductsListHtml(products) {
  if (!Array.isArray(products) || products.length === 0) {
    return '<p>(no products to list — the stock-check query returned an empty set)</p>'
  }
  var rows = []
  for (var i = 0; i < products.length; i++) {
    var p = products[i] || {}
    var name = htmlEscape(p.name || p.productName || 'Unknown product')
    var stock = p.stock != null ? p.stock : (p.quantity != null ? p.quantity : '')
    var sku = p.sku ? ' (SKU: ' + htmlEscape(p.sku) + ')' : ''
    rows.push('<li><strong>' + name + '</strong>' + sku + ' — current stock: ' + htmlEscape(stock) + '</li>')
  }
  return '<ul>' + rows.join('') + '</ul>'
}

${STORE_SERVER_CALLER_CODE}
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
${STORE_SERVER_CALLER_CHECK}
  try {
    const { products, threshold: providedThreshold } = req.body || {}
    const productsArr = Array.isArray(products) ? products : []
    if (productsArr.length === 0) {
      console.log('[low-stock-alert] skipped: no low-stock products to report')
      return res.status(200).json({ sent: false, reason: 'no_low_stock_products' })
    }

    const notificationEmails = ${notificationEmails}
    if (notificationEmails.length === 0) {
      console.log('[low-stock-alert] skipped: no notification emails configured')
      return res.status(200).json({ sent: false, reason: 'no_notification_emails' })
    }

    const threshold = (typeof providedThreshold === 'number' && providedThreshold >= 0) ? providedThreshold : ${threshold}
    const first = productsArr[0] || {}
    const tokenPayload = {
      productsList: buildProductsListHtml(productsArr),
      productsCount: String(productsArr.length),
      threshold: String(threshold),
      productName: String(first.name || first.productName || ''),
      productId: String(first.id || first.productId || ''),
      sku: String(first.sku || ''),
      currentStock: String(first.stock != null ? first.stock : (first.quantity != null ? first.quantity : '')),
    }

    const subject = sender.renderTemplate(${JSON.stringify(subjectTemplate)}, tokenPayload)
    // Same ordering contract as the order-notification route: expand a builder
    // template's <!--tq:each products--> row block before the flat token
    // fill, or every per-product value in it renders empty. The scan rows
    // ({ id, name, stock, sku }) already match the row keys the builder's
    // low-stock array-mapper binds to. Pass-through for a raw-HTML body, which
    // renders the list through the {{productsList}} blob instead.
    const expandedBody = sender.expandListBlocks(${JSON.stringify(
      bodyTemplate
    )}, { products: productsArr })
    const html = sender.renderTemplate(expandedBody, tokenPayload)

    const result = await sender.sendNotificationEmail(notificationEmails, subject, html, {
      emailType: 'low-stock',
      source: 'low-stock-alert',
      sourceRef: 'api/ecommerce/low-stock-alert',
      payload: { threshold: threshold, products: productsArr },
    })
    await sender.settleSentEmailLog()
    return res.status(200).json(result)
  } catch (error) {
    console.error('[low-stock-alert] handler error: ' + (error && error.message ? error.message : String(error)))
    await sender.settleSentEmailLog()
    // The reason stays in the log above, never in the answer.
    return res.status(500).json({ sent: false, error: 'Failed to send low-stock alert' })
  }
}
`
}

// Datasource types whose `generateDbImport` emits a node-postgres `Pool`. Every
// SQL-emitting e-commerce route (checkout, cart, the order-line loader in the
// order-notification route) is Postgres-specific — `$N` placeholders,
// transactions via `db.connect()`, `FOR UPDATE`, `RETURNING` — so they only
// generate for these. For anything else (mysql/supabase/turso/none) the caller
// skips the SQL-backed behaviour and degrades to the pure-client path.
const POSTGRES_DATA_SOURCE_TYPES = ['teleport', 'postgresql', 'cockroachdb', 'amazon-redshift']

export const isPostgresCartDataSource = (dataSourceType: string | null): boolean =>
  !!dataSourceType && POSTGRES_DATA_SOURCE_TYPES.indexOf(dataSourceType) !== -1

export function generateDbImport(
  dataSourceType: string | null,
  dataSourceConfig: Record<string, unknown> | null
): string | null {
  if (!dataSourceType || !dataSourceConfig) {
    return null
  }

  switch (dataSourceType) {
    case 'teleport':
      // The platform's managed Postgres adapter. The data-source plugin's
      // teleport fetcher uses TELEPORT_DB_CONNECTION_STRING, so the
      // ecommerce endpoints must read from the same env var to point at
      // the same DB the rest of the app uses. DATABASE_URL is kept as a
      // fallback so users who deploy elsewhere can override.
      return `const { Pool } = require('pg')
const db = new Pool({
  connectionString: process.env.TELEPORT_DB_CONNECTION_STRING || process.env.DATABASE_URL,
})`
    case 'postgresql':
    case 'cockroachdb':
    case 'amazon-redshift':
      return `const { Pool } = require('pg')
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
})`
    case 'mysql':
    case 'mariadb':
    case 'tidb':
      return `const mysql = require('mysql2/promise')
const db = await mysql.createConnection(process.env.DATABASE_URL)`
    case 'supabase':
      return `const { createClient } = require('@supabase/supabase-js')
const db = {
  query: async (text, params) => {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const { data, error } = await supabase.rpc('raw_sql', { query: text, params })
    if (error) throw error
    return { rows: data || [] }
  }
}`
    case 'turso':
      return `const { createClient } = require('@libsql/client')
const db = {
  query: async (text, params) => {
    const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
    const result = await client.execute({ sql: text, args: params || [] })
    return { rows: result.rows }
  }
}`
    default:
      return null
  }
}
