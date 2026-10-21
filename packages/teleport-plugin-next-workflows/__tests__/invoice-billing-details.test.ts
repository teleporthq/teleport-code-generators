/* tslint:disable:function-constructor */
import { generateInvoiceGenerateRouteCode } from '../src/invoice/api-routes-code'
import { generatePdfGeneratorCode } from '../src/invoice/pdf-generator-code'
import type { UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import {
  INVOICE_TEST_APP_SECRET,
  createInvoiceRouteRequire,
  evaluateEmittedModule,
  serverCallHeaders,
} from './_helpers/load-invoice-route'

/**
 * The buyer's own invoice details on the invoice. An order whose buyer gave
 * them (a booking's "Add invoice details") carries the address in its parts
 * and the tax or VAT number in its metadata: the invoice is made out to them
 * — never mixed with a shipping address — and names the VAT number. A booking
 * order also records the tax its final price includes, so its invoice extracts
 * it instead of adding the store's rate on top. And the template's sample
 * customer never fills a part the buyer left out. Every piece below is the
 * EMITTED code, run.
 */

const settingsWith = (overrides: Record<string, unknown>) =>
  ({
    invoicePrefix: 'INV-',
    defaultTaxRate: 19,
    showDiscount: false,
    taxIncludedInPrice: false,
    companyDetails: {},
    template: { document: null as unknown },
    tables: { invoicesTable: 'teleport_invoices', invoiceItemsTable: 'teleport_invoice_items' },
    emailDelivery: { enabled: false },
    ...overrides,
  } as unknown as UIDLInvoiceSettings)

type Row = Record<string, unknown>

const BOOKING_ORDER: Row = {
  id: 'order-bk',
  order_number: 'ORD-1',
  currency: 'EUR',
  total_amount: 238,
  shipping_amount: 0,
  billing_name: 'Acme SRL',
  billing_email: 'ana@example.com',
  billing_address: 'Str. Lunga 1, 400000 Cluj, Cluj, Romania',
  shipping_city: 'Shipped-to city',
  tax_breakdown: JSON.stringify({
    taxRate: 19,
    taxIncluded: true,
    taxDecimals: 2,
    shippingTax: 0,
    lines: [{ productId: 'room', variantId: '', taxRate: 19, taxIncluded: true }],
  }),
  metadata: JSON.stringify({
    bookingId: 'b1',
    bookingReference: 'BK-1',
    billingTaxId: 'RO12345678',
    billingStreet: 'Str. Lunga 1',
    billingCity: 'Cluj',
    billingPostalCode: '400000',
    billingRegion: 'Cluj',
    billingCountry: 'Romania',
  }),
}
const BOOKING_ITEMS: Row[] = [
  {
    product_id: 'room',
    product_name: 'Double room',
    quantity: 1,
    unit_price: 238,
    total_price: 238,
  },
]

async function runHandler(
  settings: UIDLInvoiceSettings,
  order: Row,
  items: Row[],
  body: Row
): Promise<{ status: number; invoice: Row }> {
  const code = generateInvoiceGenerateRouteCode(settings)
  let invoice: Row = {}
  const handler = evaluateEmittedModule<(req: unknown, res: unknown) => Promise<void>>(
    code,
    createInvoiceRouteRequire(settings, {
      dataAccess: {
        getOrderWithItems: async (orderId: string) =>
          orderId === order.id ? { order, items } : null,
        reserveInvoice: async (invoiceData: Row) => {
          invoice = invoiceData
          return { invoice: invoiceData, created: true }
        },
        storeInvoicePdf: async () => ({}),
        updateInvoice: async () => ({}),
      },
      pdfGenerator: {
        generateInvoicePdf: async () => Buffer.from('%PDF-1.4 fake'),
        COMPANY_DETAILS: {},
      },
    })
  )
  let status = 0
  const res = {
    status(statusCode: number) {
      status = statusCode
      return this
    },
    json() {
      return this
    },
    setHeader() {
      /* unused */
    },
    end() {
      /* unused */
    },
  }
  await handler({ method: 'POST', headers: serverCallHeaders(), body }, res)
  return { status, invoice }
}

interface PdfGeneratorModule {
  buildInvoiceDataScope: (invoiceData: Row) => { invoiceData: Record<string, Row> }
  buildInvoiceHtml: (invoiceData: Row) => string
}

function loadPdfGenerator(
  settings: UIDLInvoiceSettings,
  templateUidl: unknown
): PdfGeneratorModule {
  const code = generatePdfGeneratorCode(settings, templateUidl, {})
  const moduleObject = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', `${code}; return module.exports;`)(
    require,
    moduleObject,
    moduleObject.exports
  )
  return moduleObject.exports as unknown as PdfGeneratorModule
}

