import type { UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import {
  generateInvoiceGenerateRouteCode,
  generateInvoiceRegenerateRouteCode,
} from '../src/invoice/api-routes-code'
import { generateDataAccessCode, getRecordMappingCode } from '../src/invoice/data-access-code'
import { generateEmailSenderCode } from '../src/invoice/email-sender-code'
import { generateInvoiceAssemblyCode } from '../src/invoice/invoice-assembly-code'
import { generatePdfGeneratorCode } from '../src/invoice/pdf-generator-code'
import { generateSentEmailLogCode } from '../src/sent-email-log/sent-email-log-code'
import { generateEmailLocaleModuleCode } from '../src/email-locale/email-locale-code'
import {
  INVOICE_TEST_APP_SECRET,
  evaluateEmittedModule,
  serverCallHeaders,
} from './_helpers/load-invoice-route'
import { FakeStoreDatabase } from './_helpers/fake-store-database'
import { AbortControllerStub } from './_helpers/abort-controller-stub'

/**
 * Regenerate emails the buyer the invoice their payment could not.
 *
 * When the PDF service is down at payment, the order is still paid and its
 * invoice row stays reserved without a PDF, so the payment's invoice email
 * never goes out. The merchant then gets the PDF with the admin panel's
 * Regenerate — and that regeneration, the FIRST to give the invoice a PDF,
 * emails the buyer, once, when the store emails invoices.
 *
 * Everything here is the code the store runs, as emitted: the payment's
 * `/api/invoices/generate`, the admin panel's `/api/invoices/[id]/regenerate`,
 * the data access, the assembly, the PDF client, the invoice sender, the
 * sent-email ledger and the locale module. Only what lies outside the store is
 * faked: its Postgres database, the PDF service and the email provider.
 */

type Row = Record<string, unknown>

const ORDER_ID = '0b7a3c52-5d1e-4c55-9a51-3f0c2b7e9d11'
const SECOND_ORDER_ID = '7d4f8e21-1c3b-4a9e-8f62-5b0d9c3a2e44'
const BUYER = 'ana@buyer.test'
const SECOND_BUYER = 'ion@buyer.test'

/** Invoice Email Delivery as the editor saves it: Postmark, a named sender, a Spanish copy. */
const EMAIL_DELIVERY = {
  enabled: true,
  provider: 'postmark',
  fromEmail: 'shop@lumen.test',
  fromName: 'Lumen Pottery',
  subject: 'Invoice {{invoiceNumber}}',
  body: '<p>Hi {{customerName}}, invoice {{invoiceNumber}} for {{totalAmount}}: {{invoiceUrl}}</p>',
  localizedTemplates: {
    es: {
      subject: 'Factura {{invoiceNumber}}',
      body: '<p>Hola {{customerName}}, factura {{invoiceNumber}} por {{totalAmount}}: {{invoiceUrl}}</p>',
    },
  },
  secretKeys: { serverToken: 'INVOICE_POSTMARK_TOKEN' },
}

const settingsFor = (emailDelivery: boolean): UIDLInvoiceSettings =>
  ({
    invoicePrefix: 'INV-',
    defaultTaxRate: 0,
    taxIncludedInPrice: false,
    companyDetails: { companyName: 'Lumen Pottery SRL', companyEmail: 'shop@lumen.test' },
    template: { document: null },
    tables: { invoicesTable: 'teleport_invoices', invoiceItemsTable: 'teleport_invoice_items' },
    emailDelivery: emailDelivery ? EMAIL_DELIVERY : { enabled: false },
  } as unknown as UIDLInvoiceSettings)

const LOCALES = { locales: ['en', 'es', 'de'], defaultLocale: 'en' }

const ENV = {
  NEXTAUTH_SECRET: INVOICE_TEST_APP_SECRET,
  TELEPORT_DB_CONNECTION_STRING: 'postgres://store:secret@db.test:5432/store',
  PDF_SERVICE_URL: 'https://pdf.test',
  PDF_SERVICE_API_KEY: 'pdf-key',
  INVOICE_POSTMARK_TOKEN: 'postmark-token',
}

interface PostmarkMessage {
  From: string
  To: string
  Subject: string
  HtmlBody: string
  Attachments: Array<{ Name: string; Content: string; ContentType: string }>
}

interface RouteAnswer {
  status: number
  body: Row
}

interface Store {
  db: FakeStoreDatabase
  /** Every email handed to the provider, accepted or refused. */
  emails: PostmarkMessage[]
  provider: { refuses: boolean }
  pdfService: { down: boolean; renders: number; hold: Promise<void> | null }
  /** Runtime storage: when configured, a PDF gets a public URL. */
  storage: { configured: boolean }
  errors: string[]
  pay: (orderId: string) => Promise<RouteAnswer>
  regenerate: (invoiceId: string) => Promise<RouteAnswer>
  routeCode: string
}

function seedPaidOrder(
  db: FakeStoreDatabase,
  orderId: string,
  overrides: Row = {},
  buyer: string = BUYER
): void {
  db.insert('teleport_orders', {
    id: orderId,
    order_number: 'ORD-' + orderId.slice(0, 4),
    status: 'confirmed',
    payment_status: 'paid',
    currency: 'EUR',
    total_amount: 100,
    billing_name: 'Ana Pop',
    billing_email: buyer,
    payment_method: 'stripe',
    locale: 'es',
    invoice_id: null,
    invoice_number: null,
    invoice_pdf_url: null,
    ...overrides,
  })
  db.insert('teleport_order_items', {
    id: orderId + '-line-1',
    order_id: orderId,
    product_id: 'p1',
    product_name: 'Lamp',
    quantity: 2,
    unit_price: 50,
    total_price: 100,
  })
}

/** Builds the store: its emitted modules over the fake database, PDF service and provider. */
function openStore(options: { emailDelivery?: boolean } = {}): Store {
  const settings = settingsFor(options.emailDelivery !== false)
  const db = new FakeStoreDatabase()
  const emails: PostmarkMessage[] = []
  const provider = { refuses: false }
  const pdfService = { down: false, renders: 0, hold: null as Promise<void> | null }
  const errors: string[] = []

  const postmark = {
    ServerClient: function ServerClient() {
      return {
        sendEmail: async (message: PostmarkMessage) => {
          emails.push(message)
          if (provider.refuses) {
            throw new Error('422 The From address is not a confirmed sender signature')
          }
          return { MessageID: 'pm-' + emails.length }
        },
      }
    },
  }

  const sources: Record<string, string> = {
    'data-access': `${generateDataAccessCode(settings, 'postgresql', null)}\n${getRecordMappingCode(
      'postgresql'
    )}`,
    'pdf-generator': generatePdfGeneratorCode(settings, null, {}),
    'invoice-assembly': generateInvoiceAssemblyCode(settings),
    'email-sender': generateEmailSenderCode(settings.emailDelivery),
    'sent-email-log': generateSentEmailLogCode({ pgSupported: true }),
    'email-locale': generateEmailLocaleModuleCode(LOCALES),
  }
  const loaded: Record<string, unknown> = {}
  const storeRequire = ((id: string): unknown => {
    if (id === 'pg') {
      return db.pg
    }
    if (id === 'postmark') {
      return postmark
    }
    if (id === 'next-auth/jwt') {
      return { getToken: async () => ({ id: 'admin-1', role: 'admin' }) }
    }
    const name = id.split('/').pop() as string
    if (sources[name] !== undefined) {
      if (!(name in loaded)) {
        loaded[name] = evaluateEmittedModule(sources[name], storeRequire)
      }
      return loaded[name]
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id)
  }) as NodeRequire

  type Handler = (req: unknown, res: unknown) => Promise<void>
  const generateRoute = evaluateEmittedModule<Handler>(
    generateInvoiceGenerateRouteCode(settings),
    storeRequire
  )
  const routeCode = generateInvoiceRegenerateRouteCode(settings)
  const regenerateRoute = evaluateEmittedModule<Handler>(routeCode, storeRequire)

  const call = async (handler: Handler, req: Row): Promise<RouteAnswer> => {
    const answer: RouteAnswer = { status: 0, body: {} }
    await handler(req, {
      status(code: number) {
        answer.status = code
        return this
      },
      json(value: Row) {
        answer.body = value
        return this
      },
      setHeader() {
        return this
      },
    })
    return answer
  }

  const store: Store = {
    db,
    emails,
    provider,
    pdfService,
    storage: { configured: false },
    errors,
    routeCode,
    // The payment webhook's "Generate Invoice For Paid Order" node.
    pay: (orderId) =>
      call(generateRoute, {
        method: 'POST',
        headers: serverCallHeaders(),
        body: { orderId, sendEmail: true },
      }),
    // The admin panel's Regenerate, from the merchant's browser: a German
    // admin page, so the request's own language is not the buyer's.
    regenerate: (invoiceId) =>
      call(regenerateRoute, {
        method: 'POST',
        query: { id: invoiceId },
        headers: {
          host: 'shop.test',
          'x-forwarded-proto': 'https',
          'x-teleport-locale': 'de',
          referer: 'https://shop.test/de/admin/invoices',
          cookie: 'next-auth.session-token=abc; NEXT_LOCALE=de',
        },
      }),
  }
  stores.push(store)
  return store
}

const stores: Store[] = []

/** The multipart body of a storage upload, kept readable for the fake fetch. */
class FormDataStub {
  readonly entries: Array<{ name: string; filename?: string }> = []

  append(name: string, _value: unknown, filename?: string): void {
    this.entries.push({ name, filename })
  }
}

/** The fetch the store's server code makes: the PDF service, and its own storage upload. */
async function fakeFetch(url: string, init: { body?: unknown } = {}) {
  const store = stores[stores.length - 1]
  const target = String(url)
  if (target === 'https://pdf.test/generate') {
    const { pdfService } = store
    if (pdfService.down) {
      return {
        ok: false,
        status: 503,
        headers: { get: (): string | null => null },
        text: async () => 'Service Unavailable',
      }
    }
    pdfService.renders += 1
    if (pdfService.hold) {
      await pdfService.hold
    }
    const request = JSON.parse(String(init.body || '{}'))
    const bytes = Buffer.from('%PDF-1.4 ' + String(request.metadata?.invoiceNumber || ''))
    return {
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === 'content-type' ? 'application/pdf' : null) },
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    }
  }
  if (target.endsWith('/api/runtime-storage/upload')) {
    if (!store.storage.configured) {
      // The PDF is then served from the database.
      return { ok: false, status: 500, json: async () => ({ error: 'Storage is not configured' }) }
    }
    const file = (init.body as FormDataStub).entries.find((entry) => entry.name === 'file')
    const fileName = String(file && file.filename)
    return {
      ok: true,
      status: 200,
      json: async () => ({
        files: [{ id: 'file-' + fileName, url: 'https://cdn.test/' + fileName }],
      }),
    }
  }
  throw new Error('unexpected fetch: ' + target)
}

