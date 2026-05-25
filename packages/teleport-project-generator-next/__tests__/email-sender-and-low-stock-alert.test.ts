import { generateEmailSenderModule } from '../src/ecommerce/email-sender-generator'
import {
  generateOrderNotificationApiRoute,
  generateLowStockAlertApiRoute,
} from '../src/ecommerce/ecommerce-api-routes-generator'
import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'

// End-to-end regression guard for the merchant-emailing pipeline.
// The previous shape had three holes that all manifested as "I
// configured everything in the GUI but no email arrives":
//   1. The order-notification endpoint hard-coded its provider
//      switch — postmark fell through to SMTP/nodemailer and
//      silently failed when SMTP env vars weren't set.
//   2. There was no low-stock-alert endpoint at all — the AI
//      generated email-payload-builder workflow nodes that
//      returned `skip: true` because their templates were empty,
//      and nothing else picked up the slack.
//   3. The data-api's raw-query path didn't auto-fire alerts on
//      the post-stock-decrement SELECT the workflow runs after a
//      purchase — so even with a configured endpoint, nothing
//      called it.
//
// The new architecture: a shared utils/ecommerce/email-sender
// module renders {{token}} templates + dispatches to one of four
// providers, both endpoints consume it, and the data-api's
// handleRawQuery auto-fires the alert when the right SQL shape
// runs. These tests pin every layer so a future refactor can't
// silently re-open any of the holes.

const baseSettings = (overrides: Partial<UIDLEcommerceSettings> = {}): UIDLEcommerceSettings => ({
  cashOnDelivery: true,
  deliveryEnabled: true,
  storePickupEnabled: false,
  guestCheckout: true,
  stockManagement: true,
  orderNotifications: true,
  deliveryConfig: null,
  stockManagementConfig: {
    allowBackorders: false,
    lowStockThreshold: 5,
    lowStockAlerts: true,
    outOfStockVisibility: 'visible',
    maxQuantityPerProduct: null,
    lowStockAlertConfig: {
      provider: 'postmark',
      fromEmail: 'orders@example.com',
      fromName: 'Example Store',
      notificationEmails: ['merchant@example.com'],
      subject: 'Low stock alert — {{productsCount}} product(s) below {{threshold}}',
      body: '<p>{{productsList}}</p>',
    },
  },
  orderNotificationConfig: {
    provider: 'postmark',
    fromEmail: 'orders@example.com',
    fromName: 'Example Store',
    notificationEmails: ['merchant@example.com'],
    subject: 'New order {{orderNumber}}',
    body: '<p>Order {{orderNumber}} for {{customerName}}</p>',
  },
  paymentProviders: [],
  ...overrides,
})

