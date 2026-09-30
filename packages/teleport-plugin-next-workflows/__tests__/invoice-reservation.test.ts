import { generateInvoiceGenerateRouteCode } from '../src/invoice/api-routes-code'
import type { UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import {
  INVOICE_TEST_APP_SECRET,
  createInvoiceRouteRequire,
  evaluateEmittedModule,
  serverCallHeaders,
} from './_helpers/load-invoice-route'

// A provider delivers a slow webhook again while the first delivery is still
// rendering the invoice, so `/api/invoices/generate` is asked twice for one
// order at once. The route reserves the number and the row before it renders
// (`reserveInvoice`), and a second request finds that reservation instead of
// issuing another invoice.

type Row = Record<string, unknown>

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

const ORDER = {
  id: 'order-1',
  currency: 'USD',
  total_amount: 96,
  billing_name: 'Jane Buyer',
  billing_email: 'jane@example.com',
}
const ORDER_ITEMS = [
  { product_id: 'p1', product_name: 'Mug', quantity: 2, unit_price: 48, total_price: 96 },
]

interface Run {
  status: number
  payload: Row
  renders: number
  stored: Array<{ id: string; bytes: number }>
  staleClaims: string[]
}

async function run(
  reservation: (invoiceData: Row) => { invoice: Row; created: boolean },
  stale = false
): Promise<Run> {
  let renders = 0
  const stored: Array<{ id: string; bytes: number }> = []
  const staleClaims: string[] = []
  const dataAccess = {
    getOrderWithItems: async () => ({ order: ORDER, items: ORDER_ITEMS }),
    reserveInvoice: async (invoiceData: Row) => reservation(invoiceData),
    claimStaleInvoice: async (id: string) => {
      staleClaims.push(id)
      return stale
    },
    storeInvoicePdf: async (id: string, pdf: Buffer) => {
      stored.push({ id, bytes: pdf.length })
      return {}
    },
    updateInvoice: async () => ({}),
  }
  const pdfGenerator = {
    generateInvoicePdf: async (invoiceData: Row) => {
      renders += 1
      return Buffer.from('%PDF-1.4 ' + String(invoiceData.invoiceNumber))
    },
    COMPANY_DETAILS: {},
  }
  const handler = evaluateEmittedModule<(req: unknown, res: unknown) => Promise<void>>(
    generateInvoiceGenerateRouteCode(SETTINGS),
    createInvoiceRouteRequire(SETTINGS, { dataAccess, pdfGenerator })
  )
  let status = 0
  let payload: Row = {}
  const res = {
    status(code: number) {
      status = code
      return this
    },
    json(value: Row) {
      payload = value
      return this
    },
    setHeader: () => undefined,
    end: () => undefined,
  }
  const savedSecret = process.env.NEXTAUTH_SECRET
  process.env.NEXTAUTH_SECRET = INVOICE_TEST_APP_SECRET
  const quiet = [
    jest.spyOn(console, 'info').mockImplementation(() => undefined),
    jest.spyOn(console, 'warn').mockImplementation(() => undefined),
  ]
  try {
    await handler(
      { method: 'POST', headers: serverCallHeaders(), body: { orderId: 'order-1' } },
      res
    )
  } finally {
    quiet.forEach((spy) => spy.mockRestore())
    if (savedSecret === undefined) {
      delete process.env.NEXTAUTH_SECRET
    } else {
      process.env.NEXTAUTH_SECRET = savedSecret
    }
  }
  return { status, payload, renders, stored, staleClaims }
}

describe('/api/invoices/generate — one invoice per order, one number per invoice', () => {
  it('issues a new invoice under the number the reservation took', async () => {
    const result = await run((invoiceData) => {
      invoiceData.invoiceNumber = 'INV-0007'
      return { invoice: { id: invoiceData.id }, created: true }
    })
    expect(result.status).toBe(200)
    expect(result.payload).toMatchObject({ success: true, invoiceNumber: 'INV-0007' })
    expect(result.renders).toBe(1)
    expect(result.stored).toEqual([{ id: result.payload.invoiceId, bytes: expect.any(Number) }])
    expect(result.staleClaims).toEqual([])
  })

  it('returns the invoice the order already has, without rendering or storing another', async () => {
    const result = await run(() => ({
      invoice: {
        id: 'inv-1',
        invoice_number: 'INV-0001',
        pdf_size_bytes: 2048,
        pdf_url: 'https://cdn.test/INV-0001.pdf',
        total: '96.00',
        currency: 'USD',
      },
      created: false,
    }))
    expect(result.status).toBe(200)
    expect(result.payload).toEqual({
      success: true,
      alreadyIssued: true,
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-0001',
      storageUrl: 'https://cdn.test/INV-0001.pdf',
      pdfUrl: 'https://cdn.test/INV-0001.pdf',
      total: 96,
      currency: 'USD',
    })
    expect(result.renders).toBe(0)
    expect(result.stored).toEqual([])
  })

  it('names no storage URL for an invoice only the database serves', async () => {
    const result = await run(() => ({
      invoice: { id: 'inv-1', invoice_number: 'INV-0001', pdf_size_bytes: 2048, pdf_url: null },
      created: false,
    }))
    expect(result.payload).toMatchObject({
      storageUrl: '',
      pdfUrl: '/api/invoices/inv-1/pdf',
    })
  })

  it('refuses while another request is still rendering the same invoice', async () => {
    const result = await run(() => ({
      invoice: { id: 'inv-1', invoice_number: 'INV-0001', pdf_size_bytes: null },
      created: false,
    }))
    expect(result.status).toBe(409)
    expect(result.payload).toMatchObject({ success: false, inProgress: true })
    expect(result.staleClaims).toEqual(['inv-1'])
    expect(result.renders).toBe(0)
    expect(result.stored).toEqual([])
  })

  it('finishes a reservation whose request died, under its own id and number', async () => {
    const result = await run(
      () => ({
        invoice: { id: 'inv-1', invoice_number: 'INV-0001', pdf_size_bytes: null },
        created: false,
      }),
      true
    )
    expect(result.status).toBe(200)
    expect(result.payload).toMatchObject({
      success: true,
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-0001',
    })
    expect(result.renders).toBe(1)
    expect(result.stored).toEqual([{ id: 'inv-1', bytes: expect.any(Number) }])
  })
})
