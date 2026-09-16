/* tslint:disable:function-constructor */
import { generateInvoiceGenerateRouteCode } from '../src/invoice/api-routes-code'
import { REGIONAL_INVOICE_TAX_CODE } from '../src/invoice/regional-invoice-tax-code'
import type { UIDLInvoiceSettings } from '@teleporthq/teleport-types'

/**
 * The invoice of an order priced by region (shipping zones + tax
 * jurisdictions) is computed from the rates the order was CHARGED at —
 * `teleport_orders.tax_breakdown` — not from the store's single default rate,
 * and its total must equal `goods + shipping_amount - discount_amount`, the
 * amount the buyer was debited.
 */

interface RegionalInvoiceTax {
  taxRate: number
  taxIncluded: boolean
  subtotal: number
  taxAmount: number
  shippingNet: number
  total: number
  itemTax: Array<{ rate: number; included: boolean; amount: number }>
}

const api = new Function(
  REGIONAL_INVOICE_TAX_CODE +
    '\nreturn { parse: parseOrderTaxBreakdown, resolve: resolveRegionalInvoiceTax };'
)() as {
  parse: (raw: unknown) => Record<string, unknown> | null
  resolve: (
    breakdown: Record<string, unknown>,
    items: Array<Record<string, unknown>>,
    discountAmount: number,
    shippingAmount: number
  ) => RegionalInvoiceTax
}

const cents = (n: number) => Math.round(n * 100) / 100

// Germany: food at 7% and tools at 19%, both added on top; 6.00 shipping taxed
// at 19% → shipping_amount 7.14 on the order.
const GERMAN_ORDER = {
  taxRate: 19,
  taxIncluded: false,
  taxDecimals: 2,
  shippingTax: 1.14,
  lines: [
    { productId: 'p1', variantId: '', taxRate: 7, taxIncluded: false },
    { productId: 'p2', variantId: 'v2', taxRate: 19, taxIncluded: false },
  ],
}
const GERMAN_ITEMS = [
  { productId: 'p1', variantId: null, quantity: 2, unitPrice: 10, totalPrice: 20 },
  { productId: 'p2', variantId: 'v2', quantity: 1, unitPrice: 25.99, totalPrice: 25.99 },
]

describe('invoice — regional tax breakdown', () => {
  it('reads the breakdown from the TEXT column, and nothing from a legacy order', () => {
    expect(api.parse(JSON.stringify(GERMAN_ORDER))).toMatchObject({ taxRate: 19 })
    expect(api.parse(null)).toBeNull()
    expect(api.parse('not json')).toBeNull()
    expect(api.parse('{"taxRate":19}')).toBeNull()
  })

  it('taxes each line at its own rate and reconciles with the order total', () => {
    const result = api.resolve(GERMAN_ORDER, GERMAN_ITEMS, 0, 7.14)
    // goods: 21.40 + 30.93 = 52.33, tax 1.40 + 4.94 = 6.34; shipping tax 1.14.
    expect(cents(result.total)).toBe(59.47)
    expect(cents(result.taxAmount)).toBe(7.48)
    expect(cents(result.subtotal)).toBe(45.99)
    // Delivery prints net, so Subtotal + Tax + Delivery is the total.
    expect(cents(result.shippingNet)).toBe(6)
    expect(cents(result.subtotal + result.taxAmount + result.shippingNet)).toBe(59.47)
    expect(result.itemTax).toEqual([
      { rate: 7, included: false, amount: 1.4 },
      { rate: 19, included: false, amount: 4.94 },
    ])
    expect(result.taxRate).toBe(19)
  })

  it('takes a discount off the goods first, then the shipping, shrinking each tax in proportion', () => {
    const goodsOnly = api.resolve(GERMAN_ORDER, GERMAN_ITEMS, 10.466, 7.14)
    // 52.33 - 10.466 leaves 80% of the goods: 6.34 * 0.8 = 5.072, shipping untouched.
    expect(cents(goodsOnly.total)).toBe(cents(52.33 - 10.466 + 7.14))
    expect(cents(goodsOnly.taxAmount)).toBe(cents(6.34 * 0.8 + 1.14))

    const intoShipping = api.resolve(GERMAN_ORDER, GERMAN_ITEMS, 55.9, 7.14)
    // The goods are fully discounted and 3.57 of 7.14 shipping is left: half its tax.
    expect(cents(intoShipping.total)).toBe(3.57)
    expect(cents(intoShipping.taxAmount)).toBe(0.57)
    expect(intoShipping.subtotal).toBe(0)
    expect(cents(intoShipping.shippingNet)).toBe(3)
  })

  it('extracts included tax without adding it, and falls back to the standard rate for an unmatched line', () => {
    const french = api.resolve(
      { taxRate: 20, taxIncluded: true, taxDecimals: 2, shippingTax: 1, lines: [] },
      [{ productId: 'p9', quantity: 1, unitPrice: 25.99, totalPrice: 25.99 }],
      0,
      6
    )
    expect(cents(french.total)).toBe(31.99)
    expect(cents(french.taxAmount)).toBe(5.33)
    expect(french.itemTax).toEqual([{ rate: 20, included: true, amount: 4.33 }])
  })
})

describe('/api/invoices/generate — regional tax wiring', () => {
  const route = generateInvoiceGenerateRouteCode({
    invoicePrefix: 'INV-',
    defaultTaxRate: 20,
    showDiscount: false,
    taxIncludedInPrice: false,
    companyDetails: {},
    template: { document: null },
    tables: { invoicesTable: 'teleport_invoices', invoiceItemsTable: 'teleport_invoice_items' },
    emailDelivery: { enabled: false },
  } as unknown as UIDLInvoiceSettings)

  it('prices from the order breakdown unless the caller names its own rate', () => {
    expect(route).toContain('function resolveRegionalInvoiceTax(')
    expect(route).toContain('var regionalTaxBreakdown = body.taxRate == null')
    expect(route).toContain('parseOrderTaxBreakdown(orderShippingSource.tax_breakdown)')
    expect(route).toContain('taxIncludedInPrice: taxIncludedInPrice,')
    expect(route).toContain('variantId: row.variant_id || row.variantId || null,')
  })
})
