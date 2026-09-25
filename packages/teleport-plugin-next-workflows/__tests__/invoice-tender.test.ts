/* tslint:disable:function-constructor */
import { generateInvoiceGenerateRouteCode } from '../src/invoice/api-routes-code'
import { generatePdfGeneratorCode } from '../src/invoice/pdf-generator-code'
import { generateDataAccessCode, getRecordMappingCode } from '../src/invoice/data-access-code'
import type { UIDLInvoiceSettings } from '@teleporthq/teleport-types'

/**
 * Vouchers and the gift-card tender on the invoice.
 *
 * A voucher is money the buyer was not charged, so the invoice subtracts it
 * and names the code. A gift card is a TENDER: the total stays what the order
 * was worth, and the invoice says how much of it the card settled and what was
 * left to pay — 0.00 when the card covered everything, which is the buyer's
 * proof of exactly that. Every piece below is the EMITTED code, run.
 */

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

type Row = Record<string, unknown>

const GIFT_CARD_ORDER: Row = {
  id: 'order-gc',
  order_number: 'ORD-9',
  currency: 'USD',
  total_amount: 96,
  shipping_amount: 0,
  gift_card_amount: 96,
  gift_card_last4: '1234',
  billing_name: 'Jane Buyer',
  billing_email: 'jane@example.com',
}
const GIFT_CARD_ITEMS: Row[] = [
  { product_id: 'p1', product_name: 'E-book', quantity: 1, unit_price: 96, total_price: 96 },
]

// A voucher and an automatic rule on one order: `discount_amount` holds both,
// `automatic_discount_amount` the rule's share, and the order predates the
// `voucher_discount_amount` column.
const VOUCHER_ORDER: Row = {
  id: 'order-v',
  order_number: 'ORD-10',
  currency: 'USD',
  total_amount: 75,
  discount_amount: 25,
  automatic_discount_amount: 10,
  voucher_code: 'SAVE20',
  subscription_id: 'sub-1',
  billing_reason: 'renewal',
  billing_name: 'Jane Buyer',
  billing_email: 'jane@example.com',
}
const VOUCHER_ITEMS: Row[] = [
  { product_id: 'p2', product_name: 'Course', quantity: 1, unit_price: 100, total_price: 100 },
]

interface HandlerRun {
  status: number
  payload: Row
  /** The `invoiceData` the route handed to the PDF generator and the insert. */
  invoice: Row
}

async function runHandler(order: Row, items: Row[], body: Row): Promise<HandlerRun> {
  const code = generateInvoiceGenerateRouteCode(FAKE_SETTINGS)
  let invoice: Row = {}

  const dataAccessStub = {
    getOrderWithItems: async (orderId: string) => (orderId === order.id ? { order, items } : null),
    getNextInvoiceNumber: async () => 1,
    insertInvoice: async (invoiceData: Row) => {
      invoice = invoiceData
      return invoiceData
    },
    insertInvoiceItems: async (_invoiceId: string, rows: unknown[]) => rows,
    updateInvoice: async () => ({}),
  }
  const pdfGeneratorStub = {
    generateInvoicePdf: async () => Buffer.from('%PDF-1.4 fake'),
    COMPANY_DETAILS: {},
  }
  const stubRequire = ((id: string) => {
    if (id.indexOf('data-access') !== -1) return dataAccessStub
    if (id.indexOf('pdf-generator') !== -1) return pdfGeneratorStub
    if (id === 'pg') return { Client: class {} }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id)
  }) as unknown as NodeRequire

  const factory = new Function(
    'require',
    'module',
    'exports',
    `${code}; return module.exports;`
  ) as (
    req: NodeRequire,
    mod: { exports: unknown },
    exp: unknown
  ) => (req: unknown, res: unknown) => Promise<void>
  const moduleObject = { exports: {} as unknown }
  const handler = factory(stubRequire, moduleObject, moduleObject.exports)

  let status = 0
  let payload: Row = {}
  const res = {
    status(statusCode: number) {
      status = statusCode
      return this
    },
    json(value: Row) {
      payload = value
      return this
    },
    setHeader() {
      /* unused */
    },
    end() {
      /* unused */
    },
  }
  await handler({ method: 'POST', headers: { host: 'localhost:3000' }, body }, res)
  return { status, payload, invoice }
}

