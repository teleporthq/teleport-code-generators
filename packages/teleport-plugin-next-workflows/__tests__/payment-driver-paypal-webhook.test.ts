import { loadPaymentDrivers } from './_helpers/load-payment-drivers'
import { withEnv, withFetch } from './_helpers/fake-fetch'

/**
 * The PayPal driver's webhook verification EXECUTED: an event is read back
 * from PayPal (no webhook id configured), and an APPROVED order is captured
 * right there — a buyer who closes the tab before returning never triggers
 * the return capture, and an approval alone moves no money.
 */

const paypal = loadPaymentDrivers({ ids: ['paypal'] }).get('paypal')
const ENV = {
  PAYPAL_CLIENT_ID: 'client-id-1',
  PAYPAL_CLIENT_SECRET: 'client-secret-1',
  PAYPAL_WEBHOOK_ID: undefined,
  CONFIGURATION_PAYPAL_WEBHOOK_ID: undefined,
}
const SANDBOX = 'https://api-m.sandbox.paypal.com'

const approved = {
  id: 'WH-1',
  event_type: 'CHECKOUT.ORDER.APPROVED',
  resource: { id: 'ORDER-1', intent: 'CAPTURE', status: 'APPROVED' },
}

const answer = (capture: { status: number; body: unknown }) => (call: { url: string }) => {
  if (call.url.endsWith('/v1/oauth2/token')) {
    return { status: 200, body: { access_token: 'token' } }
  }
  if (call.url.endsWith('/v1/notifications/webhooks-events/WH-1')) {
    return { status: 200, body: approved }
  }
  if (call.url.endsWith('/v2/checkout/orders/ORDER-1/capture')) {
    return capture
  }
  return { status: 404, body: {} }
}

describe('PayPal driver — webhook', () => {
  it('captures an approved order and hands over the event PayPal returned', async () => {
    await withEnv(ENV, () =>
      withFetch(answer({ status: 201, body: { status: 'COMPLETED' } }), async (calls) => {
        const result = await paypal.verifyWebhook({
          body: { id: 'WH-1', event_type: 'forged' },
          headers: {},
        })
        expect(result).toEqual({ ok: true, body: approved })
        expect(calls.map((call) => call.url)).toContain(
          SANDBOX + '/v2/checkout/orders/ORDER-1/capture'
        )
      })
    )
  })

  it('takes an order that was already captured as done', async () => {
    await withEnv(ENV, () =>
      withFetch(
        answer({ status: 422, body: { details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] } }),
        async () => {
          expect(await paypal.verifyWebhook({ body: { id: 'WH-1' }, headers: {} })).toEqual({
            ok: true,
            body: approved,
          })
        }
      )
    )
  })

  it('asks PayPal to deliver again while the capture cannot be made, and not after a refusal', async () => {
    await withEnv(ENV, () =>
      withFetch(answer({ status: 503, body: { message: 'Service unavailable' } }), async () => {
        expect(await paypal.verifyWebhook({ body: { id: 'WH-1' }, headers: {} })).toMatchObject({
          ok: false,
          retry: true,
        })
      })
    )
    await withEnv(ENV, () =>
      withFetch(
        answer({
          status: 422,
          body: { details: [{ issue: 'INSTRUMENT_DECLINED', description: 'Declined' }] },
        }),
        async () => {
          expect(await paypal.verifyWebhook({ body: { id: 'WH-1' }, headers: {} })).toEqual({
            ok: true,
            body: approved,
          })
        }
      )
    )
  })

  it('asks PayPal to check the signature over the event exactly as it arrived', async () => {
    const raw =
      '{"id":"WH-2","event_type":"PAYMENT.SALE.COMPLETED","resource":{"note":"$$ $& $\'","total":1.50}}'
    await withEnv({ ...ENV, PAYPAL_WEBHOOK_ID: 'WH-ID' }, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/v1/oauth2/token')
            ? { status: 200, body: { access_token: 'token' } }
            : { status: 200, body: { verification_status: 'SUCCESS' } },
        async (calls) => {
          const body = JSON.parse(raw)
          const result = await paypal.verifyWebhook({
            body,
            rawBody: Buffer.from(raw),
            headers: { 'paypal-cert-url': 'https://api.sandbox.paypal.com/cert' },
          })
          expect(result).toEqual({ ok: true, body })
          const verify = calls.find((call) => call.url.endsWith('/verify-webhook-signature'))!
          expect(verify.body.endsWith(',"webhook_event":' + raw + '}')).toBe(true)
          expect(verify.json.webhook_id).toBe('WH-ID')
        }
      )
    )
  })

  it('refuses an event PayPal does not know', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/v1/oauth2/token')
            ? { status: 200, body: { access_token: 'token' } }
            : { status: 404, body: {} },
        async (calls) => {
          const result = await paypal.verifyWebhook({ body: { id: 'WH-404' }, headers: {} })
          expect(result.ok).toBe(false)
          expect(calls.some((call) => call.url.includes('/capture'))).toBe(false)
        }
      )
    )
  })
})

