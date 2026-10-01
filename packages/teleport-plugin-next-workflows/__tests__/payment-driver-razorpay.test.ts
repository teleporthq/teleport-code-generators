import * as crypto from 'crypto'
import { loadPaymentDrivers } from './_helpers/load-payment-drivers'
import { withEnv, withFetch } from './_helpers/fake-fetch'

/**
 * The Razorpay driver EXECUTED against Razorpay's documented answers:
 * integer sub-units, Payment Links with a unique reference, immutable Plans,
 * subscriptions authorised on the store's page, and a webhook the store only
 * accepts signed.
 */

const razorpay = loadPaymentDrivers({ ids: ['razorpay'] }).get('razorpay')
const ENV = {
  RAZORPAY_KEY_ID: 'rzp_test_abc',
  RAZORPAY_KEY_SECRET: 'secret',
  RAZORPAY_WEBHOOK_SECRET: 'whsecret',
}
const API = 'https://api.razorpay.com/v1'
const BASIC = 'Basic ' + Buffer.from('rzp_test_abc:secret').toString('base64')

describe('Razorpay driver — payment links', () => {
  it('creates a link in paise with the order as its reference and a day to pay', async () => {
    await withEnv(ENV, () =>
      withFetch(
        () => ({
          status: 200,
          body: { id: 'plink_1', short_url: 'https://rzp.io/i/abc', status: 'created' },
        }),
        async (calls) => {
          const before = Math.floor(Date.now() / 1000)
          const result = await razorpay.createCheckout({
            amount: 299,
            currency: 'inr',
            description: 'Order ORD-3',
            successUrl: 'https://shop.test/order-details/ORD-3?payment=success',
            metadata: { orderId: 'order-3', orderNumber: 'ORD-3' },
          })
          expect(result).toEqual({ checkoutUrl: 'https://rzp.io/i/abc', sessionId: 'plink_1' })
          expect(calls[0].url).toBe(API + '/payment_links')
          expect(calls[0].headers.Authorization).toBe(BASIC)
          expect(calls[0].json).toMatchObject({
            amount: 29900,
            currency: 'INR',
            reference_id: 'order-3',
            callback_url: 'https://shop.test/order-details/ORD-3?payment=success',
            callback_method: 'get',
            notes: { orderId: 'order-3', orderNumber: 'ORD-3' },
          })
          expect(calls[0].json.expire_by - before).toBeGreaterThanOrEqual(24 * 60 * 60)
        }
      )
    )
  })

  it('rounds a three-decimal amount so it ends in 0', async () => {
    await withEnv(ENV, () =>
      withFetch(
        () => ({ status: 200, body: { id: 'plink_1', short_url: 'https://rzp.io/i/x' } }),
        async (calls) => {
          await razorpay.createCheckout({
            amount: 99.999,
            currency: 'KWD',
            metadata: { orderId: 'o' },
          })
          expect(calls[0].json.amount).toBe(100000)
        }
      )
    )
  })

  it('finds the link a retried place-order created before instead of failing on the duplicate', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.method === 'POST'
            ? {
                status: 400,
                body: {
                  error: {
                    code: 'BAD_REQUEST_ERROR',
                    description: 'payment link creation with reference ID already attempted',
                  },
                },
              }
            : {
                status: 200,
                body: {
                  payment_links: [
                    { id: 'plink_old', short_url: 'https://rzp.io/i/old', status: 'created' },
                  ],
                },
              },
        async (calls) => {
          const result = await razorpay.createCheckout({
            amount: 10,
            currency: 'INR',
            metadata: { orderId: 'order-3' },
          })
          expect(result).toEqual({ checkoutUrl: 'https://rzp.io/i/old', sessionId: 'plink_old' })
          expect(calls[1].url).toBe(API + '/payment_links?reference_id=order-3')
          expect(calls).toHaveLength(2)
        }
      )
    )
  })

  it("opens a new link under a suffixed reference when the order's link expired", async () => {
    let posts = 0
    await withEnv(ENV, () =>
      withFetch(
        (call) => {
          if (call.method !== 'POST') {
            return {
              status: 200,
              body: {
                payment_links: [
                  { id: 'plink_old', short_url: 'https://rzp.io/i/old', status: 'expired' },
                ],
              },
            }
          }
          posts += 1
          return posts === 1
            ? {
                status: 400,
                body: {
                  error: {
                    description: 'payment link creation with reference ID already attempted',
                  },
                },
              }
            : {
                status: 200,
                body: { id: 'plink_new', short_url: 'https://rzp.io/i/new', status: 'created' },
              }
        },
        async (calls) => {
          const orderId = '5f0c1a52-8f53-4c3e-9d8e-3b0a3f1d2e4c'
          const result = await razorpay.createCheckout({
            amount: 10,
            currency: 'INR',
            metadata: { orderId },
          })
          expect(result).toEqual({ checkoutUrl: 'https://rzp.io/i/new', sessionId: 'plink_new' })
          const retried = calls[2].json
          // The first number: the order's links can be searched in turn.
          expect(retried.reference_id).toBe(orderId.slice(0, 32) + '-1')
          // The webhook still names the order from the notes.
          expect(retried.notes.orderId).toBe(orderId)
        }
      )
    )
  })
})

