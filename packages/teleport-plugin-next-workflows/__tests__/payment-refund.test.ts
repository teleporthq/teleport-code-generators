import { loadHandler, HandlerFn } from './_helpers/load-handler'
import { paymentRefund } from '../src/nodes/payment/payment-refund'
import { resolveHandlerEntryName } from '../src/nodes/types'
import { collectSecrets } from '../src/secret-collector'

interface RefundResult {
  success: boolean
  refundId: string
  amount: number
  currency: string
  status: string
  error: string
}

describe('payment-refund', () => {
  const handler: HandlerFn = loadHandler('payment-refund')
  const source = paymentRefund.generateHandler()

  it('is a SERVER node that continues the workflow', () => {
    expect(paymentRefund.executionEnv).toBe('server')
    // Unlike a charge, a refund must NOT be terminal: the steps that record it,
    // restock it and email the buyer all run after it.
    expect(paymentRefund.isTerminal).toBe(false)
  })

  it('has its provider credentials collected into the generated env', () => {
    // Without this the exported project ships with no key for the refund node
    // and every refund fails at runtime with "not configured".
    const secrets = collectSecrets({
      workflows: {
        wf1: {
          nodes: [
            {
              id: 'node-1',
              type: 'payment-refund',
              config: { secretKey: 'sk_test_1', clientId: 'id_1', clientSecret: 'cs_1' },
            },
          ],
        },
      },
    } as never)
    expect(secrets.map((secret) => secret.fieldName).sort()).toEqual([
      'clientId',
      'clientSecret',
      'secretKey',
    ])
  })

  it('resolves its own entry point out of the concatenated source', () => {
    // The entry has to be the FIRST statement-level two-parameter function, or
    // the generated route calls a helper instead.
    expect(resolveHandlerEntryName(source, 'payment-refund')).toBe('payment_refund')
  })

  it('reads process through globalThis, which webpack leaves alone', () => {
    // A bare `process` is rewritten by the GUI's browser packer into a name
    // that does not exist on the Vercel Node runtime.
    expect(source).toContain('globalThis.process.env')
    // …and nowhere is `process.env` read WITHOUT that prefix.
    expect(source.replace(/globalThis\.process\.env/g, '')).not.toContain('process.env')
  })

  it('keeps each currency list in the SAME snapshot as the code that reads it', () => {
    // A declaration in one `.toString()`'d function and its reference in
    // another is the "Oo is not defined" bug — a minifier renames the two
    // independently and the generated file references a name it never declares.
    // Slicing the emitted source per function is the only way to check that.
    for (const fnName of ['toProviderMinorUnits', 'fromProviderMinorUnits']) {
      const start = source.indexOf(`function ${fnName}`)
      expect(start).toBeGreaterThanOrEqual(0)
      const next = source.indexOf('\nfunction ', start + 1)
      const body = next === -1 ? source.slice(start) : source.slice(start, next)
      expect(body).toContain('zeroDecimalCurrencies = [')
      expect(body).toContain('threeDecimalCurrencies = [')
      expect(body).toContain('zeroDecimalCurrencies.indexOf')
    }
  })

  it('refuses without a payment reference instead of calling a provider', async () => {
    const result = (await handler({ currency: 'usd' }, {})) as RefundResult
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no payment reference/i)
    expect(result.refundId).toBe('')
  })

  it('reports missing Stripe credentials as an actionable error', async () => {
    const saved = process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY
    try {
      const result = (await handler(
        { providerType: 'stripe', paymentReference: 'pi_1', currency: 'usd' },
        {}
      )) as RefundResult
      expect(result.success).toBe(false)
      expect(result.error).toContain('STRIPE_SECRET_KEY')
      // The shape stays constant on every path, so a downstream node can bind
      // to it without knowing which branch ran.
      expect(result).toMatchObject({ refundId: '', amount: 0, status: '' })
    } finally {
      if (saved !== undefined) {
        process.env.STRIPE_SECRET_KEY = saved
      }
    }
  })

  it('reports missing PayPal credentials without attempting a network call', async () => {
    const savedId = process.env.PAYPAL_CLIENT_ID
    const savedSecret = process.env.PAYPAL_CLIENT_SECRET
    delete process.env.PAYPAL_CLIENT_ID
    delete process.env.PAYPAL_CLIENT_SECRET
    try {
      const result = (await handler(
        { providerType: 'paypal', paymentReference: 'cap_1', currency: 'usd' },
        {}
      )) as RefundResult
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/PayPal credentials are not configured/i)
    } finally {
      if (savedId !== undefined) {
        process.env.PAYPAL_CLIENT_ID = savedId
      }
      if (savedSecret !== undefined) {
        process.env.PAYPAL_CLIENT_SECRET = savedSecret
      }
    }
  })

  it('always returns an answer rather than throwing, so bookkeeping can still run', async () => {
    // A declined refund is a branch the workflow takes, not a crash that takes
    // the whole segment — including the steps that record what happened — down.
    await expect(
      handler({ providerType: 'stripe', paymentReference: 'pi_1', currency: 'usd' }, {})
    ).resolves.toBeDefined()
  })
})

