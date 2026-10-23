/* tslint:disable:function-constructor */
import { generateInvoiceAssemblyCode } from '../src/invoice/invoice-assembly-code'
import { generatePdfGeneratorCode } from '../src/invoice/pdf-generator-code'
import type { UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import { evaluateEmittedModule } from './_helpers/load-invoice-route'

/**
 * What the invoice says about being paid, and how it writes money.
 *
 * A store invoices an order the moment its payment webhook marks it paid, so
 * that invoice — its email and its PDF — must not ask for a payment already
 * made: no due date, no amount due. A cash-on-delivery order is invoiced
 * unpaid when it is placed and keeps both. A summary line whose amount is zero
 * (no delivery, no discount, no tax, no gift card) is left out. And an empty
 * field on the real invoice prints nothing — never the design canvas's sample.
 *
 * Every piece below is the EMITTED code, run: the assembly the generate route
 * builds the invoice with, then the renderer the email and the PDF go through
 * (`email-sender-code.ts` fills the body with `buildDataContext` +
 * `replacePlaceholders`).
 */

const SETTINGS = {
  invoicePrefix: 'INV-',
  defaultTaxRate: 0,
  showDiscount: false,
  taxIncludedInPrice: false,
  companyDetails: {},
  template: { document: null as unknown },
  tables: { invoicesTable: 'teleport_invoices', invoiceItemsTable: 'teleport_invoice_items' },
  emailDelivery: { enabled: false },
} as unknown as UIDLInvoiceSettings

type Row = Record<string, unknown>

interface AssemblyModule {
  assembleInvoiceData: (body: Row, order: Row | null, items: Row[]) => Row
}

interface PdfGeneratorModule {
  buildInvoiceDataScope: (invoiceData: Row) => {
    invoiceData: { Invoice: Record<string, string>; Company: Record<string, string> }
  }
  buildInvoiceHtml: (invoiceData: Row) => string
  replacePlaceholders: (template: string, data: Row) => string
  buildDataContext: (invoiceData: Row) => Row
}

function loadAssembly(): AssemblyModule {
  const requireFn = ((id: string) => {
    if (id.indexOf('pdf-generator') !== -1) {
      return { COMPANY_DETAILS: {} }
    }
    if (id.indexOf('data-access') !== -1) {
      return {}
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id)
  }) as unknown as NodeRequire
  return evaluateEmittedModule<AssemblyModule>(generateInvoiceAssemblyCode(SETTINGS), requireFn)
}

function loadPdfGenerator(templateUidl: unknown = null): PdfGeneratorModule {
  return evaluateEmittedModule<PdfGeneratorModule>(
    generatePdfGeneratorCode(SETTINGS, templateUidl, templateUidl ? {} : null),
    require
  )
}

// The date the renderer prints for a stored date: it reads the calendar day in
// the server's own time zone, so the expectation does too.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const printedDate = (raw: unknown): string => {
  const date = new Date(raw as string)
  return MONTHS[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear()
}

// The editor's invoice email design (teleport-gui purposed-email-designs.ts) as
// it is published: each summary row is a <div> of <span>s, copied from a body a
// store sent on 2026-10-23 with its values put back to their tokens.
const SUMMARY_ROW_STYLE =
  'color: #374151; margin: 0; padding: 10px 0; font-size: 14px; line-height: 1.5'
const summaryRow = (label: string, value: string, last = false) =>
  `<div style="${SUMMARY_ROW_STYLE}${last ? '' : '; border-bottom: 1px solid #f0f1f3'}">` +
  `<span>${label}: </span>${value}</div>`
const INVOICE_EMAIL_BODY =
  '<div style="color: #1f2937; margin: 0 auto; padding: 8px; max-width: 600px; font-family: \'Segoe UI\',Roboto,Helvetica,Arial,sans-serif">' +
  '<div style="border: 1px solid #e5e7eb; overflow: hidden; background: #ffffff; border-radius: 14px">' +
  '<div style="padding: 24px 32px; background: #1e293b"><small style="color: #94a3b8; margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase">Invoice</small>' +
  '<p style="color: #ffffff; margin: 6px 0 0; font-size: 22px; font-weight: 700">Your invoice</p></div>' +
  '<div style="padding: 28px 32px">' +
  '<div style="color: #1f2937; margin: 0 0 16px; font-size: 15px; line-height: 1.6"><span>Dear </span><span>{{customerName}}</span><span>,</span></div>' +
  '<p style="color: #4b5563; margin: 0 0 18px; font-size: 15px; line-height: 1.6">Thank you for your purchase. Your invoice is attached to this email. Here is a quick summary:</p>' +
  '<div style="margin: 0 0 22px">' +
  summaryRow('Invoice number', '<span>{{invoiceNumber}}</span>') +
  summaryRow('Invoice date', '<span>{{invoiceDate}}</span>') +
  summaryRow('Due date', '<span>{{dueDate}}</span>') +
  summaryRow('Subtotal', '<span>{{subtotal}}</span>') +
  summaryRow('Discount', '<span>−</span><span>{{discountAmount}}</span>') +
  summaryRow('Tax', '<span>{{taxAmount}}</span>') +
  summaryRow('Delivery', '<span>{{shippingAmount}}</span>') +
  summaryRow('Total', '<span>{{totalAmount}}</span>') +
  summaryRow('Paid by gift card', '<span>−</span><span>{{giftCardAmount}}</span>') +
  summaryRow('Amount due', '<span>{{amountDue}}</span>', true) +
  '</div>' +
  '<div style="color: #4b5563; margin: 4px 0 0; font-size: 14px; line-height: 1.6"><span>If you have any questions about this invoice, contact us at </span><span>{{companyEmail}}</span><span>.</span></div>' +
  '<p style="color: #4b5563; margin: 20px 0 2px; font-size: 14px; line-height: 1.6">Best regards,</p>' +
  '<p style="color: #1f2937; margin: 0; font-size: 14px; font-weight: 600; line-height: 1.6">{{companyName}}</p>' +
  '</div></div></div>'

// ORD-2 of the store this was found on: one 119.00 lei line paid by card, no
// delivery, discount, tax or gift card. The payment webhook marked it paid —
// `payment_status` and the `updated_at` that write stamps — then asked for the
// invoice with just the order id.
const PAID_CARD_ORDER: Row = {
  id: 'order-2',
  order_number: 'ORD-2',
  currency: 'RON',
  total_amount: 119,
  shipping_amount: 0,
  discount_amount: 0,
  gift_card_amount: 0,
  status: 'confirmed',
  payment_status: 'paid',
  payment_method: 'stripe',
  payment_provider: 'stripe',
  updated_at: '2026-10-23T09:15:00.000Z',
  billing_name: 'Card Buyer',
}
const LINES: Row[] = [
  { product_id: 'p1', product_name: 'Bouquet', quantity: 1, unit_price: 119, total_price: 119 },
]
// The same basket, delivered and paid in cash at the door: invoiced when it is
// placed, before any money moved.
const CASH_ORDER: Row = {
  ...PAID_CARD_ORDER,
  id: 'order-3',
  order_number: 'ORD-3',
  total_amount: 134,
  shipping_amount: 15,
  status: 'pending',
  payment_status: 'unpaid',
  payment_method: 'cash_on_delivery',
  payment_provider: '',
}

// The editor's default invoice template, reduced to the parts this covers: the
// <context> carrying the design canvas's sample (teleport-gui
// invoice-template-builder.ts), the dates under the number, the total, the
// notes and the seller's VAT number.
const SAMPLE_NOTES = 'Payment is due within 30 days. Thank you for your business.'
const boundText = (path: string) => ({
  type: 'element',
  content: {
    elementType: 'text',
    semanticType: 'p',
    children: [{ type: 'expr', content: `invoiceData?.${path}` }],
  },
})
const INVOICE_TEMPLATE = {
  name: 'invoice-template',
  node: {
    type: 'element',
    content: {
      elementType: 'context',
      attrs: {
        Company: {
          type: 'static',
          content: { name: 'Acme Corporation', vat: 'US123456789', logoUrl: '' },
        },
        Invoice: {
          type: 'static',
          content: {
            invoiceNumber: '#INV-001',
            status: 'paid',
            issueDate: 'Jan 15, 2025',
            dueDate: 'Feb 14, 2025',
            paidDate: 'Jan 20, 2025',
            total: '371.49',
            currency: 'USD',
            notes: SAMPLE_NOTES,
          },
        },
      },
      children: [
        boundText('Invoice?.invoiceNumber'),
        boundText('Invoice?.issueDate'),
        boundText('Invoice?.dueDate'),
        boundText('Invoice?.total'),
        boundText('Invoice?.notes'),
        boundText('Invoice?.paidDate'),
        boundText('Company?.vat'),
      ],
    },
  },
}

const assembly = loadAssembly()
const pdfGenerator = loadPdfGenerator()

function invoiceFor(order: Row, body: Row = {}): Row {
  const invoice = assembly.assembleInvoiceData(
    { orderId: order.id, issueDate: '2026-10-23', ...body },
    order,
    LINES
  )
  return { ...invoice, invoiceNumber: 'INV-0002' }
}

function emailFor(invoice: Row, body = INVOICE_EMAIL_BODY): string {
  return pdfGenerator.replacePlaceholders(body, pdfGenerator.buildDataContext(invoice))
}

describe('the invoice of a paid order', () => {
  it('is issued paid, at the time the payment marked the order', () => {
    const invoice = invoiceFor(PAID_CARD_ORDER)
    expect(invoice.status).toBe('paid')
    expect(invoice.paidAt).toBe('2026-10-23T09:15:00.000Z')
  })

  it('keeps the status and payment time a caller states', () => {
    const invoice = invoiceFor(PAID_CARD_ORDER, { status: 'issued' })
    expect(invoice.status).toBe('issued')
    expect(invoice.paidAt).toBeNull()
    const stated = invoiceFor(PAID_CARD_ORDER, { status: 'paid', paidAt: '2026-10-20T08:00:00Z' })
    expect(stated.paidAt).toBe('2026-10-20T08:00:00Z')
  })

  it('emails no due date, no amount due and no zero lines', () => {
    const email = emailFor(invoiceFor(PAID_CARD_ORDER))
    expect(email).toContain('<span>Invoice number: </span><span>INV-0002</span>')
    expect(email).toContain(
      '<span>Invoice date: </span><span>' + printedDate('2026-10-23') + '</span>'
    )
    expect(email).toContain('<span>Subtotal: </span><span>lei 119.00</span>')
    expect(email).toContain('<span>Total: </span><span>lei 119.00</span>')
    for (const gone of ['Due date', 'Amount due', 'Discount', 'Tax', 'Delivery', 'gift card']) {
      expect(email).not.toContain(gone)
    }
    // Only the rows went: the summary box and the rest of the message stay.
    expect(email).toContain('<div style="margin: 0 0 22px">')
    expect(email).toContain('Best regards,')
  })

  it('prints a paid line where the PDF printed the due date', () => {
    const invoice = invoiceFor(PAID_CARD_ORDER)
    const html = loadPdfGenerator(INVOICE_TEMPLATE).buildInvoiceHtml(invoice)
    expect(html).toContain('<p>Paid on ' + printedDate('2026-10-23T09:15:00.000Z') + '</p>')
    expect(html).not.toContain(printedDate(invoice.dueDate))
    expect(html).toContain('<p>lei 119.00</p>')
    // The built-in layout of a store without a template says so too.
    expect(pdfGenerator.buildInvoiceHtml(invoice)).toContain(
      'Paid on ' + printedDate('2026-10-23T09:15:00.000Z')
    )
  })
})

describe('the invoice of a cash-on-delivery order', () => {
  it('is issued unpaid and due in 30 days', () => {
    const invoice = invoiceFor(CASH_ORDER)
    expect(invoice.status).toBe('issued')
    expect(invoice.paidAt).toBeNull()
    expect(invoice.dueDate).toBe('2026-11-22')
  })

  it('emails its due date and the delivery, and no amount due without a gift card', () => {
    const email = emailFor(invoiceFor(CASH_ORDER))
    expect(email).toContain(
      '<span>Due date: </span><span>' + printedDate('2026-11-22') + '</span></div>'
    )
    expect(email).toContain('<span>Delivery: </span><span>lei 15.00</span>')
    expect(email).toContain('<span>Total: </span><span>lei 134.00</span>')
    for (const gone of ['Amount due', 'Discount', 'Tax', 'gift card']) {
      expect(email).not.toContain(gone)
    }
  })

  it('keeps the due date on its PDF', () => {
    const invoice = invoiceFor(CASH_ORDER)
    const html = loadPdfGenerator(INVOICE_TEMPLATE).buildInvoiceHtml(invoice)
    expect(html).toContain('<p>' + printedDate('2026-11-22') + '</p>')
    expect(html).not.toContain('Paid on')
    expect(pdfGenerator.buildInvoiceHtml(invoice)).not.toContain('Paid on')
  })

  it('emails what a gift card paid and what is left to pay at the door', () => {
    const email = emailFor(invoiceFor({ ...CASH_ORDER, gift_card_amount: 50 }))
    expect(email).toContain(
      '<span>Paid by gift card: </span><span>−</span><span>lei 50.00</span></div>'
    )
    expect(email).toContain('<span>Amount due: </span><span>lei 84.00</span></div>')
    expect(email).toContain('<span>Due date: </span>')
  })

  it('emails no amount due once the rest was paid by card', () => {
    const email = emailFor(invoiceFor({ ...PAID_CARD_ORDER, gift_card_amount: 50 }))
    expect(email).toContain('<span>Paid by gift card: </span><span>−</span><span>lei 50.00</span>')
    expect(email).not.toContain('Amount due')
  })
})

describe('the invoice email drops a zero line, never what holds it', () => {
  const zeroDeliveryInvoice = invoiceFor(CASH_ORDER, { shippingAmount: 0 })

  it("keeps a merchant's own block around the line it drops", () => {
    const body =
      '<div class="merchant-summary">' +
      '<div class="row"><span>Delivery: </span><span>{{shippingAmount}}</span></div>' +
      '<div class="row"><span>Total: </span><span>{{totalAmount}}</span></div>' +
      '<p>Thank you for shopping with us.</p>' +
      '</div>'
    expect(emailFor(zeroDeliveryInvoice, body)).toBe(
      '<div class="merchant-summary">' +
        '<div class="row"><span>Total: </span><span>lei 119.00</span></div>' +
        '<p>Thank you for shopping with us.</p>' +
        '</div>'
    )
  })

  it('keeps a block that holds more than the line', () => {
    const withBlocks =
      '<div class="note"><span>Delivery {{shippingAmount}}</span><p>See you soon.</p></div>'
    expect(emailFor(zeroDeliveryInvoice, withBlocks)).toBe(
      '<div class="note"><span>Delivery lei 0.00</span><p>See you soon.</p></div>'
    )
    const withFigures = '<div>Delivery {{shippingAmount}}, total {{totalAmount}}.</div>'
    expect(emailFor(zeroDeliveryInvoice, withFigures)).toBe(
      '<div>Delivery lei 0.00, total lei 119.00.</div>'
    )
  })
})

describe('money on the invoice', () => {
  it.each([
    ['RON', 'lei 119.00'],
    ['CHF', 'CHF 119.00'],
    ['USD', '$119.00'],
    ['EUR', '€119.00'],
  ])('writes %s as %s in the email and the PDF alike', (currency, printed) => {
    const invoice = invoiceFor({ ...PAID_CARD_ORDER, currency })
    expect(emailFor(invoice, '<span>{{totalAmount}}</span>')).toBe(`<span>${printed}</span>`)
    expect(pdfGenerator.buildInvoiceDataScope(invoice).invoiceData.Invoice.total).toBe(printed)
  })
})

describe("the invoice PDF never prints the template's sample", () => {
  it('prints nothing for a field the real invoice leaves empty', () => {
    const html = loadPdfGenerator(INVOICE_TEMPLATE).buildInvoiceHtml(
      invoiceFor(CASH_ORDER, { notes: '' })
    )
    expect(html).not.toContain(SAMPLE_NOTES)
    expect(html).not.toContain('Jan 20, 2025')
    expect(html).not.toContain('US123456789')
    expect(html).not.toContain('371.49')
    expect(html).toContain('<p>#INV-0002</p>')
    expect(html).toContain('<p>lei 134.00</p>')
  })

  it("prints the invoice's own notes", () => {
    const html = loadPdfGenerator(INVOICE_TEMPLATE).buildInvoiceHtml(
      invoiceFor(CASH_ORDER, { notes: 'Leave it with the neighbour.' })
    )
    expect(html).toContain('<p>Leave it with the neighbour.</p>')
  })

  it("keeps the company logo the editor wrote onto the template's context", () => {
    const withLogo = {
      ...INVOICE_TEMPLATE,
      node: {
        ...INVOICE_TEMPLATE.node,
        content: {
          ...INVOICE_TEMPLATE.node.content,
          attrs: {
            Company: { type: 'static', content: { name: '', logoUrl: 'https://cdn/logo.png' } },
          },
        },
      },
    }
    const scope = loadPdfGenerator(withLogo).buildInvoiceDataScope(invoiceFor(CASH_ORDER))
    expect(scope.invoiceData.Company.logoUrl).toBe('https://cdn/logo.png')
  })
})
