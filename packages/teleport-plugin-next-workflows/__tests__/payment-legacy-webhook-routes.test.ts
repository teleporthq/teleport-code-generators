import {
  generatePaypalWebhookCode,
  generateStripeWebhookCode,
  generateWebhookFiles,
} from '../src/webhook-generator'
import { FetchResponder, withEnv, withFetch } from './_helpers/fake-fetch'
import { loadPaymentDrivers } from './_helpers/load-payment-drivers'

/**
 * `/api/webhooks/stripe` and `/api/webhooks/paypal`, the fixed routes a store
 * without workflow-driven payment webhooks still carries. EXECUTED: each one
 * acts only on an event its provider's driver verified, and refuses the rest.
 */

interface Reply {
  status: number
  body: any
}

const loadRoute = (
  source: string,
  verify: ((input: any) => Promise<any>) | null,
  modules: Record<string, unknown> = {}
) => {
  const inputs: any[] = []
  const requireShim = (id: string) => {
    if (modules[id]) {
      return modules[id]
    }
    if (id.endsWith('/utils/payments')) {
      if (!verify) {
        throw new Error("Cannot find module '" + id + "'")
      }
      return {
        get: () => ({
          verifyWebhook: async (input: any) => {
            inputs.push(input)
            return verify(input)
          },
        }),
        // The store's own money helpers, as the registry exposes them.
        core: loadPaymentDrivers({ ids: ['stripe'] }).core,
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id)
  }
  const module = { exports: null as any }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', source)(module, {}, requireShim)
  const post = async (body: string): Promise<Reply> => {
    const reply: Reply = { status: 0, body: null }
    await module.exports(
      {
        method: 'POST',
        headers: { host: 'shop.test', 'stripe-signature': 't=1,v1=x' },
        body: Buffer.from(body),
      },
      {
        status(code: number) {
          reply.status = code
          return {
            json(payload: unknown) {
              reply.body = payload
            },
          }
        },
      }
    )
    return reply
  }
  return { post, inputs, config: module.exports.config }
}

const CREDENTIALS = {
  STRIPE_SECRET_KEY: 'sk_test_1',
  PAYPAL_CLIENT_ID: 'client',
  PAYPAL_CLIENT_SECRET: 'secret',
}

describe('legacy payment webhook routes', () => {
  const routes: Array<[string, string]> = [
    ['stripe', generateStripeWebhookCode(undefined, undefined)],
    ['paypal', generatePaypalWebhookCode(undefined, undefined)],
  ]

  it.each(routes)('%s: reads the raw body itself', (_provider, source) => {
    expect(loadRoute(source, null).config).toEqual({ api: { bodyParser: false } })
  })

  it.each(routes)('%s: refuses an event its driver could not verify', async (_provider, source) => {
    await withEnv(CREDENTIALS, async () => {
      const route = loadRoute(source, async () => ({ ok: false, reason: 'forged' }))
      expect(await route.post('{"id":"evt_forged","type":"checkout.session.completed"}')).toEqual({
        status: 400,
        body: { error: 'Invalid webhook signature' },
      })
      expect(route.inputs[0].rawBody.toString('utf8')).toBe(
        '{"id":"evt_forged","type":"checkout.session.completed"}'
      )
      expect(route.inputs[0].body).toEqual({ id: 'evt_forged', type: 'checkout.session.completed' })
    })
  })

  it.each(routes)(
    '%s: refuses everything in a store without the driver module',
    async (_provider, source) => {
      await withEnv(CREDENTIALS, async () => {
        expect((await loadRoute(source, null).post('{}')).status).toBe(400)
      })
    }
  )

  it.each(routes)('%s: acknowledges an event the driver vouched for', async (_provider, source) => {
    await withEnv(CREDENTIALS, async () => {
      const route = loadRoute(source, async () => ({
        ok: true,
        body: { id: 'evt_1', type: 'some.unhandled.event', event_type: 'SOME.UNHANDLED' },
      }))
      expect(await route.post('{"id":"evt_1"}')).toEqual({ status: 200, body: { received: true } })
    })
  })
})

describe('legacy Stripe webhook route — completed checkouts', () => {
  // Records every statement the route sends to the store's database.
  const fakePg = () => {
    const queries: Array<{ text: string; values: unknown[] }> = []
    function Client(): Record<string, unknown> {
      return {
        connect: async (): Promise<void> => undefined,
        query: async (text: string, values: unknown[]): Promise<{ rowCount: number }> => {
          queries.push({ text, values })
          return { rowCount: 1 }
        },
        end: async (): Promise<void> => undefined,
      }
    }
    return { pg: { Client }, queries }
  }
  const completed = (type: string, paymentStatus: string) => ({
    id: 'evt_1',
    type,
    data: {
      object: {
        id: 'cs_1',
        payment_status: paymentStatus,
        payment_intent: 'pi_1',
        amount_total: 1000,
        metadata: { orderId: 'order-1' },
      },
    },
  })
  const deliver = async (source: string, event: unknown) => {
    const { pg, queries } = fakePg()
    const route = loadRoute(source, async () => ({ ok: true, body: event }), { pg })
    const { reply, fetched } = await withEnv(
      { ...CREDENTIALS, TELEPORT_DB_CONNECTION_STRING: 'postgres://store' },
      () =>
        withFetch(
          () => ({ status: 200, body: { invoiceId: 'inv-1' } }),
          async (calls) => ({ reply: await route.post('{}'), fetched: calls.map((c) => c.url) })
        )
    )
    return { reply, queries, fetched }
  }
  const ecommerce: any = { orderNotifications: true }

  it('marks nothing paid, invoices nothing and announces nothing while the money is on its way', async () => {
    for (const source of [
      generateStripeWebhookCode(undefined, ecommerce),
      generateStripeWebhookCode({ enabled: true, autoGenerateOnPayment: true } as any, ecommerce),
    ]) {
      const { reply, queries, fetched } = await deliver(
        source,
        completed('checkout.session.completed', 'unpaid')
      )
      expect(reply.status).toBe(200)
      expect(queries).toEqual([])
      expect(fetched).toEqual([])
    }
  })

  it('marks the order paid once Stripe has the money, never a cancelled one', async () => {
    const source = generateStripeWebhookCode(undefined, {} as any)
    for (const event of [
      completed('checkout.session.completed', 'paid'),
      completed('checkout.session.completed', 'no_payment_required'),
      // A bank debit or a transfer settles after the session completed.
      completed('checkout.session.async_payment_succeeded', 'paid'),
    ]) {
      const { queries } = await deliver(source, event)
      expect(queries).toHaveLength(1)
      expect(queries[0].values).toEqual(['paid', 'paid', 'pi_1', 'order-1'])
      expect(queries[0].text).toMatch(/WHERE id = \$4 AND status IS DISTINCT FROM 'cancelled'$/)
    }
  })

  it('never marks a cancelled order paid through the invoice either', async () => {
    const source = generateStripeWebhookCode(
      { enabled: true, autoGenerateOnPayment: true } as any,
      {} as any
    )
    const { queries, fetched } = await deliver(
      source,
      completed('checkout.session.completed', 'paid')
    )
    expect(fetched).toContain('https://shop.test/api/invoices/generate')
    expect(queries).toHaveLength(1)
    expect(queries[0].text).toMatch(/WHERE id = \$7 AND status IS DISTINCT FROM 'cancelled'$/)
  })
})

// Records every statement a route sends to the store's database, answering the
// order read with `order` (null: no such order).
const scriptedPg = (order: Record<string, unknown> | null) => {
  const queries: Array<{ text: string; values: unknown[] }> = []
  function Client(): Record<string, unknown> {
    return {
      connect: async (): Promise<void> => undefined,
      query: async (text: string, values: unknown[]) => {
        queries.push({ text, values })
        return /^SELECT/.test(text) ? { rows: order ? [order] : [] } : { rowCount: 1 }
      },
      end: async (): Promise<void> => undefined,
    }
  }
  return { pg: { Client }, queries }
}

const deliverTo = async (
  source: string,
  event: unknown,
  order: Record<string, unknown> | null = null,
  respond: FetchResponder = () => ({ status: 200, body: { invoiceId: 'inv-1' } })
) => {
  const { pg, queries } = scriptedPg(order)
  const route = loadRoute(source, async () => ({ ok: true, body: event }), { pg })
  const { reply, calls } = await withEnv(
    { ...CREDENTIALS, TELEPORT_DB_CONNECTION_STRING: 'postgres://store' },
    () => withFetch(respond, async (seen) => ({ reply: await route.post('{}'), calls: seen }))
  )
  const posted = (path: string) => calls.filter((call) => call.url === 'https://shop.test' + path)
  return { reply, queries, posted, calls }
}

describe('legacy PayPal webhook route — captures', () => {
  const both = generatePaypalWebhookCode(
    { enabled: true, autoGenerateOnPayment: true } as any,
    { orderNotifications: true } as any
  )
  const notificationsOnly = generatePaypalWebhookCode(undefined, {
    orderNotifications: true,
  } as any)
  const captureEvent = (value: string, currencyCode = 'USD', status = 'COMPLETED') => ({
    id: 'WH-1',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: 'CAP-1',
      status,
      amount: { value, currency_code: currencyCode },
      custom_id: JSON.stringify({ orderId: 'order-1', orderNumber: 'ORD-1' }),
    },
  })
  // Due 30.00: a 50.00 order a gift card paid 20.00 of.
  const unpaidOrder = {
    status: 'pending',
    payment_status: 'unpaid',
    currency: 'USD',
    total_amount: '50.00',
    gift_card_amount: '20.00',
  }

  it('acts on no approval: an approval moves no money', async () => {
    for (const source of [both, notificationsOnly]) {
      const { reply, queries, posted } = await deliverTo(
        source,
        {
          id: 'WH-0',
          event_type: 'CHECKOUT.ORDER.APPROVED',
          resource: {
            id: 'ORDER-1',
            purchase_units: [
              {
                amount: { value: '30.00', currency_code: 'USD' },
                custom_id: '{"orderId":"order-1"}',
              },
            ],
          },
        },
        unpaidOrder
      )
      expect(reply.status).toBe(200)
      expect(queries).toEqual([])
      expect(posted('/api/invoices/generate')).toEqual([])
      expect(posted('/api/ecommerce/order-notification')).toEqual([])
    }
  })

  it('invoices, pays and announces a capture of what the order is due, once', async () => {
    const { queries, posted } = await deliverTo(both, captureEvent('30.00'), unpaidOrder)
    expect(posted('/api/invoices/generate')).toHaveLength(1)
    expect(posted('/api/ecommerce/order-notification')).toHaveLength(1)
    expect(posted('/api/ecommerce/order-notification')[0].json.orderId).toBe('order-1')
    expect(queries).toHaveLength(2)
    expect(queries[0].values).toEqual(['order-1'])
    expect(queries[1].text).toMatch(/WHERE id = \$7 AND status IS DISTINCT FROM 'cancelled'$/)
    expect(queries[1].values[6]).toBe('order-1')
    // Redelivered after the order was paid: nothing twice.
    const replay = await deliverTo(both, captureEvent('30.00'), {
      ...unpaidOrder,
      payment_status: 'paid',
    })
    expect(replay.posted('/api/invoices/generate')).toEqual([])
    expect(replay.posted('/api/ecommerce/order-notification')).toEqual([])
    expect(replay.queries).toHaveLength(1)
  })

  it('pays nothing for a capture of another amount or currency, a cancelled order or none at all', async () => {
    const refused: Array<[unknown, Record<string, unknown> | null]> = [
      [captureEvent('29.99'), unpaidOrder],
      [captureEvent('50.00'), unpaidOrder],
      [captureEvent('30.00', 'EUR'), unpaidOrder],
      [captureEvent('30.00', 'USD', 'DECLINED'), unpaidOrder],
      [captureEvent('30.00'), { ...unpaidOrder, status: 'cancelled' }],
      [captureEvent('30.00'), null],
    ]
    for (const source of [both, notificationsOnly]) {
      for (const [event, order] of refused) {
        const { reply, queries, posted } = await deliverTo(source, event, order)
        expect(reply.status).toBe(200)
        expect(posted('/api/invoices/generate')).toEqual([])
        expect(posted('/api/ecommerce/order-notification')).toEqual([])
        expect(queries.every((query) => /^SELECT/.test(query.text))).toBe(true)
      }
    }
  })

  it('announces a capture of an order without gift card column once, from the notifications-only route', async () => {
    const { posted } = await deliverTo(notificationsOnly, captureEvent('50.00'), {
      status: 'pending',
      payment_status: 'unpaid',
      currency: 'usd',
      total_amount: '50.00',
      gift_card_amount: '0',
    })
    expect(posted('/api/ecommerce/order-notification')).toHaveLength(1)
  })
})

