import {
  generateInvoiceGenerateRouteCode,
  generateInvoiceRegenerateRouteCode,
} from '../src/invoice/api-routes-code'
import type { ProjectPluginStructure, UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import { generateInvoiceFiles } from '../src/invoice'
import {
  INVOICE_TEST_APP_SECRET,
  createInvoiceRouteRequire,
  evaluateEmittedModule,
  serverCallHeaders,
} from './_helpers/load-invoice-route'

/**
 * `POST /api/invoices/[id]/regenerate` — the admin panel's "Regenerate".
 *
 * Every test runs the EMITTED route against the REAL emitted assembly, with
 * the database, the PDF service and the session stubbed: a regenerated invoice
 * must be priced by exactly the code that issued it, keep its identity, take
 * the merchant's corrections over the order, and never email anybody.
 */

const SETTINGS = {
  invoicePrefix: 'INV-',
  defaultTaxRate: 0,
  taxIncludedInPrice: false,
  companyDetails: {},
  template: { document: null as unknown },
  tables: { invoicesTable: 'teleport_invoices', invoiceItemsTable: 'teleport_invoice_items' },
  emailDelivery: { enabled: true, provider: 'postmark' },
} as unknown as UIDLInvoiceSettings

type Row = Record<string, unknown>

const ORDER: Row = {
  id: 'order-1',
  order_number: 'ORD-7',
  currency: 'EUR',
  total_amount: 105,
  discount_amount: 10,
  shipping_amount: 15,
  gift_card_amount: 20,
  billing_name: 'Order Name',
  billing_email: 'order@example.com',
  shipping_city: 'Cluj',
  shipping_country: 'Romania',
  payment_method: 'stripe',
  notes: 'order note',
}
const ORDER_ITEMS: Row[] = [
  { product_id: 'p1', product_name: 'Lamp', quantity: 2, unit_price: 50, total_price: 100 },
]

// June 3 2026 local time — what pg hands over for a naive TIMESTAMP column.
const ISSUED_AT = new Date(2026, 5, 3, 0, 0, 0)
const DUE_AT = new Date(2026, 6, 3, 0, 0, 0)

const INVOICE: Row = {
  id: 'inv-1',
  invoice_number: 'INV-0004',
  status: 'partially_refunded',
  order_id: 'order-1',
  issue_date: ISSUED_AT,
  due_date: DUE_AT,
  paid_at: null,
  // What the merchant corrected with Edit.
  customer_name: 'Corrected Name',
  customer_email: '',
  customer_country: 'Moldova',
  customer_vat: 'RO123',
  notes: '',
  pdf_storage_key: 'old-file',
}

interface Harness {
  status: number
  payload: Row
  replaced: { id: string; invoice: Row; items: Row[] } | null
  links: unknown[][]
  updates: Array<{ id: string; fields: Row }>
  storageCalls: Array<{ url: string; method: string }>
  rendered: Row | null
}

interface RunOptions {
  method?: string
  id?: string
  token?: Row | null
  invoice?: Row | null
  invoiceLookupError?: Error
  order?: Row | null
  items?: Row[]
  pdfFails?: boolean
  uploadOk?: boolean
  linkFails?: boolean
}

const STORAGE_ENV = {
  RUNTIME_STORAGE_URL: 'https://storage.test',
  RUNTIME_STORAGE_API_KEY: 'key',
  RUNTIME_STORAGE_PROJECT_ID: 'proj',
}

/**
 * jest's node environment has neither `Blob` nor `FormData`; the upload only
 * needs them to exist. Returns the function that puts the originals back.
 */
function stubMultipartGlobals(): () => void {
  const runtime = globalThis as unknown as Record<string, unknown>
  const originals = { Blob: runtime.Blob, FormData: runtime.FormData }
  runtime.Blob = runtime.Blob || class {}
  runtime.FormData =
    runtime.FormData ||
    class {
      append(): void {
        // The request body is never read by the stubbed fetch.
      }
    }
  return () => {
    runtime.Blob = originals.Blob
    runtime.FormData = originals.FormData
  }
}

async function run(options: RunOptions = {}): Promise<Harness> {
  const harness: Harness = {
    status: 0,
    payload: {},
    replaced: null,
    links: [],
    updates: [],
    storageCalls: [],
    rendered: null,
  }
  const invoice = options.invoice === undefined ? INVOICE : options.invoice
  const order = options.order === undefined ? ORDER : options.order

  const dataAccess = {
    getInvoiceById: async (id: string) => {
      if (options.invoiceLookupError) {
        throw options.invoiceLookupError
      }
      return invoice && invoice.id === id ? invoice : null
    },
    getOrderWithItems: async (orderId: string) =>
      order && order.id === orderId ? { order, items: options.items ?? ORDER_ITEMS } : null,
    replaceInvoice: async (id: string, invoiceData: Row, items: Row[]) => {
      harness.replaced = { id, invoice: invoiceData, items }
      return invoiceData
    },
    updateInvoice: async (id: string, fields: Row) => {
      harness.updates.push({ id, fields })
      return fields
    },
    linkOrderToInvoice: async (...args: unknown[]) => {
      if (options.linkFails) {
        throw new Error('Connection terminated')
      }
      harness.links.push(args)
      return true
    },
  }
  const pdfGenerator = {
    generateInvoicePdf: async (data: Row) => {
      if (options.pdfFails) {
        throw new Error('PDF service unavailable')
      }
      harness.rendered = data
      return Buffer.from('%PDF-1.4 regenerated')
    },
    COMPANY_DETAILS: { companyName: 'Seller SRL' },
  }

  const restoreMultipart = stubMultipartGlobals()
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: string, init: { method?: string } = {}) => {
    harness.storageCalls.push({ url: String(url), method: init.method || 'GET' })
    if (String(url).endsWith('/api/runtime-storage/upload')) {
      if (options.uploadOk) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ files: [{ id: 'new-file', url: 'https://cdn.test/INV-0004.pdf' }] }),
        }
      }
      return { ok: false, status: 500, json: async () => ({ error: 'not configured' }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  }) as unknown as typeof fetch

  const token = options.token === undefined ? { role: 'admin', id: 'u1' } : options.token
  const handler = evaluateEmittedModule<(req: unknown, res: unknown) => Promise<void>>(
    generateInvoiceRegenerateRouteCode(),
    createInvoiceRouteRequire(SETTINGS, {
      dataAccess,
      pdfGenerator,
      modules: { 'next-auth/jwt': { getToken: async () => token } },
    })
  )

  const res = {
    status(code: number) {
      harness.status = code
      return this
    },
    json(value: Row) {
      harness.payload = value
      return this
    },
    setHeader() {
      return this
    },
  }
  try {
    await handler(
      {
        method: options.method || 'POST',
        query: { id: options.id === undefined ? 'inv-1' : options.id },
        headers: { host: 'localhost:3000', cookie: 'next-auth.session-token=abc' },
      },
      res
    )
  } finally {
    globalThis.fetch = originalFetch
    restoreMultipart()
  }
  return harness
}

