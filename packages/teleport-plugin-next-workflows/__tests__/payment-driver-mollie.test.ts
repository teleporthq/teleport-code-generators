import { loadPaymentDrivers } from './_helpers/load-payment-drivers'
import { withEnv, withFetch } from './_helpers/fake-fetch'

/**
 * The Mollie driver EXECUTED against Mollie's documented answers (API v2):
 * JSON bodies, decimal-string amounts, a webhook that carries only the
 * payment id, and subscriptions opened by a FIRST payment.
 */

const mollie = loadPaymentDrivers({ ids: ['mollie'] }).get('mollie')
const KEY = { MOLLIE_API_KEY: 'test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM' }
const API = 'https://api.mollie.com/v2'

const paidFirstPayment = {
  resource: 'payment',
  id: 'tr_first',
  status: 'paid',
  sequenceType: 'first',
  customerId: 'cst_1',
  paidAt: '2026-01-31T10:00:00+00:00',
  webhookUrl: 'https://shop.test/api/webhooks/mollie-payment',
  amount: { value: '10.00', currency: 'EUR' },
  metadata: {
    orderId: 'order-1',
    subscriptionId: 'sub-row-1',
    plan: {
      amount: '10.00',
      currency: 'EUR',
      interval: '1 month',
      trialDays: 0,
      description: 'Coffee club',
    },
  },
}

// The runner is Jest 26, whose modern timers fake the clock; the installed
// @types/jest predates them.
const clock = jest as unknown as {
  useFakeTimers(implementation: 'modern'): void
  setSystemTime(now: Date): void
}

// Runs `run` with the clock at `iso`: when a webhook arrives decides the
// subscription's start date.
const at = async (iso: string, run: () => Promise<any>): Promise<any> => {
  clock.useFakeTimers('modern')
  clock.setSystemTime(new Date(iso))
  try {
    return await run()
  } finally {
    jest.useRealTimers()
  }
}