/**
 * The serialized handler EXECUTED against a fake provider: every PayPal call
 * goes through `fetch`, and the Stripe SDK is replaced through the same
 * `__non_webpack_require__` hook the generated app loads it with. What is
 * pinned: which Stripe object a stored reference is exchanged for, that a
 * PayPal reference is tried as a capture, then a v1 sale, then an order — and
 * that only "not found" moves the chain along — the exact request each
 * provider receives, and that the provider's own answer (currency, status) is
 * what the merchant is told.
 */

interface FetchCall {
  url: string
  init: { method?: string; headers?: Record<string, string>; body?: string }
}

type Responder = (
  url: string,
  init: FetchCall['init']
) => { ok: boolean; status?: number; body: unknown }

const PAYPAL_ENV = {
  PAYPAL_CLIENT_ID: 'Aclient',
  PAYPAL_CLIENT_SECRET: 'Esecret',
}

const withEnv = async <T>(
  env: Record<string, string | undefined>,
  run: () => Promise<T>
): Promise<T> => {
  const saved: Record<string, string | undefined> = {}
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key]
    if (env[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = env[key]
    }
  }
  try {
    return await run()
  } finally {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = saved[key]
      }
    }
  }
}

const withFetch = async <T>(
  respond: Responder,
  run: (calls: FetchCall[]) => Promise<T>
): Promise<T> => {
  const calls: FetchCall[] = []
  const previous = (globalThis as { fetch?: unknown }).fetch
  ;(globalThis as { fetch?: unknown }).fetch = async (
    url: string,
    init: FetchCall['init'] = {}
  ) => {
    calls.push({ url, init })
    const answer = respond(url, init)
    return {
      ok: answer.ok,
      status: answer.status ?? (answer.ok ? 200 : 400),
      json: async () => answer.body,
    }
  }
  try {
    return await run(calls)
  } finally {
    ;(globalThis as { fetch?: unknown }).fetch = previous
    ;(globalThis as { __paypalBaseUrlCache?: string }).__paypalBaseUrlCache = undefined
  }
}

// The handler loads the SDK through `__non_webpack_require__` whenever that
// exists — the generated app's way past webpack's bundling — so a fake SDK
// takes its place through the same global and the test process never loads
// Stripe.
const withStripe = async <T>(
  client: Record<string, unknown>,
  run: () => Promise<T>
): Promise<T> => {
  const scope = globalThis as { __non_webpack_require__?: unknown }
  const previous = scope.__non_webpack_require__
  scope.__non_webpack_require__ = (name: string) => {
    if (name !== 'stripe') {
      throw new Error('unexpected require: ' + name)
    }
    return function FakeStripe() {
      return client
    }
  }
  try {
    return await withEnv({ STRIPE_SECRET_KEY: 'sk_test_unit' }, run)
  } finally {
    if (previous === undefined) {
      delete scope.__non_webpack_require__
    } else {
      scope.__non_webpack_require__ = previous
    }
  }
}

type RefundParams = Record<string, unknown>

const stripeClient = (
  refund: Record<string, unknown> = {
    id: 're_1',
    amount: 999,
    currency: 'usd',
    status: 'succeeded',
  }
) => {
  const create = jest.fn(
    async (_params: RefundParams, _options?: Record<string, unknown>) => refund
  )
  const retrieveInvoice = jest.fn()
  return {
    client: {
      refunds: { create },
      invoices: { retrieve: retrieveInvoice },
      checkout: { sessions: { retrieve: jest.fn() } },
    },
    create,
    retrieveInvoice,
  }
}

/** Authenticates on the sandbox and answers each later call from a script. */
const scriptPaypal = (responses: Array<{ status: number; body?: unknown }>): Responder => {
  const queue = [...responses]
  return (url) => {
    if (url.endsWith('/v1/oauth2/token')) {
      return { ok: true, body: { access_token: 'token-1' } }
    }
    const next = queue.shift() ?? { status: 500, body: { message: 'unscripted call' } }
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      body: next.body ?? {},
    }
  }
}