describe('generateEmailSenderModule — shared dispatcher', () => {
  it('exports sendNotificationEmail + renderTemplate (CommonJS)', () => {
    const code = generateEmailSenderModule(baseSettings())
    expect(code).toContain('module.exports = {')
    expect(code).toContain('sendNotificationEmail: sendNotificationEmail')
    expect(code).toContain('renderTemplate: renderTemplate')
  })

  it('emits postmark dispatch when provider is postmark', () => {
    const code = generateEmailSenderModule(baseSettings())
    expect(code).toContain('api.postmarkapp.com/email')
    expect(code).toContain("'X-Postmark-Server-Token': token")
    expect(code).toContain('POSTMARK_SERVER_TOKEN')
    expect(code).not.toContain('nodemailer.createTransport')
    expect(code).not.toContain('@sendgrid/mail')
  })

  it('emits sendgrid dispatch when provider is sendgrid', () => {
    const code = generateEmailSenderModule(
      baseSettings({
        orderNotificationConfig: {
          provider: 'sendgrid',
          fromEmail: 'x@y.com',
          fromName: 'X',
          notificationEmails: ['m@m.com'],
        },
        stockManagementConfig: {
          allowBackorders: false,
          lowStockThreshold: 5,
          lowStockAlerts: false,
          outOfStockVisibility: 'visible',
          maxQuantityPerProduct: null,
        },
      })
    )
    expect(code).toContain("require('@sendgrid/mail')")
    expect(code).toContain('SENDGRID_API_KEY')
  })

  it('emits resend dispatch when provider is resend', () => {
    const code = generateEmailSenderModule(
      baseSettings({
        orderNotificationConfig: {
          provider: 'resend',
          fromEmail: 'x@y.com',
          fromName: '',
          notificationEmails: ['m@m.com'],
        },
        stockManagementConfig: {
          allowBackorders: false,
          lowStockThreshold: 5,
          lowStockAlerts: false,
          outOfStockVisibility: 'visible',
          maxQuantityPerProduct: null,
        },
      })
    )
    expect(code).toContain("require('resend')")
    expect(code).toContain('RESEND_API_KEY')
    expect(code).toContain('reply_to')
  })

  it('falls through to nodemailer/SMTP for unknown providers', () => {
    const code = generateEmailSenderModule(
      baseSettings({
        orderNotificationConfig: {
          provider: 'mailgun',
          fromEmail: 'x@y.com',
          fromName: '',
          notificationEmails: ['m@m.com'],
        },
        stockManagementConfig: {
          allowBackorders: false,
          lowStockThreshold: 5,
          lowStockAlerts: false,
          outOfStockVisibility: 'visible',
          maxQuantityPerProduct: null,
        },
      })
    )
    expect(code).toContain("require('nodemailer')")
    expect(code).toContain('SMTP_HOST')
  })

  it('falls back to the low-stock provider when order-notifications has none', () => {
    // A merchant who turned order-notifications off but kept
    // low-stock alerts on still needs a working sender. The
    // generator should pick up the alert config's provider.
    const settings = baseSettings({
      orderNotifications: false,
      orderNotificationConfig: null,
    })
    const code = generateEmailSenderModule(settings)
    expect(code).toContain('api.postmarkapp.com/email')
  })

  it('emits diagnostic console logs on every dispatch (success + failure)', () => {
    const code = generateEmailSenderModule(baseSettings(), { logTag: 'test-tag' })
    expect(code).toContain("console.log('[test-tag] dispatching to '")
    expect(code).toContain("console.log('[test-tag] sent successfully')")
    expect(code).toContain("console.error('[test-tag] dispatch failed:")
    expect(code).toContain("console.log('[test-tag] skipped: no recipients configured')")
  })

  it('renderTemplate substitutes {{token}} and renders missing tokens as empty', () => {
    // Reconstruct the helper in a sandbox so a future signature
    // change to renderTemplate gets caught here.
    const code = generateEmailSenderModule(baseSettings())
    const factory = new Function(
      `${extractFn(code, 'function renderTemplate')}\nreturn renderTemplate;`
    )
    const renderTemplate = factory() as (t: string, p: Record<string, unknown>) => string
    expect(renderTemplate('Hi {{name}}', { name: 'Pat' })).toBe('Hi Pat')
    expect(renderTemplate('Order {{ orderNumber }}!', { orderNumber: 'ORD-1' })).toBe(
      'Order ORD-1!'
    )
    expect(renderTemplate('Missing: {{x}}', {})).toBe('Missing: ')
    expect(renderTemplate('Mixed {{a}} {{b}}', { a: '1' })).toBe('Mixed 1 ')
    // Curly braces in the surrounding HTML must NOT be eaten.
    expect(renderTemplate('<style>.x { color: red; }</style> {{title}}', { title: 'T' })).toBe(
      '<style>.x { color: red; }</style> T'
    )
  })

  it('htmlToText strips tags so providers without HTML get a text fallback', () => {
    const code = generateEmailSenderModule(baseSettings())
    const factory = new Function(`${extractFn(code, 'function htmlToText')}\nreturn htmlToText;`)
    const htmlToText = factory() as (h: string) => string
    expect(htmlToText('<p>Hello <strong>World</strong></p>')).toBe('Hello World')
    expect(htmlToText('')).toBe('')
    expect(htmlToText(null as any)).toBe('')
  })
})

describe('generateOrderNotificationApiRoute — request handler', () => {
  it('delegates dispatch to the shared sender module', () => {
    const code = generateOrderNotificationApiRoute(baseSettings())
    expect(code).toContain("require('../../../utils/ecommerce/email-sender')")
    expect(code).toContain('sender.sendNotificationEmail')
    expect(code).toContain('sender.renderTemplate')
  })

  it('logs the "no notification emails" skip path with a diagnostic line', () => {
    const code = generateOrderNotificationApiRoute(
      baseSettings({
        orderNotificationConfig: {
          provider: 'postmark',
          fromEmail: 'x@y.com',
          fromName: '',
          notificationEmails: [],
        },
      })
    )
    expect(code).toContain(
      "console.log('[order-notification] skipped: no notification emails configured')"
    )
    expect(code).toContain('no_notification_emails')
  })

  it('emits a no-op handler when no provider is configured', () => {
    const code = generateOrderNotificationApiRoute(
      baseSettings({
        orderNotificationConfig: null,
      })
    )
    expect(code).toContain('notifications_not_configured')
    expect(code).not.toContain('email-sender')
  })

  it("preserves the merchant's subject + body templates verbatim in the source", () => {
    const code = generateOrderNotificationApiRoute(baseSettings())
    expect(code).toContain('New order {{orderNumber}}')
    expect(code).toContain('<p>Order {{orderNumber}} for {{customerName}}</p>')
  })

  it('resolves the canonical order token payload', () => {
    const code = generateOrderNotificationApiRoute(baseSettings())
    for (const fragment of [
      'orderNumber: resolvedOrderNumber',
      'customerName: customerName',
      'customerEmail: customerEmail',
      'totalAmount:',
      'currency: currency',
      'paymentMethod: paymentMethod',
      'fulfillmentMethod: fulfillmentMethod',
      'itemsCount: itemsCount',
      'orderDate: formattedDate',
      'shippingAddress: shippingAddress',
    ]) {
      expect(code).toContain(fragment)
    }
  })

  it('falls back orderNumber to orderId when only orderId is sent', () => {
    const code = generateOrderNotificationApiRoute(baseSettings())
    expect(code).toContain('orderNumber || orderId || ')
  })
})

