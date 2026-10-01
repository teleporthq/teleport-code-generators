import { loadPaymentDrivers } from './_helpers/load-payment-drivers'
import { createFakeStripe } from './_helpers/fake-stripe'
import { FetchCall, FakeAnswer, withEnv, withFetch } from './_helpers/fake-fetch'

/**
 * `closeCheckout` and `findCheckouts` on every driver, and the composition
 * that closes every checkout an order has open (`core.closeOrderCheckouts`),
 * EXECUTED against each provider's documented answers.
 *
 * Closing is what stops a page the store opened from taking an order's money
 * once the order is settled or cancelled another way: `closed` means the page
 * takes no more money, `paid` / `confirming` that it took (or is taking) it,
 * `open` that the provider cannot close it early (with when it runs out), and
 * an `error` that the provider could not be asked.
 */

const PLACED_AT = '2026-09-28T10:00:00.000Z'
const PLACED_MS = Date.parse(PLACED_AT)

const route =
  (routes: Array<[string, string, FakeAnswer]>, fallback: FakeAnswer = { status: 404, body: {} }) =>
  (call: FetchCall): FakeAnswer => {
    const match = routes.find(
      ([method, path]) =>
        call.method === method && call.url.replace(/^https:\/\/[^/]+/, '').startsWith(path)
    )
    return match ? match[2] : fallback
  }

const trail = (calls: FetchCall[]) =>
  calls.map((call) => call.method + ' ' + call.url.replace(/^https:\/\/[^/]+/, ''))

describe('core.closeOrderCheckouts', () => {
  const { core } = loadPaymentDrivers({ ids: [] })
  const fakeDriver = (
    states: Record<string, unknown>,
    found: unknown = { references: Object.keys(states) }
  ) => {
    const closed: string[] = []
    return {
      closed,
      driver: {
        closeCheckout: async ({ reference }: { reference: string }) => {
          closed.push(reference)
          return states[reference]
        },
        findCheckouts: async () => found,
      },
    }
  }

  it('closes the checkout the order recorded, without searching', async () => {
    const { driver, closed } = fakeDriver(
      { cs_1: { state: 'closed' } },
      { error: 'never searched' }
    )
    expect(await core.closeOrderCheckouts(driver, { reference: 'cs_1' })).toEqual({
      outcome: 'closed',
      openUntil: '',
      checkoutUrl: '',
      reference: '',
    })
    expect(closed).toEqual(['cs_1'])
  })

  it('closes every checkout the provider finds for an order that recorded none', async () => {
    const { driver, closed } = fakeDriver({
      a: { state: 'closed' },
      b: { state: 'closed' },
    })
    const result = await core.closeOrderCheckouts(driver, { orderId: 'o-1', placedAt: PLACED_AT })
    expect(result.outcome).toBe('closed')
    expect(closed).toEqual(['a', 'b'])
  })

  it('answers none when the provider finds nothing', async () => {
    const { driver } = fakeDriver({}, { references: [] })
    expect(
      (await core.closeOrderCheckouts(driver, { orderId: 'o-1', placedAt: PLACED_AT })).outcome
    ).toBe('none')
  })

  it('answers the most binding state: paid over confirming over open over closed', async () => {
    const { driver } = fakeDriver({
      a: { state: 'open', openUntil: '2026-09-28T11:00:00.000Z', checkoutUrl: 'https://pay/a' },
      b: { state: 'paid' },
      c: { state: 'closed' },
    })
    expect(
      (await core.closeOrderCheckouts(driver, { orderId: 'o-1', placedAt: PLACED_AT })).outcome
    ).toBe('paid')
  })

  it('keeps the latest time an uncloseable page runs out, and the page to reopen', async () => {
    const { driver } = fakeDriver({
      a: { state: 'open', openUntil: '2026-09-28T11:00:00.000Z', checkoutUrl: 'https://pay/a' },
      b: { state: 'open', openUntil: '2026-09-28T12:00:00.000Z', checkoutUrl: '' },
    })
    expect(await core.closeOrderCheckouts(driver, { orderId: 'o-1', placedAt: PLACED_AT })).toEqual(
      {
        outcome: 'open',
        openUntil: '2026-09-28T12:00:00.000Z',
        checkoutUrl: 'https://pay/a',
        reference: 'a',
      }
    )
  })

  it('never names a time when one open page runs out at a time nobody knows', async () => {
    const { driver } = fakeDriver({
      a: { state: 'open', openUntil: '2026-09-28T11:00:00.000Z' },
      b: { state: 'open', openUntil: '' },
    })
    expect(
      (await core.closeOrderCheckouts(driver, { orderId: 'o-1', placedAt: PLACED_AT })).openUntil
    ).toBe('')
  })

  it('reports a provider that could not be asked as an error, never as closed', async () => {
    const { driver } = fakeDriver({
      a: { state: 'closed' },
      b: { state: '', error: 'Stripe is down' },
    })
    expect(await core.closeOrderCheckouts(driver, { orderId: 'o-1', placedAt: PLACED_AT })).toEqual(
      {
        outcome: '',
        openUntil: '',
        checkoutUrl: '',
        error: 'Stripe is down',
      }
    )
    const { driver: unsearchable } = fakeDriver({}, { error: 'search failed' })
    expect(
      (await core.closeOrderCheckouts(unsearchable, { orderId: 'o-1', placedAt: PLACED_AT })).error
    ).toBe('search failed')
  })

  it('waits out a provider that cannot be searched until its pages have run out', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const { driver } = fakeDriver({}, { searchable: false, openUntil: future })
    expect(await core.closeOrderCheckouts(driver, { orderId: 'o-1', placedAt: PLACED_AT })).toEqual(
      {
        outcome: 'open',
        openUntil: future,
        checkoutUrl: '',
      }
    )
    const { driver: expired } = fakeDriver({}, { searchable: false, openUntil: PLACED_AT })
    expect(
      (await core.closeOrderCheckouts(expired, { orderId: 'o-1', placedAt: PLACED_AT })).outcome
    ).toBe('none')
  })

  it('searches around the time the order was placed', () => {
    expect(core.searchWindow(PLACED_AT)).toEqual({
      from: PLACED_MS - 10 * 60 * 1000,
      to: PLACED_MS + 60 * 60 * 1000,
    })
    expect(core.searchWindow('')).toBeNull()
  })
})