describe('/api/invoices/generate — the buyer’s own invoice details', () => {
  const originalFetch = globalThis.fetch
  const originalConnString = process.env.TELEPORT_DB_CONNECTION_STRING
  const originalDatabaseUrl = process.env.DATABASE_URL
  const originalAppSecret = process.env.NEXTAUTH_SECRET

  beforeAll(() => {
    globalThis.fetch = (async () => {
      throw new Error('runtime storage not configured in tests')
    }) as unknown as typeof fetch
    delete process.env.TELEPORT_DB_CONNECTION_STRING
    delete process.env.DATABASE_URL
    process.env.NEXTAUTH_SECRET = INVOICE_TEST_APP_SECRET
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
    if (originalAppSecret === undefined) {
      delete process.env.NEXTAUTH_SECRET
    } else {
      process.env.NEXTAUTH_SECRET = originalAppSecret
    }
    if (originalConnString !== undefined) {
      process.env.TELEPORT_DB_CONNECTION_STRING = originalConnString
    }
    if (originalDatabaseUrl !== undefined) {
      process.env.DATABASE_URL = originalDatabaseUrl
    }
  })

  it('makes the invoice out to the address parts and VAT number the order carries', async () => {
    const run = await runHandler(settingsWith({}), BOOKING_ORDER, BOOKING_ITEMS, {
      orderId: 'order-bk',
    })
    expect(run.status).toBe(200)
    expect(run.invoice).toMatchObject({
      customerName: 'Acme SRL',
      customerAddress: 'Str. Lunga 1',
      customerCity: 'Cluj',
      customerZip: '400000',
      customerState: 'Cluj',
      customerCountry: 'Romania',
      customerVat: 'RO12345678',
    })
  })

  it('extracts the tax a booking price includes, so the invoice totals what was charged', async () => {
    // The store adds 19% on top of its products; the booking's price already holds it.
    const run = await runHandler(settingsWith({}), BOOKING_ORDER, BOOKING_ITEMS, {
      orderId: 'order-bk',
    })
    expect(run.invoice.total).toBe(238)
    expect(run.invoice.taxAmount).toBeCloseTo(38, 2)
    expect(run.invoice.subtotal).toBeCloseTo(200, 2)
  })

  it('keeps the order’s own billing and shipping address when it carries no parts', async () => {
    const order = {
      ...BOOKING_ORDER,
      tax_breakdown: null,
      billing_address: 'Main St 5',
      shipping_city: 'Springfield',
      shipping_country: 'United States',
      metadata: JSON.stringify({ billingTaxId: 'US-99' }),
    }
    const run = await runHandler(settingsWith({ defaultTaxRate: 0 }), order, BOOKING_ITEMS, {
      orderId: 'order-bk',
    })
    expect(run.invoice).toMatchObject({
      customerAddress: 'Main St 5',
      customerCity: 'Springfield',
      customerCountry: 'United States',
      customerVat: 'US-99',
    })
  })

  it('bills a store order shipped elsewhere at its billing address, under its company', async () => {
    // The store checkout's "Billing Details", as its order records them; the
    // goods go to someone else, in another town.
    const storeOrder: Row = {
      id: 'order-store',
      order_number: 'ORD-7',
      currency: 'USD',
      total_amount: 40,
      shipping_amount: 0,
      billing_name: 'Ana Billing',
      billing_email: 'ana@example.test',
      billing_address: '1 Billing Street, Suite 4',
      shipping_name: 'Ben Recipient',
      shipping_address: '12 Delivery Lane',
      shipping_city: 'Lyon',
      shipping_state: 'Rhone',
      shipping_zip: '69001',
      shipping_country: 'FR',
      metadata: JSON.stringify({
        billingStreet: '1 Billing Street, Suite 4',
        billingCompany: 'Acme Widgets Ltd',
        billingCity: 'Halifax',
        billingRegion: 'NS',
        billingPostalCode: 'B3H 1A1',
        billingCountry: 'CA',
      }),
    }
    const items = [{ product_id: 'mug', product_name: 'Mug', quantity: 2, unit_price: 20 }]
    const run = await runHandler(settingsWith({ defaultTaxRate: 0 }), storeOrder, items, {
      orderId: 'order-store',
    })
    expect(run.status).toBe(200)
    expect(run.invoice).toMatchObject({
      customerName: 'Ana Billing',
      customerCompany: 'Acme Widgets Ltd',
      customerAddress: '1 Billing Street, Suite 4',
      customerCity: 'Halifax',
      customerState: 'NS',
      customerZip: 'B3H 1A1',
      customerCountry: 'CA',
    })

    const withoutCompany = await runHandler(
      settingsWith({ defaultTaxRate: 0 }),
      { ...storeOrder, metadata: JSON.stringify({ billingStreet: '1 Billing Street' }) },
      items,
      { orderId: 'order-store' }
    )
    expect(withoutCompany.invoice.customerCompany).toBe('')
  })

  it('reads no metadata that is not a JSON object, and lets the caller’s VAT win', async () => {
    for (const metadata of ['not json', '[1,2]', null]) {
      const run = await runHandler(
        settingsWith({ defaultTaxRate: 0 }),
        { ...BOOKING_ORDER, metadata, tax_breakdown: null },
        BOOKING_ITEMS,
        { orderId: 'order-bk' }
      )
      expect([metadata, run.status]).toEqual([metadata, 200])
      expect([metadata, run.invoice.customerVat, run.invoice.customerCity]).toEqual([
        metadata,
        '',
        'Shipped-to city',
      ])
    }
    const stated = await runHandler(settingsWith({}), BOOKING_ORDER, BOOKING_ITEMS, {
      orderId: 'order-bk',
      customerVat: 'EDITED-1',
    })
    expect(stated.invoice.customerVat).toBe('EDITED-1')
  })
})

