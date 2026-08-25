import { generateInvoiceGenerateRouteCode } from '../src/invoice/api-routes-code'
import type { UIDLInvoiceSettings } from '@teleporthq/teleport-types'

// `/api/invoices/generate` used to invoice a HALF-WRITTEN order.
//
// The runtime `data-create-item` handler fire-and-forgets
// `/api/ecommerce/order-notification` the moment the `teleport_orders` row
// lands, and that route generates the invoice for every non-webhook payment
// method. But the checkout workflow writes `teleport_order_items` AFTER the
// order row, one HTTP round-trip per cart line — so the invoice endpoint was
// reading the line items while they were still being inserted.
//
// Observed in a real store: a 3-line order (4x Linen Table Runner, 3x Ceramic
// Dinner Plate Set, 2x Wireless Bluetooth Speaker, charged 474.45) produced an
// invoice with ONE line item and a total of 249.00 — the two rows that had not
// been inserted yet were simply absent, and nothing anywhere said so.
//
// These tests run the EMITTED handler against a data-access stub whose rows
// arrive progressively, which is what the race actually looks like.

const FAKE_SETTINGS = {
  invoicePrefix: 'INV-',
  defaultTaxRate: 10,
  showDiscount: false,
  taxIncludedInPrice: false,
  companyDetails: {},
  template: { document: null as unknown },
  tables: { invoicesTable: 'teleport_invoices', invoiceItemsTable: 'teleport_invoice_items' },
  emailDelivery: { enabled: false },
} as unknown as UIDLInvoiceSettings

interface OrderItemRow {
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
  total_price: number
}

const ORDER_ROW_BASE = {
  id: 'order-1',
  currency: 'USD',
  total_amount: 474.45,
  shipping_amount: 150,
  billing_name: 'Jane Buyer',
  billing_email: 'jane@example.com',
}

const ITEM_ROWS: OrderItemRow[] = [
  {
    product_id: 'p1',
    product_name: 'Linen Table Runner',
    quantity: 4,
    unit_price: 22.5,
    total_price: 90,
  },
  {
    product_id: 'p2',
    product_name: 'Ceramic Dinner Plate Set',
    quantity: 3,
    unit_price: 34.99,
    total_price: 104.97,
  },
  {
    product_id: 'p3',
    product_name: 'Wireless Bluetooth Speaker',
    quantity: 2,
    unit_price: 49.99,
    total_price: 99.98,
  },
]

interface HandlerRun {
  status: number
  payload: Record<string, unknown>
  insertedItems: unknown[]
  reads: number
}

/**
 * Loads the emitted `pages/api/invoices/generate.js` as a real module and
 * invokes its handler.
 *
 * `orderNumberAfterRead` controls when checkout's order-number backfill
 * becomes visible — that write happens after the item loop in both the COD
 * and the online-payment branch, so it is one of the endpoint's "the order is
 * whole now" signals. `Infinity` models a flow that never sets one.
 */
