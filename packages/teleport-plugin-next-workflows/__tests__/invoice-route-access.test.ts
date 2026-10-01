import type { UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import {
  generateInvoiceGenerateRouteCode,
  generateInvoicePdfRouteCode,
} from '../src/invoice/api-routes-code'
import {
  INVOICE_TEST_APP_SECRET,
  createInvoiceRouteRequire,
  evaluateEmittedModule,
  serverCallHeaders,
} from './_helpers/load-invoice-route'
import { loadHandler } from './_helpers/load-handler'

/**
 * Who may issue an invoice, and who may download one — executed against the
 * emitted routes.
 *
 * `/api/invoices/generate` was open: anyone could print invoices on the
 * merchant's letterhead, burn invoice numbers, claim an order's invoice for
 * good (the order keeps the first invoice id it is given), and, naming another
 * buyer's order id, read their personal data back. It now issues only for the
 * store's own server code (the invoice node and the payment webhooks, which
 * present the app secret) or a signed-in admin.
 *
 * `/api/invoices/[id]/pdf` served any invoice to whoever knew its id. It now
 * serves the order's own buyer, an admin, or the server — and answers anyone
 * else exactly as it answers an invoice that does not exist.
 */

type Row = Record<string, unknown>

const SETTINGS = {
  enabled: true,
  invoicePrefix: 'INV-',
  emailDelivery: { enabled: false },
} as unknown as UIDLInvoiceSettings

interface Session {
  id: string
  role?: string
}

interface Response {
  status: number
  payload: Row | null
  headers: Record<string, unknown>
  sent: Buffer | null
}

const SESSION_COOKIE = 'next-auth.session-token=signed'

function fakeResponse(): { res: unknown; result: Response } {
  const result: Response = { status: 0, payload: null, headers: {}, sent: null }
  const res = {
    status(code: number) {
      result.status = code
      return res
    },
    json(value: Row) {
      result.payload = value
      return res
    },
    setHeader(name: string, value: unknown) {
      result.headers[name] = value
    },
    end(buffer: Buffer) {
      result.sent = buffer
    },
  }
  return { res, result }
}

const nextAuthJwt = (session: Session | null) => ({
  getToken: async () => (session ? { sub: session.id, id: session.id, role: session.role } : null),
})

describe('/api/invoices/generate — issued by the store only', () => {
  const savedSecret = process.env.NEXTAUTH_SECRET
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = INVOICE_TEST_APP_SECRET
  })
  afterEach(() => {
    if (savedSecret === undefined) {
      delete process.env.NEXTAUTH_SECRET
    } else {
      process.env.NEXTAUTH_SECRET = savedSecret
    }
  })

  const boot = (session: Session | null) => {
    const reads: string[] = []
    const dataAccess = {
      getOrderWithItems: async (orderId: string) => {
        reads.push(orderId)
        return null
      },
      reserveInvoice: async (invoiceData: Row) => ({ invoice: invoiceData, created: true }),
    }
    const handler = evaluateEmittedModule<(req: unknown, res: unknown) => Promise<void>>(
      generateInvoiceGenerateRouteCode(SETTINGS),
      createInvoiceRouteRequire(SETTINGS, {
        dataAccess,
        pdfGenerator: {},
        modules: { 'next-auth/jwt': nextAuthJwt(session) },
      })
    )
    return async (headers: Record<string, string>, body: Row = { orderId: 'order-1' }) => {
      const { res, result } = fakeResponse()
      await handler({ method: 'POST', headers, body }, res)
      return { ...result, reads: reads.slice() }
    }
  }

  it('refuses a visitor before it reads any order', async () => {
    const result = await boot(null)({ host: 'localhost:3000' })
    expect(result.status).toBe(401)
    expect(result.reads).toEqual([])
  })

  it('refuses a signed-in shopper, whoever the order belongs to', async () => {
    const result = await boot({ id: 'u1', role: 'user' })({
      host: 'localhost:3000',
      cookie: SESSION_COOKIE,
    })
    expect(result.status).toBe(403)
    expect(result.reads).toEqual([])
  })

  it('refuses a wrong or empty app secret', async () => {
    for (const secret of ['nope', '', INVOICE_TEST_APP_SECRET + 'x']) {
      const result = await boot(null)({ host: 'localhost:3000', 'x-internal-data-secret': secret })
      expect(result.status).toBe(401)
      expect(result.reads).toEqual([])
    }
  })

  it("serves the store's server code and a signed-in admin", async () => {
    // Past the gate, an order with no lines is a 400 — the answer of a request
    // that was let in.
    const server = await boot(null)(serverCallHeaders())
    expect(server.status).toBe(400)
    expect(server.reads).toEqual(['order-1'])

    const admin = await boot({ id: 'a1', role: 'admin' })({
      host: 'localhost:3000',
      cookie: SESSION_COOKIE,
    })
    expect(admin.status).toBe(400)
    expect(admin.reads).toEqual(['order-1'])
  })

  it('is called by the invoice node with the app secret', async () => {
    const handler = loadHandler('ecommerce-generate-invoice')
    const calls: Array<{ url: string; init: { headers: Record<string, string> } }> = []
    const savedFetch = (globalThis as any).fetch
    ;(globalThis as any).fetch = async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, init })
      return { ok: true, json: async () => ({ invoiceId: 'i1', invoiceNumber: 'INV-0001' }) }
    }
    try {
      const result = (await handler(
        { orderId: 'order-1' },
        {
          __baseUrl: 'https://shop.test',
          __internalHeaders: { 'x-vercel-protection-bypass': 'bypass' },
        }
      )) as Row
      expect(result.invoiceNumber).toBe('INV-0001')
    } finally {
      ;(globalThis as any).fetch = savedFetch
    }
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://shop.test/api/invoices/generate')
    expect(calls[0].init.headers['x-internal-data-secret']).toBe(INVOICE_TEST_APP_SECRET)
    expect(calls[0].init.headers['x-vercel-protection-bypass']).toBe('bypass')
  })
})

