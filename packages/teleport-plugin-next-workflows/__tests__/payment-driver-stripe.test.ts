import { loadPaymentDrivers } from './_helpers/load-payment-drivers'
import { createFakeStripe } from './_helpers/fake-stripe'
import { withEnv } from './_helpers/fake-fetch'

/**
 * The Stripe driver EXECUTED against a recording stand-in for the SDK: the
 * amounts it sends in the currencies Stripe takes only in whole tens of the
 * smallest unit (KWD, BHD, JOD, OMR, TND).
 */

const KEY = { STRIPE_SECRET_KEY: 'sk_test_1' }

const load = () => {
  const fake = createFakeStripe({
    'checkout.sessions.create': () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/1' }),
    'coupons.create': () => ({ id: 'co_1' }),
    'refunds.create': (params: any) => ({
      id: 're_1',
      amount: params.amount,
      currency: 'kwd',
      status: 'succeeded',
    }),
  })
  return {
    stripe: loadPaymentDrivers({ ids: ['stripe'], stripe: fake.FakeStripe }).get('stripe'),
    calls: fake.calls,
  }
}

describe('Stripe driver — three-decimal currencies', () => {
  it('sends a checkout amount in whole tens of the smallest unit', async () => {
    const { stripe, calls } = load()
    await withEnv(KEY, async () => {
      await stripe.createCheckout({
        currency: 'kwd',
        lineItems: [
          { name: 'Oud', unitAmount: 5.125, quantity: 2 },
          { name: 'Shipping', unitAmount: 1.234, quantity: 1 },
        ],
      })
      await stripe.createCheckout({ amount: 12.346, currency: 'OMR', description: 'Order' })
      // 1.005 × 1000 is 1004.999… in floating point: the thousandth is
      // rounded first, as every other amount is.
      await stripe.createCheckout({ amount: 1.005, currency: 'JOD', description: 'Order' })
      await stripe.createCheckout({ amount: 12.346, currency: 'usd', description: 'Order' })
    })
    const sent = calls.map((call: any) =>
      call.params.line_items.map((line: any) => line.price_data.unit_amount)
    )
    // USD keeps its two decimals untouched.
    expect(sent).toEqual([[5130, 1230], [12350], [1010], [1235]])
  })

  it('sends a subscription price, its first-cycle discount and a refund in whole tens', async () => {
    const { stripe, calls } = load()
    const result = await withEnv(KEY, async () => {
      await stripe.createSubscriptionCheckout({
        amount: 10.005,
        amountDue: 7.001,
        currency: 'bhd',
        recurringInterval: 'month',
        description: 'Club',
      })
      return stripe.refund({
        paymentReference: 'pi_1',
        amount: 1.234,
        currency: 'KWD',
        idempotencyKey: 'k',
      })
    })
    const coupon = calls.find((call: any) => call.method === 'coupons.create') as any
    const session = calls.find((call: any) => call.method === 'checkout.sessions.create') as any
    const refund = calls.find((call: any) => call.method === 'refunds.create') as any
    expect(session.params.line_items[0].price_data.unit_amount).toBe(10010)
    expect(coupon.params.amount_off).toBe(10010 - 7000)
    expect(refund.params.amount).toBe(1230)
    expect(result).toMatchObject({ success: true, amount: 1.23, currency: 'KWD' })
  })
})

