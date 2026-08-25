import { generateInvoiceGenerateRouteCode } from '../src/invoice/api-routes-code'
import { generatePdfGeneratorCode } from '../src/invoice/pdf-generator-code'
import type { UIDLInvoiceSettings } from '@teleporthq/teleport-types'

// The delivery fee on the invoice.
//
// `teleport_orders.shipping_amount` is folded into the amount the buyer was
// actually charged, so an invoice that ignores it prints a Total its own rows
// do not add up to — and, through `{{totalAmount}}`, asks the customer to pay
// a different number than their card was debited.
//
// Two halves are covered here:
//   1. `/api/invoices/generate` reads the fee off the order (or the caller)
//      and adds it to the total WITHOUT taxing it — the storefront charges the
//      configured delivery price verbatim, so the invoice has to as well.
//   2. The PDF renderer publishes `Invoice.shippingAmount` + `Invoice.hasShipping`
//      for the template to bind and gate on, and prints its own Delivery line in
//      the no-template fallback.

const FAKE_SETTINGS = {
  invoicePrefix: 'INV-',
  defaultTaxRate: 0,
  showDiscount: false,
  taxIncludedInPrice: false,
  companyDetails: {},
  template: { document: null as unknown },
  tables: { invoicesTable: 'teleport_invoices', invoiceItemsTable: 'teleport_invoice_items' },
  emailDelivery: { enabled: false },
} as unknown as UIDLInvoiceSettings

interface InvoiceScope {
  invoiceData: {
    Invoice: Record<string, string>
  }
}

interface PdfGeneratorModule {
  buildInvoiceDataScope: (invoiceData: Record<string, unknown>) => InvoiceScope
  buildInvoiceHtml: (invoiceData: Record<string, unknown>) => string
  replacePlaceholders: (template: string, data: Record<string, unknown>) => string
  buildDataContext: (invoiceData: Record<string, unknown>) => Record<string, unknown>
}

/**
 * Loads the emitted `utils/invoices/pdf-generator.js` as a real module so the
 * assertions run its arithmetic instead of matching its source text. No
 * template UIDL is passed, which is the fallback-HTML path.
 */
function loadPdfGenerator(): PdfGeneratorModule {
  const code = generatePdfGeneratorCode(FAKE_SETTINGS, null, null)
  const factory = new Function(
    'require',
    'module',
    'exports',
    `${code}; return module.exports;`
  ) as (
    req: NodeRequire,
    mod: { exports: Record<string, unknown> },
    exp: Record<string, unknown>
  ) => PdfGeneratorModule
  const moduleObject = { exports: {} as Record<string, unknown> }
  return factory(require, moduleObject, moduleObject.exports)
}

describe('/api/invoices/generate — delivery fee', () => {
  const route = generateInvoiceGenerateRouteCode(FAKE_SETTINGS)

  it('reads the fee off the hydrated order, with a caller override', () => {
    expect(route).toContain(
      'body.shippingAmount != null ? body.shippingAmount : (orderShippingSource.shipping_amount || 0)'
    )
  })

  it('coerces a missing / negative / unparseable fee to zero', () => {
    // Orders placed before the column existed hydrate `undefined` here, and
    // that has to read as "this order paid nothing for delivery" rather than
    // poisoning the total with NaN.
    expect(route).toContain('if (!isFinite(shippingAmount) || shippingAmount < 0) {')
    expect(route).toContain('shippingAmount = 0;')
  })

  it('adds the fee to the total but leaves subtotal and tax to the goods', () => {
    // The storefront never taxes the delivery price (`computeShippingMeta`
    // uses the configured value verbatim), so taxing it here would make the
    // invoice total disagree with `teleport_orders.total_amount`.
    expect(route).toContain('var total = goodsTotal + shippingAmount;')
    expect(route).toContain('subtotal: Math.round(subtotal * 100) / 100,')
    expect(route).toContain('shippingAmount: Math.round(shippingAmount * 100) / 100,')
  })
})

describe('invoice PDF renderer — delivery fee', () => {
  const pdfGenerator = loadPdfGenerator()

  const baseInvoice = {
    invoiceNumber: 'INV-0001',
    currency: 'USD',
    currencySymbol: '$',
    subtotal: 200,
    taxRate: 0,
    taxAmount: 0,
    discountAmount: 0,
    items: [{ name: 'Espresso Machine', quantity: 1, unitPrice: 200, totalPrice: 200 }],
  }

  it('publishes the formatted fee and turns the row flag on', () => {
    const { invoiceData } = pdfGenerator.buildInvoiceDataScope({
      ...baseInvoice,
      shippingAmount: 9.99,
      total: 209.99,
    })

    expect(invoiceData.Invoice.shippingAmount).toBe('$9.99')
    expect(invoiceData.Invoice.hasShipping).toBe('true')
  })

  it('turns the row flag off for an order that paid nothing to be delivered', () => {
    // Covers store-pickup orders, free-delivery orders, and every invoice
    // generated from an order placed before the column existed (no field at
    // all, so `Number(undefined)` is NaN and must not read as a fee).
    const { invoiceData } = pdfGenerator.buildInvoiceDataScope({
      ...baseInvoice,
      total: 200,
    })

    expect(invoiceData.Invoice.shippingAmount).toBe('$0.00')
    expect(invoiceData.Invoice.hasShipping).toBe('false')
  })

  it('prints a Delivery line in the fallback HTML only when there is a fee', () => {
    const withFee = pdfGenerator.buildInvoiceHtml({
      ...baseInvoice,
      shippingAmount: 9.99,
      total: 209.99,
    })
    expect(withFee).toContain('<span>Delivery</span><span>$9.99</span>')
    expect(withFee).toContain('<span>Total</span><span>$209.99</span>')

    const withoutFee = pdfGenerator.buildInvoiceHtml({ ...baseInvoice, total: 200 })
    expect(withoutFee).not.toContain('<span>Delivery</span>')
  })

  it('fills the {{shippingAmount}} merge token in the invoice email', () => {
    const data = pdfGenerator.buildDataContext({
      ...baseInvoice,
      shippingAmount: 9.99,
      total: 209.99,
    })

    expect(pdfGenerator.replacePlaceholders('Delivery: {{shippingAmount}}', data)).toBe(
      'Delivery: $9.99'
    )
    expect(pdfGenerator.replacePlaceholders('Due: {{totalAmount}}', data)).toBe('Due: $209.99')
  })
})