describe('PayPal driver — a Webhook ID that does not sign the store events', () => {
  it('reads the event back from PayPal instead of refusing it, and says why', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await withEnv({ ...ENV, PAYPAL_WEBHOOK_ID: 'WH-OF-ANOTHER-APP' }, () =>
        withFetch(
          (call) => {
            if (call.url.endsWith('/v1/oauth2/token')) {
              return { status: 200, body: { access_token: 'token' } }
            }
            if (call.url.endsWith('/verify-webhook-signature')) {
              return { status: 200, body: { verification_status: 'FAILURE' } }
            }
            return answer({ status: 201, body: { status: 'COMPLETED' } })(call)
          },
          async (calls) => {
            const forged = { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} }
            const result = await paypal.verifyWebhook({
              body: forged,
              rawBody: Buffer.from(JSON.stringify(forged)),
              headers: { 'paypal-cert-url': 'https://api.sandbox.paypal.com/cert' },
            })
            // PayPal's own copy of the event, never the posted one.
            expect(result).toEqual({ ok: true, body: approved })
            expect(calls.map((call) => call.url)).toContain(
              SANDBOX + '/v1/notifications/webhooks-events/WH-1'
            )
          }
        )
      )
      expect(String(warn.mock.calls[0][0])).toContain('Webhook ID')
    } finally {
      warn.mockRestore()
    }
  })
})