describe('legacy Stripe webhook route — amounts and payment intents', () => {
  const session = (currency: string, amountTotal: number) => ({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_1',
        payment_status: 'paid',
        payment_intent: 'pi_1',
        currency,
        amount_total: amountTotal,
        metadata: { orderId: 'order-1' },
      },
    },
  })

  it('announces the total in the major unit of its own currency', async () => {
    const source = generateStripeWebhookCode(undefined, { orderNotifications: true } as any)
    for (const [currency, minor, major] of [
      ['usd', 1234, 12.34],
      ['jpy', 1234, 1234],
      ['kwd', 12340, 12.34],
    ] as const) {
      const { posted } = await deliverTo(source, session(currency, minor))
      expect(posted('/api/ecommerce/order-notification')[0].json.totalAmount).toBe(major)
    }
  })

  it('invoices a zero-decimal payment intent at its own amount', async () => {
    const source = generateStripeWebhookCode(
      { enabled: true, autoGenerateOnPayment: true } as any,
      {} as any
    )
    const { posted } = await deliverTo(source, {
      id: 'evt_2',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_9', amount: 5000, currency: 'jpy', metadata: {} } },
    })
    expect(posted('/api/invoices/generate')[0].json.items).toEqual([
      { name: 'Payment', quantity: 1, unitPrice: 5000, totalPrice: 5000, currency: 'JPY' },
    ])
  })

  // A subscription's first payment and every renewal arrive twice: as the
  // invoice and as the intent that paid it. The invoice event is the one path.
  it('invoices a payment of a Stripe invoice once, from the invoice event', async () => {
    const source = generateStripeWebhookCode(
      { enabled: true, autoGenerateOnPayment: true } as any,
      {} as any
    )
    const renewalIntent = (extra: Record<string, unknown>) => ({
      id: 'evt_4',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_sub', amount: 1500, currency: 'usd', metadata: {}, ...extra } },
    })
    // The classic API names the invoice on the intent.
    const classic = await deliverTo(source, renewalIntent({ invoice: 'in_1' }))
    expect(classic.posted('/api/invoices/generate')).toEqual([])
    expect(classic.calls).toEqual([])
    // From 2025-03-31 on it does not: the invoice payments are searched by the intent.
    const lookups: Array<{ url: string; version: string }> = []
    const answerLookup =
      (found: unknown[]): FetchResponder =>
      (call) => {
        if (call.url.startsWith('https://api.stripe.com/v1/invoice_payments?')) {
          lookups.push({ url: call.url, version: call.headers['Stripe-Version'] })
          return { status: 200, body: { object: 'list', data: found } }
        }
        return { status: 200, body: { invoiceId: 'inv-1' } }
      }
    const current = await deliverTo(
      source,
      renewalIntent({}),
      null,
      answerLookup([{ id: 'inpay_1', invoice: 'in_1' }])
    )
    expect(current.posted('/api/invoices/generate')).toEqual([])
    expect(lookups).toEqual([
      {
        url: 'https://api.stripe.com/v1/invoice_payments?payment%5Btype%5D=payment_intent&payment%5Bpayment_intent%5D=pi_sub&limit=1',
        version: '2025-03-31.basil',
      },
    ])
    // An intent no invoice names is a payment of its own.
    const standalone = await deliverTo(source, renewalIntent({}), null, answerLookup([]))
    expect(standalone.posted('/api/invoices/generate')).toHaveLength(1)
    // The invoice event invoices it, once.
    const invoiceEvent = await deliverTo(source, {
      id: 'evt_5',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_1',
          currency: 'usd',
          payment_intent: 'pi_sub',
          lines: { data: [{ description: 'Club', quantity: 1, amount: 1500 }] },
        },
      },
    })
    const invoiced = invoiceEvent.posted('/api/invoices/generate')
    expect(invoiced).toHaveLength(1)
    expect(invoiced[0].json).toMatchObject({
      paymentIntentId: 'pi_sub',
      paymentProviderInvoiceId: 'in_1',
      items: [{ name: 'Club', quantity: 1, unitPrice: 15, totalPrice: 15, currency: 'USD' }],
    })
  })

  it("leaves a subscription's first invoice to the store checkout that opened it", async () => {
    const source = generateStripeWebhookCode(
      { enabled: true, autoGenerateOnPayment: true } as any,
      {} as any
    )
    const invoiceEvent = (object: Record<string, unknown>) => ({
      id: 'evt_6',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_2',
          currency: 'usd',
          lines: { data: [{ description: 'Club', quantity: 1, amount: 1500 }] },
          ...object,
        },
      },
    })
    const storeOrder = { metadata: { orderId: 'order-1' } }
    // The classic API snapshots the subscription's metadata on the invoice;
    // from 2025-03-31 on it sits under `parent`.
    for (const first of [
      { billing_reason: 'subscription_create', subscription_details: storeOrder },
      { billing_reason: 'subscription_create', parent: { subscription_details: storeOrder } },
    ]) {
      const delivered = await deliverTo(source, invoiceEvent(first))
      expect(delivered.reply.status).toBe(200)
      expect(delivered.posted('/api/invoices/generate')).toEqual([])
    }
    // A renewal, and a first invoice of a subscription no store checkout opened.
    for (const invoiced of [
      { billing_reason: 'subscription_cycle', subscription_details: storeOrder },
      { billing_reason: 'subscription_create', subscription_details: { metadata: {} } },
    ]) {
      const delivered = await deliverTo(source, invoiceEvent(invoiced))
      expect(delivered.posted('/api/invoices/generate')).toHaveLength(1)
    }
  })

  it('asks Stripe to send a payment intent again when it cannot tell what it pays', async () => {
    const source = generateStripeWebhookCode(
      { enabled: true, autoGenerateOnPayment: true } as any,
      {} as any
    )
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const delivered = await deliverTo(
        source,
        {
          id: 'evt_7',
          type: 'payment_intent.succeeded',
          data: { object: { id: 'pi_2', amount: 1500, currency: 'usd', metadata: {} } },
        },
        null,
        (call) =>
          call.url.startsWith('https://api.stripe.com/v1/invoice_payments?')
            ? { status: 503, body: {} }
            : { status: 200, body: { invoiceId: 'inv-1' } }
      )
      expect(delivered.reply.status).toBe(500)
      expect(delivered.posted('/api/invoices/generate')).toEqual([])
    } finally {
      quiet.mockRestore()
    }
  })

  it("leaves the payment intent of a checkout session's order to the session's event", async () => {
    const source = generateStripeWebhookCode(
      { enabled: true, autoGenerateOnPayment: true } as any,
      { orderNotifications: true } as any
    )
    const { reply, queries, posted } = await deliverTo(source, {
      id: 'evt_3',
      type: 'payment_intent.succeeded',
      data: {
        object: { id: 'pi_1', amount: 1000, currency: 'usd', metadata: { orderId: 'order-1' } },
      },
    })
    expect(reply.status).toBe(200)
    expect(queries).toEqual([])
    expect(posted('/api/invoices/generate')).toEqual([])
  })
})