describe('Stripe', () => {
  const KEY = { STRIPE_SECRET_KEY: 'sk_test_1' }
  const load = (script: Record<string, (params: any) => unknown>) => {
    const fake = createFakeStripe(script)
    return {
      stripe: loadPaymentDrivers({ ids: ['stripe'], stripe: fake.FakeStripe }).get('stripe'),
      calls: fake.calls,
    }
  }

  it('expires an open session', async () => {
    const { stripe, calls } = load({
      'checkout.sessions.retrieve': () => ({
        status: 'open',
        url: 'https://checkout.stripe.com/c/1',
      }),
      'checkout.sessions.expire': () => ({ status: 'expired' }),
    })
    expect(await withEnv(KEY, () => stripe.closeCheckout({ reference: 'cs_1' }))).toEqual({
      state: 'closed',
      checkoutUrl: '',
      openUntil: '',
    })
    expect(calls.map((call) => call.method)).toEqual([
      'checkout.sessions.retrieve',
      'checkout.sessions.expire',
    ])
  })

  it('leaves a completed session alone and answers what it took', async () => {
    for (const [session, state] of [
      [{ status: 'complete', payment_status: 'paid' }, 'paid'],
      [{ status: 'complete', payment_status: 'unpaid' }, 'confirming'],
    ] as const) {
      const { stripe, calls } = load({ 'checkout.sessions.retrieve': () => session })
      expect((await withEnv(KEY, () => stripe.closeCheckout({ reference: 'cs_1' }))).state).toBe(
        state
      )
      expect(calls.map((call) => call.method)).toEqual(['checkout.sessions.retrieve'])
    }
  })

  it('reads a completed unpaid session by its PaymentIntent, failed as closed', async () => {
    for (const [intentStatus, state] of [
      ['processing', 'confirming'],
      ['requires_payment_method', 'closed'],
      ['canceled', 'closed'],
      ['succeeded', 'paid'],
    ]) {
      const { stripe, calls } = load({
        'checkout.sessions.retrieve': () => ({
          status: 'complete',
          payment_status: 'unpaid',
          payment_intent: 'pi_1',
        }),
        'paymentIntents.retrieve': () => ({ id: 'pi_1', status: intentStatus }),
      })
      expect((await withEnv(KEY, () => stripe.closeCheckout({ reference: 'cs_1' }))).state).toBe(
        state
      )
      expect(calls.map((call) => call.method)).toEqual([
        'checkout.sessions.retrieve',
        'paymentIntents.retrieve',
      ])
    }
  })

  it('answers a session the buyer finished paying between the read and the expiry as paid', async () => {
    let reads = 0
    const { stripe } = load({
      'checkout.sessions.retrieve': () =>
        reads++ === 0
          ? { status: 'open', url: 'https://x' }
          : { status: 'complete', payment_status: 'paid' },
      'checkout.sessions.expire': () => {
        throw new Error('Only Checkout Sessions with a status of open can be expired.')
      },
    })
    expect((await withEnv(KEY, () => stripe.closeCheckout({ reference: 'cs_1' }))).state).toBe(
      'paid'
    )
  })

  it('finds the sessions opened for an order around the time it was placed', async () => {
    const pages = [
      {
        data: [
          { id: 'cs_a', metadata: { orderId: 'o-1' } },
          { id: 'cs_b', metadata: { orderId: 'o-2' } },
        ],
        has_more: true,
      },
      { data: [{ id: 'cs_c', metadata: { orderId: 'o-1' } }], has_more: false },
    ]
    let page = 0
    const { stripe, calls } = load({ 'checkout.sessions.list': () => pages[page++] })
    expect(
      await withEnv(KEY, () => stripe.findCheckouts({ orderId: 'o-1', placedAt: PLACED_AT }))
    ).toEqual({ references: ['cs_a', 'cs_c'] })
    expect(calls[0].params).toEqual({
      created: { gte: PLACED_MS / 1000 - 600, lte: PLACED_MS / 1000 + 3600 },
      limit: 100,
    })
    expect((calls[1].params as { starting_after: string }).starting_after).toBe('cs_b')
  })

  it('refuses a search that would need more pages than it reads', async () => {
    const { stripe } = load({
      'checkout.sessions.list': () => ({ data: [{ id: 'cs_x', metadata: {} }], has_more: true }),
    })
    const result = await withEnv(KEY, () =>
      stripe.findCheckouts({ orderId: 'o-1', placedAt: PLACED_AT })
    )
    expect(result.error).toMatch(/more checkouts/)
  })
})