describe('Mollie driver — one-time checkout', () => {
  it('creates a payment with the exact decimal amount and sends the buyer to its checkout', async () => {
    await withEnv(KEY, () =>
      withFetch(
        () => ({
          status: 201,
          body: { id: 'tr_1', _links: { checkout: { href: 'https://www.mollie.com/checkout/1' } } },
        }),
        async (calls) => {
          const result = await mollie.createCheckout({
            amount: 12.5,
            currency: 'eur',
            description: 'Order ORD-7',
            successUrl: 'https://shop.test/order-details/ORD-7?payment=success',
            cancelUrl: 'https://shop.test/checkout',
            metadata: { orderId: 'order-7', orderNumber: 'ORD-7' },
            baseUrl: 'https://shop.test',
          })
          expect(result).toEqual({
            checkoutUrl: 'https://www.mollie.com/checkout/1',
            sessionId: 'tr_1',
          })
          expect(calls).toHaveLength(1)
          expect(calls[0].url).toBe(API + '/payments')
          expect(calls[0].method).toBe('POST')
          expect(calls[0].headers.Authorization).toBe('Bearer ' + KEY.MOLLIE_API_KEY)
          expect(calls[0].json).toEqual({
            amount: { currency: 'EUR', value: '12.50' },
            description: 'Order ORD-7',
            redirectUrl: 'https://shop.test/order-details/ORD-7?payment=success',
            cancelUrl: 'https://shop.test/checkout',
            webhookUrl: 'https://shop.test/api/webhooks/mollie-payment',
            metadata: { orderId: 'order-7', orderNumber: 'ORD-7' },
          })
        }
      )
    )
  })

  it('leaves the webhook URL out on a local run, which Mollie would refuse', async () => {
    await withEnv(KEY, () =>
      withFetch(
        () => ({
          status: 201,
          body: { id: 'tr_2', _links: { checkout: { href: 'https://m/2' } } },
        }),
        async (calls) => {
          await mollie.createCheckout({
            amount: 5,
            currency: 'JPY',
            baseUrl: 'http://localhost:3001',
          })
          expect(calls[0].json.webhookUrl).toBeUndefined()
          // JPY has no decimals at Mollie.
          expect(calls[0].json.amount).toEqual({ currency: 'JPY', value: '5' })
        }
      )
    )
  })

  it('leaves out a webhook URL on a private network or a local name, and keeps a public one', async () => {
    const local = [
      'http://127.0.0.1:3000',
      'http://0.0.0.0:3000',
      'http://[::1]:3000',
      'http://10.0.0.12:3000',
      'http://172.16.4.2',
      'http://172.31.255.1',
      'http://192.168.1.20:3000',
      'http://169.254.10.1',
      'http://[fd12:3456::1]:3000',
      'http://[fe80::1]',
      'http://my-laptop.local:3000',
      'http://shop.localhost',
      'http://devbox:3000',
    ]
    const reachable = [
      'https://shop.test',
      'https://172.32.0.1',
      'https://tunnel.ngrok.app',
      'http://8.8.8.8',
    ]
    await withEnv(KEY, () =>
      withFetch(
        () => ({
          status: 201,
          body: { id: 'tr_2', _links: { checkout: { href: 'https://m/2' } } },
        }),
        async (calls) => {
          for (const baseUrl of local.concat(reachable)) {
            await mollie.createCheckout({ amount: 5, currency: 'EUR', baseUrl })
          }
          expect(calls.map((call) => call.json.webhookUrl)).toEqual(
            local
              .map(() => undefined)
              .concat(reachable.map((baseUrl) => baseUrl + '/api/webhooks/mollie-payment'))
          )
        }
      )
    )
  })

  it("reports Mollie's own detail on a refusal, and a missing key without calling it", async () => {
    await withEnv(KEY, () =>
      withFetch(
        () => ({
          status: 422,
          body: {
            status: 422,
            title: 'Unprocessable Entity',
            detail: 'The amount is higher than the maximum',
          },
        }),
        async () => {
          const result = await mollie.createCheckout({ amount: 1, currency: 'EUR' })
          expect(result.error).toBe('The amount is higher than the maximum')
        }
      )
    )
    await withEnv({ MOLLIE_API_KEY: undefined, CONFIGURATION_MOLLIE_API_KEY: undefined }, () =>
      withFetch(
        () => {
          throw new Error('no call expected')
        },
        async () => {
          expect((await mollie.createCheckout({ amount: 1, currency: 'EUR' })).error).toBe(
            'MOLLIE_API_KEY is not configured'
          )
        }
      )
    )
  })
})