interface PdfGeneratorModule {
  buildInvoiceDataScope: (invoiceData: Row) => { invoiceData: { Invoice: Record<string, string> } }
  buildInvoiceHtml: (invoiceData: Row) => string
  replacePlaceholders: (template: string, data: Row) => string
  buildDataContext: (invoiceData: Row) => Row
}

function loadPdfGenerator(templateUidl: unknown = null): PdfGeneratorModule {
  const code = generatePdfGeneratorCode(FAKE_SETTINGS, templateUidl, templateUidl ? {} : null)
  const moduleObject = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', `${code}; return module.exports;`)(
    require,
    moduleObject,
    moduleObject.exports
  )
  return moduleObject.exports as unknown as PdfGeneratorModule
}

describe('/api/invoices/generate — vouchers and the gift-card tender', () => {
  const originalFetch = globalThis.fetch
  const originalConnString = process.env.TELEPORT_DB_CONNECTION_STRING
  const originalDatabaseUrl = process.env.DATABASE_URL

  beforeAll(() => {
    globalThis.fetch = (async () => {
      throw new Error('runtime storage not configured in tests')
    }) as unknown as typeof fetch
    delete process.env.TELEPORT_DB_CONNECTION_STRING
    delete process.env.DATABASE_URL
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
    if (originalConnString !== undefined) {
      process.env.TELEPORT_DB_CONNECTION_STRING = originalConnString
    }
    if (originalDatabaseUrl !== undefined) {
      process.env.DATABASE_URL = originalDatabaseUrl
    }
  })

  it('keeps the total of an order paid entirely by gift card and owes nothing', async () => {
    const run = await runHandler(GIFT_CARD_ORDER, GIFT_CARD_ITEMS, { orderId: 'order-gc' })

    expect(run.status).toBe(200)
    expect(run.payload.total).toBe(96)
    expect(run.invoice.total).toBe(96)
    expect(run.invoice.giftCardAmount).toBe(96)
    expect(run.invoice.giftCardLast4).toBe('1234')
    expect(run.invoice.hasGiftCard).toBe(true)
    expect(run.invoice.amountDue).toBe(0)
    expect(run.invoice.hasDiscount).toBe(false)
    expect(run.invoice.discountAmount).toBe(0)
  })

  it('subtracts the voucher, splits it from the automatic share and names the code', async () => {
    const run = await runHandler(VOUCHER_ORDER, VOUCHER_ITEMS, { orderId: 'order-v' })

    expect(run.status).toBe(200)
    expect(run.invoice.total).toBe(75)
    expect(run.invoice.discountAmount).toBe(25)
    expect(run.invoice.voucherDiscountAmount).toBe(15)
    expect(run.invoice.automaticDiscountAmount).toBe(10)
    expect(run.invoice.voucherCode).toBe('SAVE20')
    expect(run.invoice.hasDiscount).toBe(true)
    // No card: nothing tendered, the whole total is due.
    expect(run.invoice.hasGiftCard).toBe(false)
    expect(run.invoice.giftCardAmount).toBe(0)
    expect(run.invoice.amountDue).toBe(75)
    expect(run.invoice.subscriptionId).toBe('sub-1')
    expect(run.invoice.billingReason).toBe('renewal')
  })

  it('reads a recorded voucher share over the derived remainder', async () => {
    const run = await runHandler({ ...VOUCHER_ORDER, voucher_discount_amount: 12 }, VOUCHER_ITEMS, {
      orderId: 'order-v',
    })
    expect(run.invoice.voucherDiscountAmount).toBe(12)
  })

  it('no longer hides a discount behind a template flag', () => {
    const route = generateInvoiceGenerateRouteCode(FAKE_SETTINGS)
    expect(route).not.toContain('SHOW_DISCOUNT')
    // A caller that assembled the invoice itself states its own discount.
    expect(route).toContain("if (body.discountAmount != null && body.discountAmount !== '') {")
  })
})