describe('PayPal', () => {
  const paypal = loadPaymentDrivers({ ids: ['paypal'] }).get('paypal')
  const ENV = { PAYPAL_CLIENT_ID: 'client-id-1', PAYPAL_CLIENT_SECRET: 'client-secret-1' }
  const token: [string, string, FakeAnswer] = [
    'POST',
    '/v1/oauth2/token',
    { status: 200, body: { access_token: 'token' } },
  ]
  const order = (body: Record<string, unknown>): [string, string, FakeAnswer] => [
    'GET',
    '/v2/checkout/orders/ORDER-1',
    { status: 200, body: { id: 'ORDER-1', ...body } },
  ]
  const CUSTOM_ID = JSON.stringify({ orderId: 'o-1', orderNumber: 'ORD-1' })

  it('marks an order nobody approved closed, keeping the store order it names', async () => {
    await withEnv(ENV, () =>
      withFetch(
        route([
          token,
          order({
            status: 'CREATED',
            purchase_units: [{ reference_id: 'default', custom_id: CUSTOM_ID }],
          }),
          ['PATCH', '/v2/checkout/orders/ORDER-1', { status: 204, body: null }],
        ]),
        async (calls) => {
          expect(await paypal.closeCheckout({ reference: 'ORDER-1' })).toEqual({
            state: 'closed',
            checkoutUrl: '',
            openUntil: '',
          })
          const patch = calls.find((call) => call.method === 'PATCH')!
          expect(patch.json).toEqual([
            {
              op: 'replace',
              path: "/purchase_units/@reference_id=='default'/custom_id",
              value: JSON.stringify({ orderId: 'o-1', orderNumber: 'ORD-1', closed: true }),
            },
          ])
        }
      )
    )
  })

  it('adds the mark to an order that carried no custom id', async () => {
    await withEnv(ENV, () =>
      withFetch(
        route([
          token,
          order({ status: 'CREATED', purchase_units: [{}] }),
          ['PATCH', '/v2/checkout/orders/ORDER-1', { status: 204, body: null }],
        ]),
        async (calls) => {
          await paypal.closeCheckout({ reference: 'ORDER-1' })
          expect(calls.find((call) => call.method === 'PATCH')!.json[0].op).toBe('add')
        }
      )
    )
  })

  it('answers a completed order by its capture, marking nothing', async () => {
    const captured = (captureStatus: string) => ({
      status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: captureStatus }] } }],
    })
    for (const [body, state] of [
      [captured('COMPLETED'), 'paid'],
      [captured('PENDING'), 'confirming'],
      // PayPal completes an order whose capture it declined: no money moved.
      [captured('DECLINED'), 'closed'],
      [{ status: 'COMPLETED' }, 'confirming'],
      [{ status: 'VOIDED' }, 'closed'],
    ] as const) {
      await withEnv(ENV, () =>
        withFetch(route([token, order(body)]), async (calls) => {
          expect((await paypal.closeCheckout({ reference: 'ORDER-1' })).state).toBe(state)
          expect(calls.some((call) => call.method === 'PATCH')).toBe(false)
        })
      )
    }
  })

  // A buyer who approved on PayPal's page but whose capture never ran must not
  // be able to pay once the merchant settled or cancelled the order.
  it('marks an order the buyer approved but the store never captured closed, so no capture takes it', async () => {
    let marked: unknown = null
    const approved = () => ({
      id: 'ORDER-1',
      status: 'APPROVED',
      purchase_units: [
        { reference_id: 'default', custom_id: marked ? (marked as string) : CUSTOM_ID },
      ],
    })
    await withEnv(ENV, () =>
      withFetch(
        (call) => {
          const path = call.url.replace(/^https:\/\/[^/]+/, '')
          if (path === '/v1/oauth2/token') {
            return { status: 200, body: { access_token: 'token' } }
          }
          if (call.method === 'PATCH' && path === '/v2/checkout/orders/ORDER-1') {
            marked = call.json[0].value
            return { status: 204, body: null }
          }
          if (call.method === 'GET' && path === '/v2/checkout/orders/ORDER-1') {
            return { status: 200, body: approved() }
          }
          return { status: 500, body: {} }
        },
        async (calls) => {
          expect(await paypal.closeCheckout({ reference: 'ORDER-1' })).toEqual({
            state: 'closed',
            checkoutUrl: '',
            openUntil: '',
          })
          expect(marked).toBe(
            JSON.stringify({ orderId: 'o-1', orderNumber: 'ORD-1', closed: true })
          )
          // The buyer's return, or the approval webhook, arrives late: refused.
          expect(await paypal.confirmReturn({ query: { token: 'ORDER-1' } })).toMatchObject({
            ok: false,
            retryable: false,
            closed: true,
          })
          expect(calls.some((call) => call.url.endsWith('/capture'))).toBe(false)
        }
      )
    )
  })

  it('never answers closed for an approved order PayPal would not let it mark', async () => {
    const approved = {
      status: 'APPROVED',
      purchase_units: [{ reference_id: 'default', custom_id: CUSTOM_ID }],
    }
    const refusal: [string, string, FakeAnswer] = [
      'PATCH',
      '/v2/checkout/orders/ORDER-1',
      { status: 422, body: { details: [{ issue: 'UNPROCESSABLE_ENTITY' }] } },
    ]
    await withEnv(ENV, () =>
      withFetch(route([token, order(approved), refusal]), async () => {
        expect(await paypal.closeCheckout({ reference: 'ORDER-1' })).toEqual({
          state: '',
          error: 'UNPROCESSABLE_ENTITY',
        })
      })
    )
  })

  it('leaves an order waiting on a step at PayPal open until it runs out when PayPal refuses the mark', async () => {
    const waiting = {
      status: 'PAYER_ACTION_REQUIRED',
      create_time: PLACED_AT,
      purchase_units: [{ reference_id: 'default', custom_id: CUSTOM_ID }],
      links: [
        { rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1' },
      ],
    }
    await withEnv(ENV, () =>
      withFetch(
        route([
          token,
          order(waiting),
          [
            'PATCH',
            '/v2/checkout/orders/ORDER-1',
            { status: 422, body: { name: 'UNPROCESSABLE_ENTITY' } },
          ],
        ]),
        async () => {
          expect(await paypal.closeCheckout({ reference: 'ORDER-1' })).toEqual({
            state: 'open',
            checkoutUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1',
            openUntil: new Date(PLACED_MS + 78 * 60 * 60 * 1000).toISOString(),
          })
        }
      )
    )
  })

  it('never captures an order the store closed, nor reopens it', async () => {
    const closedOrder = order({
      status: 'APPROVED',
      purchase_units: [{ custom_id: JSON.stringify({ orderId: 'o-1', closed: true }) }],
    })
    await withEnv(ENV, () =>
      withFetch(route([token, closedOrder]), async (calls) => {
        const capture = await paypal.confirmReturn({ query: { token: 'ORDER-1' } })
        expect(capture).toMatchObject({ handled: true, ok: false, retryable: false, closed: true })
        expect(calls.some((call) => call.url.endsWith('/capture'))).toBe(false)
        expect(await paypal.inspectCheckout({ reference: 'ORDER-1' })).toEqual({
          state: 'closed',
          checkoutUrl: '',
        })
      })
    )
  })

  // PayPal cancels only an ACTIVE or SUSPENDED subscription.
  it('says how long the page of a subscription nobody approved may stay open, cancelling nothing', async () => {
    await withEnv(ENV, () =>
      withFetch(
        route([
          token,
          [
            'GET',
            '/v1/billing/subscriptions/I-1',
            {
              status: 200,
              body: { id: 'I-1', status: 'APPROVAL_PENDING', create_time: PLACED_AT },
            },
          ],
        ]),
        async (calls) => {
          expect(await paypal.closeCheckout({ reference: 'I-1' })).toEqual({
            state: 'open',
            checkoutUrl: '',
            openUntil: new Date(PLACED_MS + 78 * 60 * 60 * 1000).toISOString(),
          })
          expect(trail(calls)).toEqual([
            'POST /v1/oauth2/token',
            'GET /v1/billing/subscriptions/I-1',
          ])
        }
      )
    )
  })

  // 6 hours to send the buyer (up to 72 on some accounts), then 6 to approve and capture.
  it('cannot be searched: the order placed is waited out for the longest a PayPal order lives', async () => {
    expect(await paypal.findCheckouts({ orderId: 'o-1', placedAt: PLACED_AT })).toEqual({
      searchable: false,
      openUntil: new Date(PLACED_MS + 78 * 60 * 60 * 1000).toISOString(),
    })
  })
})