describe('/api/invoices/[id]/pdf — served to its buyer and the store', () => {
  const savedSecret = process.env.NEXTAUTH_SECRET
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = INVOICE_TEST_APP_SECRET
  })
  afterEach(() => {
    if (savedSecret === undefined) {
      delete process.env.NEXTAUTH_SECRET
    } else {
      process.env.NEXTAUTH_SECRET = savedSecret
    }
  })

  const INVOICE = {
    id: 'inv-1',
    order_id: 'order-1',
    invoice_number: 'INV-0001',
    pdf_data: Buffer.from('%PDF-1.4 invoice'),
  }

  const boot = (session: Session | null, options: { lookupError?: Error } = {}) => {
    const lookups: string[] = []
    const dataAccess = {
      getInvoiceById: async (id: string) => {
        lookups.push(id)
        if (options.lookupError) {
          throw options.lookupError
        }
        return id === INVOICE.id ? INVOICE : null
      },
      getOrderWithItems: async (orderId: string) =>
        orderId === 'order-1' ? { order: { id: 'order-1', user_id: 'buyer-1' }, items: [] } : null,
    }
    const handler = evaluateEmittedModule<(req: unknown, res: unknown) => Promise<void>>(
      generateInvoicePdfRouteCode(),
      createInvoiceRouteRequire(SETTINGS, {
        dataAccess,
        pdfGenerator: {},
        modules: { 'next-auth/jwt': nextAuthJwt(session) },
      })
    )
    return async (id: string, headers: Record<string, string> = {}) => {
      const { res, result } = fakeResponse()
      const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        await handler({ method: 'GET', query: { id }, headers }, res)
      } finally {
        quiet.mockRestore()
      }
      return { ...result, lookups: lookups.slice() }
    }
  }

  const signedIn = { host: 'localhost:3000', cookie: SESSION_COOKIE }

  it('refuses a visitor before it looks the invoice up', async () => {
    const result = await boot(null)('inv-1', { host: 'localhost:3000' })
    expect(result.status).toBe(401)
    expect(result.lookups).toEqual([])
    expect(result.sent).toBeNull()
  })

  it("serves the order's own buyer, privately", async () => {
    const result = await boot({ id: 'buyer-1', role: 'user' })('inv-1', signedIn)
    expect(result.status).toBe(200)
    expect(String(result.sent)).toBe('%PDF-1.4 invoice')
    expect(result.headers['Cache-Control']).toBe('private, no-store')
  })

  it('answers another signed-in shopper exactly like a missing invoice', async () => {
    const other = await boot({ id: 'someone-else', role: 'user' })('inv-1', signedIn)
    const missing = await boot({ id: 'someone-else', role: 'user' })('inv-404', signedIn)
    expect(other.status).toBe(404)
    expect(other.sent).toBeNull()
    expect(other.payload).toEqual(missing.payload)
  })

  it('serves an admin and the store server code any invoice', async () => {
    expect((await boot({ id: 'a1', role: 'admin' })('inv-1', signedIn)).status).toBe(200)
    expect((await boot(null)('inv-1', serverCallHeaders())).status).toBe(200)
  })

  it('reads a malformed id as missing, and an outage as a generic 500', async () => {
    const malformed = Object.assign(new Error('invalid input syntax for type uuid'), {
      code: '22P02',
    })
    expect((await boot(null, { lookupError: malformed })('x', serverCallHeaders())).status).toBe(
      404
    )

    const outage = await boot(null, {
      lookupError: new Error('connect ECONNREFUSED 10.0.0.5:5432'),
    })('inv-1', serverCallHeaders())
    expect(outage.status).toBe(500)
    expect(JSON.stringify(outage.payload)).not.toContain('ECONNREFUSED')
  })
})