describe('Razorpay driver — payment links opened again', () => {
  it('takes the next number no link carries, and reuses a numbered link still taking money', async () => {
    const existing: Record<string, string> = {
      'order-9': 'expired',
      'order-9-1': 'cancelled',
      'order-9-2': 'created',
    }
    await withEnv(ENV, () =>
      withFetch(
        (call) => {
          if (call.method === 'GET') {
            const reference = new URL(call.url).searchParams.get('reference_id') || ''
            return {
              status: 200,
              body: {
                payment_links: [
                  {
                    id: 'plink_' + reference,
                    short_url: 'https://rzp.io/i/' + reference,
                    status: existing[reference],
                  },
                ],
              },
            }
          }
          return existing[call.json.reference_id]
            ? {
                status: 400,
                body: {
                  error: {
                    description: 'payment link creation with reference ID already attempted',
                  },
                },
              }
            : {
                status: 200,
                body: { id: 'plink_fresh', short_url: 'https://rzp.io/i/fresh', status: 'created' },
              }
        },
        async (calls) => {
          const result = await razorpay.createCheckout({
            amount: 10,
            currency: 'INR',
            metadata: { orderId: 'order-9' },
          })
          expect(result).toEqual({
            checkoutUrl: 'https://rzp.io/i/order-9-2',
            sessionId: 'plink_order-9-2',
          })
          expect(
            calls.filter((call) => call.method === 'POST').map((call) => call.json.reference_id)
          ).toEqual(['order-9', 'order-9-1', 'order-9-2'])
        }
      )
    )
  })

  it('refuses to open more links than it can search for the order', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.method === 'GET'
            ? { status: 200, body: { payment_links: [{ id: 'plink_old', status: 'expired' }] } }
            : {
                status: 400,
                body: {
                  error: {
                    description: 'payment link creation with reference ID already attempted',
                  },
                },
              },
        async (calls) => {
          const result = await razorpay.createCheckout({
            amount: 10,
            currency: 'INR',
            metadata: { orderId: 'order-9' },
          })
          expect(result.error).toBe(
            'This order has opened more Razorpay payment links than the store allows.'
          )
          expect(calls.filter((call) => call.method === 'POST')).toHaveLength(21)
        }
      )
    )
  })
})