describe('Mollie driver — subscriptions', () => {
  it('opens a subscription with a customer and a FIRST payment carrying the plan', async () => {
    await withEnv(KEY, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/customers')
            ? { status: 201, body: { id: 'cst_1' } }
            : {
                status: 201,
                body: { id: 'tr_first', _links: { checkout: { href: 'https://m/first' } } },
              },
        async (calls) => {
          const result = await mollie.createSubscriptionCheckout({
            amount: 10,
            amountDue: 7,
            currency: 'EUR',
            recurringInterval: 'year',
            recurringIntervalCount: 1,
            description: 'Coffee club',
            customerEmail: 'jo@shop.test',
            metadata: { orderId: 'order-1', subscriptionId: 'sub-row-1' },
            baseUrl: 'https://shop.test',
          })
          expect(result).toEqual({
            checkoutUrl: 'https://m/first',
            sessionId: 'tr_first',
            providerSubscriptionId: '',
          })
          expect(calls[0].json).toEqual({
            email: 'jo@shop.test',
            metadata: { subscriptionId: 'sub-row-1' },
          })
          expect(calls[1].json).toMatchObject({
            // What is due now: the first cycle less the gift card.
            amount: { currency: 'EUR', value: '7.00' },
            sequenceType: 'first',
            customerId: 'cst_1',
            metadata: {
              orderId: 'order-1',
              subscriptionId: 'sub-row-1',
              plan: { amount: '10.00', currency: 'EUR', interval: '12 months', trialDays: 0 },
            },
          })
        }
      )
    )
  })

  it('takes nothing before a free trial and refuses what Mollie cannot bill', async () => {
    await withEnv(KEY, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/customers')
            ? { status: 201, body: { id: 'cst_1' } }
            : { status: 201, body: { id: 'tr_t', _links: { checkout: { href: 'https://m/t' } } } },
        async (calls) => {
          await mollie.createSubscriptionCheckout({
            amount: 10,
            currency: 'EUR',
            recurringInterval: 'week',
            trialDays: 14,
          })
          expect(calls[1].json.amount).toEqual({ currency: 'EUR', value: '0.00' })
          // Only a card or PayPal can take a zero-amount first payment.
          expect(calls[1].json.method).toEqual(['creditcard', 'paypal'])
          expect(calls[1].json.metadata.plan).toMatchObject({ interval: '1 week', trialDays: 14 })
          const twoYears = await mollie.createSubscriptionCheckout({
            amount: 10,
            currency: 'EUR',
            recurringInterval: 'year',
            recurringIntervalCount: 2,
          })
          expect(twoYears.error).toBe('Mollie bills a subscription at most once a year.')
          const covered = await mollie.createSubscriptionCheckout({
            amount: 10,
            amountDue: 0,
            currency: 'EUR',
            recurringInterval: 'month',
          })
          expect(covered.error).toBe(
            'A gift card cannot cover the whole first payment of a subscription'
          )
        }
      )
    )
  })

  it('cancels (never pauses) through the customer the store keeps with the subscription id', async () => {
    await withEnv(KEY, () =>
      withFetch(
        () => ({ status: 200, body: { id: 'sub_9', status: 'canceled' } }),
        async (calls) => {
          const cancelled = await mollie.manageSubscription({
            subscriptionId: 'cst_1:sub_9',
            action: 'cancel_at_period_end',
          })
          expect(cancelled).toEqual({
            ok: 'true',
            status: 'cancelled',
            cancelAtPeriodEnd: 'false',
            currentPeriodStart: '',
            currentPeriodEnd: '',
          })
          expect(calls[0]).toMatchObject({
            url: API + '/customers/cst_1/subscriptions/sub_9',
            method: 'DELETE',
          })
          const paused = await mollie.manageSubscription({
            subscriptionId: 'cst_1:sub_9',
            action: 'pause',
          })
          expect(paused.error).toBe(
            'Mollie cannot pause or resume a subscription; cancel it instead.'
          )
          const foreign = await mollie.manageSubscription({
            subscriptionId: 'sub_9',
            action: 'cancel',
          })
          expect(foreign.error).toBe('This is not a Mollie subscription reference.')
          expect(calls).toHaveLength(1)
        }
      )
    )
  })

  it('reads the next payment date back on a refresh', async () => {
    await withEnv(KEY, () =>
      withFetch(
        () => ({
          status: 200,
          body: { id: 'sub_9', status: 'active', nextPaymentDate: '2026-03-01' },
        }),
        async (calls) => {
          const state = await mollie.manageSubscription({
            subscriptionId: 'cst_1:sub_9',
            action: 'refresh',
          })
          expect(state).toMatchObject({
            ok: 'true',
            status: 'active',
            currentPeriodEnd: '2026-03-01T00:00:00.000Z',
          })
          expect(calls[0].method).toBe('GET')
        }
      )
    )
  })
})