describe('Stripe driver — settling a checkout from Stripe', () => {
  const SESSION = 'cs_test_a1B2c3D4e5F6g7'
  const settle = (script: Record<string, (params: unknown) => unknown>) => {
    const fake = createFakeStripe(script)
    const stripe = loadPaymentDrivers({ ids: ['stripe'], stripe: fake.FakeStripe }).get('stripe')
    return { stripe, calls: fake.calls }
  }
  const refusal = (statusCode: number, code = '') =>
    Object.assign(new Error('Stripe says no (' + statusCode + ')'), { statusCode, code })

  it('settles a session, then the first invoice a subscription session opened', () => {
    const { stripe } = settle({})
    expect(stripe.reconcileKinds(SESSION)).toEqual(['checkout', 'checkout-invoice'])
    for (const foreign of ['pi_3Nx', '5O190127TN364715T', 'tr_WDqYK6vllg', 'cs_', '', undefined]) {
      expect(stripe.reconcileKinds(foreign)).toEqual([])
    }
  })

  it('answers a paid session as the completion Stripe sends, read from Stripe alone', async () => {
    const session = {
      id: SESSION,
      object: 'checkout.session',
      mode: 'payment',
      status: 'complete',
      payment_status: 'paid',
      payment_intent: 'pi_1',
      amount_total: 2400,
      currency: 'usd',
      metadata: { orderId: 'order-1', orderNumber: 'ORD-1' },
    }
    const { stripe, calls } = settle({ 'checkout.sessions.retrieve': () => session })
    const result = await withEnv(KEY, () => stripe.reconcile({ kind: 'checkout', id: SESSION }))
    expect(result).toEqual({
      ok: true,
      body: {
        id: 'teleport-settle:' + SESSION,
        object: 'event',
        type: 'checkout.session.completed',
        data: { object: session },
      },
    })
    expect(calls).toEqual([{ method: 'checkout.sessions.retrieve', params: SESSION }])
  })

  it('answers what an asynchronous method did with a session it completed unpaid, and an expired one', async () => {
    const unpaid = (intentStatus: string) =>
      settle({
        'checkout.sessions.retrieve': () => ({
          id: SESSION,
          mode: 'payment',
          status: 'complete',
          payment_status: 'unpaid',
          payment_intent: 'pi_1',
        }),
        'paymentIntents.retrieve': () => ({ id: 'pi_1', status: intentStatus }),
      }).stripe
    const typeOf = async (stripe: any) =>
      (await withEnv<any>(KEY, () => stripe.reconcile({ kind: 'checkout', id: SESSION }))).body.type
    expect(await typeOf(unpaid('succeeded'))).toBe('checkout.session.async_payment_succeeded')
    expect(await typeOf(unpaid('requires_payment_method'))).toBe(
      'checkout.session.async_payment_failed'
    )
    expect(await typeOf(unpaid('canceled'))).toBe('checkout.session.async_payment_failed')
    // Still on its way: the completion, which the store reads as awaiting.
    expect(await typeOf(unpaid('processing'))).toBe('checkout.session.completed')
    const expired = settle({
      'checkout.sessions.retrieve': () => ({ id: SESSION, status: 'expired' }),
    }).stripe
    expect(await typeOf(expired)).toBe('checkout.session.expired')
  })

  it('settles nothing for a session still open or one Stripe does not know, and retries an outage', async () => {
    const answer = (script: Record<string, (params: unknown) => unknown>, kind = 'checkout') =>
      withEnv<any>(KEY, () => settle(script).stripe.reconcile({ kind, id: SESSION }))
    expect(
      await answer({ 'checkout.sessions.retrieve': () => ({ id: SESSION, status: 'open' }) })
    ).toEqual({ ok: false, reason: 'Stripe checkout ' + SESSION + ' is still open.' })
    const missing = await answer({
      'checkout.sessions.retrieve': () => {
        throw refusal(404, 'resource_missing')
      },
    })
    expect(missing).toMatchObject({ ok: false })
    expect(missing.retry).toBeFalsy()
    for (const statusCode of [500, 429]) {
      expect(
        await answer({
          'checkout.sessions.retrieve': () => {
            throw refusal(statusCode)
          },
        })
      ).toMatchObject({ ok: false, retry: true })
    }
    expect(
      await answer({
        'checkout.sessions.retrieve': () => {
          throw new Error('socket hang up')
        },
      })
    ).toMatchObject({ ok: false, retry: true, reason: 'socket hang up' })
  })

  it("answers a subscription session's completion, then its first invoice once paid", async () => {
    const session = {
      id: SESSION,
      mode: 'subscription',
      status: 'complete',
      payment_status: 'paid',
      subscription: 'sub_1',
      invoice: 'in_1',
      metadata: { orderId: 'order-1', subscriptionId: 'sub-row-1' },
    }
    const invoice = {
      id: 'in_1',
      object: 'invoice',
      status: 'paid',
      amount_paid: 900,
      subscription: 'sub_1',
      payment_intent: 'pi_9',
    }
    const { stripe, calls } = settle({
      'checkout.sessions.retrieve': () => session,
      'invoices.retrieve': () => invoice,
    })
    await withEnv(KEY, async () => {
      expect(await stripe.reconcile({ kind: 'checkout', id: SESSION })).toMatchObject({
        ok: true,
        body: { type: 'checkout.session.completed', data: { object: session } },
      })
      expect(await stripe.reconcile({ kind: 'checkout-invoice', id: SESSION })).toEqual({
        ok: true,
        body: {
          id: 'teleport-settle:in_1',
          object: 'event',
          type: 'invoice.paid',
          data: { object: invoice },
        },
      })
    })
    expect(calls[calls.length - 1]).toEqual({ method: 'invoices.retrieve', params: 'in_1' })
  })

  it('settles no invoice for a payment session, or one not paid yet', async () => {
    const answer = (session: unknown, invoiceStatus = 'paid') =>
      withEnv(KEY, () =>
        settle({
          'checkout.sessions.retrieve': () => session,
          'invoices.retrieve': () => ({ id: 'in_1', status: invoiceStatus }),
        }).stripe.reconcile({ kind: 'checkout-invoice', id: SESSION })
      )
    expect(await answer({ id: SESSION, mode: 'payment', status: 'complete' })).toEqual({
      ok: false,
      reason: 'Stripe checkout ' + SESSION + ' has no subscription invoice to settle.',
    })
    expect(
      await answer(
        { id: SESSION, mode: 'subscription', status: 'complete', invoice: 'in_1' },
        'open'
      )
    ).toEqual({ ok: false, reason: 'Stripe invoice in_1 is not paid yet.' })
  })

  it('asks Stripe nothing for a request naming no session, and retries without a key', async () => {
    const { stripe, calls } = settle({})
    await withEnv(KEY, async () => {
      for (const request of [
        { kind: 'checkout', id: 'pi_1' },
        { kind: 'checkout', id: 'cs_test_../../v1/charges' },
        { kind: 'refund', id: SESSION },
        null,
      ]) {
        expect(await stripe.reconcile(request)).toEqual({
          ok: false,
          reason: 'The request names no Stripe checkout to settle.',
        })
      }
    })
    expect(calls).toEqual([])
    expect(
      await withEnv(
        { STRIPE_SECRET_KEY: undefined, CONFIGURATION_STRIPE_SECRET_KEY: undefined },
        () => stripe.reconcile({ kind: 'checkout', id: SESSION })
      )
    ).toMatchObject({ ok: false, retry: true })
    expect(calls).toEqual([])
  })
})