describe('Razorpay driver — plans and subscriptions', () => {
  it('creates a plan once per product and price, and reuses a cached one', async () => {
    await withEnv(ENV, () =>
      withFetch(
        () => ({ status: 200, body: { id: 'plan_abc' } }),
        async (calls) => {
          const created = await razorpay.ensurePlan({
            amount: 499,
            currency: 'INR',
            interval: 'week',
            intervalCount: 2,
            productName: 'Box',
            productId: 'p1',
          })
          expect(created).toEqual({
            ok: 'true',
            planId: 'plan_abc',
            providerProductId: '',
            created: 'true',
          })
          expect(calls[0].json).toEqual({
            period: 'weekly',
            interval: 2,
            item: { name: 'Box', amount: 49900, currency: 'INR' },
            notes: { productId: 'p1' },
          })
          const cached = await razorpay.ensurePlan({
            planId: 'plan_cached',
            amount: 499,
            currency: 'INR',
            interval: 'week',
          })
          expect(cached).toEqual({
            ok: 'true',
            planId: 'plan_cached',
            providerProductId: '',
            created: 'false',
          })
          // The cached plan is checked against the current keys, never re-created.
          expect(calls.map((call) => call.method + ' ' + call.url.replace(API, ''))).toEqual([
            'POST /plans',
            'GET /plans/plan_cached',
          ])
          const daily = await razorpay.ensurePlan({
            amount: 499,
            currency: 'INR',
            interval: 'day',
            intervalCount: 3,
          })
          expect(daily.error).toBe('Razorpay bills a daily plan at most once every 7 days.')
        }
      )
    )
  })

  it('creates the plan again when the cached one belongs to the other mode, and keeps it through an outage', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.method === 'GET'
            ? { status: 400, body: { error: { description: 'The id provided does not exist' } } }
            : { status: 200, body: { id: 'plan_new' } },
        async (calls) => {
          const result = await razorpay.ensurePlan({
            planId: 'plan_live_cached',
            amount: 499,
            currency: 'INR',
            interval: 'month',
            productName: 'Box',
            productId: 'p1',
          })
          expect(result).toEqual({
            ok: 'true',
            planId: 'plan_new',
            providerProductId: '',
            created: 'true',
          })
          expect(calls.map((call) => call.method + ' ' + call.url.replace(API, ''))).toEqual([
            'GET /plans/plan_live_cached',
            'POST /plans',
          ])
        }
      )
    )
    await withEnv(ENV, () =>
      withFetch(
        () => ({ status: 502, body: null }),
        async (calls) => {
          expect(
            (await razorpay.ensurePlan({ planId: 'plan_cached', amount: 499, currency: 'INR' }))
              .planId
          ).toBe('plan_cached')
          expect(calls).toHaveLength(1)
        }
      )
    )
  })

  it('creates the subscription and sends the buyer to the store page that authorises it', async () => {
    await withEnv(ENV, () =>
      withFetch(
        () => ({
          status: 200,
          body: { id: 'sub_1', status: 'created', short_url: 'https://rzp.io/s/1' },
        }),
        async (calls) => {
          const result = await razorpay.createSubscriptionCheckout({
            planId: 'plan_abc',
            amount: 499,
            currency: 'INR',
            recurringInterval: 'month',
            recurringIntervalCount: 1,
            trialDays: 7,
            successUrl: 'https://shop.test/ok',
            cancelUrl: 'https://shop.test/checkout',
            metadata: { orderId: 'order-1', subscriptionId: 'sub-row-1' },
            baseUrl: 'https://shop.test',
          })
          expect(result).toEqual({
            checkoutUrl: 'https://shop.test/pay/razorpay?subscription=sub_1',
            sessionId: 'sub_1',
            providerSubscriptionId: 'sub_1',
          })
          expect(calls[0].json).toMatchObject({
            plan_id: 'plan_abc',
            total_count: 99 * 12,
            customer_notify: false,
            notes: {
              orderId: 'order-1',
              subscriptionId: 'sub-row-1',
              successUrl: 'https://shop.test/ok',
              cancelUrl: 'https://shop.test/checkout',
            },
          })
          expect(calls[0].json.start_at).toBeGreaterThan(
            Math.floor(Date.now() / 1000) + 6 * 24 * 60 * 60
          )
          // The buyer has a day to authorise it, never Razorpay's default of 30 years.
          const now = Math.floor(Date.now() / 1000)
          expect(calls[0].json.expire_by).toBeGreaterThan(now + 23 * 60 * 60)
          expect(calls[0].json.expire_by).toBeLessThanOrEqual(now + 24 * 60 * 60)
          expect(calls[0].json.expire_by).toBeLessThan(calls[0].json.start_at)
          const gift = await razorpay.createSubscriptionCheckout({
            planId: 'plan_abc',
            amount: 499,
            amountDue: 100,
            currency: 'INR',
          })
          expect(gift.error).toBe('Razorpay cannot take a gift card toward a subscription payment.')
        }
      )
    )
  })

  it('maps cancel, cancel at cycle end, pause and resume onto Razorpay, reading the subscription first where it matters', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) => ({
          status: 200,
          body: {
            id: 'sub_1',
            status: call.url.endsWith('/pause')
              ? 'paused'
              : call.url.endsWith('/cancel') && call.json.cancel_at_cycle_end === false
              ? 'cancelled'
              : 'active',
            has_scheduled_changes:
              call.url.endsWith('/cancel') && call.json.cancel_at_cycle_end === true,
            current_start: 1700000000,
            current_end: 1702592000,
          },
        }),
        async (calls) => {
          expect(
            (await razorpay.manageSubscription({ subscriptionId: 'sub_1', action: 'cancel' }))
              .status
          ).toBe('cancelled')
          const scheduled = await razorpay.manageSubscription({
            subscriptionId: 'sub_1',
            action: 'cancel_at_period_end',
          })
          expect(scheduled).toMatchObject({
            status: 'active',
            cancelAtPeriodEnd: 'true',
            currentPeriodEnd: new Date(1702592000 * 1000).toISOString(),
          })
          expect(scheduled.message).toBeUndefined()
          expect(
            (await razorpay.manageSubscription({ subscriptionId: 'sub_1', action: 'pause' })).status
          ).toBe('paused')
          expect(
            (await razorpay.manageSubscription({ subscriptionId: 'sub_1', action: 'resume' }))
              .status
          ).toBe('active')
          expect(calls.map((call) => [call.method, call.url.replace(API, ''), call.json])).toEqual([
            ['POST', '/subscriptions/sub_1/cancel', { cancel_at_cycle_end: false }],
            ['GET', '/subscriptions/sub_1', null],
            ['POST', '/subscriptions/sub_1/cancel', { cancel_at_cycle_end: true }],
            ['GET', '/subscriptions/sub_1', null],
            ['POST', '/subscriptions/sub_1/pause', { pause_at: 'now' }],
            ['POST', '/subscriptions/sub_1/resume', { resume_at: 'now' }],
          ])
        }
      )
    )
  })

  it('never pauses a subscription that is not active: a paused trial would be cancelled for good', async () => {
    for (const status of ['authenticated', 'pending', 'halted', 'created']) {
      await withEnv(ENV, () =>
        withFetch(
          () => ({ status: 200, body: { id: 'sub_1', status } }),
          async (calls) => {
            const result = await razorpay.manageSubscription({
              subscriptionId: 'sub_1',
              action: 'pause',
            })
            expect(result).toMatchObject({
              ok: 'false',
              error:
                'Razorpay can pause only an active subscription: one still in its free trial would be cancelled for good, and one with a payment due cannot be paused.',
            })
            expect(calls.map((call) => call.method)).toEqual(['GET'])
          }
        )
      )
    }
  })

  it('cancels a subscription still in its trial at once, since Razorpay schedules nothing before the first cycle', async () => {
    for (const status of ['authenticated', 'created']) {
      await withEnv(ENV, () =>
        withFetch(
          (call) => ({
            status: 200,
            body:
              call.method === 'GET'
                ? { id: 'sub_1', status, charge_at: 1702592000 }
                : { id: 'sub_1', status: 'cancelled', charge_at: 1702592000 },
          }),
          async (calls) => {
            const result = await razorpay.manageSubscription({
              subscriptionId: 'sub_1',
              action: 'cancel_at_period_end',
            })
            expect(result).toMatchObject({
              ok: 'true',
              status: 'cancelled',
              cancelAtPeriodEnd: 'false',
              message:
                'Razorpay cannot schedule a cancellation before the first billing cycle has started, so the subscription was cancelled immediately. No payment will be taken.',
            })
            expect(calls[1].json).toEqual({ cancel_at_cycle_end: false })
          }
        )
      )
    }
  })

  it('reports a subscription it could not read instead of acting blind', async () => {
    await withEnv(ENV, () =>
      withFetch(
        () => ({ status: 500, body: { error: { description: 'Server error' } } }),
        async (calls) => {
          const result = await razorpay.manageSubscription({
            subscriptionId: 'sub_1',
            action: 'cancel_at_period_end',
          })
          expect(result).toMatchObject({ ok: 'false', error: 'Server error' })
          expect(calls).toHaveLength(1)
        }
      )
    )
  })

  it('gives the store page the public key id and the return URLs, and a 404 for an unknown subscription', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/sub_1') || call.url.endsWith('/sub_3')
            ? {
                status: 200,
                body: {
                  id: 'sub_1',
                  status: call.url.endsWith('/sub_1') ? 'created' : 'authenticated',
                  notes: {
                    successUrl: 'https://shop.test/ok',
                    cancelUrl: 'https://shop.test/checkout',
                  },
                },
              }
            : { status: 400, body: { error: { description: 'The id provided does not exist' } } },
        async () => {
          expect(await razorpay.checkoutPage('sub_1')).toEqual({
            subscriptionId: 'sub_1',
            keyId: 'rzp_test_abc',
            successUrl: 'https://shop.test/ok',
            cancelUrl: 'https://shop.test/checkout',
          })
          expect(await razorpay.checkoutPage('sub_2')).toBeNull()
          expect(await razorpay.checkoutPage('plink_1')).toBeNull()
          // Authorised already (or cancelled, or expired): nothing to open again.
          expect(await razorpay.checkoutPage('sub_3')).toBeNull()
        }
      )
    )
  })
})