describe('Mollie driver — webhook', () => {
  it('answers an id the store never asked about, or one Mollie does not know, as ignored', async () => {
    await withEnv(KEY, () =>
      withFetch(
        () => ({ status: 404, body: { status: 404, title: 'Not Found' } }),
        async (calls) => {
          expect(await mollie.verifyWebhook({ body: { id: 're_x' } })).toEqual({
            ok: true,
            body: { resource: 'ignored', id: 're_x' },
          })
          expect(calls).toHaveLength(0)
          expect(await mollie.verifyWebhook({ body: { id: 'tr_unknown' } })).toEqual({
            ok: true,
            body: { resource: 'ignored', id: 'tr_unknown' },
          })
        }
      )
    )
  })

  it('hands the store the payment read back from Mollie, never the posted body', async () => {
    const payment = {
      resource: 'payment',
      id: 'tr_1',
      status: 'paid',
      sequenceType: 'oneoff',
      metadata: { orderId: 'o1' },
    }
    await withEnv(KEY, () =>
      withFetch(
        () => ({ status: 200, body: payment }),
        async (calls) => {
          expect(await mollie.verifyWebhook({ body: { id: 'tr_1', status: 'forged' } })).toEqual({
            ok: true,
            body: payment,
          })
          // Chargebacks come embedded too, so one is never taken for a refund.
          expect(calls[0].url).toBe(API + '/payments/tr_1?embed=refunds,chargebacks')
        }
      )
    )
  })

  it('creates the subscription a paid first payment opens — once, starting a cycle later', async () => {
    await withEnv(KEY, () =>
      withFetch(
        (call) => {
          if (call.url.startsWith(API + '/payments/')) {
            return { status: 200, body: JSON.parse(JSON.stringify(paidFirstPayment)) }
          }
          if (call.method === 'GET') {
            return { status: 200, body: { _embedded: { subscriptions: [] } } }
          }
          return { status: 201, body: { id: 'sub_new', status: 'active', customerId: 'cst_1' } }
        },
        async (calls) => {
          const result = await at('2026-01-31T10:05:00Z', () =>
            mollie.verifyWebhook({ body: { id: 'tr_first' } })
          )
          expect(result.ok).toBe(true)
          expect(result.body.teleportSubscription).toMatchObject({ id: 'sub_new' })
          const create = calls[2]
          expect(create.url).toBe(API + '/customers/cst_1/subscriptions')
          expect(create.headers['Idempotency-Key']).toBe('teleport-activate-tr_first')
          expect(create.json).toMatchObject({
            amount: { currency: 'EUR', value: '10.00' },
            interval: '1 month',
            // Paid on 31 January: the next cycle falls on the last day of February.
            startDate: '2026-02-28',
            webhookUrl: 'https://shop.test/api/webhooks/mollie-payment',
          })
          // Every renewal carries the subscription's metadata: the FIRST order's
          // id there would book a renewal's refund on that order.
          expect(create.json.metadata).toEqual({ subscriptionId: 'sub-row-1' })
        }
      )
    )
  })

  it('never starts billing for a refund or a chargeback of the first payment', async () => {
    for (const givenBack of [
      { amountRefunded: { value: '10.00', currency: 'EUR' } },
      { amountChargedBack: { value: '10.00', currency: 'EUR' } },
    ]) {
      await withEnv(KEY, () =>
        withFetch(
          (call) => {
            if (call.url.startsWith(API + '/payments/')) {
              // Mollie calls the same webhook, and the payment still reads `paid`.
              return {
                status: 200,
                body: {
                  ...JSON.parse(JSON.stringify(paidFirstPayment)),
                  amountRefunded: { value: '0.00', currency: 'EUR' },
                  ...givenBack,
                },
              }
            }
            if (call.method === 'GET') {
              // The customer cancelled before asking for the money back.
              return {
                status: 200,
                body: {
                  _embedded: {
                    subscriptions: [
                      {
                        id: 'sub_old',
                        status: 'canceled',
                        metadata: { subscriptionId: 'sub-row-1' },
                      },
                    ],
                  },
                },
              }
            }
            return { status: 201, body: { id: 'sub_again', status: 'active' } }
          },
          async (calls) => {
            const result = await mollie.verifyWebhook({ body: { id: 'tr_first' } })
            expect(result.ok).toBe(true)
            expect(result.body.teleportSubscription).toBeUndefined()
            expect(calls.map((call) => call.method)).toEqual(['GET'])
          }
        )
      )
    }
  })

  it('never re-creates a subscription it created before and that was cancelled since', async () => {
    await withEnv(KEY, () =>
      withFetch(
        (call) => {
          if (call.url.startsWith(API + '/payments/')) {
            return { status: 200, body: JSON.parse(JSON.stringify(paidFirstPayment)) }
          }
          if (call.method === 'GET') {
            return {
              status: 200,
              body: {
                _embedded: {
                  subscriptions: [
                    {
                      id: 'sub_other',
                      status: 'active',
                      metadata: { subscriptionId: 'sub-row-9' },
                    },
                    {
                      id: 'sub_old',
                      status: 'canceled',
                      metadata: { subscriptionId: 'sub-row-1' },
                    },
                  ],
                },
              },
            }
          }
          return { status: 201, body: { id: 'sub_again', status: 'active' } }
        },
        async (calls) => {
          // Anyone can post a payment id; the driver reads the payment back.
          const result = await mollie.verifyWebhook({ body: { id: 'tr_first' } })
          expect(result.body.teleportSubscription.id).toBe('sub_old')
          expect(calls.map((call) => call.method)).toEqual(['GET', 'GET'])
        }
      )
    )
  })

  it('lets Mollie start a subscription today when the paid cycle has already run out', async () => {
    await withEnv(KEY, () =>
      withFetch(
        (call) => {
          if (call.url.startsWith(API + '/payments/')) {
            return { status: 200, body: JSON.parse(JSON.stringify(paidFirstPayment)) }
          }
          if (call.method === 'GET') {
            return { status: 200, body: { _embedded: { subscriptions: [] } } }
          }
          // Mollie refuses a start date in the past.
          return call.json.startDate && call.json.startDate < '2026-09-28'
            ? { status: 422, body: { detail: 'The start date cannot be in the past' } }
            : { status: 201, body: { id: 'sub_new', status: 'active' } }
        },
        async (calls) => {
          const result = await at('2026-09-28T08:00:00Z', () =>
            mollie.verifyWebhook({ body: { id: 'tr_first' } })
          )
          expect(result.ok).toBe(true)
          expect(result.body.teleportSubscription.id).toBe('sub_new')
          expect(calls[2].json.startDate).toBeUndefined()
        }
      )
    )
  })

  it('reuses the subscription a replayed webhook created before', async () => {
    await withEnv(KEY, () =>
      withFetch(
        (call) =>
          call.url.startsWith(API + '/payments/')
            ? { status: 200, body: JSON.parse(JSON.stringify(paidFirstPayment)) }
            : {
                status: 200,
                body: {
                  _embedded: {
                    subscriptions: [
                      {
                        id: 'sub_old',
                        status: 'active',
                        metadata: { subscriptionId: 'sub-row-1' },
                      },
                    ],
                  },
                },
              },
        async (calls) => {
          const result = await mollie.verifyWebhook({ body: { id: 'tr_first' } })
          expect(result.body.teleportSubscription.id).toBe('sub_old')
          expect(calls.map((call) => call.method)).toEqual(['GET', 'GET'])
        }
      )
    )
  })

  it('asks Mollie to call again, creating nothing, when the subscriptions could not be listed', async () => {
    await withEnv(KEY, () =>
      withFetch(
        (call) => {
          if (call.url.startsWith(API + '/payments/')) {
            return { status: 200, body: JSON.parse(JSON.stringify(paidFirstPayment)) }
          }
          return call.method === 'GET'
            ? { status: 503, body: { detail: 'Temporarily unavailable' } }
            : { status: 201, body: { id: 'sub_second' } }
        },
        async (calls) => {
          const result = await mollie.verifyWebhook({ body: { id: 'tr_first' } })
          expect(result).toMatchObject({ ok: false, retry: true })
          expect(result.reason).toContain('Temporarily unavailable')
          expect(calls.some((call) => call.method === 'POST')).toBe(false)
        }
      )
    )
  })

  it("reads every page of the customer's subscriptions before deciding one must be created", async () => {
    await withEnv(KEY, () =>
      withFetch(
        (call) => {
          if (call.url.startsWith(API + '/payments/')) {
            return { status: 200, body: JSON.parse(JSON.stringify(paidFirstPayment)) }
          }
          if (call.url.includes('from=sub_2')) {
            return {
              status: 200,
              body: {
                _embedded: {
                  subscriptions: [{ id: 'sub_mine', metadata: { subscriptionId: 'sub-row-1' } }],
                },
              },
            }
          }
          return {
            status: 200,
            body: {
              _embedded: {
                subscriptions: [{ id: 'sub_other', metadata: { subscriptionId: 'other' } }],
              },
              _links: {
                next: { href: API + '/customers/cst_1/subscriptions?from=sub_2&limit=250' },
              },
            },
          }
        },
        async (calls) => {
          const result = await mollie.verifyWebhook({ body: { id: 'tr_first' } })
          expect(result.ok).toBe(true)
          expect(result.body.teleportSubscription.id).toBe('sub_mine')
          expect(calls.map((call) => call.method + ' ' + call.url.replace(API, ''))).toEqual([
            'GET /payments/tr_first?embed=refunds,chargebacks',
            'GET /customers/cst_1/subscriptions?limit=250',
            'GET /customers/cst_1/subscriptions?from=sub_2&limit=250',
          ])
        }
      )
    )
  })

  it('asks Mollie to call again when the subscription cannot be created yet', async () => {
    await withEnv(KEY, () =>
      withFetch(
        (call) => {
          if (call.url.startsWith(API + '/payments/')) {
            return { status: 200, body: JSON.parse(JSON.stringify(paidFirstPayment)) }
          }
          return call.method === 'GET'
            ? { status: 200, body: { _embedded: { subscriptions: [] } } }
            : { status: 503, body: { detail: 'Temporarily unavailable' } }
        },
        async () => {
          expect(await mollie.verifyWebhook({ body: { id: 'tr_first' } })).toEqual({
            ok: false,
            retry: true,
            reason: 'Temporarily unavailable',
          })
        }
      )
    )
  })
})

