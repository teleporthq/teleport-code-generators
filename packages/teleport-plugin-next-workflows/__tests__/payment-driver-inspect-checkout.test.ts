import { loadPaymentDrivers } from './_helpers/load-payment-drivers'
import { createFakeStripe } from './_helpers/fake-stripe'
import { FetchCall, FakeAnswer, withEnv, withFetch } from './_helpers/fake-fetch'

/**
 * `inspectCheckout` on every driver, EXECUTED against each provider's
 * documented answers: what became of a checkout the store opened earlier.
 * `open` carries the page the buyer can still pay on; `confirming` and `paid`
 * stop the store opening a second checkout; `closed` lets it; `error` means
 * the provider could not be asked, and nothing is opened.
 */

const inspect = (driver: any, reference: string) => driver.inspectCheckout({ reference })

const onlyGet =
  (routes: Record<string, FakeAnswer>, fallback: FakeAnswer = { status: 404, body: {} }) =>
  (call: FetchCall): FakeAnswer => {
    const match = Object.keys(routes).find((suffix) => call.url.endsWith(suffix))
    return match ? routes[match] : fallback
  }

describe('Stripe — Checkout Sessions', () => {
  const load = (session: unknown) => {
    const fake = createFakeStripe({
      'checkout.sessions.retrieve': () => {
        if (session instanceof Error) {
          throw session
        }
        return session
      },
    })
    return {
      stripe: loadPaymentDrivers({ ids: ['stripe'], stripe: fake.FakeStripe }).get('stripe'),
      calls: fake.calls,
    }
  }
  const KEY = { STRIPE_SECRET_KEY: 'sk_test_1' }

  it('maps each session status', async () => {
    const cases: Array<[unknown, unknown]> = [
      [
        { status: 'open', url: 'https://checkout.stripe.com/c/1' },
        { state: 'open', checkoutUrl: 'https://checkout.stripe.com/c/1' },
      ],
      [
        { status: 'complete', payment_status: 'paid' },
        { state: 'paid', checkoutUrl: '' },
      ],
      [
        { status: 'complete', payment_status: 'no_payment_required' },
        { state: 'paid', checkoutUrl: '' },
      ],
      // An asynchronous method (a bank debit, crypto) completed but not settled.
      [
        { status: 'complete', payment_status: 'unpaid' },
        { state: 'confirming', checkoutUrl: '' },
      ],
      [{ status: 'expired' }, { state: 'closed', checkoutUrl: '' }],
    ]
    for (const [session, expected] of cases) {
      const { stripe, calls } = load(session)
      expect(await withEnv(KEY, () => inspect(stripe, 'cs_test_1'))).toEqual(expected)
      expect(calls).toEqual([{ method: 'checkout.sessions.retrieve', params: 'cs_test_1' }])
    }
  })

  it('reads a session Stripe does not know, or a reference that is no session, as closed', async () => {
    const missing = Object.assign(new Error('No such checkout.session'), { statusCode: 404 })
    const { stripe } = load(missing)
    expect(await withEnv(KEY, () => inspect(stripe, 'cs_gone'))).toEqual({
      state: 'closed',
      checkoutUrl: '',
    })
    const { stripe: other, calls } = load({ status: 'open', url: 'x' })
    expect(await withEnv(KEY, () => inspect(other, 'pi_123'))).toEqual({
      state: 'closed',
      checkoutUrl: '',
    })
    expect(calls).toEqual([])
  })

  it('reports an outage as an error, never as closed', async () => {
    const { stripe } = load(Object.assign(new Error('Connection error'), { statusCode: 500 }))
    const result = await withEnv(KEY, () => inspect(stripe, 'cs_test_1'))
    expect(result.error).toBe('Connection error')
  })

  // A session an asynchronous method completed stays `unpaid` whether the
  // money settles or fails: its PaymentIntent is what says which.
  it('reads a completed unpaid session by its PaymentIntent', async () => {
    const cases: Array<[unknown, string]> = [
      ['processing', 'confirming'],
      // A bank transfer waiting for the buyer's money.
      ['requires_action', 'confirming'],
      ['requires_payment_method', 'closed'],
      ['canceled', 'closed'],
      ['succeeded', 'paid'],
    ]
    for (const [intentStatus, state] of cases) {
      const fake = createFakeStripe({
        'checkout.sessions.retrieve': () => ({
          status: 'complete',
          payment_status: 'unpaid',
          payment_intent: 'pi_1',
        }),
        'paymentIntents.retrieve': () => ({ id: 'pi_1', status: intentStatus }),
      })
      const driver = loadPaymentDrivers({ ids: ['stripe'], stripe: fake.FakeStripe }).get('stripe')
      expect(await withEnv(KEY, () => inspect(driver, 'cs_test_1'))).toEqual({
        state,
        checkoutUrl: '',
      })
      expect(fake.calls).toEqual([
        { method: 'checkout.sessions.retrieve', params: 'cs_test_1' },
        { method: 'paymentIntents.retrieve', params: 'pi_1' },
      ])
    }
    // An intent the session already carries expanded is read as it is.
    const { stripe, calls } = load({
      status: 'complete',
      payment_status: 'unpaid',
      payment_intent: { id: 'pi_1', status: 'requires_payment_method' },
    })
    expect((await withEnv(KEY, () => inspect(stripe, 'cs_test_1'))).state).toBe('closed')
    expect(calls.map((call) => call.method)).toEqual(['checkout.sessions.retrieve'])
  })

  it('reports an intent Stripe could not be asked about as an error', async () => {
    const fake = createFakeStripe({
      'checkout.sessions.retrieve': () => ({
        status: 'complete',
        payment_status: 'unpaid',
        payment_intent: 'pi_1',
      }),
      'paymentIntents.retrieve': () => {
        throw Object.assign(new Error('Connection error'), { statusCode: 500 })
      },
    })
    const stripe = loadPaymentDrivers({ ids: ['stripe'], stripe: fake.FakeStripe }).get('stripe')
    expect(await withEnv(KEY, () => inspect(stripe, 'cs_test_1'))).toEqual({
      state: '',
      checkoutUrl: '',
      error: 'Connection error',
    })
  })
})