describe('invoice PDF renderer — vouchers and the gift-card tender', () => {
  const pdfGenerator = loadPdfGenerator()

  const giftCardInvoice: Row = {
    invoiceNumber: 'INV-0001',
    currency: 'USD',
    currencySymbol: '$',
    subtotal: 96,
    taxRate: 0,
    taxAmount: 0,
    discountAmount: 0,
    shippingAmount: 0,
    total: 96,
    giftCardAmount: 96,
    giftCardLast4: '1234',
    amountDue: 0,
    items: [{ name: 'E-book', quantity: 1, unitPrice: 96, totalPrice: 96 }],
  }

  const voucherInvoice: Row = {
    invoiceNumber: 'INV-0002',
    currency: 'USD',
    currencySymbol: '$',
    subtotal: 100,
    taxRate: 0,
    taxAmount: 0,
    discountAmount: 25,
    voucherDiscountAmount: 15,
    automaticDiscountAmount: 10,
    voucherCode: 'SAVE20',
    shippingAmount: 0,
    total: 75,
    items: [{ name: 'Course', quantity: 1, unitPrice: 100, totalPrice: 100 }],
  }

  it('publishes the tender, the amount due and the flag the row is gated on', () => {
    const { invoiceData } = pdfGenerator.buildInvoiceDataScope(giftCardInvoice)
    expect(invoiceData.Invoice.hasGiftCard).toBe('true')
    expect(invoiceData.Invoice.giftCardAmount).toBe('$96.00')
    expect(invoiceData.Invoice.giftCardLast4).toBe('1234')
    expect(invoiceData.Invoice.amountDue).toBe('$0.00')
    expect(invoiceData.Invoice.hasDiscount).toBe('false')
    expect(invoiceData.Invoice.discountLabel).toBe('Discount:')
  })

  it('publishes the discount split with the voucher code in the label', () => {
    const { invoiceData } = pdfGenerator.buildInvoiceDataScope(voucherInvoice)
    expect(invoiceData.Invoice.hasDiscount).toBe('true')
    expect(invoiceData.Invoice.discountAmount).toBe('$25.00')
    expect(invoiceData.Invoice.voucherDiscountAmount).toBe('$15.00')
    expect(invoiceData.Invoice.automaticDiscountAmount).toBe('$10.00')
    expect(invoiceData.Invoice.discountLabel).toBe('Discount (SAVE20):')
    // No tender: the amount due is the total, and no card is named.
    expect(invoiceData.Invoice.hasGiftCard).toBe('false')
    expect(invoiceData.Invoice.amountDue).toBe('$75.00')
  })

  it('derives the amount due when the route did not send one', () => {
    const { invoiceData } = pdfGenerator.buildInvoiceDataScope({
      ...giftCardInvoice,
      amountDue: undefined,
      giftCardAmount: 40,
    })
    expect(invoiceData.Invoice.amountDue).toBe('$56.00')
  })

  it('never lets the template sample supply a voucher code or a card tail', () => {
    const templated = loadPdfGenerator({
      name: 'invoice-template',
      node: {
        type: 'element',
        content: {
          elementType: 'context',
          attrs: {
            Invoice: { type: 'static', content: { voucherCode: 'SAMPLE', giftCardLast4: '9999' } },
          },
          children: [],
        },
      },
    })
    const { invoiceData } = templated.buildInvoiceDataScope({
      ...giftCardInvoice,
      giftCardLast4: '',
    })
    expect(invoiceData.Invoice.voucherCode).toBe('')
    expect(invoiceData.Invoice.giftCardLast4).toBe('')
  })

  it('prints the gift card and the amount due beneath the total in the fallback HTML', () => {
    const html = pdfGenerator.buildInvoiceHtml(giftCardInvoice)
    expect(html).toContain('<span>Total</span><span>$96.00</span>')
    expect(html).toContain('<span>Paid by gift card ••••1234</span><span>−$96.00</span>')
    expect(html).toContain('<span>Amount due</span><span>$0.00</span>')
    expect(html.indexOf('Amount due')).toBeGreaterThan(html.indexOf('<span>Total</span>'))
    expect(html).not.toContain('Discount')
  })

  it('prints the voucher under its code and the automatic share on its own line', () => {
    const html = pdfGenerator.buildInvoiceHtml(voucherInvoice)
    expect(html).toContain('<span>Discount (SAVE20)</span><span>−$15.00</span>')
    expect(html).toContain('<span>Automatic discount</span><span>−$10.00</span>')
    expect(html).toContain('<span>Total</span><span>$75.00</span>')
    expect(html).not.toContain('Amount due')
    expect(html.indexOf('Discount (SAVE20)')).toBeLessThan(html.indexOf('<span>Total</span>'))
  })

  it('prints a plain Discount line for an order with only automatic discounts', () => {
    const html = pdfGenerator.buildInvoiceHtml({
      ...voucherInvoice,
      voucherCode: '',
      voucherDiscountAmount: 0,
      automaticDiscountAmount: 25,
    })
    expect(html).toContain('<span>Discount</span><span>−$25.00</span>')
    expect(html).not.toContain('Automatic discount')
  })

  it('renders the template rows gated on Invoice.hasGiftCard and Invoice.hasDiscount', () => {
    const textNode = (children: unknown[]) => ({
      type: 'element',
      content: { elementType: 'text', semanticType: 'p', children },
    })
    const gatedRow = (flag: string, label: string, valuePath: string) => ({
      type: 'conditional',
      content: {
        reference: { type: 'expr', content: `invoiceData?.Invoice?.${flag}` },
        condition: { conditions: [{ operation: '=', operand: 'true' }] },
        node: {
          type: 'element',
          content: {
            elementType: 'container',
            children: [
              textNode([{ type: 'static', content: label }]),
              textNode([{ type: 'expr', content: `invoiceData?.Invoice?.${valuePath}` }]),
            ],
          },
        },
      },
    })
    const templated = loadPdfGenerator({
      name: 'invoice-template',
      node: {
        type: 'element',
        content: {
          elementType: 'container',
          children: [
            gatedRow('hasDiscount', 'Discount:', 'discountAmount'),
            gatedRow('hasGiftCard', 'Paid by gift card:', 'giftCardAmount'),
            gatedRow('hasGiftCard', 'Amount due:', 'amountDue'),
          ],
        },
      },
    })

    const giftCardHtml = templated.buildInvoiceHtml(giftCardInvoice)
    expect(giftCardHtml).toContain('Paid by gift card:')
    expect(giftCardHtml).toContain('$96.00')
    expect(giftCardHtml).toContain('Amount due:')
    expect(giftCardHtml).not.toContain('Discount:')

    const voucherHtml = templated.buildInvoiceHtml(voucherInvoice)
    expect(voucherHtml).toContain('Discount:')
    expect(voucherHtml).toContain('$25.00')
    expect(voucherHtml).not.toContain('Amount due:')
  })

  it('fills the {{amountDue}}, {{giftCardAmount}} and {{discountAmount}} merge tokens', () => {
    const giftCard = pdfGenerator.buildDataContext(giftCardInvoice)
    expect(
      pdfGenerator.replacePlaceholders(
        'Total {{totalAmount}} · card {{giftCardAmount}} · due {{amountDue}}',
        giftCard
      )
    ).toBe('Total $96.00 · card $96.00 · due $0.00')

    // Without a card the amount due is the total.
    const voucher = pdfGenerator.buildDataContext(voucherInvoice)
    expect(
      pdfGenerator.replacePlaceholders('Discount {{discountAmount}} · due {{amountDue}}', voucher)
    ).toBe('Discount $25.00 · due $75.00')
  })

  it('drops the summary line of an amount that is zero, and keeps the ones that applied', () => {
    const body =
      '<table><tbody>' +
      '<tr><td>Due date</td><td>{{dueDate}}</td></tr>' +
      '<tr><td>Delivery</td><td>{{shippingAmount}}</td></tr>' +
      '<tr><td>Discount</td><td>−{{discountAmount}}</td></tr>' +
      '<tr><td>Paid by gift card</td><td>−{{giftCardAmount}}</td></tr>' +
      '<tr><td>Amount due</td><td>{{amountDue}}</td></tr>' +
      '</tbody></table>'

    const voucherEmail = pdfGenerator.replacePlaceholders(
      body,
      pdfGenerator.buildDataContext(voucherInvoice)
    )
    expect(voucherEmail).not.toContain('Delivery')
    expect(voucherEmail).not.toContain('gift card')
    expect(voucherEmail).toContain('<tr><td>Discount</td><td>−$25.00</td></tr>')
    expect(voucherEmail).toContain('<tr><td>Amount due</td><td>$75.00</td></tr>')

    const giftCardEmail = pdfGenerator.replacePlaceholders(
      body,
      pdfGenerator.buildDataContext({ ...giftCardInvoice, shippingAmount: 9.99 })
    )
    expect(giftCardEmail).toContain('<tr><td>Delivery</td><td>$9.99</td></tr>')
    expect(giftCardEmail).not.toContain('Discount')
    expect(giftCardEmail).toContain('<tr><td>Paid by gift card</td><td>−$96.00</td></tr>')
    expect(giftCardEmail).toContain('<tr><td>Amount due</td><td>$0.00</td></tr>')

    // A rich-text editor turns table rows into paragraphs; the same rule holds.
    expect(
      pdfGenerator.replacePlaceholders(
        '<p>Delivery {{shippingAmount}}</p><p>Due {{amountDue}}</p>',
        pdfGenerator.buildDataContext(voucherInvoice)
      )
    ).toBe('<p>Due $75.00</p>')
  })
})