describe('Mollie driver — refunds', () => {
  it('refunds what is left when no amount is given, in the payment currency, with the idempotency key', async () => {
    await withEnv(KEY, () =>
      withFetch(
        (call) =>
          call.method === 'GET'
            ? {
                status: 200,
                body: {
                  id: 'tr_1',
                  amount: { value: '20.00', currency: 'EUR' },
                  amountRemaining: { value: '15.00', currency: 'EUR' },
                },
              }
            : {
                status: 201,
                body: {
                  id: 're_1',
                  status: 'pending',
                  amount: { value: '15.00', currency: 'EUR' },
                },
              },
        async (calls) => {
          const result = await mollie.refund({
            paymentReference: 'tr_1',
            amount: 0,
            currency: 'usd',
            reason: 'Damaged',
            idempotencyKey: 'refund:tr_1:0',
            orderId: 'o1',
          })
          expect(result).toEqual({
            success: true,
            refundId: 're_1',
            amount: 15,
            currency: 'EUR',
            status: 'pending',
            error: '',
          })
          expect(calls[1].url).toBe(API + '/payments/tr_1/refunds')
          expect(calls[1].headers['Idempotency-Key']).toBe('refund:tr_1:0')
          expect(calls[1].json).toEqual({
            amount: { currency: 'EUR', value: '15.00' },
            description: 'Damaged',
            metadata: { orderId: 'o1' },
          })
        }
      )
    )
  })

  it('refuses a reference that is not a Mollie payment, and reports a failed refund as a failure', async () => {
    await withEnv(KEY, () =>
      withFetch(
        (call) =>
          call.method === 'GET'
            ? {
                status: 200,
                body: {
                  id: 'tr_1',
                  amount: { value: '20.00', currency: 'EUR' },
                  amountRemaining: { value: '20.00', currency: 'EUR' },
                },
              }
            : {
                status: 201,
                body: { id: 're_2', status: 'failed', amount: { value: '5.00', currency: 'EUR' } },
              },
        async () => {
          expect(
            (
              await mollie.refund({
                paymentReference: 'pi_1',
                amount: 1,
                currency: 'EUR',
                idempotencyKey: 'k',
              })
            ).error
          ).toBe('This is not a Mollie payment reference.')
          const failed = await mollie.refund({
            paymentReference: 'tr_1',
            amount: 5,
            currency: 'EUR',
            idempotencyKey: 'k',
          })
          expect(failed).toMatchObject({
            success: false,
            refundId: 're_2',
            status: 'failed',
            error: 'Mollie reported the refund as failed.',
          })
        }
      )
    )
  })
})