describe('PayPal — orders', () => {
  const paypal = loadPaymentDrivers({ ids: ['paypal'] }).get('paypal')
  const ENV = { PAYPAL_CLIENT_ID: 'client-id-1', PAYPAL_CLIENT_SECRET: 'client-secret-1' }
  const token = { status: 200, body: { access_token: 'token' } }

  it('reopens an order nobody approved on its approval page', async () => {
    const result = await withEnv(ENV, () =>
      withFetch(
        onlyGet({
          '/v1/oauth2/token': token,
          '/v2/checkout/orders/ORDER-1': {
            status: 200,
            body: {
              id: 'ORDER-1',
              status: 'CREATED',
              links: [
                {
                  rel: 'approve',
                  href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1',
                },
              ],
            },
          },
        }),
        () => inspect(paypal, 'ORDER-1')
      )
    )
    expect(result).toEqual({
      state: 'open',
      checkoutUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1',
    })
  })

  it('captures an approved order it finds uncaptured, and opens nothing beside it', async () => {
    const result = await withEnv(ENV, () =>
      withFetch(
        onlyGet({
          '/v1/oauth2/token': token,
          '/v2/checkout/orders/ORDER-1/capture': { status: 201, body: { status: 'COMPLETED' } },
          '/v2/checkout/orders/ORDER-1': {
            status: 200,
            body: { id: 'ORDER-1', status: 'APPROVED' },
          },
        }),
        async (calls) => {
          const answer = await inspect(paypal, 'ORDER-1')
          expect(
            calls.map((call) => call.method + ' ' + call.url.replace(/^https:\/\/[^/]+/, ''))
          ).toEqual([
            'POST /v1/oauth2/token',
            'GET /v2/checkout/orders/ORDER-1',
            'POST /v1/oauth2/token',
            // The capture reads the order first: one the store closed is never captured.
            'GET /v2/checkout/orders/ORDER-1',
            'POST /v2/checkout/orders/ORDER-1/capture',
          ])
          return answer
        }
      )
    )
    expect(result).toEqual({ state: 'confirming', checkoutUrl: '' })
  })

  // PayPal completes an order whose capture it declined too: the capture says
  // whether the money moved.
  const completed = (...captureStatuses: string[]): FakeAnswer => ({
    status: 200,
    body: {
      status: 'COMPLETED',
      purchase_units: [
        {
          payments: {
            captures: captureStatuses.map((status, i) => ({ id: 'CAP-' + i, status })),
          },
        },
      ],
    },
  })

  it('reads a completed order by its capture, voided or forgotten as closed', async () => {
    const answers: Array<[FakeAnswer, string]> = [
      [completed('COMPLETED'), 'paid'],
      [completed('PARTIALLY_REFUNDED'), 'paid'],
      [completed('REFUNDED'), 'paid'],
      // Held for review: the money is on its way.
      [completed('PENDING'), 'confirming'],
      // Declined: a completed order is never captured again.
      [completed('DECLINED'), 'closed'],
      [completed('FAILED'), 'closed'],
      [completed('DECLINED', 'COMPLETED'), 'paid'],
      // No capture to read: neither paid nor a second checkout.
      [{ status: 200, body: { status: 'COMPLETED' } }, 'confirming'],
      [{ status: 200, body: { status: 'VOIDED' } }, 'closed'],
      [{ status: 404, body: { name: 'RESOURCE_NOT_FOUND' } }, 'closed'],
    ]
    for (const [order, state] of answers) {
      const result = await withEnv(ENV, () =>
        withFetch(
          onlyGet({ '/v1/oauth2/token': token, '/v2/checkout/orders/ORDER-9': order }),
          () => inspect(paypal, 'ORDER-9')
        )
      )
      expect(result).toEqual({ state, checkoutUrl: '' })
    }
  })

  // An APPROVED order captured now, answered by what the capture did.
  const captureOf = (capture: FakeAnswer, routes: Array<[string, FakeAnswer]> = []) =>
    withEnv(ENV, () =>
      withFetch(
        (call) => {
          const path = call.url.replace(/^https:\/\/[^/]+/, '')
          const extra = routes.find(([route]) => call.method + ' ' + path === route)
          if (extra) {
            return extra[1]
          }
          if (path === '/v1/oauth2/token') {
            return token
          }
          if (path === '/v2/checkout/orders/ORDER-1/capture') {
            return capture
          }
          if (call.method === 'GET' && path === '/v2/checkout/orders/ORDER-1') {
            return {
              status: 200,
              body: {
                id: 'ORDER-1',
                status: 'APPROVED',
                purchase_units: [{ reference_id: 'default', custom_id: '{"orderId":"o-1"}' }],
              },
            }
          }
          return { status: 404, body: {} }
        },
        async (calls) => ({ result: await inspect(paypal, 'ORDER-1'), calls })
      )
    )
  const refusal = (status: number, issue: string, links: unknown[] = []): FakeAnswer => ({
    status,
    body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue, description: issue }], links },
  })

  it('asks for the whole order back, and reads a declined capture as closed and a held one as confirming', async () => {
    const declined = await captureOf(completed('DECLINED'))
    expect(declined.result).toEqual({ state: 'closed', checkoutUrl: '' })
    const capture = declined.calls.find((call) => call.url.endsWith('/capture'))!
    expect(capture.headers.Prefer).toBe('return=representation')
    expect(declined.calls.some((call) => call.method === 'PATCH')).toBe(false)
    expect((await captureOf(completed('PENDING'))).result).toEqual({
      state: 'confirming',
      checkoutUrl: '',
    })
  })

  it('sends the buyer back to the SAME order when the refusal is theirs to fix', async () => {
    for (const issue of ['INSTRUMENT_DECLINED', 'REDIRECT_PAYER_FOR_ALTERNATE_FUNDING']) {
      const { result, calls } = await captureOf(refusal(422, issue))
      expect(result).toEqual({
        state: 'open',
        checkoutUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1',
      })
      // Nothing is closed: the buyer pays this order.
      expect(calls.some((call) => call.method === 'PATCH')).toBe(false)
    }
    const payerAction = await captureOf(
      refusal(422, 'PAYER_ACTION_REQUIRED', [
        {
          rel: 'payer-action',
          href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1&3ds=1',
        },
      ])
    )
    expect(payerAction.result).toEqual({
      state: 'open',
      checkoutUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1&3ds=1',
    })
  })

  it('closes an order whose capture PayPal refused for good before answering closed', async () => {
    const { result, calls } = await captureOf(refusal(422, 'TRANSACTION_REFUSED'), [
      ['PATCH /v2/checkout/orders/ORDER-1', { status: 204, body: null }],
    ])
    expect(result).toEqual({ state: 'closed', checkoutUrl: '' })
    const patch = calls.find((call) => call.method === 'PATCH')!
    expect(patch.json).toEqual([
      {
        op: 'replace',
        path: "/purchase_units/@reference_id=='default'/custom_id",
        value: '{"orderId":"o-1","closed":true}',
      },
    ])
  })

  it('opens nothing beside an order it could neither capture nor close', async () => {
    const { result } = await captureOf(refusal(422, 'TRANSACTION_REFUSED'), [
      ['PATCH /v2/checkout/orders/ORDER-1', refusal(422, 'ORDER_COMPLETED_OR_VOIDED')],
    ])
    expect(result.state).toBe('')
    expect(result.error).toMatch(/refused to capture order ORDER-1 \(TRANSACTION_REFUSED\)/)
  })

  it('asks again after an outage, a request in progress or a rate limit, closing nothing', async () => {
    for (const status of [503, 409, 429]) {
      const { result, calls } = await captureOf({ status, body: { message: 'Try later' } })
      expect(result).toEqual({ state: '', checkoutUrl: '', error: 'Try later' })
      expect(calls.some((call) => call.method === 'PATCH')).toBe(false)
    }
  })
})