const NOT_FOUND = { status: 404, body: { name: 'RESOURCE_NOT_FOUND' } }
const SALE = { status: 200, body: { id: '1AB23456CD789012E', state: 'completed' } }
const SALE_REFUND = {
  status: 200,
  body: { id: '5XY67890AB123456C', state: 'completed', amount: { total: '9.99', currency: 'USD' } },
}
const CAPTURE = { status: 200, body: { id: 'CAP1', status: 'COMPLETED' } }
const CAPTURE_REFUND = {
  status: 201,
  body: { id: '9RE12345', status: 'COMPLETED', amount: { value: '9.99', currency_code: 'USD' } },
}

const bodyOf = (call: FetchCall) => JSON.parse(call.init.body || '{}')
const refundPosts = (calls: FetchCall[]) =>
  calls.filter((call) => call.init.method === 'POST' && call.url.endsWith('/refund'))

describe('payment-refund against Stripe', () => {
  const handler: HandlerFn = loadHandler('payment-refund')
  const run = (config: Record<string, unknown>) =>
    handler(
      { providerType: 'stripe', paymentReference: 'pi_1', currency: 'usd', ...config },
      {}
    ) as Promise<RefundResult>

  it('refunds an invoice through the intent on its classic shape', async () => {
    const stripe = stripeClient()
    stripe.retrieveInvoice.mockResolvedValue({ payment_intent: 'pi_classic', charge: 'ch_old' })

    const result = await withStripe(stripe.client, () => run({ paymentReference: 'in_1' }))

    expect(result.success).toBe(true)
    expect(stripe.retrieveInvoice).toHaveBeenCalledWith('in_1')
    expect(stripe.create.mock.calls[0][0]).toMatchObject({ payment_intent: 'pi_classic' })
    expect(stripe.create.mock.calls[0][0].charge).toBeUndefined()
  })

  it('refunds an invoice through the intent on its 2025 shape, id or object', async () => {
    const stripe = stripeClient()
    stripe.retrieveInvoice.mockResolvedValueOnce({
      payment_intent: null,
      payments: { data: [{ payment: { payment_intent: { id: 'pi_object' } } }] },
    })
    stripe.retrieveInvoice.mockResolvedValueOnce({
      payments: { data: [{ payment: { payment_intent: 'pi_string' } }] },
    })

    await withStripe(stripe.client, async () => {
      await run({ paymentReference: 'in_1' })
      await run({ paymentReference: 'in_1' })
    })

    expect(stripe.create.mock.calls[0][0]).toMatchObject({ payment_intent: 'pi_object' })
    expect(stripe.create.mock.calls[1][0]).toMatchObject({ payment_intent: 'pi_string' })
  })

  it('falls back to the invoice charge and refuses an invoice with no payment', async () => {
    const stripe = stripeClient()
    stripe.retrieveInvoice.mockResolvedValueOnce({ payment_intent: null, charge: 'ch_only' })
    stripe.retrieveInvoice.mockResolvedValueOnce({ payment_intent: null, charge: null })

    const [withCharge, without] = await withStripe(stripe.client, () =>
      Promise.all([run({ paymentReference: 'in_1' }), run({ paymentReference: 'in_1' })])
    )

    expect(withCharge.success).toBe(true)
    expect(stripe.create.mock.calls[0][0]).toMatchObject({ charge: 'ch_only' })
    expect(without.success).toBe(false)
    expect(without.error).toBe('This Stripe invoice has no payment to refund.')
    expect(stripe.create).toHaveBeenCalledTimes(1)
  })

  it('refuses a subscription id and a refund id without calling Stripe', async () => {
    const stripe = stripeClient()

    const [sub, re] = await withStripe(stripe.client, () =>
      Promise.all([run({ paymentReference: 'sub_1' }), run({ paymentReference: 're_1' })])
    )

    expect(sub.success).toBe(false)
    expect(sub.error).toMatch(/subscription id cannot be refunded/i)
    expect(sub.error).toMatch(/invoice/i)
    expect(re.success).toBe(false)
    expect(re.error).toMatch(/already a refund id/i)
    expect(stripe.create).not.toHaveBeenCalled()
    expect(stripe.retrieveInvoice).not.toHaveBeenCalled()
  })

  it('attaches the order id as metadata only when it is given', async () => {
    const stripe = stripeClient()

    await withStripe(stripe.client, async () => {
      await run({ orderId: 'order-1' })
      await run({})
    })

    expect(stripe.create.mock.calls[0][0]).toMatchObject({ metadata: { orderId: 'order-1' } })
    expect(stripe.create.mock.calls[1][0].metadata).toBeUndefined()
  })

  it('reports the amount in the currency of the refund, not of the request', async () => {
    // A JPY refund read back with the request's USD factor would be 100× too small.
    const stripe = stripeClient({ id: 're_1', amount: 5000, currency: 'jpy', status: 'succeeded' })

    const result = await withStripe(stripe.client, () => run({ currency: 'usd' }))

    expect(result).toMatchObject({ success: true, amount: 5000, currency: 'JPY' })
  })

  it('refuses an amount below the smallest unit instead of sending a full refund', async () => {
    // Stripe reads a missing `amount` as "refund everything".
    const stripe = stripeClient()

    const [usd, jpy] = await withStripe(stripe.client, () =>
      Promise.all([run({ amount: 0.004, currency: 'usd' }), run({ amount: 0.4, currency: 'jpy' })])
    )

    expect(usd.success).toBe(false)
    expect(usd.error).toBe('The amount is smaller than the smallest unit of USD.')
    expect(jpy.error).toBe('The amount is smaller than the smallest unit of JPY.')
    expect(stripe.create).not.toHaveBeenCalled()
  })

  it('treats a failed or canceled refund as a failure and names the reason', async () => {
    const failed = stripeClient({
      id: 're_f',
      amount: 999,
      currency: 'usd',
      status: 'failed',
      failure_reason: 'insufficient_funds',
    })
    const canceled = stripeClient({ id: 're_c', amount: 999, currency: 'usd', status: 'canceled' })
    const pending = stripeClient({ id: 're_p', amount: 999, currency: 'usd', status: 'pending' })

    const failedResult = await withStripe(failed.client, () => run({}))
    const canceledResult = await withStripe(canceled.client, () => run({}))
    const pendingResult = await withStripe(pending.client, () => run({}))

    expect(failedResult).toMatchObject({ success: false, refundId: 're_f', status: 'failed' })
    expect(failedResult.error).toBe('Stripe reported the refund as failed: insufficient funds.')
    expect(canceledResult).toMatchObject({ success: false, status: 'canceled' })
    expect(pendingResult).toMatchObject({ success: true, status: 'pending', amount: 9.99 })
  })
})

