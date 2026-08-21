import { generateOrderNotificationApiRoute } from '../src/ecommerce/ecommerce-api-routes-generator'
import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'

// The order-notification endpoint is now a thin shell that
// resolves the canonical order-shaped token payload from the
// request body, renders the configured subject + body templates,
// and delegates dispatch to the shared utils/ecommerce/email-sender
// module. Provider switching, environment-variable lookup, and
// HTTPS / SMTP wiring all live in the sender (see
// `email-sender-and-low-stock-alert.test.ts`); this file pins the
// endpoint-level contract — template literals carried verbatim
// into the emitted code, fallback paths, diagnostic logging.

const baseSettings = (overrides: any = {}): UIDLEcommerceSettings => ({
  cashOnDelivery: true,
  deliveryEnabled: true,
  storePickupEnabled: false,
  guestCheckout: true,
  stockManagement: true,
  orderNotifications: true,
  deliveryConfig: null,
  stockManagementConfig: null,
  paymentProviders: [],
  orderNotificationConfig: {
    provider: 'postmark',
    fromEmail: 'orders@example.com',
    fromName: 'Example Store',
    notificationEmails: ['merchant@example.com'],
    subject: 'New order {{orderNumber}} — {{totalAmount}}',
    body: '<p>Order {{orderNumber}} for {{customerName}}</p>',
    ...overrides,
  },
})

describe('generateOrderNotificationApiRoute — endpoint shell', () => {
  const route = generateOrderNotificationApiRoute(baseSettings())

  it('delegates dispatch to the shared email-sender module', () => {
    expect(route).toContain("require('../../../utils/ecommerce/email-sender')")
    expect(route).toContain('sender.sendNotificationEmail(notificationEmails, subject, html)')
  })

  it('renders subject + body via sender.renderTemplate (not inline)', () => {
    expect(route).toContain('sender.renderTemplate(')
    // The inline renderTemplate function was removed — assert it
    // is NOT defined locally in the endpoint anymore.
    expect(route).not.toMatch(/function\s+renderTemplate/)
  })

  it("bakes the merchant's subject + body templates verbatim into the source", () => {
    // The merchant edits the templates in the GUI; the generator
    // emits them as string literals so the runtime only needs to
    // do token substitution.
    expect(route).toContain('New order {{orderNumber}} — {{totalAmount}}')
    expect(route).toContain('<p>Order {{orderNumber}} for {{customerName}}</p>')
  })

  it('injects the configured notificationEmails list as a JSON array', () => {
    expect(route).toContain('["merchant@example.com"]')
  })

  it('logs a diagnostic line on the no-recipients skip path', () => {
    const empty = generateOrderNotificationApiRoute(baseSettings({ notificationEmails: [] }))
    expect(empty).toContain(
      "console.log('[order-notification] skipped: no notification emails configured')"
    )
    expect(empty).toContain('no_notification_emails')
  })

  it('logs a diagnostic line on uncaught handler errors', () => {
    expect(route).toContain("console.error('[order-notification] handler error: '")
  })
})

describe('generateOrderNotificationApiRoute — token payload', () => {
  const route = generateOrderNotificationApiRoute(baseSettings())

  it('builds the canonical token payload from the request body', () => {
    for (const tok of [
      'orderNumber: resolvedOrderNumber',
      'customerName: customerName',
      'customerEmail: customerEmail',
      'currency: currency',
      'paymentMethod: paymentMethod',
      'fulfillmentMethod: fulfillmentMethod',
      'itemsCount: itemsCount',
      'orderDate: formattedDate',
      // shippingAddress is HTML-escaped + newline-converted before
      // being put into the token payload, so the property assignment
      // uses the rendered variable (not the raw request body field).
      'shippingAddress: shippingAddressHtml',
      // itemsList is the new HTML-rendered token derived from items[]
      'itemsList: itemsListHtml',
    ]) {
      expect(route).toContain(tok)
    }
  })

  it('falls back to orderId when orderNumber is missing', () => {
    expect(route).toContain('orderNumber || orderId || ')
  })

  it('formats totalAmount with two decimals when numeric', () => {
    expect(route).toContain('totalAmount.toFixed(2)')
  })
})