describe('Mollie — payments', () => {
  const mollie = loadPaymentDrivers({ ids: ['mollie'] }).get('mollie')
  const ENV = { MOLLIE_API_KEY: 'test_key' }
  const payment = (body: unknown, status = 200) =>
    withEnv(ENV, () =>
      withFetch(onlyGet({ '/v2/payments/tr_1': { status, body } }), () => inspect(mollie, 'tr_1'))
    )

  it('maps each payment status', async () => {
    expect(
      await payment({
        status: 'open',
        _links: { checkout: { href: 'https://www.mollie.com/checkout/1' } },
      })
    ).toEqual({ state: 'open', checkoutUrl: 'https://www.mollie.com/checkout/1' })
    // Open with no page of its own: the money may already be on its way.
    expect(await payment({ status: 'open', _links: {} })).toEqual({
      state: 'confirming',
      checkoutUrl: '',
    })
    expect(await payment({ status: 'pending' })).toEqual({ state: 'confirming', checkoutUrl: '' })
    expect(await payment({ status: 'authorized' })).toEqual({
      state: 'confirming',
      checkoutUrl: '',
    })
    expect(await payment({ status: 'paid' })).toEqual({ state: 'paid', checkoutUrl: '' })
    for (const closed of ['canceled', 'expired', 'failed']) {
      expect(await payment({ status: closed })).toEqual({ state: 'closed', checkoutUrl: '' })
    }
    expect(await payment({ status: 404, title: 'Not Found' }, 404)).toEqual({
      state: 'closed',
      checkoutUrl: '',
    })
    expect((await payment({ title: 'Unavailable', detail: 'Try later' }, 503)).error).toBe(
      'Try later'
    )
  })
})