describe('payment-refund against PayPal', () => {
  const handler: HandlerFn = loadHandler('payment-refund')
  const run = (config: Record<string, unknown>) =>
    withEnv(PAYPAL_ENV, () =>
      handler(
        {
          providerType: 'paypal',
          paymentReference: '1AB23456CD789012E',
          currency: 'usd',
          ...config,
        },
        {}
      )
    ) as Promise<RefundResult>

  it('refunds a subscription sale through the v1 API when the reference is not a capture', async () => {
    const { calls, result } = await withFetch(
      scriptPaypal([NOT_FOUND, SALE, SALE_REFUND]),
      async (seen) => ({
        calls: seen,
        result: await run({ amount: 9.99, reason: 'Requested by customer', orderId: 'order-1' }),
      })
    )

    expect(calls.map((call) => call.url)).toEqual([
      'https://api-m.sandbox.paypal.com/v1/oauth2/token',
      'https://api-m.sandbox.paypal.com/v2/payments/captures/1AB23456CD789012E',
      'https://api-m.sandbox.paypal.com/v1/payments/sale/1AB23456CD789012E',
      'https://api-m.sandbox.paypal.com/v1/payments/sale/1AB23456CD789012E/refund',
    ])
    const refund = calls[3]
    expect(refund.init.method).toBe('POST')
    expect(refund.init.headers?.['PayPal-Request-Id']).toBe('refund:1AB23456CD789012E:9.99')
    // v1 vocabulary, and NO custom_id / invoice_number: PayPal rejects a repeated
    // invoice number, which a retried refund would be.
    expect(bodyOf(refund)).toEqual({
      amount: { total: '9.99', currency: 'USD' },
      description: 'Requested by customer',
    })
    expect(result).toEqual({
      success: true,
      refundId: '5XY67890AB123456C',
      amount: 9.99,
      currency: 'USD',
      status: 'completed',
      error: '',
    })
  })

  it('omits the amount from a full sale refund', async () => {
    const calls = await withFetch(scriptPaypal([NOT_FOUND, SALE, SALE_REFUND]), async (seen) => {
      await run({})
      return seen
    })

    expect(bodyOf(calls[3])).toEqual({})
  })

  it('surfaces a probe that fails for any reason other than "not found"', async () => {
    // An expired token must not be reported as an unrecognised reference.
    const { calls, result } = await withFetch(
      scriptPaypal([{ status: 401, body: { message: 'Access Token expired' } }]),
      async (seen) => ({ calls: seen, result: await run({}) })
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/as a capture/)
    expect(result.error).toMatch(/Access Token expired/)
    expect(result.error).not.toMatch(/does not recognise/)
    expect(calls).toHaveLength(2)
  })

  it('still resolves an order to its completed capture after the sale probe misses', async () => {
    const order = {
      status: 200,
      body: {
        purchase_units: [
          {
            payments: {
              captures: [
                { id: 'CAP_PENDING', status: 'PENDING' },
                { id: 'CAP_DONE', status: 'COMPLETED' },
              ],
            },
          },
        ],
      },
    }
    const { calls, result } = await withFetch(
      scriptPaypal([NOT_FOUND, NOT_FOUND, order, CAPTURE_REFUND]),
      async (seen) => ({ calls: seen, result: await run({ paymentReference: 'ORDER1' }) })
    )

    expect(calls[3].url).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER1')
    expect(calls[4].url).toBe(
      'https://api-m.sandbox.paypal.com/v2/payments/captures/CAP_DONE/refund'
    )
    expect(result.success).toBe(true)
  })

  it('reports an unrecognised reference only once every probe says "not found"', async () => {
    const result = await withFetch(scriptPaypal([NOT_FOUND, NOT_FOUND, NOT_FOUND]), () => run({}))

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/does not recognise/)
  })

  it('sends the order id as custom_id on a capture refund only', async () => {
    const calls = await withFetch(scriptPaypal([CAPTURE, CAPTURE_REFUND]), async (seen) => {
      await run({ paymentReference: 'CAP1', amount: 9.99, orderId: 'order-1' })
      return seen
    })

    expect(calls[2].url).toBe('https://api-m.sandbox.paypal.com/v2/payments/captures/CAP1/refund')
    expect(bodyOf(calls[2])).toEqual({
      amount: { value: '9.99', currency_code: 'USD' },
      custom_id: JSON.stringify({ orderId: 'order-1' }),
    })
  })

  it('reports the amount in the currency the refund came back in', async () => {
    const jpyRefund = {
      status: 201,
      body: { id: 'R1', status: 'COMPLETED', amount: { value: '1200', currency_code: 'JPY' } },
    }
    const result = await withFetch(scriptPaypal([CAPTURE, jpyRefund]), () =>
      run({ paymentReference: 'CAP1', currency: 'usd' })
    )

    expect(result).toMatchObject({ success: true, amount: 1200, currency: 'JPY' })
  })

  it('refuses an amount below the smallest unit instead of sending a full refund', async () => {
    const { calls, usd, jpy } = await withFetch(scriptPaypal([CAPTURE, CAPTURE]), async (seen) => ({
      calls: seen,
      usd: await run({ paymentReference: 'CAP1', amount: 0.004, currency: 'usd' }),
      jpy: await run({ paymentReference: 'CAP1', amount: 0.4, currency: 'jpy' }),
    }))

    expect(usd.success).toBe(false)
    expect(usd.error).toBe('The amount is smaller than the smallest unit of USD.')
    expect(jpy.error).toBe('The amount is smaller than the smallest unit of JPY.')
    expect(refundPosts(calls)).toHaveLength(0)
  })

  it('treats a FAILED or CANCELLED refund as a failure on both APIs', async () => {
    const v2Failed = {
      status: 201,
      body: { id: 'R1', status: 'FAILED', amount: { value: '9.99', currency_code: 'USD' } },
    }
    const v2 = await withFetch(scriptPaypal([CAPTURE, v2Failed]), () =>
      run({ paymentReference: 'CAP1' })
    )
    expect(v2).toMatchObject({ success: false, refundId: 'R1', status: 'FAILED' })
    expect(v2.error).toBe('PayPal reported the refund as FAILED.')

    const v1Failed = {
      status: 200,
      body: { id: 'R2', state: 'failed', amount: { total: '9.99', currency: 'USD' } },
    }
    const v1 = await withFetch(scriptPaypal([NOT_FOUND, SALE, v1Failed]), () => run({}))
    expect(v1).toMatchObject({ success: false, refundId: 'R2', status: 'failed' })

    const v1Pending = {
      status: 200,
      body: { id: 'R3', state: 'pending', amount: { total: '9.99', currency: 'USD' } },
    }
    const pending = await withFetch(scriptPaypal([NOT_FOUND, SALE, v1Pending]), () => run({}))
    expect(pending).toMatchObject({ success: true, status: 'pending' })
  })
})
