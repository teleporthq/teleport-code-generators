import { generateOrderNotificationApiRoute } from '../src/ecommerce/ecommerce-api-routes-generator'
import type { UIDLEcommerceSettings, UIDLInvoiceSettings } from '@teleporthq/teleport-types'

/**
 * The merchant's order-notification email has TWO senders — the workflow's own
 * `Send Order-Notification Email` node and this route, which the payment
 * webhooks and the `data-create-item` auto-fire POST to. Both read NET prices
 * (`teleport_order_items`, or the client cart) and both must quote what the
 * buyer actually paid, or the merchant sees a different total depending on how
 * the order was placed.
 *
 * The date has the same shape of problem: a merge token carries only a field
 * name, so an ISO timestamp forwarded by a webhook reaches the inbox verbatim.
 */

const ecommerceSettings = (): UIDLEcommerceSettings =>
  ({
    orderNotifications: true,
    orderNotificationConfig: {
      provider: 'resend',
      notificationEmails: ['owner@example.com'],
      subject: 'New order {{orderNumber}}',
      body: '<!--tq:each items--><span>{{product_name}} {{unit_price}} {{line_total}}</span><!--/tq:each-->',
    },
  } as unknown as UIDLEcommerceSettings)

const invoiceSettings = (over: Partial<UIDLInvoiceSettings>): UIDLInvoiceSettings =>
  ({ defaultTaxRate: 0, taxIncludedInPrice: false, ...over } as UIDLInvoiceSettings)

/** Pulls one top-level function out of the emitted route module and runs it. */
const grabHelper = <T>(source: string, name: string): T => {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) {
    throw new Error(`helper ${name} not emitted`)
  }
  // Everything from the tax prelude through the helper, so `STOREFRONT_TAX_RATE`
  // and `applyStorefrontTax` are in scope exactly as they are at runtime.
  const preludeStart = source.indexOf('var STOREFRONT_TAX_RATE = ')
  const end = source.indexOf('\n}', start) + 2
  const code = source.slice(preludeStart, end)
  return new Function(`${code}\nreturn ${name};`)() as T
}