describe('Mollie', () => {
  const mollie = loadPaymentDrivers({ ids: ['mollie'] }).get('mollie')
  const ENV = { MOLLIE_API_KEY: 'test_key' }
  const payment = (body: Record<string, unknown>): [string, string, FakeAnswer] => [
    'GET',
    '/v2/payments/tr_1',
    { status: 200, body: { id: 'tr_1', ...body } },
  ]

  it('cancels an open payment Mollie says is cancelable', async () => {
    await withEnv(ENV, () =>
      withFetch(
        route([
          payment({ status: 'open', isCancelable: true }),
          ['DELETE', '/v2/payments/tr_1', { status: 200, body: { status: 'canceled' } }],
        ]),
        async (calls) => {
          expect((await mollie.closeCheckout({ reference: 'tr_1' })).state).toBe('closed')
          expect(trail(calls)).toEqual(['GET /v2/payments/tr_1', 'DELETE /v2/payments/tr_1'])
        }
      )
    )
  })

  it('says until when an open payment it cannot cancel stays payable', async () => {
    await withEnv(ENV, () =>
      withFetch(
        route([
          payment({
            status: 'open',
            isCancelable: false,
            expiresAt: '2026-09-28T10:15:00+00:00',
            _links: { checkout: { href: 'https://www.mollie.com/checkout/1' } },
          }),
        ]),
        async (calls) => {
          expect(await mollie.closeCheckout({ reference: 'tr_1' })).toEqual({
            state: 'open',
            checkoutUrl: 'https://www.mollie.com/checkout/1',
            openUntil: '2026-09-28T10:15:00+00:00',
          })
          expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
        }
      )
    )
  })

  it('reads a paid payment as paid and a pending one as confirming', async () => {
    for (const [status, state] of [
      ['paid', 'paid'],
      ['pending', 'confirming'],
      ['expired', 'closed'],
    ]) {
      await withEnv(ENV, () =>
        withFetch(route([payment({ status })]), async () => {
          expect((await mollie.closeCheckout({ reference: 'tr_1' })).state).toBe(state)
        })
      )
    }
  })

  it('finds the payments opened for an order, reading back until it passes the time it was placed', async () => {
    const page1 = {
      _embedded: {
        payments: [
          { id: 'tr_new', createdAt: '2026-09-28T12:00:00+00:00', metadata: { orderId: 'o-2' } },
          { id: 'tr_a', createdAt: '2026-09-28T10:00:05+00:00', metadata: { orderId: 'o-1' } },
        ],
      },
      _links: { next: { href: 'https://api.mollie.com/v2/payments?from=tr_b&limit=250' } },
    }
    const page2 = {
      _embedded: {
        payments: [
          { id: 'tr_b', createdAt: '2026-09-28T09:55:00+00:00', metadata: { orderId: 'o-1' } },
          { id: 'tr_old', createdAt: '2026-09-27T09:00:00+00:00', metadata: { orderId: 'o-1' } },
        ],
      },
      _links: { next: { href: 'https://api.mollie.com/v2/payments?from=tr_z&limit=250' } },
    }
    await withEnv(ENV, () =>
      withFetch(
        (call) => ({ status: 200, body: call.url.includes('from=tr_b') ? page2 : page1 }),
        async (calls) => {
          expect(await mollie.findCheckouts({ orderId: 'o-1', placedAt: PLACED_AT })).toEqual({
            references: ['tr_a', 'tr_b'],
          })
          expect(trail(calls)).toEqual([
            'GET /v2/payments?limit=250',
            'GET /v2/payments?from=tr_b&limit=250',
          ])
        }
      )
    )
  })
})

