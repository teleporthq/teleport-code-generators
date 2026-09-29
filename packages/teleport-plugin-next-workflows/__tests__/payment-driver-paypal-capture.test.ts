import { loadPaymentDrivers } from './_helpers/load-payment-drivers'
import { FakeAnswer, withEnv, withFetch } from './_helpers/fake-fetch'

/**
 * The PayPal driver's capture of an approved order (`confirmReturn`, run by
 * the buyer's return page, the approval webhook and `inspectCheckout`),
 * EXECUTED against PayPal's documented answers. A 201 is not a payment:
 * PayPal completes an order whose capture it declined, so the capture's own
 * status decides. A refusal the buyer can fix names the page to fix it on;
 * an outage, a request in progress (409) or a rate limit (429) is retried.
 */

const paypal = loadPaymentDrivers({ ids: ['paypal'] }).get('paypal')
const ENV = { PAYPAL_CLIENT_ID: 'client-id-1', PAYPAL_CLIENT_SECRET: 'client-secret-1' }

const withCaptures = (orderStatus: string, ...captureStatuses: string[]) => ({
  id: 'ORDER-1',
  status: orderStatus,
  purchase_units: [
    { payments: { captures: captureStatuses.map((status) => ({ id: 'CAP-1', status })) } },
  ],
})

const capture = (answer: FakeAnswer, reread: FakeAnswer = { status: 404, body: {} }) => {
  let orderReads = 0
  return withEnv(ENV, () =>
    withFetch(
      (call) => {
        if (call.url.endsWith('/v1/oauth2/token')) {
          return { status: 200, body: { access_token: 'token' } }
        }
        if (call.url.endsWith('/v2/checkout/orders/ORDER-1/capture')) {
          return answer
        }
        if (call.url.endsWith('/v2/checkout/orders/ORDER-1')) {
          // The read before the capture, then the read after one.
          return orderReads++ === 0
            ? { status: 200, body: { id: 'ORDER-1', status: 'APPROVED' } }
            : reread
        }
        return { status: 404, body: {} }
      },
      async (calls) => ({
        result: await paypal.confirmReturn({ query: { token: 'ORDER-1' } }),
        calls,
      })
    )
  )
}

describe('PayPal driver — capturing an approved order', () => {
  it('pays only on a completed capture, and asks PayPal for the capture in its answer', async () => {
    const { result, calls } = await capture({
      status: 201,
      body: withCaptures('COMPLETED', 'COMPLETED'),
    })
    expect(result).toEqual({
      handled: true,
      ok: true,
      alreadyCaptured: false,
      pending: false,
      status: 'COMPLETED',
    })
    const post = calls.find((call) => call.url.endsWith('/capture'))!
    expect(post.headers.Prefer).toBe('return=representation')
  })

  it('refuses a declined or failed capture for good, though the order says COMPLETED', async () => {
    for (const status of ['DECLINED', 'FAILED']) {
      const { result } = await capture({ status: 201, body: withCaptures('COMPLETED', status) })
      expect(result).toEqual({
        handled: true,
        ok: false,
        retryable: false,
        declined: true,
        error: 'PayPal declined the payment for order ORDER-1.',
      })
    }
  })

  it('takes a capture PayPal holds for review as money on its way, not paid', async () => {
    const { result } = await capture({ status: 201, body: withCaptures('COMPLETED', 'PENDING') })
    expect(result).toMatchObject({ handled: true, ok: true, pending: true, status: 'PENDING' })
  })

  it('reads an order captured before by its capture', async () => {
    const already = { status: 422, body: { details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] } }
    const paid = await capture(already, {
      status: 200,
      body: withCaptures('COMPLETED', 'COMPLETED'),
    })
    expect(paid.result).toMatchObject({ ok: true, alreadyCaptured: true, pending: false })
    const declined = await capture(already, {
      status: 200,
      body: withCaptures('COMPLETED', 'DECLINED'),
    })
    expect(declined.result).toMatchObject({ ok: false, retryable: false, declined: true })
  })

  it('names the page a buyer fixes a refusal on, and never retries it', async () => {
    const declined = await capture({
      status: 422,
      body: {
        details: [{ issue: 'INSTRUMENT_DECLINED', description: 'The instrument was declined.' }],
      },
    })
    expect(declined.result).toEqual({
      handled: true,
      ok: false,
      retryable: false,
      payerActionUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1',
      error: 'The instrument was declined.',
    })
    const refused = await capture({
      status: 422,
      body: { details: [{ issue: 'TRANSACTION_REFUSED' }] },
    })
    expect(refused.result).toMatchObject({ ok: false, retryable: false, payerActionUrl: '' })
  })

  it('retries an outage, a request still in progress and a rate limit', async () => {
    for (const status of [500, 503, 409, 429]) {
      const { result } = await capture({ status, body: { message: 'Try later' } })
      expect(result).toMatchObject({ ok: false, retryable: true, error: 'Try later' })
    }
  })

  it('asks PayPal to deliver an approval again while its capture is rate limited', async () => {
    const approved = {
      id: 'WH-1',
      event_type: 'CHECKOUT.ORDER.APPROVED',
      resource: { id: 'ORDER-1', intent: 'CAPTURE', status: 'APPROVED' },
    }
    const result = await withEnv(
      { ...ENV, PAYPAL_WEBHOOK_ID: undefined, CONFIGURATION_PAYPAL_WEBHOOK_ID: undefined },
      () =>
        withFetch(
          (call) => {
            if (call.url.endsWith('/v1/oauth2/token')) {
              return { status: 200, body: { access_token: 'token' } }
            }
            if (call.url.endsWith('/v1/notifications/webhooks-events/WH-1')) {
              return { status: 200, body: approved }
            }
            if (call.url.endsWith('/capture')) {
              return {
                status: 429,
                body: { name: 'RATE_LIMIT_REACHED', message: 'Too many requests' },
              }
            }
            return { status: 404, body: {} }
          },
          () => paypal.verifyWebhook({ body: { id: 'WH-1' }, headers: {} })
        )
    )
    expect(result).toMatchObject({ ok: false, retry: true })
  })
})