describe('invoice data-access — the tender columns', () => {
  interface DataAccessModule {
    insertInvoice: (invoiceData: Row) => Promise<Row>
    mapInvoiceToRecord: (invoiceData: Row) => Row
  }

  function loadPostgresDataAccess(query: (sql: string, values: unknown[]) => Promise<unknown>) {
    const code =
      generateDataAccessCode(FAKE_SETTINGS, 'postgresql', null) +
      '\n' +
      getRecordMappingCode('postgresql')
    const pgStub = {
      Pool: class {
        query = query
      },
    }
    const stubRequire = ((id: string) => {
      if (id === 'pg') return pgStub
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(id)
    }) as unknown as NodeRequire
    const factory = new Function(
      'require',
      'module',
      'exports',
      `${code}; return { insertInvoice: insertInvoice, mapInvoiceToRecord: mapInvoiceToRecord };`
    ) as (req: NodeRequire, mod: { exports: unknown }, exp: unknown) => DataAccessModule
    const moduleObject = { exports: {} as unknown }
    return factory(stubRequire, moduleObject, moduleObject.exports)
  }

  it('writes the delivery fee, the tender and the amount due', () => {
    const dataAccess = loadPostgresDataAccess(async () => ({ rows: [{}] }))
    const record = dataAccess.mapInvoiceToRecord({
      total: 96,
      shippingAmount: 9.99,
      giftCardAmount: 96,
      amountDue: 0,
    })
    expect(record.shipping_amount).toBe(9.99)
    expect(record.gift_card_amount).toBe(96)
    expect(record.amount_due).toBe(0)
    // The whole total is due when the route sent no figure (an older caller).
    expect(dataAccess.mapInvoiceToRecord({ total: 50 }).amount_due).toBe(50)
  })

  it('still inserts on a store whose table predates the columns', async () => {
    // The editor adds missing columns when activation runs; a store that only
    // republished has the old table, and its buyers must still get invoices.
    const attempts: string[] = []
    const dataAccess = loadPostgresDataAccess(async (sql: string) => {
      attempts.push(sql)
      if (sql.indexOf('"amount_due"') !== -1) {
        throw new Error('column "amount_due" of relation "teleport_invoices" does not exist')
      }
      if (sql.indexOf('"gift_card_amount"') !== -1) {
        throw new Error('column "gift_card_amount" of relation "teleport_invoices" does not exist')
      }
      return { rows: [{ id: 'inv-1' }] }
    })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const inserted = await dataAccess.insertInvoice({
        id: 'inv-1',
        total: 96,
        giftCardAmount: 96,
      })
      expect(inserted).toEqual({ id: 'inv-1' })
      expect(attempts).toHaveLength(3)
      expect(attempts[2]).not.toContain('"amount_due"')
      expect(attempts[2]).not.toContain('"gift_card_amount"')
      expect(attempts[2]).toContain('"shipping_amount"')
      expect(warn).toHaveBeenCalledTimes(2)
    } finally {
      warn.mockRestore()
    }
  })

  it('does not swallow any other insert failure', async () => {
    const dataAccess = loadPostgresDataAccess(async () => {
      throw new Error('column "customer_name" of relation "teleport_invoices" does not exist')
    })
    await expect(dataAccess.insertInvoice({ id: 'inv-1', total: 96 })).rejects.toThrow(
      'customer_name'
    )
  })
})