describe('Razorpay', () => {
  const razorpay = loadPaymentDrivers({ ids: ['razorpay'] }).get('razorpay')
  const ENV = { RAZORPAY_KEY_ID: 'rzp_test_1', RAZORPAY_KEY_SECRET: 'secret' }

  it('cancels a payment link still taking money, and a subscription nobody authorised', async () => {
    for (const [reference, path] of [
      ['plink_1', '/v1/payment_links/plink_1'],
      ['sub_1', '/v1/subscriptions/sub_1'],
    ]) {
      await withEnv(ENV, () =>
        withFetch(
          route([
            ['GET', path, { status: 200, body: { id: reference, status: 'created' } }],
            ['POST', path + '/cancel', { status: 200, body: { status: 'cancelled' } }],
          ]),
          async (calls) => {
            expect((await razorpay.closeCheckout({ reference })).state).toBe('closed')
            expect(trail(calls)).toEqual(['GET ' + path, 'POST ' + path + '/cancel'])
          }
        )
      )
    }
  })

  it('reads a paid link, and an authorised subscription, as paid', async () => {
    for (const [reference, path, status] of [
      ['plink_1', '/v1/payment_links/plink_1', 'paid'],
      ['sub_1', '/v1/subscriptions/sub_1', 'active'],
    ]) {
      await withEnv(ENV, () =>
        withFetch(route([['GET', path, { status: 200, body: { status } }]]), async () => {
          expect((await razorpay.closeCheckout({ reference })).state).toBe('paid')
        })
      )
    }
  })

  it('finds the link the order placed by its reference, then each one opened again after it', async () => {
    const links: Record<string, string> = {
      'o-1': 'plink_1',
      'o-1-1': 'plink_2',
      'o-1-2': 'plink_3',
    }
    await withEnv(ENV, () =>
      withFetch(
        (call) => {
          const reference = new URL(call.url).searchParams.get('reference_id') || ''
          return {
            status: 200,
            body: { payment_links: links[reference] ? [{ id: links[reference] }] : [] },
          }
        },
        async (calls) => {
          expect(await razorpay.findCheckouts({ orderId: 'o-1', placedAt: PLACED_AT })).toEqual({
            references: ['plink_1', 'plink_2', 'plink_3'],
          })
          // The numbers are taken in turn: the first one no link carries ends the search.
          expect(trail(calls)).toEqual([
            'GET /v1/payment_links?reference_id=o-1',
            'GET /v1/payment_links?reference_id=o-1-1',
            'GET /v1/payment_links?reference_id=o-1-2',
            'GET /v1/payment_links?reference_id=o-1-3',
          ])
        }
      )
    )
  })

  it('stops at twenty links opened again, and reports a lookup Razorpay refused', async () => {
    await withEnv(ENV, () =>
      withFetch(
        () => ({ status: 200, body: { payment_links: [{ id: 'plink_x' }] } }),
        async (calls) => {
          const found = await razorpay.findCheckouts({ orderId: 'o-1', placedAt: PLACED_AT })
          expect(found.references).toHaveLength(21)
          expect(calls).toHaveLength(21)
        }
      )
    )
    await withEnv(ENV, () =>
      withFetch(
        () => ({ status: 500, body: { error: { description: 'Server error' } } }),
        async () => {
          expect(await razorpay.findCheckouts({ orderId: 'o-1', placedAt: PLACED_AT })).toEqual({
            error: 'Server error',
          })
        }
      )
    )
  })
})