describe('Mollie driver — settling a payment from Mollie', () => {
  it('settles a payment by itself', () => {
    expect(mollie.reconcileKinds(' tr_WDqYK6vllg ')).toEqual(['checkout'])
    for (const foreign of [
      'cs_test_a1b2c3d4e5',
      'I-BW452GLLEP1G',
      '538',
      'tr_',
      're_4qqhO89gsT',
      '',
    ]) {
      expect(mollie.reconcileKinds(foreign)).toEqual([])
    }
  })

  it('answers the payment read back from Mollie, as its webhook does', async () => {
    const payment = {
      resource: 'payment',
      id: 'tr_WDqYK6vllg',
      status: 'paid',
      sequenceType: 'oneoff',
      amount: { value: '24.00', currency: 'EUR' },
      metadata: { orderId: 'order-1', orderNumber: 'ORD-1' },
    }
    await withEnv(KEY, () =>
      withFetch(
        () => ({ status: 200, body: payment }),
        async (calls) => {
          expect(await mollie.reconcile({ kind: 'checkout', id: 'tr_WDqYK6vllg' })).toEqual({
            ok: true,
            body: payment,
          })
          expect(calls.map((call) => call.url)).toEqual([
            API + '/payments/tr_WDqYK6vllg?embed=refunds,chargebacks',
          ])
        }
      )
    )
  })

  it('starts the subscription a paid first payment opens, as its webhook does', async () => {
    await withEnv(KEY, () =>
      withFetch(
        (call) => {
          if (call.url.startsWith(API + '/payments/')) {
            return { status: 200, body: JSON.parse(JSON.stringify(paidFirstPayment)) }
          }
          if (call.method === 'GET') {
            return { status: 200, body: { _embedded: { subscriptions: [] } } }
          }
          return { status: 201, body: { id: 'sub_new', status: 'active', customerId: 'cst_1' } }
        },
        async (calls) => {
          const result = await at('2026-01-31T10:05:00Z', () =>
            mollie.reconcile({ kind: 'checkout', id: 'tr_first' })
          )
          expect(result.ok).toBe(true)
          expect(result.body.teleportSubscription).toMatchObject({ id: 'sub_new' })
          expect(calls[2].headers['Idempotency-Key']).toBe('teleport-activate-tr_first')
        }
      )
    )
  })

  it('settles nothing for a payment still open or one Mollie does not know, and retries an outage', async () => {
    const answer = (status: number, body: unknown) =>
      withEnv(KEY, () =>
        withFetch(
          () => ({ status, body }),
          () => mollie.reconcile({ kind: 'checkout', id: 'tr_WDqYK6vllg' })
        )
      )
    expect(await answer(200, { resource: 'payment', id: 'tr_WDqYK6vllg', status: 'open' })).toEqual(
      { ok: false, reason: 'Mollie payment tr_WDqYK6vllg is still open.' }
    )
    expect(await answer(404, { status: 404, title: 'Not Found' })).toEqual({
      ok: false,
      reason: 'Mollie does not know payment tr_WDqYK6vllg.',
    })
    expect(await answer(503, { status: 503, title: 'Service Unavailable' })).toMatchObject({
      ok: false,
      retry: true,
    })
  })

  it('asks Mollie nothing for a request naming no payment, and retries without a key', async () => {
    await withEnv(KEY, () =>
      withFetch(
        () => ({ status: 200, body: {} }),
        async (calls) => {
          for (const request of [
            { kind: 'checkout', id: 'tr_../../customers' },
            { kind: 'checkout', id: 're_4qqhO89gsT' },
            { kind: 'refund', id: 'tr_WDqYK6vllg' },
            null,
          ]) {
            expect(await mollie.reconcile(request)).toEqual({
              ok: false,
              reason: 'The request names no Mollie payment to settle.',
            })
          }
          expect(calls).toHaveLength(0)
        }
      )
    )
    await withEnv({ MOLLIE_API_KEY: undefined, CONFIGURATION_MOLLIE_API_KEY: undefined }, () =>
      withFetch(
        () => ({ status: 200, body: {} }),
        async (calls) => {
          expect(await mollie.reconcile({ kind: 'checkout', id: 'tr_WDqYK6vllg' })).toMatchObject({
            ok: false,
            retry: true,
          })
          expect(calls).toHaveLength(0)
        }
      )
    )
  })
})