describe('Razorpay driver — refunds', () => {
  it('refunds a payment with a sanitised idempotency header, the whole of it when no amount is given', async () => {
    await withEnv(ENV, () =>
      withFetch(
        () => ({
          status: 200,
          body: { id: 'rfnd_1', status: 'processed', amount: 29900, currency: 'INR' },
        }),
        async (calls) => {
          const result = await razorpay.refund({
            paymentReference: 'pay_1',
            amount: 0,
            currency: 'INR',
            idempotencyKey: 'refund:pay_1:0',
            orderId: 'o1',
          })
          expect(result).toEqual({
            success: true,
            refundId: 'rfnd_1',
            amount: 299,
            currency: 'INR',
            status: 'processed',
            error: '',
          })
          expect(calls[0].url).toBe(API + '/payments/pay_1/refund')
          expect(calls[0].headers['X-Refund-Idempotency']).toBe('refund-pay_1-0')
          expect(calls[0].json).toEqual({ notes: { orderId: 'o1' } })
        }
      )
    )
  })

  it('resolves a stored payment link to its captured payment, and refuses one never paid', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/plink_1')
            ? {
                status: 200,
                body: { id: 'plink_1', payments: [{ payment_id: 'pay_9', status: 'captured' }] },
              }
            : call.url.endsWith('/plink_2')
            ? { status: 200, body: { id: 'plink_2', payments: null } }
            : {
                status: 200,
                body: { id: 'rfnd_2', status: 'pending', amount: 1000, currency: 'INR' },
              },
        async (calls) => {
          const paid = await razorpay.refund({
            paymentReference: 'plink_1',
            amount: 10,
            currency: 'INR',
            idempotencyKey: 'refund-key-1',
          })
          expect(paid).toMatchObject({ success: true, refundId: 'rfnd_2', amount: 10 })
          expect(calls[1].url).toBe(API + '/payments/pay_9/refund')
          expect(calls[1].json.amount).toBe(1000)
          const unpaid = await razorpay.refund({
            paymentReference: 'plink_2',
            amount: 10,
            currency: 'INR',
            idempotencyKey: 'refund-key-2',
          })
          expect(unpaid.error).toBe('This order has no captured Razorpay payment to refund.')
        }
      )
    )
  })
})