describe('Square', () => {
  const square = loadPaymentDrivers({ ids: ['square'] }).get('square')
  const ENV = { SQUARE_ACCESS_TOKEN: 'sq-token', SQUARE_LOCATION_ID: 'LOC1' }
  const locations: [string, string, FakeAnswer] = [
    'GET',
    '/v2/locations',
    { status: 200, body: {} },
  ]
  const openOrder: [string, string, FakeAnswer] = [
    'GET',
    '/v2/orders/SQ1',
    { status: 200, body: { order: { id: 'SQ1', state: 'OPEN', version: 3, location_id: 'LOC1' } } },
  ]

  it('deletes the payment link, which cancels the order with it', async () => {
    await withEnv(ENV, () =>
      withFetch(
        route([
          locations,
          openOrder,
          ['DELETE', '/v2/online-checkout/payment-links/PL1', { status: 200, body: {} }],
          ['PUT', '/v2/orders/SQ1', { status: 200, body: { order: { state: 'CANCELED' } } }],
        ]),
        async (calls) => {
          expect((await square.closeCheckout({ reference: 'SQ1:PL1' })).state).toBe('closed')
          expect(calls.some((call) => call.method === 'PUT')).toBe(false)
        }
      )
    )
  })

  it('cancels the order itself when there is no link, or the link could not be deleted', async () => {
    for (const reference of ['SQ1', 'SQ1:PL1']) {
      await withEnv(ENV, () =>
        withFetch(
          route([
            locations,
            openOrder,
            ['DELETE', '/v2/online-checkout/payment-links/PL1', { status: 500, body: {} }],
            ['PUT', '/v2/orders/SQ1', { status: 200, body: { order: { state: 'CANCELED' } } }],
          ]),
          async (calls) => {
            expect((await square.closeCheckout({ reference })).state).toBe('closed')
            const cancel = calls.find((call) => call.method === 'PUT')!
            expect(cancel.json.order).toEqual({
              location_id: 'LOC1',
              version: 3,
              state: 'CANCELED',
            })
          }
        )
      )
    }
  })

  it('counts a deleted link as closed even when the order cannot be cancelled', async () => {
    await withEnv(ENV, () =>
      withFetch(
        route([
          locations,
          openOrder,
          ['DELETE', '/v2/online-checkout/payment-links/PL1', { status: 200, body: {} }],
          ['PUT', '/v2/orders/SQ1', { status: 400, body: { errors: [{ detail: 'nope' }] } }],
        ]),
        async () => {
          expect((await square.closeCheckout({ reference: 'SQ1:PL1' })).state).toBe('closed')
        }
      )
    )
  })

  it('reads a payment-link order as what its tender payment took, a completed one as paid', async () => {
    // A payment link's order stays OPEN after it is paid: its payment decides.
    for (const [order, paymentStatus, state] of [
      [{ state: 'OPEN', tenders: [{ id: 't', payment_id: 'PAY1' }] }, 'COMPLETED', 'paid'],
      [{ state: 'OPEN', tenders: [{ id: 't', payment_id: 'PAY1' }] }, 'APPROVED', 'confirming'],
      [{ state: 'OPEN', tenders: [{ id: 'PAY1' }] }, 'PENDING', 'confirming'],
      [
        {
          state: 'OPEN',
          tenders: [{ id: 't' }],
          net_amount_due_money: { amount: 0, currency: 'USD' },
        },
        '',
        'paid',
      ],
      [{ state: 'COMPLETED' }, '', 'paid'],
      [{ state: 'CANCELED' }, '', 'closed'],
    ] as const) {
      await withEnv(ENV, () =>
        withFetch(
          route([
            locations,
            ['GET', '/v2/orders/SQ1', { status: 200, body: { order } }],
            [
              'GET',
              '/v2/payments/PAY1',
              { status: 200, body: { payment: { status: paymentStatus } } },
            ],
          ]),
          async (calls) => {
            expect((await square.closeCheckout({ reference: 'SQ1:PL1' })).state).toBe(state)
            expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
          }
        )
      )
    }
  })

  it('closes a payment-link order whose tender payment failed, and reports a payment it cannot read', async () => {
    const failedOrder: [string, string, FakeAnswer] = [
      'GET',
      '/v2/orders/SQ1',
      {
        status: 200,
        body: {
          order: {
            id: 'SQ1',
            state: 'OPEN',
            version: 3,
            location_id: 'LOC1',
            tenders: [{ id: 't', payment_id: 'PAY1' }],
          },
        },
      },
    ]
    await withEnv(ENV, () =>
      withFetch(
        route([
          locations,
          failedOrder,
          ['GET', '/v2/payments/PAY1', { status: 200, body: { payment: { status: 'FAILED' } } }],
          ['DELETE', '/v2/online-checkout/payment-links/PL1', { status: 200, body: {} }],
        ]),
        async (calls) => {
          expect((await square.closeCheckout({ reference: 'SQ1:PL1' })).state).toBe('closed')
          expect(trail(calls)).toContain('DELETE /v2/online-checkout/payment-links/PL1')
        }
      )
    )
    await withEnv(ENV, () =>
      withFetch(
        route([
          locations,
          failedOrder,
          [
            'GET',
            '/v2/payments/PAY1',
            { status: 500, body: { errors: [{ detail: 'Try again' }] } },
          ],
        ]),
        async (calls) => {
          expect(await square.closeCheckout({ reference: 'SQ1:PL1' })).toEqual({
            state: '',
            error: 'Try again',
          })
          expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
        }
      )
    )
  })

  it('finds the Square orders placed for the store order by their reference', async () => {
    await withEnv(ENV, () =>
      withFetch(
        route([
          [
            'GET',
            '/v2/locations/LOC1',
            { status: 200, body: { location: { id: 'LOC1', currency: 'USD' } } },
          ],
          locations,
          [
            'POST',
            '/v2/orders/search',
            {
              status: 200,
              body: {
                orders: [
                  { id: 'SQ1', reference_id: 'o-1' },
                  { id: 'SQ2', reference_id: 'o-2' },
                ],
              },
            },
          ],
        ]),
        async (calls) => {
          expect(await square.findCheckouts({ orderId: 'o-1', placedAt: PLACED_AT })).toEqual({
            references: ['SQ1'],
          })
          const search = calls.find((call) => call.url.endsWith('/v2/orders/search'))!
          expect(search.json.location_ids).toEqual(['LOC1'])
          expect(search.json.query.filter.date_time_filter.created_at).toEqual({
            start_at: new Date(PLACED_MS - 10 * 60 * 1000).toISOString(),
            end_at: new Date(PLACED_MS + 60 * 60 * 1000).toISOString(),
          })
          // Square refuses a time filter sorted on another field.
          expect(search.json.query.sort).toEqual({ sort_field: 'CREATED_AT' })
          // The orders were found: the payment links are not listed.
          expect(trail(calls).some((line) => line.includes('payment-links'))).toBe(false)
        }
      )
    )
  })

  it('finds the link of a draft order the order search does not return, by the note naming the order', async () => {
    const link = (id: string, orderId: string, note: string, createdAt: string) => ({
      id,
      order_id: orderId,
      payment_note: note,
      created_at: createdAt,
    })
    await withEnv(ENV, () =>
      withFetch(
        (call) => {
          const path = call.url.replace(/^https:\/\/[^/]+/, '')
          if (path.startsWith('/v2/locations/LOC1')) {
            return { status: 200, body: { location: { id: 'LOC1', currency: 'USD' } } }
          }
          if (path.startsWith('/v2/locations')) {
            return { status: 200, body: {} }
          }
          if (path.startsWith('/v2/orders/search')) {
            return { status: 200, body: { orders: [] } }
          }
          if (path.includes('cursor=next')) {
            return {
              status: 200,
              body: {
                payment_links: [
                  link('PL2', 'SQ2', 'teleport:o-1::', '2026-09-28T10:00:09Z'),
                  // Opened for the order days earlier: not this placing's.
                  link('PL0', 'SQ0', 'teleport:o-1::', '2026-09-20T10:00:00Z'),
                ],
              },
            }
          }
          return {
            status: 200,
            body: {
              payment_links: [
                link('PL1', 'SQ1', 'teleport:o-10::', '2026-09-28T10:00:05Z'),
                link('PL3', 'SQ3', 'teleport:o-2::', '2026-09-28T10:00:07Z'),
              ],
              cursor: 'next',
            },
          }
        },
        async (calls) => {
          expect(await square.findCheckouts({ orderId: 'o-1', placedAt: PLACED_AT })).toEqual({
            references: ['SQ2:PL2'],
          })
          expect(trail(calls).filter((line) => line.includes('payment-links'))).toEqual([
            'GET /v2/online-checkout/payment-links?limit=1000',
            'GET /v2/online-checkout/payment-links?limit=1000&cursor=next',
          ])
        }
      )
    )
  })
})