async function runHandler(options: {
  body: Record<string, unknown>
  /** Number of item rows visible on the Nth read (1-indexed reads). */
  visibleItemsPerRead: (read: number) => number
  orderNumberAfterRead?: number
}): Promise<HandlerRun> {
  const code = generateInvoiceGenerateRouteCode(FAKE_SETTINGS)

  let reads = 0
  const insertedItems: unknown[] = []
  const orderNumberAfterRead = options.orderNumberAfterRead ?? 1

  const dataAccessStub = {
    getOrderWithItems: async (orderId: string) => {
      reads += 1
      if (orderId !== ORDER_ROW_BASE.id) {
        return null
      }
      return {
        order: {
          ...ORDER_ROW_BASE,
          order_number: reads >= orderNumberAfterRead ? 'ORD-1' : null,
        },
        items: ITEM_ROWS.slice(0, options.visibleItemsPerRead(reads)),
      }
    },
    getNextInvoiceNumber: async () => 1,
    insertInvoice: async (invoiceData: Record<string, unknown>) => invoiceData,
    insertInvoiceItems: async (_invoiceId: string, items: unknown[]) => {
      insertedItems.push(...items)
      return items
    },
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
  let payload: Record<string, unknown> = {}
  const res = {
    status(statusCode: number) {
      status = statusCode
      return this
    },
    json(value: Record<string, unknown>) {
      payload = value
      return this
    },
    setHeader() {
      /* not used by this route */
    },
    end() {
      /* not used by this route */
    },
  }

  await handler({ method: 'POST', headers: { host: 'localhost:3000' }, body: options.body }, res)

  return { status, payload, insertedItems, reads }
}

describe('/api/invoices/generate — waits for the order to be fully written', () => {
  const originalFetch = globalThis.fetch
  const originalConnString = process.env.TELEPORT_DB_CONNECTION_STRING
  const originalDatabaseUrl = process.env.DATABASE_URL

  beforeAll(() => {
    // The route self-fetches the runtime-storage proxy and mirrors onto
    // `teleport_orders`; neither is under test and neither may reach the
    // network from a unit test.
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

  it('invoices every line of an order whose items are still being inserted', async () => {
    // The exact shape of the reported bug: one row visible on the first read,
    // the rest landing while the endpoint runs. `expectedItemCount` is what
    // the order-notification route forwards from the cart it was handed.
    const run = await runHandler({
      body: { orderId: 'order-1', expectedItemCount: 3 },
      visibleItemsPerRead: (read) => Math.min(read, 3),
      orderNumberAfterRead: Infinity,
    })

    expect(run.status).toBe(200)
    expect(run.insertedItems).toHaveLength(3)
    expect(run.insertedItems.map((item) => (item as { name: string }).name)).toEqual([
      'Linen Table Runner',
      'Ceramic Dinner Plate Set',
      'Wireless Bluetooth Speaker',
    ])
    // 90 + 104.97 + 99.98 = 294.95 net, +10% VAT = 324.45, +150 delivery.
    expect(run.payload.total).toBe(474.45)
  })

  it('accepts the order as whole once checkout has backfilled the order number', async () => {
    // No `expectedItemCount` — the webhook-driven callers send only an
    // orderId. `teleport_orders.order_number` is written after the item loop,
    // so its presence is the endpoint's own proof that no line is missing.
    const run = await runHandler({
      body: { orderId: 'order-1' },
      visibleItemsPerRead: (read) => Math.min(read, 3),
      orderNumberAfterRead: 3,
    })

    expect(run.status).toBe(200)
    expect(run.insertedItems).toHaveLength(3)
    expect(run.reads).toBe(3)
  })

  it('does not poll an order that is already complete on the first read', async () => {
    // The common case — every payment-webhook invoice. It must cost exactly
    // one query and no added latency.
    const run = await runHandler({
      body: { orderId: 'order-1' },
      visibleItemsPerRead: () => 3,
      orderNumberAfterRead: 1,
    })

    expect(run.status).toBe(200)
    expect(run.insertedItems).toHaveLength(3)
    expect(run.reads).toBe(1)
  })

  it('does not wait at all when the caller supplied its own line items', async () => {
    const run = await runHandler({
      body: {
        orderId: 'order-1',
        items: [{ name: 'Handpicked line', quantity: 1, unitPrice: 10, totalPrice: 10 }],
      },
      visibleItemsPerRead: () => 0,
      orderNumberAfterRead: Infinity,
    })

    expect(run.status).toBe(200)
    expect(run.reads).toBe(1)
    expect(run.insertedItems).toHaveLength(1)
    expect((run.insertedItems[0] as { name: string }).name).toBe('Handpicked line')
  })

  it('still rejects an order that never gets any line items', async () => {
    const run = await runHandler({
      body: { orderId: 'order-1', expectedItemCount: 3 },
      visibleItemsPerRead: () => 0,
      orderNumberAfterRead: 1,
    })

    expect(run.status).toBe(400)
    expect(run.payload.error).toBe('At least one item is required')
  }, 15000)
})

describe('/api/invoices/generate — settle contract (emitted source)', () => {
  const route = generateInvoiceGenerateRouteCode(FAKE_SETTINGS)

  it('reads the line items through the settling helper, never a bare query', () => {
    expect(route).toContain('async function hydrateOrderWhenSettled(orderId, expectedItemCount)')
    expect(route).toContain('await hydrateOrderWhenSettled(body.orderId, expectedItemCount)')
  })

  it('treats a populated order_number as proof the item loop finished', () => {
    // Checkout writes it in "Mark Order As Cash On Delivery Confirmed" /
    // "Set Order Number Before Payment Redirect", both downstream of the loop.
    expect(route).toContain('var orderNumber = hydrated.order.order_number;')
    expect(route).toContain(
      'if (count > 0 && orderNumber != null && String(orderNumber).length > 0) {'
    )
  })

  it('bounds the wait so a stuck order still produces an invoice', () => {
    expect(route).toContain('var SETTLE_TIMEOUT_MS = 6000;')
    expect(route).toContain('did not settle within ')
  })

  it('warns when the invoice total disagrees with the amount charged', () => {
    // The tripwire that would have caught this the first time: the invoice is
    // summed from line items, `teleport_orders.total_amount` is what the buyer
    // actually paid, and a missing line makes them disagree.
    expect(route).toContain('var orderTotalAmount = Number(orderShippingSource.total_amount);')
    expect(route).toContain('[invoice] Total mismatch for order ')
  })
})