describe('legacy payment webhook emission', () => {
  it('writes every driver the store uses, even when it is the first to write the module', () => {
    const files = new Map<string, any>()
    const structure: any = {
      files,
      dependencies: {},
      uidl: {
        globals: { env: {} },
        ecommerceSettings: { paymentProviders: [{ type: 'stripe' }, { type: 'mollie' }] },
      },
    }
    generateWebhookFiles(structure, undefined)
    expect(files.has('webhook-stripe')).toBe(true)
    expect(files.has('webhook-paypal')).toBe(false)
    expect(
      files.get('payment-drivers-drivers').files.map((file: { name: string }) => file.name)
    ).toEqual(['stripe', 'paypal', 'mollie'])
  })

  it('writes Stripe and PayPal for a store that names Stripe only by its keys', () => {
    const files = new Map<string, any>()
    generateWebhookFiles(
      { files, dependencies: {}, uidl: { globals: { env: { STRIPE_SECRET_KEY: '' } } } } as any,
      undefined
    )
    expect(
      files.get('payment-drivers-drivers').files.map((file: { name: string }) => file.name)
    ).toEqual(['stripe', 'paypal'])
  })

  it('leaves a provider to the workflow route that owns its webhook', () => {
    const files = new Map<string, any>()
    generateWebhookFiles(
      {
        files,
        dependencies: {},
        uidl: {
          globals: { env: {} },
          ecommerceSettings: { paymentProviders: [{ type: 'stripe' }] },
        },
      } as any,
      undefined,
      { skipProviders: new Set(['stripe']) }
    )
    expect(files.size).toBe(0)
  })
})