describe('Paddle', () => {
  const paddle = loadPaymentDrivers({ ids: ['paddle'] }).get('paddle')
  const ENV = { PADDLE_API_KEY: 'pdl_sdbx_apikey_1' }

  it('cancels a ready transaction', async () => {
    await withEnv(ENV, () =>
      withFetch(
        route([
          [
            'GET',
            '/transactions/txn_1',
            { status: 200, body: { data: { id: 'txn_1', status: 'ready' } } },
          ],
          ['PATCH', '/transactions/txn_1', { status: 200, body: { data: { status: 'canceled' } } }],
        ]),
        async (calls) => {
          expect((await paddle.closeCheckout({ reference: 'txn_1' })).state).toBe('closed')
          expect(calls.find((call) => call.method === 'PATCH')!.json).toEqual({
            status: 'canceled',
          })
        }
      )
    )
  })

  it('reads a completed transaction as paid and a billed one as confirming', async () => {
    for (const [status, state] of [
      ['completed', 'paid'],
      ['billed', 'confirming'],
      ['canceled', 'closed'],
    ]) {
      await withEnv(ENV, () =>
        withFetch(
          route([['GET', '/transactions/txn_1', { status: 200, body: { data: { status } } }]]),
          async () => {
            expect((await paddle.closeCheckout({ reference: 'txn_1' })).state).toBe(state)
          }
        )
      )
    }
  })

  it('finds the transactions opened for an order around the time it was placed', async () => {
    await withEnv(ENV, () =>
      withFetch(
        route([
          [
            'GET',
            '/transactions?',
            {
              status: 200,
              body: {
                data: [
                  { id: 'txn_1', custom_data: { orderId: 'o-1' } },
                  { id: 'txn_2', custom_data: { orderId: 'o-2' } },
                ],
                meta: { pagination: { has_more: false } },
              },
            },
          ],
        ]),
        async (calls) => {
          expect(await paddle.findCheckouts({ orderId: 'o-1', placedAt: PLACED_AT })).toEqual({
            references: ['txn_1'],
          })
          expect(decodeURIComponent(calls[0].url)).toContain(
            'created_at[GTE]=' + new Date(PLACED_MS - 10 * 60 * 1000).toISOString()
          )
          // Paddle serves at most 30 a page; the store's checkouts are its API transactions.
          expect(calls[0].url).toContain('/transactions?per_page=30&origin=api&')
        }
      )
    )
  })
})