describe('order-notification route — storefront tax', () => {
  it('bakes the resolved rate and a display-only re-pricing helper', () => {
    const source = generateOrderNotificationApiRoute(
      ecommerceSettings(),
      null,
      null,
      invoiceSettings({ defaultTaxRate: 19 })
    )
    expect(source).toContain('var STOREFRONT_TAX_RATE = 19;')
    expect(source).toContain('grossOrderItems(')
  })

  it('grosses BOTH spellings of a row, because one payload feeds two renderers', () => {
    const source = generateOrderNotificationApiRoute(
      ecommerceSettings(),
      null,
      null,
      invoiceSettings({ defaultTaxRate: 19 })
    )
    const grossOrderItems = grabHelper<(items: unknown[]) => Array<Record<string, unknown>>>(
      source,
      'grossOrderItems'
    )

    const [row] = grossOrderItems([
      {
        name: 'Espresso Beans',
        quantity: 3,
        unitPrice: 19.99,
        totalPrice: 59.97,
        unit_price: '19.99',
        line_total: '59.97',
      },
    ])

    expect(row.unitPrice).toBe(23.79)
    expect(row.unit_price).toBe('23.79')
    // Per-UNIT rounding: 23.79 x 3, not the net line (59.97) taxed as a lump —
    // that would print 71.36 beside a unit price that multiplies to 71.37.
    expect(row.totalPrice).toBe(71.37)
    expect(row.line_total).toBe('71.37')
    // Non-money fields ride through untouched.
    expect(row.name).toBe('Espresso Beans')
    expect(row.quantity).toBe(3)
  })

  it('derives the line total from the unit price when the caller sent none', () => {
    const source = generateOrderNotificationApiRoute(
      ecommerceSettings(),
      null,
      null,
      invoiceSettings({ defaultTaxRate: 19 })
    )
    const grossOrderItems = grabHelper<(items: unknown[]) => Array<Record<string, unknown>>>(
      source,
      'grossOrderItems'
    )
    const [row] = grossOrderItems([{ price: 10, quantity: 2 }])
    expect(row.price).toBe(11.9)
    expect(row.line_total).toBe('23.80')
  })

  it('is a pass-through when nothing could move a price', () => {
    const source = generateOrderNotificationApiRoute(
      ecommerceSettings(),
      null,
      null,
      invoiceSettings({ defaultTaxRate: 19, taxIncludedInPrice: true })
    )
    expect(source).toContain('var STOREFRONT_TAX_RATE = 0;')
    const grossOrderItems = grabHelper<(items: unknown[], breakdown?: unknown) => unknown[]>(
      source,
      'grossOrderItems'
    )
    const input = [{ unitPrice: 19.99, unit_price: '19.99' }]
    expect(grossOrderItems(input)).toBe(input)
    expect(grossOrderItems(input, null)).toBe(input)
    expect(grossOrderItems(input, '{not json')).toBe(input)
  })

  describe('what the buyer paid per line', () => {
    const BREAKDOWN = JSON.stringify({
      taxRate: 20,
      taxIncluded: false,
      taxDecimals: 2,
      shippingTax: 0,
      lines: [
        { productId: 'p1', variantId: '', taxRate: 20, taxIncluded: false },
        { productId: 'p2', variantId: 'v-blue', taxRate: 9, taxIncluded: true },
      ],
    })
    const source = generateOrderNotificationApiRoute(
      ecommerceSettings(),
      null,
      null,
      invoiceSettings({ defaultTaxRate: 19 })
    )
    const grossOrderItems = grabHelper<
      (items: unknown[], breakdown?: unknown) => Array<Record<string, unknown>>
    >(source, 'grossOrderItems')

    it("prices each line at the rate the order's breakdown recorded for its product", () => {
      const [added, included, unknown] = grossOrderItems(
        [
          { product_id: 'p1', variant_id: '', quantity: 2, unitPrice: 100, unit_price: '100.00' },
          {
            product_id: 'p2',
            variant_id: 'v-blue',
            quantity: 1,
            unitPrice: 47,
            unit_price: '47.00',
          },
          // No product id (a caller's own list): the order's standard rate.
          { quantity: 1, unitPrice: 50, unit_price: '50.00' },
        ],
        BREAKDOWN
      )
      expect(added.unit_price).toBe('120.00')
      expect(added.line_total).toBe('240.00')
      expect(included.unit_price).toBe('47.00')
      expect(unknown.unit_price).toBe('60.00')
    })

    it('reads a line that RECORDED what was paid verbatim, whatever the rates say', () => {
      const [row] = grossOrderItems(
        [
          {
            product_id: 'p1',
            quantity: 2,
            unitPrice: 100,
            totalPrice: 200,
            unit_price: '100.00',
            unit_price_paid: '118.00',
            total_price_paid: '236.00',
            tax_rate: '18.000',
            tax_included: 'false',
          },
        ],
        BREAKDOWN
      )
      expect(row.unitPrice).toBe(118)
      expect(row.unit_price).toBe('118.00')
      expect(row.totalPrice).toBe(236)
      expect(row.line_total).toBe('236.00')
    })

    it('re-prices a recorded line even on a store that adds no tax and an order without rates', () => {
      const untaxed = generateOrderNotificationApiRoute(ecommerceSettings(), null, null)
      const gross = grabHelper<
        (items: unknown[], breakdown?: unknown) => Array<Record<string, unknown>>
      >(untaxed, 'grossOrderItems')
      const [row] = gross(
        [{ quantity: 1, unitPrice: 100, unit_price: '100.00', unit_price_paid: '119.00' }],
        null
      )
      expect(row.unit_price).toBe('119.00')
    })

    it('takes the breakdown from the caller, else from the order it loads the lines from', () => {
      expect(source).toContain('taxBreakdown,\n    } = req.body')
      expect(source).toContain('taxBreakdown || (loadedLines ? loadedLines.taxBreakdown : null)')
    })

    it('reads the record and the rates through to_jsonb, so an older store still gets its lines', () => {
      const withDb = generateOrderNotificationApiRoute(
        ecommerceSettings(),
        'teleport',
        { connectionString: 'postgres://x' },
        invoiceSettings({ defaultTaxRate: 19 })
      )
      expect(withDb).toContain("to_jsonb(oi) ->> 'unit_price_paid' AS unit_price_paid")
      expect(withDb).toContain("to_jsonb(oi) ->> 'tax_included' AS tax_included")
      expect(withDb).toContain("to_jsonb(o) ->> 'tax_breakdown' AS tax_breakdown")
      expect(withDb).toContain('LEFT JOIN teleport_orders o ON o.id = oi.order_id')
      expect(withDb).toContain('return { items: items, taxBreakdown:')
    })
  })

  it('omitting the invoice settings entirely behaves like an untaxed store', () => {
    const source = generateOrderNotificationApiRoute(ecommerceSettings(), null, null)
    expect(source).toContain('var STOREFRONT_TAX_RATE = 0;')
  })
})

describe('order-notification route — order date', () => {
  const source = generateOrderNotificationApiRoute(
    ecommerceSettings(),
    null,
    null,
    invoiceSettings({})
  )
  const formatOrderDate = grabHelper<(value: unknown) => string>(source, 'formatOrderDate')

  it('formats every caller`s date shape, never forwarding a raw ISO string', () => {
    expect(source).toContain('formatOrderDate(orderDate || new Date())')
    expect(formatOrderDate('2026-08-21T17:53:11.308Z')).toBe('Aug 21, 2026 5:53 PM UTC')
    expect(formatOrderDate(new Date('2026-01-02T00:04:00.000Z'))).toBe('Jan 2, 2026 12:04 AM UTC')
  })

  it('passes an unparseable value through rather than blanking the row', () => {
    expect(formatOrderDate('not a date')).toBe('not a date')
    expect(formatOrderDate('')).toBe('')
    expect(formatOrderDate(null)).toBe('')
  })
})