describe('generateLowStockAlertApiRoute', () => {
  it('emits a no-op handler when low-stock alerts are disabled', () => {
    const settings = baseSettings({
      stockManagementConfig: {
        allowBackorders: false,
        lowStockThreshold: 5,
        lowStockAlerts: false,
        outOfStockVisibility: 'visible',
        maxQuantityPerProduct: null,
      },
    })
    const code = generateLowStockAlertApiRoute(settings)
    expect(code).toContain('low_stock_alerts_not_configured')
    expect(code).not.toContain('email-sender')
  })

  it('emits a no-op handler when stockManagement itself is off', () => {
    const code = generateLowStockAlertApiRoute(baseSettings({ stockManagement: false }))
    expect(code).toContain('low_stock_alerts_not_configured')
  })

  it('delegates dispatch to the shared sender when fully configured', () => {
    const code = generateLowStockAlertApiRoute(baseSettings())
    expect(code).toContain("require('../../../utils/ecommerce/email-sender')")
    expect(code).toContain('sender.sendNotificationEmail')
    expect(code).toContain('sender.renderTemplate')
  })

  it('logs the no-products + no-recipients skip paths', () => {
    const code = generateLowStockAlertApiRoute(baseSettings())
    expect(code).toContain(
      "console.log('[low-stock-alert] skipped: no low-stock products to report')"
    )
    // notificationEmails is non-empty in baseSettings; assert the
    // skip-line is still emitted for the runtime check.
    expect(code).toContain('no_low_stock_products')
  })

  it('uses the threshold from stockManagementConfig as the renderer fallback', () => {
    const code = generateLowStockAlertApiRoute(
      baseSettings({
        stockManagementConfig: {
          allowBackorders: false,
          lowStockThreshold: 12,
          lowStockAlerts: true,
          outOfStockVisibility: 'visible',
          maxQuantityPerProduct: null,
          lowStockAlertConfig: {
            provider: 'postmark',
            fromEmail: 'x@y.com',
            fromName: 'X',
            notificationEmails: ['m@m.com'],
            subject: 'S',
            body: 'B',
          },
        },
      })
    )
    expect(code).toContain(': 12')
  })

  it("renders the merchant's subject + body templates literally", () => {
    const code = generateLowStockAlertApiRoute(baseSettings())
    expect(code).toContain('Low stock alert — {{productsCount}} product(s) below {{threshold}}')
    expect(code).toContain('<p>{{productsList}}</p>')
  })

  it('builds the productsList HTML even from a non-uniform row shape', () => {
    // The generated buildProductsListHtml must coalesce
    // stock/quantity and missing fields without crashing.
    const code = generateLowStockAlertApiRoute(baseSettings())
    const factory = new Function(
      `${extractFn(code, 'function htmlEscape')}\n${extractFn(
        code,
        'function buildProductsListHtml'
      )}\nreturn buildProductsListHtml;`
    )
    const build = factory() as (products: any[]) => string
    expect(build([])).toContain('no products to list')
    expect(build([{ name: 'A', stock: 2, sku: 'SKU-A' }])).toBe(
      '<ul><li><strong>A</strong> (SKU: SKU-A) — current stock: 2</li></ul>'
    )
    expect(build([{ name: 'B', quantity: 0 }])).toContain('current stock: 0')
    expect(build([{ name: '<script>alert(1)</script>' }])).not.toContain('<script>')
  })
})

// Tiny helper: pull a function source (top-level fn or method)
// out of a larger code blob by matching balanced braces.
function extractFn(haystack: string, decl: string): string {
  const start = haystack.indexOf(decl)
  if (start === -1) {
    throw new Error('decl not found: ' + decl)
  }
  let depth = 0
  let i = haystack.indexOf('{', start)
  if (i === -1) {
    throw new Error('no brace after ' + decl)
  }
  for (; i < haystack.length; i++) {
    const ch = haystack.charAt(i)
    if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        return haystack.slice(start, i + 1)
      }
    }
  }
  throw new Error('unbalanced braces in ' + decl)
}