describe('Razorpay driver — webhook', () => {
  const raw = Buffer.from('{"event":"payment_link.paid","payload":{}}')
  const signature = crypto.createHmac('sha256', 'whsecret').update(raw).digest('hex')

  it('accepts only a body signed with the webhook secret', async () => {
    await withEnv(ENV, async () => {
      expect(
        await razorpay.verifyWebhook({
          headers: { 'x-razorpay-signature': signature },
          rawBody: raw,
          body: { event: 'payment_link.paid' },
        })
      ).toEqual({
        ok: true,
        body: { event: 'payment_link.paid' },
      })
      expect(
        (
          await razorpay.verifyWebhook({
            headers: { 'x-razorpay-signature': 'ab' + signature.slice(2) },
            rawBody: raw,
            body: {},
          })
        ).ok
      ).toBe(false)
      expect((await razorpay.verifyWebhook({ headers: {}, rawBody: raw, body: {} })).reason).toBe(
        'The X-Razorpay-Signature header is missing.'
      )
    })
  })

  it('refuses everything while no webhook secret is configured', async () => {
    await withEnv(
      {
        ...ENV,
        RAZORPAY_WEBHOOK_SECRET: undefined,
        CONFIGURATION_RAZORPAY_WEBHOOK_SECRET: undefined,
      },
      async () => {
        const result = await razorpay.verifyWebhook({
          headers: { 'x-razorpay-signature': signature },
          rawBody: raw,
          body: {},
        })
        expect(result.ok).toBe(false)
        expect(result.reason).toContain('RAZORPAY_WEBHOOK_SECRET')
      }
    )
  })
})