describe('/api/invoices/[id]/regenerate', () => {
  const savedEnv = { ...process.env }

  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = 'secret'
    Object.assign(process.env, STORAGE_ENV)
  })

  afterAll(() => {
    process.env = savedEnv
  })

  it('accepts POST only', async () => {
    const result = await run({ method: 'GET' })
    expect(result.status).toBe(405)
    expect(result.replaced).toBeNull()
  })

  it('refuses a signed-out caller and a signed-in non-admin', async () => {
    const signedOut = await run({ token: null })
    expect(signedOut.status).toBe(401)
    const customer = await run({ token: { role: 'customer' } })
    expect(customer.status).toBe(403)
    expect(customer.payload.error).toBe('Only an admin can regenerate invoices.')
    expect(signedOut.replaced).toBeNull()
    expect(customer.replaced).toBeNull()
  })

  it('reports a missing id and a missing or malformed invoice', async () => {
    expect((await run({ id: '' })).status).toBe(400)
    expect((await run({ invoice: null })).status).toBe(404)
    const malformed = Object.assign(new Error('invalid input syntax for type uuid'), {
      code: '22P02',
    })
    expect((await run({ invoiceLookupError: malformed })).status).toBe(404)
  })

  it('reports a database failure as one, never as a missing invoice', async () => {
    const outage = await run({ invoiceLookupError: new Error('Connection terminated') })
    expect(outage.status).toBe(500)
    // The database's own words stay in the server log.
    expect(outage.payload).toMatchObject({
      success: false,
      error: 'The invoice could not be regenerated.',
    })
  })

  it('refuses an invoice it has nothing to rebuild from', async () => {
    const notLinked = await run({ invoice: { ...INVOICE, order_id: null } })
    expect(notLinked.status).toBe(409)
    expect(notLinked.payload.error).toMatch(/not linked to an order/)

    const orderGone = await run({ order: null })
    expect(orderGone.status).toBe(409)
    expect(orderGone.payload.error).toMatch(/no longer exists/)

    const noLines = await run({ items: [] })
    expect(noLines.status).toBe(409)
    expect(noLines.replaced).toBeNull()
  })

  it('rebuilds the invoice in place from the order, keeping its identity', async () => {
    const result = await run()
    expect(result.status).toBe(200)
    expect(result.payload).toMatchObject({
      success: true,
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-0004',
    })

    const rebuilt = result.replaced!
    expect(rebuilt.id).toBe('inv-1')
    expect(rebuilt.invoice).toMatchObject({
      id: 'inv-1',
      invoiceNumber: 'INV-0004',
      status: 'partially_refunded',
      issueDate: '2026-06-03',
      dueDate: '2026-07-03',
      orderId: 'order-1',
      // The figures come from the ORDER, as at payment.
      currency: 'EUR',
      discountAmount: 10,
      shippingAmount: 15,
      giftCardAmount: 20,
      total: 105,
      amountDue: 85,
      companyName: 'Seller SRL',
    })
    expect(rebuilt.items).toHaveLength(1)
    expect(rebuilt.invoice.pdfData).toBeInstanceOf(Buffer)
  })

  it('takes the corrected invoice fields over the order, and the order for empty ones', async () => {
    const { rendered } = await run()
    expect(rendered).toMatchObject({
      customerName: 'Corrected Name',
      customerCountry: 'Moldova',
      customerVat: 'RO123',
      // Empty on the invoice → the order's value, exactly as at payment.
      customerEmail: 'order@example.com',
      customerCity: 'Cluj',
      notes: 'order note',
      paymentMethod: 'stripe',
    })
  })

  it('never emails the customer', async () => {
    // The route does not even load the sender: a require of it would throw here.
    const code = generateInvoiceRegenerateRouteCode()
    expect(code).not.toContain('email-sender')
    expect(code).not.toContain('sendInvoiceEmail')
  })

  it('renders before writing, so a PDF failure leaves the invoice untouched', async () => {
    const result = await run({ pdfFails: true })
    expect(result.status).toBe(500)
    expect(result.payload.error).toBe('The invoice could not be regenerated.')
    expect(result.replaced).toBeNull()
    expect(result.links).toHaveLength(0)
  })

  it('replaces the stored PDF: saves the new copy and deletes the old one', async () => {
    const result = await run({ uploadOk: true })
    expect(result.updates).toEqual([
      { id: 'inv-1', fields: { pdf_url: 'https://cdn.test/INV-0004.pdf' } },
      { id: 'inv-1', fields: { pdf_storage_key: 'new-file' } },
    ])
    expect(result.storageCalls).toContainEqual({
      url: 'https://storage.test/project/proj/files/old-file',
      method: 'DELETE',
    })
    expect(result.links).toEqual([
      ['order-1', 'inv-1', 'INV-0004', 'https://cdn.test/INV-0004.pdf'],
    ])
    expect(result.payload.pdfUrl).toBe('https://cdn.test/INV-0004.pdf')
  })

  it('falls back to the database copy when the upload fails, and still drops the old file', async () => {
    const result = await run({ uploadOk: false })
    expect(result.status).toBe(200)
    expect(result.updates).toEqual([{ id: 'inv-1', fields: { pdf_storage_key: null } }])
    expect(result.storageCalls).toContainEqual({
      url: 'https://storage.test/project/proj/files/old-file',
      method: 'DELETE',
    })
    expect(result.links).toEqual([['order-1', 'inv-1', 'INV-0004', '/api/invoices/inv-1/pdf']])
  })

  it('keeps the old copy the order still links to when the order cannot be updated', async () => {
    const result = await run({ uploadOk: true, linkFails: true })
    expect(result.status).toBe(500)
    expect(result.payload.error).toContain('customer still sees the previous PDF')
    // Nothing points at the new copy, so it goes; the old one stays reachable.
    expect(result.storageCalls.filter((call) => call.method === 'DELETE')).toEqual([
      { url: 'https://storage.test/project/proj/files/new-file', method: 'DELETE' },
    ])
    expect(result.updates).toEqual([])
  })

  it('leaves an invoice with no stored copy alone in storage', async () => {
    const result = await run({ invoice: { ...INVOICE, pdf_storage_key: null } })
    expect(result.updates).toEqual([])
    expect(result.storageCalls.filter((call) => call.method === 'DELETE')).toEqual([])
  })
})

