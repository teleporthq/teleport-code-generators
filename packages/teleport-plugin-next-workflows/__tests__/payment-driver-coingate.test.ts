import * as crypto from 'crypto'
import { loadPaymentDrivers } from './_helpers/load-payment-drivers'
import { withEnv, withFetch } from './_helpers/fake-fetch'

/**
 * The CoinGate driver EXECUTED against CoinGate's documented answers (API
 * v2): form-encoded orders, an environment found by asking, and unsigned
 * callbacks accepted only with the order's own token and read back.
 */

const coingate = loadPaymentDrivers({ ids: ['coingate'] }).get('coingate')
const ENV = { COINGATE_API_TOKEN: 'token-1', NEXTAUTH_SECRET: 'nextauth-secret' }
const LIVE = 'https://api.coingate.com/v2'
const SANDBOX = 'https://api-sandbox.coingate.com/v2'

const expectedToken = (orderId: string) =>
  crypto
    .createHmac('sha256', 'nextauth-secret')
    .update('coingate-callback:' + orderId)
    .digest('hex')
    .slice(0, 40)

const form = (body: string) => new URLSearchParams(body)

describe('CoinGate driver — invoices', () => {
  it('finds the sandbox by asking, then creates a form-encoded order carrying the callback token', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) => {
          if (call.url === LIVE + '/auth/test') {
            return {
              status: 401,
              body: { message: 'Auth Token is not valid', reason: 'BadAuthToken' },
            }
          }
          if (call.url === SANDBOX + '/auth/test') {
            return { status: 200, body: {} }
          }
          return {
            status: 200,
            body: { id: 538, status: 'new', payment_url: 'https://pay.coingate.test/invoice/1' },
          }
        },
        async (calls) => {
          const result = await coingate.createCheckout({
            amount: 19.99,
            currency: 'eur',
            description: 'Order ORD-9',
            lineItems: [{ name: 'Mug', quantity: 2, unitAmount: 9.995 }],
            successUrl: 'https://shop.test/order-details/ORD-9?payment=success',
            cancelUrl: 'https://shop.test/checkout',
            metadata: { orderId: 'order-9', orderNumber: 'ORD-9' },
            customerEmail: 'jo@shop.test',
            baseUrl: 'https://shop.test',
          })
          expect(result).toEqual({
            checkoutUrl: 'https://pay.coingate.test/invoice/1',
            sessionId: '538',
          })
          const create = calls[2]
          expect(create.url).toBe(SANDBOX + '/orders')
          expect(create.headers.Authorization).toBe('Token token-1')
          expect(create.headers['Content-Type']).toContain('application/x-www-form-urlencoded')
          const body = form(create.body)
          expect(body.get('order_id')).toBe('order-9')
          expect(body.get('price_amount')).toBe('19.99')
          expect(body.get('price_currency')).toBe('EUR')
          expect(body.get('title')).toBe('Order ORD-9')
          expect(body.get('description')).toBe('2 x Mug')
          expect(body.get('callback_url')).toBe('https://shop.test/api/webhooks/coingate-payment')
          expect(body.get('token')).toBe(expectedToken('order-9'))
          expect(body.get('shopper[email]')).toBe('jo@shop.test')
        }
      )
    )
  })

  it('remembers the environment for the process, and sends no callback URL CoinGate cannot reach', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/auth/test')
            ? { status: 200, body: {} }
            : { status: 200, body: { id: 1, payment_url: 'https://pay/1' } },
        async (calls) => {
          await coingate.createCheckout({
            amount: 5,
            currency: 'USD',
            metadata: { orderId: 'o1' },
            baseUrl: 'http://localhost:3001',
          })
          await coingate.createCheckout({
            amount: 5,
            currency: 'USD',
            metadata: { orderId: 'o2' },
            baseUrl: 'http://localhost:3001',
          })
          expect(calls.map((call) => call.url)).toEqual([
            LIVE + '/auth/test',
            LIVE + '/orders',
            LIVE + '/orders',
          ])
          expect(form(calls[1].body).get('callback_url')).toBeNull()
        }
      )
    )
  })

  it('needs the store order, and reports CoinGate’s validation errors', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/auth/test')
            ? { status: 200, body: {} }
            : {
                status: 422,
                body: {
                  message: 'Order is not valid',
                  reason: 'OrderIsNotValid',
                  errors: ["Price can't be blank"],
                },
              },
        async () => {
          expect((await coingate.createCheckout({ amount: 5, currency: 'EUR' })).error).toBe(
            'A CoinGate invoice needs the store order it pays.'
          )
          expect(
            (
              await coingate.createCheckout({
                amount: 5,
                currency: 'EUR',
                metadata: { orderId: 'o1' },
              })
            ).error
          ).toBe("Order is not valid: Price can't be blank")
        }
      )
    )
  })

  it('bills the first cycle of a store-billed subscription as an ordinary invoice, without a trial', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/auth/test')
            ? { status: 200, body: {} }
            : { status: 200, body: { id: 7, payment_url: 'https://pay/7' } },
        async (calls) => {
          const result = await coingate.createSubscriptionCheckout({
            amount: 30,
            amountDue: 20,
            currency: 'EUR',
            metadata: { orderId: 'o1', subscriptionId: 's1' },
          })
          expect(result).toEqual({
            checkoutUrl: 'https://pay/7',
            sessionId: '7',
            providerSubscriptionId: '',
          })
          expect(form(calls[1].body).get('price_amount')).toBe('20.00')
          const trial = await coingate.createSubscriptionCheckout({
            amount: 30,
            trialDays: 7,
            currency: 'EUR',
            metadata: { orderId: 'o1' },
          })
          expect(trial.error).toContain('cannot start with a free trial')
        }
      )
    )
  })

  it('never refunds or manages anything itself', async () => {
    const refund = await coingate.refund({ paymentReference: '7', amount: 5, currency: 'eur' })
    expect(refund).toMatchObject({ success: false, currency: 'EUR' })
    expect(refund.error).toContain('CoinGate dashboard')
    expect(
      (await coingate.manageSubscription({ subscriptionId: 'x', action: 'cancel' })).error
    ).toBe('CoinGate subscriptions are billed by the store, not by CoinGate.')
  })
})