describe('Razorpay driver — settling a checkout from Razorpay', () => {
  const LINK = 'plink_Ks1TzoWbVEhD6c'
  const SUBSCRIPTION = 'sub_00000000000001'
  const link = (status: string, payments: unknown[] = []) => ({
    id: LINK,
    status,
    amount: 240000,
    amount_paid: status === 'paid' ? 240000 : 0,
    currency: 'INR',
    reference_id: 'order-1',
    notes: { orderId: 'order-1', orderNumber: 'ORD-1' },
    payments,
  })
  const settle = (respond: (url: string) => { status?: number; body?: unknown }, id: string) =>
    withEnv(ENV, () =>
      withFetch(
        (call) => respond(call.url),
        async (calls) => ({
          result: await razorpay.reconcile({ kind: 'checkout', id }),
          urls: calls.map((call) => call.url),
        })
      )
    )

  it('settles a payment link or a subscription by itself', () => {
    expect(razorpay.reconcileKinds(LINK)).toEqual(['checkout'])
    expect(razorpay.reconcileKinds(' ' + SUBSCRIPTION + ' ')).toEqual(['checkout'])
    for (const foreign of ['pay_29QQoUBi66xm2f', 'cs_test_a1b2c3d4e5', '538', 'plink_', '']) {
      expect(razorpay.reconcileKinds(foreign)).toEqual([])
    }
  })

  it('answers a paid link as payment_link.paid, with the payment that paid it', async () => {
    const paid = link('paid', [
      { payment_id: 'pay_failed0001', status: 'failed' },
      { payment_id: 'pay_29QQoUBi66xm2f', status: 'captured' },
    ])
    const payment = {
      id: 'pay_29QQoUBi66xm2f',
      amount: 240000,
      currency: 'INR',
      status: 'captured',
    }
    const { result, urls } = await settle(
      (url) =>
        url.endsWith('/payment_links/' + LINK)
          ? { body: paid }
          : url.endsWith('/payments/pay_29QQoUBi66xm2f')
          ? { body: payment }
          : { status: 404, body: {} },
      LINK
    )
    expect(result).toEqual({
      ok: true,
      body: {
        entity: 'event',
        event: 'payment_link.paid',
        contains: ['payment_link', 'payment'],
        payload: { payment_link: { entity: paid }, payment: { entity: payment } },
        created_at: expect.any(Number),
      },
    })
    expect(urls).toEqual([API + '/payment_links/' + LINK, API + '/payments/pay_29QQoUBi66xm2f'])
  })

  it('answers an expired or cancelled link as itself, and settles nothing for one still taking money', async () => {
    for (const status of ['expired', 'cancelled']) {
      const { result } = await settle(() => ({ body: link(status) }), LINK)
      expect(result).toEqual({
        ok: true,
        body: {
          entity: 'event',
          event: 'payment_link.' + status,
          contains: ['payment_link'],
          payload: { payment_link: { entity: link(status) } },
          created_at: expect.any(Number),
        },
      })
    }
    for (const status of ['created', 'partially_paid']) {
      const { result, urls } = await settle(() => ({ body: link(status) }), LINK)
      expect(result).toEqual({
        ok: false,
        reason: 'Razorpay payment link ' + LINK + ' is ' + status + ', with no payment to settle.',
      })
      expect(urls).toHaveLength(1)
    }
  })

  it("answers a charged subscription as subscription.charged, with its FIRST paid invoice's payment", async () => {
    const subscription = {
      id: SUBSCRIPTION,
      status: 'active',
      notes: { orderId: 'order-1', subscriptionId: 'sub-row-1' },
    }
    const payment = { id: 'pay_first0001', invoice_id: 'inv_first', amount: 49900, currency: 'INR' }
    const { result, urls } = await settle((url) => {
      if (url.endsWith('/subscriptions/' + SUBSCRIPTION)) {
        return { body: subscription }
      }
      if (url.includes('/invoices?')) {
        return {
          body: {
            entity: 'collection',
            items: [
              {
                id: 'inv_second',
                status: 'paid',
                payment_id: 'pay_second0001',
                paid_at: 1790000000,
              },
              { id: 'inv_next', status: 'issued', payment_id: null },
              { id: 'inv_first', status: 'paid', payment_id: 'pay_first0001', paid_at: 1780000000 },
            ],
          },
        }
      }
      return url.endsWith('/payments/pay_first0001') ? { body: payment } : { status: 404, body: {} }
    }, SUBSCRIPTION)
    expect(result).toEqual({
      ok: true,
      body: {
        entity: 'event',
        event: 'subscription.charged',
        contains: ['subscription', 'payment'],
        payload: { subscription: { entity: subscription }, payment: { entity: payment } },
        created_at: expect.any(Number),
      },
    })
    expect(urls[1]).toBe(API + '/invoices?subscription_id=' + SUBSCRIPTION + '&count=100')
  })

  it('answers the mandate of a subscription in its trial, and settles nothing before it is authorised or charged', async () => {
    const authenticated = { id: SUBSCRIPTION, status: 'authenticated' }
    expect((await settle(() => ({ body: authenticated }), SUBSCRIPTION)).result).toMatchObject({
      ok: true,
      body: {
        event: 'subscription.authenticated',
        payload: { subscription: { entity: authenticated } },
      },
    })
    const created = await settle(
      () => ({ body: { id: SUBSCRIPTION, status: 'created' } }),
      SUBSCRIPTION
    )
    expect(created.result).toEqual({
      ok: false,
      reason: 'Razorpay subscription ' + SUBSCRIPTION + ' is not authorised yet.',
    })
    expect(created.urls).toHaveLength(1)
    const uncharged = await settle(
      (url) =>
        url.includes('/invoices?')
          ? { body: { items: [{ id: 'inv_1', status: 'issued' }] } }
          : { body: { id: SUBSCRIPTION, status: 'active' } },
      SUBSCRIPTION
    )
    expect(uncharged.result).toEqual({
      ok: false,
      reason: 'Razorpay has not charged subscription ' + SUBSCRIPTION + ' yet.',
    })
  })

  it('retries an outage, never an id Razorpay does not know', async () => {
    const outage = await settle(() => ({ status: 502, body: null }), LINK)
    expect(outage.result).toMatchObject({ ok: false, retry: true })
    const unknown = await settle(
      () => ({
        status: 400,
        body: {
          error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' },
        },
      }),
      LINK
    )
    expect(unknown.result).toEqual({
      ok: false,
      retry: false,
      reason: 'The id provided does not exist',
    })
    // The link read, its payment not: the settlement waits for both.
    const paymentDown = await settle(
      (url) =>
        url.includes('/payment_links/')
          ? { body: link('paid', [{ payment_id: 'pay_29QQoUBi66xm2f', status: 'captured' }]) }
          : { status: 503, body: null },
      LINK
    )
    expect(paymentDown.result).toMatchObject({ ok: false, retry: true })
  })

  it('asks Razorpay nothing for a request naming no checkout, and retries without keys', async () => {
    for (const request of [
      { kind: 'checkout', id: 'plink_../../payments' },
      { kind: 'checkout', id: 'pay_29QQoUBi66xm2f' },
      { kind: 'refund', id: LINK },
      null,
    ]) {
      const answered = await withEnv(ENV, () =>
        withFetch(
          () => ({ status: 200, body: {} }),
          async (calls) => ({ result: await razorpay.reconcile(request), calls: calls.length })
        )
      )
      expect(answered).toEqual({
        result: { ok: false, reason: 'The request names no Razorpay checkout to settle.' },
        calls: 0,
      })
    }
    const unconfigured = await withEnv(
      { RAZORPAY_KEY_ID: undefined, CONFIGURATION_RAZORPAY_KEY_ID: undefined },
      () =>
        withFetch(
          () => ({ status: 200, body: {} }),
          async (calls) => ({
            result: await razorpay.reconcile({ kind: 'checkout', id: LINK }),
            calls: calls.length,
          })
        )
    )
    expect(unconfigured).toMatchObject({ result: { ok: false, retry: true }, calls: 0 })
  })
})
