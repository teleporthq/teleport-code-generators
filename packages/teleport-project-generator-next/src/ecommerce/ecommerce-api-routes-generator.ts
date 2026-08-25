import { UIDLEcommerceSettings, UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import { EmailDate, StorefrontTax } from '@teleporthq/teleport-shared'
import { generateCommonJsSessionTokenResolverCode } from '@teleporthq/teleport-plugin-next-workflows'

// The settings payload every workflow-facing consumer shares: the
// /api/ecommerce/settings route bakes it as its response literal, and the
// generated ecommerce-context publishes the SAME object on
// `window.__teleportEcommerceSettings` so the `ecommerce-get-settings`
// workflow node (client-side, see teleport-plugin-next-workflows) can read it
// without a network round trip. Keep the two consumers on this ONE builder —
// the workflow node treats the baked global and the route response as
// interchangeable.
export const buildWorkflowEcommerceSettingsPayload = (
  settings: UIDLEcommerceSettings
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
  }
}

export const generateEcommerceSettingsApiRoute = (settings: UIDLEcommerceSettings): string => {
  const settingsPayload = JSON.stringify(buildWorkflowEcommerceSettingsPayload(settings))

  return `export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  return res.status(200).json(${settingsPayload})
}
`
}

export const generateCheckoutApiRoute = (
  settings: UIDLEcommerceSettings,
  dataSourceType: string | null,
  dataSourceConfig: Record<string, unknown> | null
): string => {
  const dbImport = generateDbImport(dataSourceType, dataSourceConfig)
  const paymentProviders = settings.paymentProviders || []
  const providerTypes = paymentProviders.map((p) => p.type)
  const hasStripe = providerTypes.includes('stripe')
  const hasPaypal = providerTypes.includes('paypal')

  const stripeBlock = hasStripe
    ? `
  if (paymentMethod === 'stripe') {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
    // No payment_method_types — Stripe Dynamic Payment Methods surface every
    // method enabled in the merchant's Dashboard (card, Apple Pay, Google Pay…).
    const session = await stripe.checkout.sessions.create({
      line_items: cartItems.map((item) => ({
        price_data: {
          currency: currency || 'usd',
          product_data: { name: item.name || 'Product' },
          unit_amount: Math.round((item.price || 0) * 100),
        },
        quantity: item.quantity || 1,
      })),
      mode: 'payment',
      success_url: (process.env.NEXTAUTH_URL || 'http://localhost:3000') + '/checkout/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: (process.env.NEXTAUTH_URL || 'http://localhost:3000') + '/checkout/cancel',
      metadata: { orderId: String(orderId) },
    })
    return res.status(200).json({ success: true, orderId, sessionId: session.id, url: session.url })
  }`
    : ''

  const paypalBlock = hasPaypal
    ? `
  if (paymentMethod === 'paypal') {
    return res.status(200).json({ success: true, orderId, paymentMethod: 'paypal' })
  }`
    : ''

  const codBlock = settings.cashOnDelivery
    ? `
  if (paymentMethod === 'cash_on_delivery') {
    ${
      dbImport
        ? `await db.query(
      'UPDATE teleport_orders SET status = $1, payment_status = $2 WHERE id = $3',
      ['confirmed', 'pending', orderId]
    )`
        : ''
    }
    return res.status(200).json({ success: true, orderId, paymentMethod: 'cash_on_delivery' })
  }`
    : ''

  return `${dbImport ? dbImport + '\n' + generateCommonJsSessionTokenResolverCode() : ''}
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const {
      cartItems,
      customer,
      deliveryAddress,
      fulfillmentMethod,
      paymentMethod,
      deliveryNotes,
      storeLocationId,
      currency,
    } = req.body

    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' })
    }
${
  settings.stockManagementConfig?.maxQuantityPerProduct != null
    ? `
    const maxQtyPerProduct = ${settings.stockManagementConfig.maxQuantityPerProduct}
    for (const item of cartItems) {
      if ((item.quantity || 1) > maxQtyPerProduct) {
        return res.status(400).json({
          error: 'Maximum ' + maxQtyPerProduct + ' units allowed per product',
          productId: item.productId,
        })
      }
    }
`
    : ''
}
    if (!paymentMethod) {
      return res.status(400).json({ error: 'Payment method is required' })
    }
${
  settings.guestCheckout
    ? ''
    : `
    if (!customer || !customer.email) {
      return res.status(400).json({ error: 'Customer information is required' })
    }
`
}${
    settings.deliveryEnabled
      ? `
    if (fulfillmentMethod === 'delivery' && (!deliveryAddress || !deliveryAddress.street)) {
      return res.status(400).json({ error: 'Delivery address is required' })
    }
`
      : ''
  }${
    settings.storePickupEnabled
      ? `
    if (fulfillmentMethod === 'store_pickup' && !storeLocationId) {
      return res.status(400).json({ error: 'Store location is required for pickup' })
    }
`
      : ''
  }
    let subtotal = 0
    for (const item of cartItems) {
      subtotal += (item.price || 0) * (item.quantity || 1)
    }

    let deliveryCost = 0
${
  settings.deliveryEnabled && settings.deliveryConfig
    ? `    if (fulfillmentMethod === 'delivery') {
      deliveryCost = ${settings.deliveryConfig.deliveryPrice}
${
  settings.deliveryConfig.freeDeliveryEnabled
    ? `      if (subtotal >= ${settings.deliveryConfig.freeDeliveryThreshold}) {
        deliveryCost = 0
      }`
    : ''
}
    }
`
    : ''
}
    const totalAmount = subtotal + deliveryCost

    let orderId = null
${
  dbImport
    ? `    const orderResult = await db.query(
      \`INSERT INTO teleport_orders (
        customer_email, customer_name, payment_method, fulfillment_method,
        subtotal, delivery_cost, total_amount, status, payment_status,
        shipping_street, shipping_city, shipping_state, shipping_zip, shipping_country,
        store_location_id, delivery_notes, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
      RETURNING id\`,
      [
        customer?.email || null,
        customer?.name || null,
        paymentMethod,
        fulfillmentMethod || 'delivery',
        subtotal,
        deliveryCost,
        totalAmount,
        'pending',
        'pending',
        deliveryAddress?.street || null,
        deliveryAddress?.city || null,
        deliveryAddress?.state || null,
        deliveryAddress?.zip || null,
        deliveryAddress?.country || null,
        storeLocationId || null,
        deliveryNotes || null,
      ]
    )
    orderId = orderResult.rows[0].id

    for (const item of cartItems) {
      await db.query(
        \`INSERT INTO teleport_order_items (order_id, product_id, variant_id, quantity, price, name)
         VALUES ($1,$2,$3,$4,$5,$6)\`,
        [orderId, item.productId, item.variantId || null, item.quantity || 1, item.price || 0, item.name || '']
      )
    }

    // Best-effort: mark this buyer's active cart as ordered. Wrapped so a
    // failure never aborts the (already successful) order response.
    try {
      let __cartUserId = null
      try {
        const __tok = await __tqSessionToken(req)
        if (__tok) __cartUserId = __tok.id || __tok.sub || null
      } catch (e) { __cartUserId = null }
      const __cartSessionId = req.body && req.body.sessionId ? String(req.body.sessionId).slice(0, 255) : null
      const __clauses = []
      const __params = []
      if (__cartUserId) { __params.push(__cartUserId); __clauses.push('user_id = $' + __params.length) }
      if (__cartSessionId) { __params.push(__cartSessionId); __clauses.push('(session_id = $' + __params.length + ' AND user_id IS NULL)') }
      if (__clauses.length > 0) {
        await db.query(
          "UPDATE teleport_cart SET status = 'ordered', updated_at = NOW() WHERE status = 'active' AND (" + __clauses.join(' OR ') + ')',
          __params
        )
      }
    } catch (e) {}`
    : `    orderId = 'order_' + Date.now()`
}
${stripeBlock}${paypalBlock}${codBlock}

    return res.status(200).json({ success: true, orderId, totalAmount })
  } catch (error) {
    console.error('Checkout error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
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

// Server-side endpoint the order-details page hits after PayPal redirects
// the buyer back with `?payment=success&token={paypalOrderId}`. Without this
// `/v2/checkout/orders/{id}/capture` call PayPal never moves the funds and
// never fires `PAYMENT.CAPTURE.COMPLETED` (or any other capture-related
// webhook). The webhook simulator works regardless because it spoofs events
// directly, but real money requires capture.
//
// The auth helper is duplicated from `payment-charge-user.ts` rather than
// shared via import: every `pages/api/*` file has to be self-contained
// because Next.js bundles each route independently and we cannot rely on
// out-of-tree relative requires resolving in production builds.
export const generatePaypalCaptureApiRoute = (): string => {
  return `// Auto-detect sandbox vs live by trying sandbox first and falling over to
// live on \`invalid_client\`. Cached on \`global\` so subsequent captures in the
// same warm process skip the failover round-trip. Mirrors the
// \`paypalAuthenticate\` helper emitted into the place-order workflow segment.
async function paypalAuthenticate(clientId, clientSecret) {
  const SANDBOX = 'https://api-m.sandbox.paypal.com'
  const LIVE = 'https://api-m.paypal.com'
  const basicAuth = 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')

  async function tryAuth(baseUrl) {
    try {
      const res = await fetch(baseUrl + '/v1/oauth2/token', {
        method: 'POST',
        headers: { 'Authorization': basicAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      })
      const data = await res.json()
      if (data && data.access_token) return { accessToken: data.access_token }
      return {
        invalidClient: data && data.error === 'invalid_client',
        errorMessage: (data && (data.error_description || data.error)) || ('HTTP ' + res.status),
      }
    } catch (e) {
      return { errorMessage: 'network error: ' + e.message }
    }
  }

  const cached = global.__paypalBaseUrlCache
  if (cached === SANDBOX || cached === LIVE) {
    const r = await tryAuth(cached)
    if (r.accessToken) return { baseUrl: cached, accessToken: r.accessToken }
    if (!r.invalidClient) return { error: r.errorMessage }
    global.__paypalBaseUrlCache = undefined
  }

  const sb = await tryAuth(SANDBOX)
  if (sb.accessToken) {
    global.__paypalBaseUrlCache = SANDBOX
    return { baseUrl: SANDBOX, accessToken: sb.accessToken }
  }
  if (!sb.invalidClient) return { error: sb.errorMessage }

  const live = await tryAuth(LIVE)
  if (live.accessToken) {
    global.__paypalBaseUrlCache = LIVE
    return { baseUrl: LIVE, accessToken: live.accessToken }
  }
  return { error: live.errorMessage || 'invalid_client' }
}

function resolveSecret(candidates, prefixScan) {
  for (const key of candidates) {
    const value = process.env[key]
    if (value && String(value).length > 0) return String(value)
  }
  if (prefixScan) {
    for (const key of Object.keys(process.env)) {
      if (key.indexOf(prefixScan) === 0) {
        const value = process.env[key]
        if (value && String(value).length > 0) return String(value)
      }
    }
  }
  return ''
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const orderId = req.body && (req.body.orderId || req.body.token)
  if (!orderId || typeof orderId !== 'string') {
    return res.status(400).json({ error: 'Missing PayPal order id' })
  }

  const clientId = resolveSecret(
    ['PAYPAL_CLIENT_ID', 'CONFIGURATION_PAYPAL_CLIENT_ID'],
    'CONFIGURATION_PAYPAL_CLIENT_ID'
  )
  const clientSecret = resolveSecret(
    ['PAYPAL_CLIENT_SECRET', 'CONFIGURATION_PAYPAL_CLIENT_SECRET'],
    'CONFIGURATION_PAYPAL_CLIENT_SECRET'
  )
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'PayPal credentials are not configured' })
  }

  const auth = await paypalAuthenticate(clientId, clientSecret)
  if (auth.error) {
    return res.status(502).json({ error: 'PayPal authentication failed: ' + auth.error })
  }

  try {
    const captureRes = await fetch(auth.baseUrl + '/v2/checkout/orders/' + encodeURIComponent(orderId) + '/capture', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + auth.accessToken,
        'Content-Type': 'application/json',
      },
      // PayPal accepts an empty JSON body for capture; sending one keeps
      // some hardened reverse proxies (which strip POSTs without bodies)
      // happy in production.
      body: '{}',
    })
    const captureData = await captureRes.json()

    // Idempotency: if the order is already captured (buyer hit the return
    // URL twice, browser back/forward, etc.) PayPal returns 422 with
    // ORDER_ALREADY_CAPTURED. Treat that as success so the page-load
    // workflow continues to the cart-clear step.
    const alreadyCaptured =
      captureRes.status === 422 &&
      captureData &&
      Array.isArray(captureData.details) &&
      captureData.details.some(function (d) { return d.issue === 'ORDER_ALREADY_CAPTURED' })

    if (!captureRes.ok && !alreadyCaptured) {
      return res.status(captureRes.status || 502).json({
        error: (captureData && captureData.message) ||
          (captureData && captureData.details && captureData.details[0] && captureData.details[0].description) ||
          'PayPal capture failed',
        details: captureData && captureData.details,
      })
    }

    return res.status(200).json({
      success: true,
      alreadyCaptured: !!alreadyCaptured,
      orderId,
      status: (captureData && captureData.status) || 'COMPLETED',
    })
  } catch (err) {
    console.error('PayPal capture error:', err)
    return res.status(500).json({ error: 'PayPal capture failed: ' + (err && err.message) })
  }
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

export const generateOrderNotificationApiRoute = (
  settings: UIDLEcommerceSettings,
  dataSourceType: string | null = null,
  dataSourceConfig: Record<string, unknown> | null = null,
  invoiceSettings?: UIDLInvoiceSettings
): string => {
  const config = settings.orderNotificationConfig
  // `teleport_order_items` stores NET prices — the invoice route re-derives VAT
  // from them — so the merchant's copy of the order grosses them here, at the
  // point of display, exactly like the workflow-sent twin
  // (`buildOrderEmailPayloadScript` in the editor).
  const storefrontTaxHelper = StorefrontTax.generateStorefrontTaxHelperCode(
    StorefrontTax.resolveStorefrontTaxRate(invoiceSettings)
  )
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
  const orderItemsLoader = dbImport
    ? `
const ORDER_ITEMS_QUERY =
  "SELECT oi.product_name, oi.variant_label, oi.quantity, oi.unit_price, oi.total_price, oi.currency, " +
  "COALESCE(NULLIF(v.image_url, ''), NULLIF(p.image_url, ''), '') AS image_url " +
  'FROM teleport_order_items oi ' +
  'LEFT JOIN teleport_products p ON p.id = oi.product_id ' +
  'LEFT JOIN teleport_product_variants v ON v.id::text = oi.variant_id ' +
  'WHERE oi.order_id = $1 ORDER BY oi.created_at ASC'

async function loadOrderItems(orderId) {
  if (!orderId) return []
  try {
    const result = await db.query(ORDER_ITEMS_QUERY, [orderId])
    const rows = (result && result.rows) || []
    return rows.map(function (row) {
      const qty = Number(row.quantity) || 1
      const unit = Number(row.unit_price) || 0
      const total = row.total_price != null ? Number(row.total_price) : unit * qty
      const label = row.variant_label ? row.product_name + ' (' + row.variant_label + ')' : row.product_name
      return {
        name: label || 'Item',
        sku: '',
        quantity: qty,
        unitPrice: unit,
        totalPrice: total,
        image: row.image_url || '',
        product_name: label || 'Item',
        unit_price: unit.toFixed(2),
        line_total: total.toFixed(2),
        currency: row.currency || '',
        image_url: row.image_url || '',
      }
    })
  } catch (err) {
    console.error('[order-notification] could not load order items: ' + (err && err.message ? err.message : String(err)))
    return []
  }
}
`
    : `
async function loadOrderItems() {
  return []
}
`

  // Token resolution + subject/body rendering happens here at request
  // time; the actual dispatch is delegated to the shared
  // utils/ecommerce/email-sender module, which encapsulates the
  // provider switch + logging + error normalisation.
  return `var sender = require('../../../utils/ecommerce/email-sender')
${storefrontTaxHelper}

// Re-prices one payload's item rows for display. Returns the SAME array when the
// store adds no tax, so an untaxed project renders byte-identical output.
//
// Both spellings are re-priced because one payload feeds two renderers: the
// camelCase fields drive the {{itemsList}} <ul>, the snake_case ones a builder
// template's row block. The line total is derived from the GROSS UNIT times the
// quantity, so the two figures on a row multiply out exactly.
function grossOrderItems(items) {
  if (!Array.isArray(items) || STOREFRONT_TAX_RATE <= 0) return items || []
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
    var grossUnit = applyStorefrontTax(netUnit)
    var grossTotal = Math.round(grossUnit * qty * 100) / 100
    if (row.unitPrice != null || row.price != null) row.unitPrice = grossUnit
    if (row.totalPrice != null) row.totalPrice = grossTotal
    if (row.price != null) row.price = grossUnit
    row.unit_price = grossUnit.toFixed(2)
    row.line_total = grossTotal.toFixed(2)
    return row
  })
}

${EmailDate.generateEmailDateHelperCode('formatOrderDate')}
${dbImport ? `${dbImport}\n` : ''}${orderItemsLoader}
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

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
    // this route runs, so it — and only it — can tell the invoice endpoint how
    // many lines the finished order will have. See the \`expectedItemCount\`
    // hand-off further down.
    const callerItems = Array.isArray(items) && items.length > 0 ? items : null
    // Every source of lines is NET — a caller's cart (the data-create-item
    // auto-fire) and the order's persisted lines alike — so they are grossed
    // HERE, once, whichever way they arrived.
    const itemsArr = grossOrderItems(callerItems || await loadOrderItems(orderId))
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
        parts.push('<li style="margin:0 0 8px;">' + imgFrag + '<strong>' + name + '</strong>' + skuFrag +
          ' — ' + qty + ' × ' + unit +
          ' = <strong>' + total + '</strong></li>')
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
    // pending-approval domain restriction) does NOT abort the handler.
    // We still need to run invoice generation below, and the order
    // itself was already created by the time we got here, so blowing
    // up here would leave the buyer with no invoice and no recourse.
    let result
    try {
      result = await sender.sendNotificationEmail(notificationEmails, subject, html)
    } catch (notifyErr) {
      console.error('[order-notification] merchant email FAILED: ' + (notifyErr && notifyErr.message ? notifyErr.message : String(notifyErr)))
      result = { sent: false, error: notifyErr && notifyErr.message ? notifyErr.message : 'merchant email failed' }
    }

    // Decide whether to generate the invoice now (from this endpoint)
    // or defer to the payment webhook. For provider-backed payments
    // (Stripe / PayPal) the webhook is the authoritative "order is
    // really paid" signal — generating here would create a pending-
    // payment invoice that the webhook can't replace (the first
    // invoice wins via COALESCE in the order-row mirror). For
    // cash-on-delivery and other "no-webhook" methods, this is the
    // only chance — generating here makes sure the buyer gets an
    // invoice PDF + email. We compare case-insensitively because the
    // merchant's settings panel mixes values like 'stripe', 'PayPal',
    // 'paypal', etc. — we want any of them to defer.
    var __pm = String(paymentMethod || '').toLowerCase()
    var __isWebhookPayment = __pm === 'stripe' || __pm === 'paypal' || __pm === 'card' || __pm === 'credit_card' || __pm === 'creditcard'
    if (orderId && !__isWebhookPayment) {
      try {
        // baseUrl is computed from the live request so dev (:3001 etc.)
        // and prod (the live origin) both resolve correctly without
        // having to plumb NEXTAUTH_URL through. Same pattern the
        // payment webhooks use when self-fetching this API.
        var __proto = req.headers['x-forwarded-proto'] || (req.headers.host && (req.headers.host.startsWith('localhost') || req.headers.host.startsWith('127.0.0.1')) ? 'http' : 'https')
        var __invoiceUrl = __proto + '://' + req.headers.host + '/api/invoices/generate'
        // Hand the invoice endpoint the number of lines this order will have.
        // We are called by the data-create-item auto-fire the instant the order
        // row lands — BEFORE checkout's item loop has written the order lines —
        // so an invoice built from whatever rows exist right now comes out
        // short (one line, and a total that doesn't match what the buyer paid).
        // The count lets /api/invoices/generate wait for the rest of the lines
        // instead of racing them. Only sent when the caller supplied the cart
        // itself: a count re-read from the database could be just as truncated,
        // and would make the wait a no-op.
        var __invoicePayload = { orderId: orderId }
        if (callerItems) {
          __invoicePayload.expectedItemCount = callerItems.length
        }
        var __invoiceResp = await fetch(__invoiceUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(__invoicePayload),
        })
        if (!__invoiceResp.ok) {
          var __invoiceErrBody = ''
          try { __invoiceErrBody = await __invoiceResp.text() } catch (_e) { __invoiceErrBody = '(no body)' }
          console.error('[order-notification] invoice generation FAILED — status=' + __invoiceResp.status + ' body=' + __invoiceErrBody.slice(0, 300))
        } else {
          var __invoiceData = await __invoiceResp.json().catch(function() { return {} })
          console.info('[order-notification] invoice generation OK — invoiceNumber=' + (__invoiceData.invoiceNumber || '(missing)') + ' storageUrl=' + (__invoiceData.storageUrl || '(empty)'))
        }
      } catch (__invoiceErr) {
        console.error('[order-notification] invoice generation threw: ' + (__invoiceErr && __invoiceErr.message ? __invoiceErr.message : String(__invoiceErr)))
      }
    }

    return res.status(200).json(result)
  } catch (error) {
    console.error('[order-notification] handler error: ' + (error && error.message ? error.message : String(error)))
    return res.status(500).json({ sent: false, error: error && error.message ? error.message : 'Failed to send notification' })
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

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

    const result = await sender.sendNotificationEmail(notificationEmails, subject, html)
    return res.status(200).json(result)
  } catch (error) {
    console.error('[low-stock-alert] handler error: ' + (error && error.message ? error.message : String(error)))
    return res.status(500).json({ sent: false, error: error && error.message ? error.message : 'Failed to send low-stock alert' })
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