describe('CoinGate driver — callbacks', () => {
  const fetched = {
    id: 538,
    order_id: 'order-9',
    status: 'paid',
    price_amount: '19.99',
    price_currency: 'EUR',
  }

  it('accepts a callback carrying the order token and hands over the order CoinGate reports', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/auth/test')
            ? { status: 200, body: {} }
            : { status: 200, body: fetched },
        async (calls) => {
          const result = await coingate.verifyWebhook({
            body: {
              id: '538',
              order_id: 'order-9',
              status: 'paid',
              token: expectedToken('order-9'),
              price_amount: '0.01',
            },
          })
          expect(result).toEqual({ ok: true, body: fetched })
          expect(calls[1].url).toBe(LIVE + '/orders/538')
        }
      )
    )
  })

  it('still accepts a callback whose token was keyed on the API token, so a rotated NEXTAUTH_SECRET ends no open invoice', async () => {
    const apiTokenKeyed = crypto
      .createHmac('sha256', 'token-1')
      .update('coingate-callback:order-9')
      .digest('hex')
      .slice(0, 40)
    await withEnv({ ...ENV, NEXTAUTH_SECRET: 'rotated-secret' }, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/auth/test')
            ? { status: 200, body: {} }
            : { status: 200, body: fetched },
        async () => {
          expect(
            await coingate.verifyWebhook({
              body: { id: '538', order_id: 'order-9', status: 'paid', token: apiTokenKeyed },
            })
          ).toEqual({ ok: true, body: fetched })
          // A token keyed on the secret before its rotation is refused.
          expect(
            (
              await coingate.verifyWebhook({
                body: { id: '538', order_id: 'order-9', token: expectedToken('order-9') },
              })
            ).ok
          ).toBe(false)
        }
      )
    )
  })

  it('verifies a refund callback, which carries no token, by reading the order and its refunds back', async () => {
    // CoinGate's documented refund callback: its own refund and order ids, no token.
    const refundCallback = {
      id: 77,
      order_id: 538,
      status: 'completed',
      request_amount: '5.0',
      request_currency: { id: 2, symbol: 'EUR' },
      refund_currency: { id: 1, symbol: 'BTC' },
    }
    const order = { ...fetched, status: 'partially_refunded' }
    const refunds = {
      refunds: [{ id: 77, status: 'completed', request_amount: '5.0' }],
      total_pages: 1,
    }
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/auth/test')
            ? { status: 200, body: {} }
            : call.url.includes('/refunds')
            ? { status: 200, body: refunds }
            : { status: 200, body: order },
        async (calls) => {
          const result = await coingate.verifyWebhook({ body: refundCallback })
          expect(result).toEqual({
            ok: true,
            body: { ...order, refunds: refunds.refunds, teleportCallback: 'refund' },
          })
          expect(calls.slice(1).map((call) => call.url)).toEqual([
            LIVE + '/orders/538',
            LIVE + '/orders/538/refunds?per_page=100',
          ])
        }
      )
    )
  })

  it('refuses a refund callback naming a refund CoinGate does not list, and retries an outage', async () => {
    const refundCallback = { id: 99, order_id: 538, status: 'completed', request_amount: '5.0' }
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/auth/test')
            ? { status: 200, body: {} }
            : call.url.includes('/refunds')
            ? { status: 200, body: { refunds: [{ id: 77, status: 'completed' }] } }
            : { status: 200, body: fetched },
        async () => {
          expect(await coingate.verifyWebhook({ body: refundCallback })).toEqual({
            ok: false,
            reason: 'CoinGate lists no refund 99 on order 538.',
          })
        }
      )
    )
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/auth/test')
            ? { status: 200, body: {} }
            : { status: 500, body: { message: 'boom' } },
        async () => {
          expect(await coingate.verifyWebhook({ body: refundCallback })).toMatchObject({
            ok: false,
            retry: true,
          })
        }
      )
    )
    // An order callback without its token is never taken for a refund callback.
    await withEnv(ENV, () =>
      withFetch(
        () => {
          throw new Error('no call expected')
        },
        async () => {
          const forged = await coingate.verifyWebhook({
            body: { id: '538', order_id: 'order-9', status: 'paid', price_amount: '19.99' },
          })
          expect(forged.ok).toBe(false)
        }
      )
    )
  })

  it('refuses a callback without the token without asking CoinGate anything', async () => {
    await withEnv(ENV, () =>
      withFetch(
        () => {
          throw new Error('no call expected')
        },
        async () => {
          const result = await coingate.verifyWebhook({
            body: { id: '538', order_id: 'order-9', status: 'paid', token: 'forged' },
          })
          expect(result.ok).toBe(false)
          expect(result.retry).toBeUndefined()
        }
      )
    )
  })

  it('refuses an order that belongs to another store order, and retries an outage', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/auth/test')
            ? { status: 200, body: {} }
            : { status: 200, body: { ...fetched, order_id: 'order-1' } },
        async () => {
          const result = await coingate.verifyWebhook({
            body: { id: '538', order_id: 'order-9', token: expectedToken('order-9') },
          })
          expect(result).toEqual({
            ok: false,
            reason: 'The CoinGate order 538 belongs to another store order.',
          })
        }
      )
    )
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/auth/test')
            ? { status: 200, body: {} }
            : { status: 500, body: { message: 'boom' } },
        async () => {
          const result = await coingate.verifyWebhook({
            body: { id: '538', order_id: 'order-9', token: expectedToken('order-9') },
          })
          expect(result).toMatchObject({ ok: false, retry: true })
        }
      )
    )
  })
})