describe('PayPal driver — settling a payment the store confirmed itself', () => {
  const auth = { status: 200, body: { access_token: 'token' } }
  const order = (captures: unknown[]) => ({
    id: '5O190127TN364715T',
    status: 'COMPLETED',
    purchase_units: [
      { custom_id: '{"orderId":"order-1","orderNumber":"ORD-1"}', payments: { captures } },
    ],
  })

  it('answers a captured order as the capture event PayPal sends, from PayPal alone', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/v1/oauth2/token')
            ? auth
            : call.url.endsWith('/v2/checkout/orders/5O190127TN364715T')
            ? {
                status: 200,
                body: order([
                  {
                    id: 'CAP-DECLINED',
                    status: 'DECLINED',
                    amount: { currency_code: 'USD', value: '24.00' },
                  },
                  {
                    id: 'CAP-1',
                    status: 'COMPLETED',
                    amount: { currency_code: 'USD', value: '24.00' },
                    create_time: '2026-09-29T10:00:00Z',
                  },
                ]),
              }
            : { status: 404, body: {} },
        async () => {
          expect(await paypal.reconcile({ kind: 'order', id: '5O190127TN364715T' })).toEqual({
            ok: true,
            body: {
              id: 'teleport-settle:CAP-1',
              event_type: 'PAYMENT.CAPTURE.COMPLETED',
              resource: {
                id: 'CAP-1',
                status: 'COMPLETED',
                amount: { currency_code: 'USD', value: '24.00' },
                custom_id: '{"orderId":"order-1","orderNumber":"ORD-1"}',
                supplementary_data: { related_ids: { order_id: '5O190127TN364715T' } },
                create_time: '2026-09-29T10:00:00Z',
              },
            },
          })
        }
      )
    )
  })

  it('settles nothing for an order PayPal has not captured, and retries an outage', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) => (call.url.endsWith('/v1/oauth2/token') ? auth : { status: 200, body: order([]) }),
        async () => {
          expect(await paypal.reconcile({ kind: 'order', id: '5O190127TN364715T' })).toMatchObject({
            ok: false,
            reason: 'PayPal order 5O190127TN364715T has no capture to settle.',
          })
        }
      )
    )
    await withEnv(ENV, () =>
      withFetch(
        (call) => (call.url.endsWith('/v1/oauth2/token') ? auth : { status: 503, body: {} }),
        async () => {
          expect(await paypal.reconcile({ kind: 'order', id: '5O190127TN364715T' })).toMatchObject({
            ok: false,
            retry: true,
          })
        }
      )
    )
  })

  it("answers a subscription's mandate and its first payment as PayPal's own events", async () => {
    const subscription = {
      id: 'I-BW452GLLEP1G',
      status: 'ACTIVE',
      custom_id: '{"orderId":"order-1","subscriptionId":"sub-row-1"}',
      create_time: '2026-09-29T10:00:00Z',
      billing_info: { next_billing_time: '2026-10-29T10:00:00Z' },
    }
    await withEnv(ENV, () =>
      withFetch(
        (call) => {
          if (call.url.endsWith('/v1/oauth2/token')) {
            return auth
          }
          if (call.url.endsWith('/v1/billing/subscriptions/I-BW452GLLEP1G')) {
            return { status: 200, body: subscription }
          }
          if (call.url.includes('/v1/billing/subscriptions/I-BW452GLLEP1G/transactions?')) {
            return {
              status: 200,
              body: {
                transactions: [
                  { id: 'SALE-2', status: 'COMPLETED', time: '2026-10-29T10:00:00Z' },
                  {
                    id: 'SALE-1',
                    status: 'COMPLETED',
                    time: '2026-09-29T10:00:05Z',
                    amount_with_breakdown: {
                      gross_amount: { currency_code: 'USD', value: '9.00' },
                    },
                  },
                  { id: 'SALE-0', status: 'DECLINED', time: '2026-09-29T10:00:01Z' },
                ],
              },
            }
          }
          return { status: 404, body: {} }
        },
        async (calls) => {
          expect(await paypal.reconcile({ kind: 'subscription', id: 'I-BW452GLLEP1G' })).toEqual({
            ok: true,
            body: {
              id: 'teleport-settle:I-BW452GLLEP1G',
              event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
              resource: subscription,
            },
          })
          expect(
            await paypal.reconcile({ kind: 'subscription-payment', id: 'I-BW452GLLEP1G' })
          ).toEqual({
            ok: true,
            body: {
              id: 'teleport-settle:SALE-1',
              event_type: 'PAYMENT.SALE.COMPLETED',
              resource: {
                id: 'SALE-1',
                state: 'completed',
                amount: { total: '9.00', currency: 'USD' },
                billing_agreement_id: 'I-BW452GLLEP1G',
                custom: subscription.custom_id,
                create_time: '2026-09-29T10:00:05Z',
              },
            },
          })
          const listed = calls.find((call) => call.url.includes('/transactions?'))!
          expect(listed.url).toContain('start_time=2026-09-28T10%3A00%3A00.000Z')
        }
      )
    )
  })

  it('refuses a subscription that is not active yet, and anything that names no PayPal id', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/v1/oauth2/token')
            ? auth
            : { status: 200, body: { id: 'I-BW452GLLEP1G', status: 'APPROVAL_PENDING' } },
        async (calls) => {
          expect(
            await paypal.reconcile({ kind: 'subscription', id: 'I-BW452GLLEP1G' })
          ).toMatchObject({
            ok: false,
          })
          const before = calls.length
          for (const request of [
            { kind: 'order', id: '../../v1/oauth2' },
            { kind: 'subscription', id: 'BA-123' },
            { kind: 'refund', id: '5O190127TN364715T' },
            null,
          ]) {
            expect(await paypal.reconcile(request)).toEqual({
              ok: false,
              reason: 'The request names no PayPal payment to settle.',
            })
          }
          expect(calls.length).toBe(before)
        }
      )
    )
  })
})

describe('PayPal driver — what settles a checkout', () => {
  it('settles a subscription by its mandate then its first payment, an order by its capture', () => {
    expect(paypal.reconcileKinds('I-BW452GLLEP1G')).toEqual([
      'subscription',
      'subscription-payment',
    ])
    expect(paypal.reconcileKinds(' 5O190127TN364715T ')).toEqual(['order'])
    for (const foreign of ['cs_test_a1b2c3d4e5', 'tr_WDqYK6vllg', 'plink_Ks1', '538', '', null]) {
      expect(paypal.reconcileKinds(foreign)).toEqual([])
    }
  })
})