/** The invoice the payment reserved for an order. */
const invoiceOf = (store: Store, orderId: string): Row => {
  const invoice = store.db.tables.teleport_invoices.find((row) => row.order_id === orderId)
  if (!invoice) {
    throw new Error('order ' + orderId + ' has no invoice')
  }
  return invoice
}

/** The payment with the PDF service down: the order is paid, its invoice has no PDF. */
async function payWhilePdfServiceIsDown(store: Store, orderId: string): Promise<Row> {
  store.pdfService.down = true
  const paid = await store.pay(orderId)
  store.pdfService.down = false
  expect(paid.status).toBe(500)
  const invoice = invoiceOf(store, orderId)
  expect(invoice.pdf_size_bytes).toBeNull()
  return invoice
}

const historyLines = (store: Store): Row[] =>
  store.db.tables.teleport_events.filter((row) => row.event_type === 'order-email-sent')

const ledgerRows = (store: Store): Row[] => store.db.tables.teleport_sent_emails

describe('Regenerate emails the buyer the invoice their payment could not', () => {
  const savedEnv = { ...process.env }
  const runtime = globalThis as unknown as Record<string, unknown>
  const savedGlobals = {
    fetch: runtime.fetch,
    AbortController: runtime.AbortController,
    Blob: runtime.Blob,
    FormData: runtime.FormData,
  }
  let consoleSpies: jest.SpyInstance[] = []

  beforeEach(() => {
    Object.assign(process.env, ENV)
    runtime.fetch = fakeFetch
    runtime.AbortController = AbortControllerStub
    runtime.Blob = class {}
    runtime.FormData = FormDataStub
    stores.length = 0
    consoleSpies = [
      jest.spyOn(console, 'info').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        const store = stores[stores.length - 1]
        if (store) {
          store.errors.push(args.map(String).join(' '))
        }
      }),
    ]
  })

  afterEach(() => {
    consoleSpies.forEach((spy) => spy.mockRestore())
    process.env = { ...savedEnv }
    Object.assign(runtime, savedGlobals)
  })

  it('no PDF before: the regeneration that gives the invoice its PDF emails the buyer once', async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID)
    const invoice = await payWhilePdfServiceIsDown(store, ORDER_ID)
    expect(store.emails).toHaveLength(0)

    const regenerated = await store.regenerate(String(invoice.id))

    expect(regenerated.status).toBe(200)
    expect(Number(invoice.pdf_size_bytes)).toBeGreaterThan(0)
    expect(store.emails).toHaveLength(1)
    const [email] = store.emails
    expect(email.To).toBe(BUYER)
    expect(email.From).toBe('Lumen Pottery <shop@lumen.test>')
    expect(email.Attachments).toEqual([
      {
        Name: 'INV-0001.pdf',
        Content: Buffer.from('%PDF-1.4 INV-0001').toString('base64'),
        ContentType: 'application/pdf',
      },
    ])

    // The sent-email ledger: the row the payment's email writes, naming the
    // route that sent it.
    expect(ledgerRows(store)).toEqual([
      expect.objectContaining({
        email_type: 'invoice-email',
        audience: 'customer',
        recipient_email: BUYER,
        from_email: 'shop@lumen.test',
        from_name: 'Lumen Pottery',
        status: 'sent',
        provider: 'postmark',
        source: 'invoice',
        source_ref: 'api/invoices/[id]/regenerate',
        order_id: ORDER_ID,
        reference_type: 'invoice',
        reference_id: invoice.id,
      }),
    ])
    // The order's history: one "email sent" line, by the store admin.
    expect(historyLines(store)).toEqual([
      expect.objectContaining({
        event_type: 'order-email-sent',
        dedupe_key: 'order-email-sent:' + String(invoice.id) + ':invoice-email',
        order_id: ORDER_ID,
        payload: JSON.stringify({ purpose: 'invoice-email', to: BUYER }),
        actor: 'Store admin',
        actor_type: 'merchant',
        status: 'recorded',
      }),
    ])
  })

  it.each([
    [
      'served from the database',
      false,
      (invoiceId: string) => '/api/invoices/' + invoiceId + '/pdf',
    ],
    ['in runtime storage', true, () => 'https://cdn.test/INV-0001.pdf'],
  ])(
    'sends exactly the email the payment would have sent — sender, template, attachment, language, and the link of a PDF %s',
    async (_, storageConfigured, expectedLink) => {
      // A payment the PDF service served: the invoice email it sends.
      const paidOk = openStore()
      paidOk.storage.configured = storageConfigured
      seedPaidOrder(paidOk.db, ORDER_ID)
      expect((await paidOk.pay(ORDER_ID)).status).toBe(200)
      expect(paidOk.emails).toHaveLength(1)
      const atPayment = paidOk.emails[0]
      const paidInvoiceId = String(invoiceOf(paidOk, ORDER_ID).id)

      // The same order, paid while the PDF service was down, then regenerated.
      const paidDown = openStore()
      paidDown.storage.configured = storageConfigured
      seedPaidOrder(paidDown.db, ORDER_ID)
      const invoice = await payWhilePdfServiceIsDown(paidDown, ORDER_ID)
      expect((await paidDown.regenerate(String(invoice.id))).status).toBe(200)
      expect(paidDown.emails).toHaveLength(1)
      const atRegeneration = paidDown.emails[0]

      // Nothing differs but the invoice's own id, inside a database link.
      const sameLink = (message: PostmarkMessage, id: string): PostmarkMessage => ({
        ...message,
        HtmlBody: message.HtmlBody.split(id).join('<invoice id>'),
      })
      expect(sameLink(atRegeneration, String(invoice.id))).toEqual(
        sameLink(atPayment, paidInvoiceId)
      )
      // The buyer's language (the order is Spanish), not the merchant's German admin.
      expect(atRegeneration.Subject).toBe('Factura INV-0001')
      expect(atRegeneration.HtmlBody).toBe(
        '<p>Hola Ana Pop, factura INV-0001 por €100.00: ' +
          expectedLink(String(invoice.id)) +
          '</p>'
      )
    }
  )

  it("an order with no language of its own gets the store's main language, never the merchant's", async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID, { locale: null })
    const invoice = await payWhilePdfServiceIsDown(store, ORDER_ID)

    await store.regenerate(String(invoice.id))

    expect(store.emails.map((email) => email.Subject)).toEqual(['Invoice INV-0001'])
  })

  it('had a PDF: only the invoice that never had one is emailed', async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID)
    seedPaidOrder(store.db, SECOND_ORDER_ID, {}, SECOND_BUYER)
    // The first order's invoice was issued and emailed at payment.
    expect((await store.pay(ORDER_ID)).status).toBe(200)
    const issued = invoiceOf(store, ORDER_ID)
    expect(store.emails.map((email) => email.To)).toEqual([BUYER])
    // The second order's was not: the PDF service was down.
    const unfinished = await payWhilePdfServiceIsDown(store, SECOND_ORDER_ID)

    expect((await store.regenerate(String(issued.id))).status).toBe(200)
    expect((await store.regenerate(String(unfinished.id))).status).toBe(200)

    // The payment's email, then the unfinished invoice's — nothing for the
    // invoice that already had its PDF.
    expect(store.emails.map((email) => email.To)).toEqual([BUYER, SECOND_BUYER])
    expect(historyLines(store).map((line) => line.order_id)).toEqual([SECOND_ORDER_ID])
  })

  it('a second regeneration never emails again', async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID)
    const invoice = await payWhilePdfServiceIsDown(store, ORDER_ID)

    expect((await store.regenerate(String(invoice.id))).status).toBe(200)
    expect(store.emails).toHaveLength(1)
    expect((await store.regenerate(String(invoice.id))).status).toBe(200)
    expect((await store.regenerate(String(invoice.id))).status).toBe(200)

    expect(store.emails).toHaveLength(1)
    expect(ledgerRows(store)).toHaveLength(1)
    expect(historyLines(store)).toHaveLength(1)
  })

  it('two overlapping regenerations (a double click) email once', async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID)
    const invoice = await payWhilePdfServiceIsDown(store, ORDER_ID)

    // Both requests read the invoice without a PDF and render before either
    // writes: the PDF service answers neither until it has both.
    let releaseRenders: () => void = () => undefined
    store.pdfService.hold = new Promise((resolve) => {
      releaseRenders = resolve
    })
    const first = store.regenerate(String(invoice.id))
    const second = store.regenerate(String(invoice.id))
    while (store.pdfService.renders < 2) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    releaseRenders()
    const answers = await Promise.all([first, second])

    expect(answers.map((answer) => answer.status)).toEqual([200, 200])
    expect(store.emails).toHaveLength(1)
    expect(ledgerRows(store)).toHaveLength(1)
    expect(historyLines(store)).toHaveLength(1)
  })

  it('Invoice Email Delivery off: the same regeneration emails nobody', async () => {
    const delivering = openStore()
    seedPaidOrder(delivering.db, ORDER_ID)
    const deliveredInvoice = await payWhilePdfServiceIsDown(delivering, ORDER_ID)
    await delivering.regenerate(String(deliveredInvoice.id))
    expect(delivering.emails).toHaveLength(1)

    const silent = openStore({ emailDelivery: false })
    seedPaidOrder(silent.db, ORDER_ID)
    const invoice = await payWhilePdfServiceIsDown(silent, ORDER_ID)
    const regenerated = await silent.regenerate(String(invoice.id))

    expect(regenerated.status).toBe(200)
    expect(Number(invoice.pdf_size_bytes)).toBeGreaterThan(0)
    expect(silent.emails).toHaveLength(0)
    expect(ledgerRows(silent)).toHaveLength(0)
    expect(historyLines(silent)).toHaveLength(0)
    // The route does not even load the sender.
    expect(silent.routeCode).not.toContain('email-sender')
  })

  it('a refused email still regenerates the invoice, is logged, and is never sent again', async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID)
    const invoice = await payWhilePdfServiceIsDown(store, ORDER_ID)
    store.provider.refuses = true

    const regenerated = await store.regenerate(String(invoice.id))

    // The merchant has the PDF, and the order links to it.
    expect(regenerated.status).toBe(200)
    expect(regenerated.body).toMatchObject({ success: true, invoiceNumber: 'INV-0001' })
    expect(Number(invoice.pdf_size_bytes)).toBeGreaterThan(0)
    expect(store.db.row('teleport_orders', ORDER_ID)).toMatchObject({
      invoice_id: invoice.id,
      invoice_number: 'INV-0001',
      invoice_pdf_url: '/api/invoices/' + String(invoice.id) + '/pdf',
    })
    // The provider was asked once and refused: the ledger says so, the
    // order's history does not claim an email went out, the log names it.
    expect(store.emails).toHaveLength(1)
    expect(ledgerRows(store)).toEqual([
      expect.objectContaining({
        status: 'failed',
        error_message: '422 The From address is not a confirmed sender signature',
      }),
    ])
    expect(historyLines(store)).toHaveLength(0)
    expect(store.errors).toContainEqual(
      expect.stringContaining('invoice INV-0001 could not be emailed to its customer')
    )

    store.provider.refuses = false
    expect((await store.regenerate(String(invoice.id))).status).toBe(200)
    expect(store.emails).toHaveLength(1)
  })

  it('an order that cannot be updated still gets its invoice emailed, once', async () => {
    const store = openStore()
    seedPaidOrder(store.db, ORDER_ID)
    const invoice = await payWhilePdfServiceIsDown(store, ORDER_ID)
    store.db.failNext(/^UPDATE teleport_orders SET invoice_id = \$1/, 'Connection terminated')

    const failed = await store.regenerate(String(invoice.id))

    // The invoice has its PDF, so its buyer is emailed it, with the link the
    // database serves it from.
    expect(failed.status).toBe(500)
    expect(store.emails).toHaveLength(1)
    expect(store.emails[0].HtmlBody).toContain('/api/invoices/' + String(invoice.id) + '/pdf')
    expect(ledgerRows(store)).toHaveLength(1)

    // Regenerating again links the order, and emails nobody.
    expect((await store.regenerate(String(invoice.id))).status).toBe(200)
    expect(store.db.row('teleport_orders', ORDER_ID)).toMatchObject({ invoice_id: invoice.id })
    expect(store.emails).toHaveLength(1)
    expect(historyLines(store)).toHaveLength(1)
  })
})