describe('Razorpay — payment links', () => {
  const razorpay = loadPaymentDrivers({ ids: ['razorpay'] }).get('razorpay')
  const ENV = { RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'secret' }
  const link = (body: unknown, status = 200) =>
    withEnv(ENV, () =>
      withFetch(onlyGet({ '/v1/payment_links/plink_1': { status, body } }), () =>
        inspect(razorpay, 'plink_1')
      )
    )

  it('maps each link status', async () => {
    expect(await link({ status: 'created', short_url: 'https://rzp.io/i/1' })).toEqual({
      state: 'open',
      checkoutUrl: 'https://rzp.io/i/1',
    })
    expect(await link({ status: 'paid' })).toEqual({ state: 'paid', checkoutUrl: '' })
    expect(await link({ status: 'expired' })).toEqual({ state: 'closed', checkoutUrl: '' })
    expect(await link({ status: 'cancelled' })).toEqual({ state: 'closed', checkoutUrl: '' })
    expect(
      await link(
        { error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' } },
        400
      )
    ).toEqual({ state: 'closed', checkoutUrl: '' })
    expect((await link({ error: { description: 'Server error' } }, 500)).error).toBe('Server error')
  })
})

describe('Square — order and payment link', () => {
  const square = loadPaymentDrivers({ ids: ['square'] }).get('square')
  const ENV = { SQUARE_ACCESS_TOKEN: 'EAAA-token' }
  const PRODUCTION = 'https://connect.squareup.com'
  const run = (
    order: FakeAnswer,
    link: FakeAnswer = { status: 404, body: {} },
    reference = 'SQO:PL1',
    payment: FakeAnswer = { status: 500, body: {} }
  ) =>
    withEnv(ENV, () =>
      withFetch(
        (call) => {
          if (call.url === PRODUCTION + '/v2/locations') {
            return { status: 200, body: { locations: [] } }
          }
          if (call.url === PRODUCTION + '/v2/orders/SQO') {
            return order
          }
          if (call.url === PRODUCTION + '/v2/online-checkout/payment-links/PL1') {
            return link
          }
          if (call.url === PRODUCTION + '/v2/payments/PAY1') {
            return payment
          }
          return { status: 500, body: {} }
        },
        () => inspect(square, reference)
      )
    )

  it('reopens an open order nobody paid on its link page', async () => {
    expect(
      await run(
        { status: 200, body: { order: { id: 'SQO', state: 'OPEN' } } },
        { status: 200, body: { payment_link: { id: 'PL1', url: 'https://square.link/u/1' } } }
      )
    ).toEqual({ state: 'open', checkoutUrl: 'https://square.link/u/1' })
  })

  it('reads a paid payment-link order, which Square leaves OPEN, by its tender payment', async () => {
    const tendered = {
      status: 200,
      body: { order: { state: 'OPEN', tenders: [{ id: 'T1', payment_id: 'PAY1' }] } },
    }
    const paymentIs = (status: string): FakeAnswer => ({
      status: 200,
      body: { payment: { id: 'PAY1', status } },
    })
    expect(await run(tendered, undefined, 'SQO:PL1', paymentIs('COMPLETED'))).toEqual({
      state: 'paid',
      checkoutUrl: '',
    })
    for (const status of ['APPROVED', 'PENDING']) {
      expect(await run(tendered, undefined, 'SQO:PL1', paymentIs(status))).toEqual({
        state: 'confirming',
        checkoutUrl: '',
      })
    }
    // A failed payment took nothing: the link still takes money.
    expect(
      await run(
        tendered,
        { status: 200, body: { payment_link: { id: 'PL1', url: 'https://square.link/u/1' } } },
        'SQO:PL1',
        paymentIs('FAILED')
      )
    ).toEqual({ state: 'open', checkoutUrl: 'https://square.link/u/1' })
    // An order that owes nothing is paid without asking about its payments.
    expect(
      await run({
        status: 200,
        body: {
          order: {
            state: 'OPEN',
            tenders: [{ id: 'T1', payment_id: 'PAY1' }],
            net_amount_due_money: { amount: 0, currency: 'USD' },
          },
        },
      })
    ).toEqual({ state: 'paid', checkoutUrl: '' })
    // A payment Square could not be asked about is an error, never a guess.
    expect((await run(tendered)).state).toBe('')
  })

  it('reads completed as paid, cancelled or unknown as closed', async () => {
    expect(await run({ status: 200, body: { order: { state: 'COMPLETED' } } })).toEqual({
      state: 'paid',
      checkoutUrl: '',
    })
    expect(await run({ status: 200, body: { order: { state: 'CANCELED' } } })).toEqual({
      state: 'closed',
      checkoutUrl: '',
    })
    expect(await run({ status: 404, body: { errors: [{ code: 'NOT_FOUND' }] } })).toEqual({
      state: 'closed',
      checkoutUrl: '',
    })
    // A reference recorded without its link cannot be reopened.
    expect(
      await run({ status: 200, body: { order: { state: 'OPEN' } } }, undefined, 'SQO')
    ).toEqual({
      state: 'closed',
      checkoutUrl: '',
    })
  })

  it('keys a checkout opened after an earlier one on that earlier one', async () => {
    const bodies: any[] = []
    await withEnv(ENV, () =>
      withFetch(
        (call) => {
          if (call.url === PRODUCTION + '/v2/locations') {
            return { status: 200, body: { locations: [] } }
          }
          if (call.url.endsWith('/v2/locations/main')) {
            return { status: 200, body: { location: { id: 'L1', currency: 'USD' } } }
          }
          bodies.push(call.json)
          return {
            status: 200,
            body: { payment_link: { id: 'PL2', url: 'https://square.link/u/2', order_id: 'SQO2' } },
          }
        },
        async () => {
          await square.createCheckout({
            amount: 5,
            currency: 'USD',
            metadata: { orderId: 'order-1' },
          })
          await square.createCheckout({
            amount: 5,
            currency: 'USD',
            metadata: { orderId: 'order-1' },
            previousAttempt: 'SQO:PL1',
          })
        }
      )
    )
    expect(bodies.map((body) => body.idempotency_key)).toEqual([
      'link:order-1',
      'link:order-1:SQO:PL1',
    ])
  })
})

describe('Paddle — transactions', () => {
  const paddle = loadPaymentDrivers({ ids: ['paddle'] }).get('paddle')
  const ENV = { PADDLE_API_KEY: 'pdl_sdbx_apikey_1', PADDLE_CLIENT_TOKEN: 'test_client_1' }
  const transaction = (data: unknown, status = 200) =>
    withEnv(ENV, () =>
      withFetch(onlyGet({ '/transactions/txn_01': { status, body: { data } } }), () =>
        inspect(paddle, 'txn_01')
      )
    )

  it('maps each transaction status', async () => {
    const page = { url: 'https://shop.test/pay/paddle?_ptxn=txn_01' }
    for (const open of ['draft', 'ready']) {
      expect(await transaction({ status: open, checkout: page })).toEqual({
        state: 'open',
        checkoutUrl: page.url,
      })
    }
    expect(await transaction({ status: 'billed' })).toEqual({
      state: 'confirming',
      checkoutUrl: '',
    })
    expect(await transaction({ status: 'paid' })).toEqual({ state: 'paid', checkoutUrl: '' })
    expect(await transaction({ status: 'completed' })).toEqual({ state: 'paid', checkoutUrl: '' })
    expect(await transaction({ status: 'canceled' })).toEqual({ state: 'closed', checkoutUrl: '' })
    expect(await transaction({}, 404)).toEqual({ state: 'closed', checkoutUrl: '' })
  })
})

describe('CoinGate — invoices', () => {
  const coingate = loadPaymentDrivers({ ids: ['coingate'] }).get('coingate')
  const ENV = { COINGATE_API_TOKEN: 'token-1' }
  const order = (body: unknown, status = 200) =>
    withEnv(ENV, () =>
      withFetch(
        onlyGet({
          '/auth/test': { status: 200, body: 'OK' },
          '/orders/123': { status, body },
        }),
        () => inspect(coingate, '123')
      )
    )

  it('maps each invoice status', async () => {
    for (const open of ['new', 'pending']) {
      expect(await order({ status: open, payment_url: 'https://coingate.com/invoice/1' })).toEqual({
        state: 'open',
        checkoutUrl: 'https://coingate.com/invoice/1',
      })
    }
    expect(await order({ status: 'confirming' })).toEqual({ state: 'confirming', checkoutUrl: '' })
    for (const paid of ['paid', 'refunded', 'partially_refunded']) {
      expect(await order({ status: paid })).toEqual({ state: 'paid', checkoutUrl: '' })
    }
    for (const closed of ['invalid', 'expired', 'canceled']) {
      expect(await order({ status: closed })).toEqual({ state: 'closed', checkoutUrl: '' })
    }
    expect(await order({ message: 'Order not found' }, 404)).toEqual({
      state: 'closed',
      checkoutUrl: '',
    })
  })

  it('reads a reference that is no CoinGate order id as closed without asking', async () => {
    await withEnv(ENV, () =>
      withFetch(
        () => ({ status: 500, body: {} }),
        async (calls) => {
          expect(await inspect(coingate, 'continued-payment')).toEqual({
            state: 'closed',
            checkoutUrl: '',
          })
          expect(calls).toEqual([])
        }
      )
    )
  })
})