describe('invoice PDF renderer — the buyer, never the template’s sample', () => {
  const settings = settingsWith({})
  const templated = loadPdfGenerator(settings, {
    name: 'invoice-template',
    node: {
      type: 'element',
      content: {
        elementType: 'context',
        attrs: {
          Customer: {
            type: 'static',
            content: { name: 'Jane Smith', city: 'San Francisco', state: 'CA', vat: 'US1' },
          },
          Payment: { type: 'static', content: { method: 'Card', intentId: 'pi_sample' } },
        },
        children: [],
      },
    },
  })

  it('leaves out what the buyer did not give, and flags the lines that show', () => {
    const { invoiceData } = templated.buildInvoiceDataScope({
      customerName: 'Acme SRL',
      customerVat: 'RO12345678',
      currency: 'EUR',
      items: [],
    })
    expect(invoiceData.Customer).toMatchObject({
      name: 'Acme SRL',
      city: '',
      state: '',
      vat: 'RO12345678',
      hasVat: 'true',
      hasZip: 'false',
      hasCountry: 'false',
    })
    expect(invoiceData.Payment.intentId).toBe('')
  })

  it('prints the company under the name only for a buyer who gave one', () => {
    const withCompany = templated.buildInvoiceDataScope({
      customerName: 'Ana Billing',
      customerCompany: 'Acme Widgets Ltd',
      items: [],
    }).invoiceData.Customer
    expect(withCompany).toMatchObject({ company: 'Acme Widgets Ltd', hasCompany: 'true' })
    const withoutCompany = templated.buildInvoiceDataScope({ customerName: 'Ana', items: [] })
      .invoiceData.Customer
    expect(withoutCompany).toMatchObject({ company: '', hasCompany: 'false' })

    // The template's company line, gated on its flag like the editor builds it.
    const text = (children: unknown[]) => ({
      type: 'element',
      content: { elementType: 'text', semanticType: 'p', children },
    })
    const billTo = loadPdfGenerator(settings, {
      name: 'invoice-template',
      node: {
        type: 'element',
        content: {
          elementType: 'container',
          children: [
            text([{ type: 'expr', content: 'invoiceData?.Customer?.name' }]),
            {
              type: 'conditional',
              content: {
                reference: { type: 'expr', content: 'invoiceData?.Customer?.hasCompany' },
                condition: { conditions: [{ operation: '=', operand: 'true' }] },
                node: text([{ type: 'expr', content: 'invoiceData?.Customer?.company' }]),
              },
            },
          ],
        },
      },
    })
    expect(
      billTo.buildInvoiceHtml({
        customerName: 'Ana',
        customerCompany: 'Acme Widgets Ltd',
        items: [],
      })
    ).toContain('Acme Widgets Ltd')
    expect(billTo.buildInvoiceHtml({ customerName: 'Ana', items: [] })).not.toContain('Acme')

    // And the built-in layout used when a store has no template.
    const fallback = loadPdfGenerator(settings, null).buildInvoiceHtml({
      customerName: 'Ana Billing',
      customerCompany: 'Acme Widgets Ltd',
      items: [],
    })
    expect(fallback).toContain('<strong>Ana Billing</strong><br/>Acme Widgets Ltd<br/>')
  })
})