describe('CoinGate driver — settling an invoice from CoinGate', () => {
  const answer = (status: number, body: unknown) => (call: { url: string }) =>
    call.url.endsWith('/auth/test') ? { status: 200, body: {} } : { status, body }

  it('settles an invoice by itself', () => {
    expect(coingate.reconcileKinds(' 538 ')).toEqual(['checkout'])
    for (const foreign of [
      'tr_WDqYK6vllg',
      'cs_test_a1b2c3d4e5',
      '5O190127TN364715T',
      '53.8',
      '',
    ]) {
      expect(coingate.reconcileKinds(foreign)).toEqual([])
    }
  })

  it('answers the order read back from CoinGate, as its callback does', async () => {
    const order = {
      id: 538,
      order_id: 'order-9',
      status: 'paid',
      price_amount: '19.99',
      price_currency: 'EUR',
    }
    await withEnv(ENV, () =>
      withFetch(answer(200, order), async (calls) => {
        expect(await coingate.reconcile({ kind: 'checkout', id: '538' })).toEqual({
          ok: true,
          body: order,
        })
        expect(calls[calls.length - 1].url).toBe(LIVE + '/orders/538')
      })
    )
  })

  it('settles nothing while the invoice waits for coins or CoinGate does not know it, and retries an outage', async () => {
    const settle = (status: number, body: unknown) =>
      withEnv(ENV, () =>
        withFetch(answer(status, body), () => coingate.reconcile({ kind: 'checkout', id: '538' }))
      )
    for (const waiting of ['new', 'pending']) {
      expect(await settle(200, { id: 538, order_id: 'order-9', status: waiting })).toEqual({
        ok: false,
        reason: 'CoinGate order 538 is still waiting for its coins.',
      })
    }
    // Confirming on the network: the store reads it as awaiting.
    expect(await settle(200, { id: 538, status: 'confirming' })).toMatchObject({ ok: true })
    expect(await settle(404, { message: 'Order not found' })).toMatchObject({
      ok: false,
      retry: false,
    })
    expect(await settle(502, null)).toMatchObject({ ok: false, retry: true })
  })

  it('asks CoinGate nothing for a request naming no order, and retries without a token', async () => {
    await withEnv(ENV, () =>
      withFetch(answer(200, {}), async (calls) => {
        for (const request of [
          { kind: 'checkout', id: '538/refunds' },
          { kind: 'checkout', id: 'order-9' },
          { kind: 'order', id: '538' },
          null,
        ]) {
          expect(await coingate.reconcile(request)).toEqual({
            ok: false,
            reason: 'The request names no CoinGate order to settle.',
          })
        }
        expect(calls).toHaveLength(0)
      })
    )
    await withEnv(
      { COINGATE_API_TOKEN: undefined, CONFIGURATION_COINGATE_API_TOKEN: undefined },
      () =>
        withFetch(answer(200, {}), async (calls) => {
          expect(await coingate.reconcile({ kind: 'checkout', id: '538' })).toMatchObject({
            ok: false,
            retry: true,
          })
          expect(calls).toHaveLength(0)
        })
    )
  })
})
