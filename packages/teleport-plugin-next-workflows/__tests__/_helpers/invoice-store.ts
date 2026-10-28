import type { UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import {
  generateInvoiceGenerateRouteCode,
  generateInvoiceRegenerateRouteCode,
} from '../../src/invoice/api-routes-code'
import { generateDataAccessCode, getRecordMappingCode } from '../../src/invoice/data-access-code'
import { generateEmailSenderCode } from '../../src/invoice/email-sender-code'
import { generateInvoiceAssemblyCode } from '../../src/invoice/invoice-assembly-code'
import { generatePdfGeneratorCode } from '../../src/invoice/pdf-generator-code'
import { generateSentEmailLogCode } from '../../src/sent-email-log/sent-email-log-code'
import { generateEmailLocaleModuleCode } from '../../src/email-locale/email-locale-code'
import {
  INVOICE_TEST_APP_SECRET,
  evaluateEmittedModule,
  serverCallHeaders,
} from './load-invoice-route'
import { FakeStoreDatabase } from './fake-store-database'
import { AbortControllerStub } from './abort-controller-stub'

/**
 * A store's invoicing, EXECUTED: the payment's `/api/invoices/generate`, the
 * admin panel's `/api/invoices/[id]/regenerate`, the data access, the
 * assembly, the PDF client, the invoice sender, the sent-email ledger and the
 * locale module, all as emitted. Only what lies outside the store is faked:
 * its Postgres database, the PDF service and the email provider.
 */

export type Row = Record<string, unknown>

export const ORDER_ID = '0b7a3c52-5d1e-4c55-9a51-3f0c2b7e9d11'
export const SECOND_ORDER_ID = '7d4f8e21-1c3b-4a9e-8f62-5b0d9c3a2e44'
export const BUYER = 'ana@buyer.test'
export const SECOND_BUYER = 'ion@buyer.test'

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

export interface PostmarkMessage {
  From: string
  To: string
  Subject: string
  HtmlBody: string
  Attachments: Array<{ Name: string; Content: string; ContentType: string }>
}

export interface RouteAnswer {
  status: number
  body: Row
}

export interface Store {
  db: FakeStoreDatabase
  /** Every email handed to the provider, accepted or refused. */
  emails: PostmarkMessage[]
  provider: { refuses: boolean }
  pdfService: { down: boolean; renders: number; hold: Promise<void> | null }
  /** Runtime storage: when configured, a PDF gets a public URL. */
  storage: { configured: boolean }
  errors: string[]
  /** The payment webhook's "Generate Invoice For Paid Order" node. */
  pay: (orderId: string) => Promise<RouteAnswer>
  /** A signed-in admin issuing the order's invoice by hand, through the same route. */
  issueAsAdmin: (orderId: string) => Promise<RouteAnswer>
  /** The admin panel's Regenerate. */
  regenerate: (invoiceId: string) => Promise<RouteAnswer>
  routeCode: string
}

const stores: Store[] = []

export function seedPaidOrder(
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
export function openStore(options: { emailDelivery?: boolean } = {}): Store {
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
    if (/(^|\/)security-runtime$/.test(id)) {
      return {
        safeEqual: (given: unknown, expected: unknown) =>
          typeof given === 'string' &&
          typeof expected === 'string' &&
          given !== '' &&
          given === expected,
      }
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

  // The merchant's browser: a German admin page, so the request's own
  // language is not the buyer's.
  const adminBrowserHeaders = {
    host: 'shop.test',
    'x-forwarded-proto': 'https',
    'x-teleport-locale': 'de',
    referer: 'https://shop.test/de/admin/invoices',
    cookie: '__Host-next-auth.session-token=abc; NEXT_LOCALE=de',
  }

  const store: Store = {
    db,
    emails,
    provider,
    pdfService,
    storage: { configured: false },
    errors,
    routeCode,
    pay: (orderId) =>
      call(generateRoute, {
        method: 'POST',
        headers: serverCallHeaders(),
        body: { orderId, sendEmail: true },
      }),
    issueAsAdmin: (orderId) =>
      call(generateRoute, {
        method: 'POST',
        headers: adminBrowserHeaders,
        body: { orderId, sendEmail: true },
      }),
    regenerate: (invoiceId) =>
      call(regenerateRoute, {
        method: 'POST',
        query: { id: invoiceId },
        headers: adminBrowserHeaders,
      }),
  }
  stores.push(store)
  return store
}

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
export const invoiceOf = (store: Store, orderId: string): Row => {
  const invoice = store.db.tables.teleport_invoices.find((row) => row.order_id === orderId)
  if (!invoice) {
    throw new Error('order ' + orderId + ' has no invoice')
  }
  return invoice
}

/** The payment with the PDF service down: the order is paid, its invoice has no PDF. */
export async function payWhilePdfServiceIsDown(store: Store, orderId: string): Promise<Row> {
  store.pdfService.down = true
  const paid = await store.pay(orderId)
  store.pdfService.down = false
  expect(paid.status).toBe(500)
  const invoice = invoiceOf(store, orderId)
  expect(invoice.pdf_size_bytes).toBeNull()
  return invoice
}

export const historyLines = (store: Store): Row[] =>
  store.db.tables.teleport_events.filter((row) => row.event_type === 'order-email-sent')

export const ledgerRows = (store: Store): Row[] => store.db.tables.teleport_sent_emails

/**
 * The deployment every store of the calling suite runs in: its environment,
 * the fake fetch, the browser globals the uploader uses, and a console whose
 * errors each store keeps (`store.errors`).
 */
export function runsAsTheStore(): void {
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
}