describe('/api/invoices/generate — remembers where its PDF is stored', () => {
  it('records the storage file id, so a later regeneration can delete that copy', async () => {
    const updates: Array<{ id: string; fields: Row }> = []
    const dataAccess = {
      getOrderWithItems: async () => ({ order: ORDER, items: ORDER_ITEMS }),
      reserveInvoice: async (invoiceData: Row) => {
        invoiceData.invoiceNumber = 'INV-0009'
        return { invoice: invoiceData, created: true }
      },
      storeInvoicePdf: async () => ({}),
      updateInvoice: async (id: string, fields: Row) => {
        updates.push({ id, fields })
        return fields
      },
    }
    const pdfGenerator = {
      generateInvoicePdf: async () => Buffer.from('%PDF-1.4 issued'),
      COMPANY_DETAILS: {},
    }
    const settings = { ...SETTINGS, emailDelivery: { enabled: false } } as UIDLInvoiceSettings
    const handler = evaluateEmittedModule<(req: unknown, res: unknown) => Promise<void>>(
      generateInvoiceGenerateRouteCode(settings),
      createInvoiceRouteRequire(settings, { dataAccess, pdfGenerator })
    )

    const restoreMultipart = stubMultipartGlobals()
    const originalAppSecret = process.env.NEXTAUTH_SECRET
    process.env.NEXTAUTH_SECRET = INVOICE_TEST_APP_SECRET
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ files: [{ id: 'file-9', url: 'https://cdn.test/INV-0009.pdf' }] }),
    })) as unknown as typeof fetch
    let payload: Row = {}
    try {
      await handler(
        { method: 'POST', headers: serverCallHeaders(), body: { orderId: 'order-1' } },
        {
          status() {
            return this
          },
          json(value: Row) {
            payload = value
            return this
          },
        }
      )
    } finally {
      globalThis.fetch = originalFetch
      restoreMultipart()
      if (originalAppSecret === undefined) {
        delete process.env.NEXTAUTH_SECRET
      } else {
        process.env.NEXTAUTH_SECRET = originalAppSecret
      }
    }

    expect(payload).toMatchObject({ success: true, invoiceNumber: 'INV-0009' })
    const invoiceId = String(payload.invoiceId)
    expect(updates).toEqual([
      { id: invoiceId, fields: { pdf_url: 'https://cdn.test/INV-0009.pdf' } },
      { id: invoiceId, fields: { pdf_storage_key: 'file-9' } },
    ])
  })
})

describe('generateInvoiceFiles — the regeneration files', () => {
  it('emits the shared assembly beside the data access, and the route beside the PDF one', () => {
    const structure = {
      files: new Map(),
      dependencies: {},
      uidl: { components: {}, globals: { settings: { language: 'en' }, assets: [], env: {} } },
    } as unknown as ProjectPluginStructure
    generateInvoiceFiles(
      { ...SETTINGS, emailDelivery: { enabled: false } } as UIDLInvoiceSettings,
      structure,
      'postgresql',
      null
    )

    const assembly = structure.files.get('invoice-assembly')
    expect(assembly?.path).toEqual(['utils', 'invoices'])
    expect(assembly?.files[0].name).toBe('invoice-assembly')

    const route = structure.files.get('invoice-regenerate-route')
    expect(route?.path).toEqual(['pages', 'api', 'invoices', '[id]'])
    expect(route?.files[0].name).toBe('regenerate')
    expect(route?.files[0].content).toContain(
      "require('../../../../utils/invoices/invoice-assembly')"
    )
  })
})