describe('CoinGate', () => {
  const coingate = loadPaymentDrivers({ ids: ['coingate'] }).get('coingate')
  const ENV = { COINGATE_API_TOKEN: 'cg-token' }
  const auth: [string, string, FakeAnswer] = ['GET', '/v2/auth/test', { status: 200, body: 'OK' }]

  it('cannot cancel an invoice: says until when one still waiting for coins is payable', async () => {
    await withEnv(ENV, () =>
      withFetch(
        route([
          auth,
          [
            'GET',
            '/v2/orders/42',
            {
              status: 200,
              body: {
                id: 42,
                status: 'new',
                payment_url: 'https://coingate.com/invoice/42',
                expire_at: '2026-09-28T10:20:00+00:00',
              },
            },
          ],
        ]),
        async (calls) => {
          expect(await coingate.closeCheckout({ reference: '42' })).toEqual({
            state: 'open',
            checkoutUrl: 'https://coingate.com/invoice/42',
            openUntil: '2026-09-28T10:20:00+00:00',
          })
          expect(calls.every((call) => call.method === 'GET')).toBe(true)
        }
      )
    )
  })

  it('says a new invoice, which carries no expiry, runs out two hours after it was created', async () => {
    for (const [status, until] of [
      ['new', '2026-09-28T12:00:00.000Z'],
      // A pending invoice's own expiry was not stated: nobody knows when.
      ['pending', ''],
    ]) {
      await withEnv(ENV, () =>
        withFetch(
          route([
            auth,
            [
              'GET',
              '/v2/orders/42',
              {
                status: 200,
                body: { id: 42, status, created_at: '2026-09-28T10:00:00+00:00' },
              },
            ],
          ]),
          async () => {
            expect(await coingate.closeCheckout({ reference: '42' })).toEqual({
              state: 'open',
              checkoutUrl: '',
              openUntil: until,
            })
          }
        )
      )
    }
  })

  it('reads a paid invoice as paid and a confirming one as confirming', async () => {
    for (const [status, state] of [
      ['paid', 'paid'],
      ['confirming', 'confirming'],
      ['expired', 'closed'],
    ]) {
      await withEnv(ENV, () =>
        withFetch(
          route([auth, ['GET', '/v2/orders/42', { status: 200, body: { status } }]]),
          async () => {
            expect((await coingate.closeCheckout({ reference: '42' })).state).toBe(state)
          }
        )
      )
    }
  })

  it('finds the invoices opened for an order around the time it was placed', async () => {
    await withEnv(ENV, () =>
      withFetch(
        route([
          auth,
          [
            'GET',
            '/v2/orders?',
            {
              status: 200,
              body: {
                orders: [
                  { id: 42, order_id: 'o-1', created_at: '2026-09-28T10:00:04+00:00' },
                  { id: 43, order_id: 'o-2', created_at: '2026-09-28T10:00:05+00:00' },
                  // The same order's invoice from another day the whole-day filter lets in.
                  { id: 41, order_id: 'o-1', created_at: '2026-09-27T09:00:00+00:00' },
                ],
                total_pages: 1,
              },
            },
          ],
        ]),
        async (calls) => {
          expect(await coingate.findCheckouts({ orderId: 'o-1', placedAt: PLACED_AT })).toEqual({
            references: ['42'],
          })
          // CoinGate filters by whole days: a day either side of the window.
          const list = calls.find((call) => call.url.includes('/v2/orders?'))!
          expect(list.url).toContain('created_at[from]=2026-09-27&created_at[to]=2026-09-29')
        }
      )
    )
  })
})