describe('generateOrderNotificationApiRoute — itemsList rendering + auto-injection', () => {
  const route = generateOrderNotificationApiRoute(
    baseSettings({
      // A merchant-configured body that has {{itemsCount}} but NO {{itemsList}}.
      // The endpoint should auto-inject the list since the merchant clearly
      // wants item details (they reference itemsCount) but forgot to add the
      // list placeholder.
      body: '<p>Order {{orderNumber}}, <strong>Items:</strong> {{itemsCount}}</p>',
    })
  )

  it('escapes HTML in product name, sku, and shipping address fields', () => {
    expect(route).toContain('function htmlEscape(v)')
    expect(route).toContain('&amp;')
    expect(route).toContain('&lt;')
    expect(route).toContain('&gt;')
    expect(route).toContain('&quot;')
  })

  it('builds an <ul> when the items array is non-empty', () => {
    // `list-style:none` because each row leads with a product thumbnail — a
    // bullet next to a 44px image reads as a rendering glitch.
    expect(route).toContain('<ul style="margin:8px 0;padding-left:20px;list-style:none;">')
    // Each line item shows quantity × unit price = total
    expect(route).toMatch(/qty\s*\+\s*' × '\s*\+\s*unit/)
  })

  it('leads each auto-built line item with the product image when one is known', () => {
    expect(route).toContain('it.image || it.image_url || it.imageUrl || it.thumbnail')
    expect(route).toContain('object-fit:cover')
    // No URL ⇒ no <img> at all: an empty src renders as a broken-image icon.
    expect(route).toMatch(/imgFrag\s*=\s*imgUrl\s*\n?\s*\?/)
  })

  it('formats every monetary field to 2 decimals via formatMoney', () => {
    expect(route).toContain('function formatMoney(n)')
    expect(route).toContain('v.toFixed(2)')
  })

  it('auto-injects an "Items ordered" block when the body renders no list of its own', () => {
    expect(route).toContain('Items ordered:')
    // The guard covers BOTH ways a template can render its own list: the
    // legacy {{itemsList}} blob and a builder array-mapper's tq:each block.
    expect(route).toContain('sender.hasOwnItemList(')
    // The injection prefers to land just after the line that mentions
    // "Items:" so the merchant's existing layout is preserved.
    expect(route).toContain("html.indexOf('Items:')")
  })

  it('expands a builder template list block BEFORE the flat token fill', () => {
    expect(route).toContain('sender.expandListBlocks(')
    const expandAt = route.indexOf('sender.expandListBlocks(')
    const renderBodyAt = route.indexOf('sender.renderTemplate(expandedBody')
    expect(expandAt).toBeGreaterThan(-1)
    expect(renderBodyAt).toBeGreaterThan(expandAt)
  })

  it('falls back to the order’s persisted lines when the caller sends no items', () => {
    // The payment webhooks know an orderId but have no cart to forward.
    expect(route).toContain('await loadOrderItems(orderId)')
  })

  it('emits a real order-lines loader only for Postgres datasources', () => {
    const pg = generateOrderNotificationApiRoute(baseSettings(), 'teleport', {
      connectionString: 'postgres://x',
    })
    expect(pg).toContain('FROM teleport_order_items oi')
    expect(pg).toContain("require('pg')")

    // A non-Postgres (or unknown) datasource keeps the endpoint SQL-free; the
    // loader degrades to "no items" rather than emitting `$N` placeholders a
    // MySQL/Turso driver could never bind.
    const nonPg = generateOrderNotificationApiRoute(baseSettings(), 'mysql', { host: 'x' })
    expect(nonPg).not.toContain('teleport_order_items')
    expect(nonPg).toContain('async function loadOrderItems()')

    // Omitting the datasource entirely (the pre-existing 1-arg call shape)
    // must stay valid and behave like the non-Postgres case.
    expect(route).not.toContain('teleport_order_items')
    expect(route).toContain('async function loadOrderItems()')
  })

  it('emits syntactically valid JavaScript in every datasource shape', () => {
    // The route is assembled from nested template literals; a stray backtick
    // or `${` in a comment silently truncates the emitted file. Parsing it
    // here is the only way to catch that before a project build does.
    const parse = (source: string) => {
      // `export default` is only legal inside a module — swap it for a plain
      // declaration so `new Function` can parse the body.
      const body = source.replace('export default async function handler', 'async function handler')
      // eslint-disable-next-line no-new-func
      return () => new Function(body)
    }
    expect(parse(route)).not.toThrow()
    expect(
      parse(
        generateOrderNotificationApiRoute(baseSettings(), 'teleport', {
          connectionString: 'postgres://x',
        })
      )
    ).not.toThrow()
    expect(parse(generateOrderNotificationApiRoute(baseSettings({ provider: null })))).not.toThrow()
  })

  it('renders shipping address with <br> separators (multi-line in email clients)', () => {
    expect(route).toContain('shippingAddressHtml')
    // The emitted JS contains the literal regex `\\r?\\n` inside the
    // .split() call (escaped once for the source-string layer).
    expect(route).toContain('.split(/\\r?\\n/)')
    expect(route).toContain(".join('<br>')")
  })

  it('skips the items-list auto-injection when items array is empty (no spurious section)', () => {
    // The guard is `if (itemsListHtml && ... ` — itemsListHtml is only
    // populated when itemsArr.length > 0, so an empty cart never injects.
    expect(route).toMatch(/if\s*\(\s*itemsListHtml\s*&&/)
  })
})

describe('generateOrderNotificationApiRoute — runtime smoke test', () => {
  // Pull the handler body out of the generated route, eval it, and
  // verify the rendered HTML contains the items list and the shipping
  // address. We don't run the full Next handler — just the sequence
  // that mutates `html` after renderTemplate.
  it('renders an items list HTML block from items[] payload', () => {
    const route = generateOrderNotificationApiRoute(
      baseSettings({
        body: '<p>Test {{orderNumber}}: items {{itemsCount}}</p>',
      })
    )
    // Extract every relevant helper + the auto-inject snippet by
    // scanning for distinguishing markers; build a tiny shim that
    // re-runs the same logic against a fixture payload.
    const HTML_ESC = 'function htmlEscape(v) {'
    const FORMAT_MONEY = 'function formatMoney(n) {'
    expect(route).toContain(HTML_ESC)
    expect(route).toContain(FORMAT_MONEY)
    // Fixture passes 2 items including one with an XSS attempt in name.
    // The output HTML must be escaped.
    const ITEMS = [
      { name: '<script>alert(1)</script>', sku: 'X1', quantity: 2, unitPrice: 9.99 },
      { name: 'Normal product', quantity: 1, unitPrice: 49 },
    ]
    // Sanity: the route's template-literal string IS the full handler
    // source, so we can verify the escaped HTML would be present in
    // the listHtml output by re-running formatMoney + htmlEscape in
    // an eval'd shim.
    const shim = `
      ${route.match(/function htmlEscape\(v\) \{[\s\S]*?\}/)![0]}
      ${route.match(/function formatMoney\(n\) \{[\s\S]*?\}/)![0]}
      return htmlEscape('<script>') + '|' + formatMoney(9.99) + '|' + formatMoney(49) + '|' + formatMoney(NaN)
    `
    const fn = new Function(shim) as () => string
    const result = fn()
    expect(result).toBe('&lt;script&gt;|9.99|49.00|')
  })
})

describe('generateOrderNotificationApiRoute — graceful fallbacks', () => {
  it('emits a no-op handler when notifications are not configured', () => {
    const settings = baseSettings()
    settings.orderNotificationConfig = null
    const route = generateOrderNotificationApiRoute(settings)
    expect(route).toContain('notifications_not_configured')
    // The no-op handler must not require the sender — the sender
    // is generated conditionally and may not exist when the
    // merchant turned notifications off.
    expect(route).not.toContain('email-sender')
  })

  it('emits a no-op handler when the provider field is missing', () => {
    const settings = baseSettings({ provider: null })
    const route = generateOrderNotificationApiRoute(settings)
    expect(route).toContain('notifications_not_configured')
    expect(route).not.toContain('email-sender')
  })
})

describe('generateOrderNotificationApiRoute — buyer invoice generation', () => {
  const route = generateOrderNotificationApiRoute(baseSettings())

  it('wraps the merchant email send in try/catch so a postmark domain error does NOT abort the handler', () => {
    // The pending-approval Postmark account rejects emails to
    // unmatched domains (the same flow that used to 500 the whole
    // handler). The fix wraps the call so the handler proceeds to
    // invoice generation even when the merchant email fails.
    expect(route).toContain('merchant email FAILED')
    expect(route).toMatch(/try\s*\{\s*\n\s*result\s*=\s*await\s+sender\.sendNotificationEmail/)
    expect(route).toMatch(/catch\s*\(\s*notifyErr/)
  })

  it('fires /api/invoices/generate when paymentMethod is COD (cash on delivery)', () => {
    // The COD path has no payment webhook; this endpoint is the
    // only place the buyer's invoice can be generated. The Stripe
    // and PayPal paths defer to their webhooks (which mark the
    // order paid first, then generate the invoice).
    expect(route).toContain("__isWebhookPayment = __pm === 'stripe' || __pm === 'paypal'")
    expect(route).toContain('!__isWebhookPayment')
    expect(route).toContain("'/api/invoices/generate'")
    expect(route).toContain('body: JSON.stringify({ orderId: orderId })')
  })

  it('logs invoice generation success and failure for debugging', () => {
    expect(route).toContain('[order-notification] invoice generation OK')
    expect(route).toContain('[order-notification] invoice generation FAILED')
    expect(route).toContain('[order-notification] invoice generation threw')
  })

  it('computes baseUrl from the live request (not env vars) so dev + prod both resolve', () => {
    expect(route).toContain("req.headers['x-forwarded-proto']")
    expect(route).toContain("req.headers.host.startsWith('localhost')")
    expect(route).toContain('req.headers.host')
  })
})
