import * as crypto from 'crypto'
import { loadPaymentDrivers } from './_helpers/load-payment-drivers'
import { withEnv, withFetch } from './_helpers/fake-fetch'

/**
 * The Paddle driver EXECUTED against Paddle Billing's documented answers:
 * tax-inclusive non-catalog transactions opened on the store's own page,
 * refunds as adjustments, portal sessions, and the `ts;h1` signature the
 * store requires on every notification.
 */

const paddle = loadPaymentDrivers({ ids: ['paddle'] }).get('paddle')
const ENV = {
  PADDLE_API_KEY: 'pdl_sdbx_apikey_1',
  PADDLE_CLIENT_TOKEN: 'test_client_1',
  PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_secret',
}
const SANDBOX = 'https://sandbox-api.paddle.com'
const LIVE = 'https://api.paddle.com'

const transaction = {
  data: { id: 'txn_01', checkout: { url: 'https://shop.test/pay/paddle?_ptxn=txn_01' } },
}

describe('Paddle driver — checkout', () => {
  it('opens a tax-inclusive transaction per line on the store page, carrying where the buyer goes', async () => {
    await withEnv(ENV, () =>
      withFetch(
        () => ({ status: 201, body: transaction }),
        async (calls) => {
          const result = await paddle.createCheckout({
            amount: 25,
            currency: 'eur',
            lineItems: [{ name: 'E-book', unitAmount: 12.5, quantity: 2 }],
            successUrl: 'https://shop.test/order-details/ORD-1?payment=success',
            cancelUrl: 'https://shop.test/checkout',
            metadata: { orderId: 'order-1', orderNumber: 'ORD-1' },
            baseUrl: 'https://shop.test',
          })
          expect(result).toEqual({
            checkoutUrl: 'https://shop.test/pay/paddle?_ptxn=txn_01',
            sessionId: 'txn_01',
          })
          expect(calls[0].url).toBe(SANDBOX + '/transactions')
          expect(calls[0].headers.Authorization).toBe('Bearer pdl_sdbx_apikey_1')
          expect(calls[0].json).toEqual({
            items: [
              {
                quantity: 2,
                price: {
                  description: 'E-book',
                  name: 'E-book',
                  unit_price: { amount: '1250', currency_code: 'EUR' },
                  tax_mode: 'internal',
                  product: { name: 'E-book', tax_category: 'standard' },
                },
              },
            ],
            currency_code: 'EUR',
            custom_data: {
              orderId: 'order-1',
              orderNumber: 'ORD-1',
              subscriptionId: '',
              successUrl: 'https://shop.test/order-details/ORD-1?payment=success',
              cancelUrl: 'https://shop.test/checkout',
            },
            checkout: { url: 'https://shop.test/pay/paddle' },
          })
        }
      )
    )
  })

  it('opens on the default payment link when Paddle has not approved the address the buyer is on', async () => {
    const unapproved = {
      status: 400,
      body: {
        error: {
          type: 'request_error',
          code: 'transaction_checkout_url_domain_is_not_approved',
          detail:
            'The value you passed for `checkout.url` does not contain a domain that has been approved by Paddle',
        },
      },
    }
    const onDefaultLink = {
      data: { id: 'txn_02', checkout: { url: 'https://shop.example/pay/paddle?_ptxn=txn_02' } },
    }
    await withEnv(ENV, () =>
      withFetch(
        (call) => (call.json.checkout ? unapproved : { status: 201, body: onDefaultLink }),
        async (calls) => {
          const result = await paddle.createCheckout({
            amount: 5,
            currency: 'USD',
            metadata: { orderId: 'order-2' },
            baseUrl: 'http://localhost:3001',
          })
          expect(result).toEqual({
            checkoutUrl: 'https://shop.example/pay/paddle?_ptxn=txn_02',
            sessionId: 'txn_02',
          })
          expect(calls).toHaveLength(2)
          expect(calls[0].json.checkout).toEqual({ url: 'http://localhost:3001/pay/paddle' })
          expect(calls[1].json.checkout).toBeUndefined()
          expect(calls[1].json.custom_data).toEqual(calls[0].json.custom_data)
        }
      )
    )
  })

  it('reports a missing default payment link, and names no page it cannot make absolute', async () => {
    const noDefaultLink = {
      status: 400,
      body: {
        error: {
          type: 'request_error',
          code: 'transaction_default_checkout_url_not_set',
          detail:
            'Cannot create a transaction or open a checkout as no default payment link has been set for this account.',
        },
      },
    }
    await withEnv(ENV, () =>
      withFetch(
        () => noDefaultLink,
        async (calls) => {
          const result = await paddle.createCheckout({
            amount: 5,
            currency: 'USD',
            metadata: { orderId: 'order-3' },
          })
          expect(result.error).toBe(
            'Cannot create a transaction or open a checkout as no default payment link has been set for this account.'
          )
          // Asked once: only an unapproved address is asked about again.
          expect(calls).toHaveLength(1)
          expect(calls[0].json.checkout).toBeUndefined()
        }
      )
    )
  })

  it('knows its environment from the key, and a legacy key from the client token', async () => {
    const hosts: string[] = []
    const probe = async (env: Record<string, string>) =>
      withEnv({ ...ENV, ...env }, () =>
        withFetch(
          () => ({ status: 201, body: transaction }),
          async (calls) => {
            await paddle.createCheckout({ amount: 5, currency: 'USD', metadata: { orderId: 'o' } })
            hosts.push(calls[0].url.replace('/transactions', ''))
          }
        )
      )
    await probe({ PADDLE_API_KEY: 'pdl_live_apikey_1' })
    await probe({ PADDLE_API_KEY: 'legacy-key', PADDLE_CLIENT_TOKEN: 'test_abc' })
    await probe({ PADDLE_API_KEY: 'legacy-key', PADDLE_CLIENT_TOKEN: 'live_abc' })
    expect(hosts).toEqual([LIVE, SANDBOX, LIVE])
  })

  it('reports Paddle’s field errors, and needs a key before calling anything', async () => {
    await withEnv(ENV, () =>
      withFetch(
        () => ({
          status: 400,
          body: {
            error: {
              type: 'request_error',
              code: 'bad_request',
              detail: 'Invalid request.',
              errors: [{ field: 'currency_code', message: 'is not supported' }],
            },
          },
        }),
        async () => {
          const result = await paddle.createCheckout({
            amount: 5,
            currency: 'XYZ',
            metadata: { orderId: 'o' },
          })
          expect(result.error).toBe('Invalid request. (currency_code is not supported)')
        }
      )
    )
    await withEnv(
      { PADDLE_API_KEY: undefined, CONFIGURATION_PADDLE_API_KEY: undefined },
      async () => {
        expect((await paddle.createCheckout({ amount: 5, currency: 'USD' })).error).toBe(
          'PADDLE_API_KEY is not configured'
        )
      }
    )
  })

  it('bills a subscription through a recurring price with its trial, and refuses a gift card toward it', async () => {
    await withEnv(ENV, () =>
      withFetch(
        () => ({ status: 201, body: transaction }),
        async (calls) => {
          const result = await paddle.createSubscriptionCheckout({
            amount: 9,
            currency: 'USD',
            description: 'Pro plan',
            recurringInterval: 'month',
            recurringIntervalCount: 3,
            trialDays: 14,
            metadata: { orderId: 'order-1', subscriptionId: 'sub-row-1' },
          })
          expect(result).toEqual({
            checkoutUrl: 'https://shop.test/pay/paddle?_ptxn=txn_01',
            sessionId: 'txn_01',
            providerSubscriptionId: '',
          })
          const price = calls[0].json.items[0].price
          expect(price.billing_cycle).toEqual({ interval: 'month', frequency: 3 })
          expect(price.trial_period).toEqual({ interval: 'day', frequency: 14 })
          expect(calls[0].json.custom_data.subscriptionId).toBe('sub-row-1')
          expect(
            (await paddle.createSubscriptionCheckout({ amount: 9, amountDue: 4, currency: 'USD' }))
              .error
          ).toBe('Paddle cannot take a gift card toward a subscription payment.')
          expect(
            (
              await paddle.createSubscriptionCheckout({
                amount: 9,
                currency: 'USD',
                recurringInterval: 'fortnight',
              })
            ).error
          ).toBe('Unknown billing interval "fortnight"')
          expect(calls).toHaveLength(1)
        }
      )
    )
  })

  it('needs no plan: the price travels on each transaction', async () => {
    expect(await paddle.ensurePlan({ amount: 9, currency: 'USD', interval: 'month' })).toEqual({
      ok: 'true',
      planId: '',
      providerProductId: '',
      created: 'false',
    })
  })
})

describe('Paddle driver — subscriptions', () => {
  const subscription = (status: string, scheduled: unknown = null) => ({
    data: {
      id: 'sub_01',
      status,
      scheduled_change: scheduled,
      current_billing_period: {
        starts_at: '2026-01-01T00:00:00Z',
        ends_at: '2026-02-01T00:00:00Z',
      },
    },
  })

  it('maps every action onto its Paddle call', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) => {
          if (call.url.endsWith('/cancel') && call.json.effective_from === 'next_billing_period') {
            return {
              body: subscription('active', {
                action: 'cancel',
                effective_at: '2026-02-01T00:00:00Z',
              }),
            }
          }
          if (call.url.endsWith('/cancel')) {
            return { body: subscription('canceled') }
          }
          if (call.url.endsWith('/pause')) {
            return { body: subscription('paused') }
          }
          return { body: subscription('active') }
        },
        async (calls) => {
          expect(
            await paddle.manageSubscription({
              subscriptionId: 'sub_01',
              action: 'cancel_at_period_end',
            })
          ).toEqual({
            ok: 'true',
            status: 'active',
            cancelAtPeriodEnd: 'true',
            currentPeriodStart: '2026-01-01T00:00:00Z',
            currentPeriodEnd: '2026-02-01T00:00:00Z',
          })
          expect(
            (await paddle.manageSubscription({ subscriptionId: 'sub_01', action: 'cancel' })).status
          ).toBe('cancelled')
          expect(
            (await paddle.manageSubscription({ subscriptionId: 'sub_01', action: 'pause' })).status
          ).toBe('paused')
          expect(
            (await paddle.manageSubscription({ subscriptionId: 'sub_01', action: 'refresh' }))
              .status
          ).toBe('active')
          expect(
            calls.map((call) => [call.method, call.url.replace(SANDBOX, ''), call.json])
          ).toEqual([
            ['POST', '/subscriptions/sub_01/cancel', { effective_from: 'next_billing_period' }],
            ['POST', '/subscriptions/sub_01/cancel', { effective_from: 'immediately' }],
            ['POST', '/subscriptions/sub_01/pause', { effective_from: 'immediately' }],
            ['GET', '/subscriptions/sub_01', null],
          ])
        }
      )
    )
  })

  it('resumes a paused subscription, and withdraws a scheduled change on an active one', async () => {
    const run = (current: string) =>
      withEnv(ENV, () =>
        withFetch(
          (call) =>
            call.method === 'GET'
              ? { body: subscription(current) }
              : { body: subscription('active') },
          async (calls) => {
            expect(
              (await paddle.manageSubscription({ subscriptionId: 'sub_01', action: 'resume' }))
                .status
            ).toBe('active')
            return calls.map((call) => [call.method, call.url.replace(SANDBOX, ''), call.json])
          }
        )
      )
    expect(await run('paused')).toEqual([
      ['GET', '/subscriptions/sub_01', null],
      ['POST', '/subscriptions/sub_01/resume', { effective_from: 'immediately' }],
    ])
    expect(await run('active')).toEqual([
      ['GET', '/subscriptions/sub_01', null],
      ['PATCH', '/subscriptions/sub_01', { scheduled_change: null }],
    ])
  })

  it('opens a portal session for the subscriber, scoped to the subscription', async () => {
    await withEnv(ENV, () =>
      withFetch(
        () => ({
          status: 201,
          body: {
            data: { urls: { general: { overview: 'https://customer-portal.paddle.com/cpl_1' } } },
          },
        }),
        async (calls) => {
          expect(
            await paddle.billingPortal({
              customerId: 'ctm_01',
              subscriptionId: 'sub_01',
              returnUrl: 'https://shop.test',
            })
          ).toEqual({
            ok: 'true',
            url: 'https://customer-portal.paddle.com/cpl_1',
          })
          expect(calls[0].url).toBe(SANDBOX + '/customers/ctm_01/portal-sessions')
          expect(calls[0].json).toEqual({ subscription_ids: ['sub_01'] })
          expect((await paddle.billingPortal({ customerId: '' })).error).toBe(
            'No Paddle customer is attached to this subscription yet.'
          )
        }
      )
    )
  })
})

describe('Paddle driver — refunds', () => {
  const adjustment = (status: string, total: string) => ({
    data: { id: 'adj_01', status, currency_code: 'EUR', totals: { total } },
  })

  it('refunds the whole transaction as one full adjustment, waiting for Paddle’s approval', async () => {
    await withEnv(ENV, () =>
      withFetch(
        () => ({ status: 201, body: adjustment('pending_approval', '2500') }),
        async (calls) => {
          const result = await paddle.refund({
            paymentReference: 'txn_01',
            amount: 0,
            currency: 'EUR',
            reason: 'Changed mind',
          })
          expect(result).toEqual({
            success: true,
            refundId: 'adj_01',
            amount: 25,
            currency: 'EUR',
            status: 'pending_approval',
            error: '',
          })
          expect(calls[0].json).toEqual({
            action: 'refund',
            transaction_id: 'txn_01',
            reason: 'Changed mind',
            type: 'full',
          })
        }
      )
    )
  })

  it('spreads a partial amount over the lines, largest first', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.method === 'GET'
            ? {
                body: {
                  data: {
                    details: {
                      line_items: [
                        { id: 'txnitm_small', totals: { total: '500' } },
                        { id: 'txnitm_big', totals: { total: '2000' } },
                      ],
                    },
                  },
                },
              }
            : { status: 201, body: adjustment('pending_approval', '2200') },
        async (calls) => {
          const result = await paddle.refund({
            paymentReference: 'txn_01',
            amount: 22,
            currency: 'EUR',
          })
          expect(result.amount).toBe(22)
          expect(calls[1].json).toEqual({
            action: 'refund',
            transaction_id: 'txn_01',
            reason: 'Refund requested by the store',
            type: 'partial',
            items: [
              { item_id: 'txnitm_big', type: 'partial', amount: '2000' },
              { item_id: 'txnitm_small', type: 'partial', amount: '200' },
            ],
          })
          const tooMuch = await paddle.refund({
            paymentReference: 'txn_01',
            amount: 26,
            currency: 'EUR',
          })
          expect(tooMuch.error).toBe('The amount is more than this Paddle transaction can refund.')
        }
      )
    )
  })

  it('spreads a partial amount over what each line has left after earlier refunds', async () => {
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.method === 'GET'
            ? {
                body: {
                  data: {
                    details: {
                      line_items: [
                        { id: 'txnitm_big', totals: { total: '3000' } },
                        { id: 'txnitm_small', totals: { total: '1000' } },
                      ],
                    },
                    adjustments: [
                      {
                        action: 'refund',
                        status: 'approved',
                        items: [{ item_id: 'txnitm_big', type: 'partial', amount: '2500' }],
                      },
                      {
                        action: 'refund',
                        status: 'pending_approval',
                        items: [{ item_id: 'txnitm_small', type: 'partial', amount: '200' }],
                      },
                      // A rejected refund gave nothing back.
                      {
                        action: 'refund',
                        status: 'rejected',
                        items: [{ item_id: 'txnitm_small', type: 'full', amount: '1000' }],
                      },
                    ],
                  },
                },
              }
            : { status: 201, body: adjustment('pending_approval', '1000') },
        async (calls) => {
          await paddle.refund({ paymentReference: 'txn_01', amount: 10, currency: 'EUR' })
          expect(calls[0].url).toBe(SANDBOX + '/transactions/txn_01?include=adjustments')
          // 500 left on the big line and 800 on the small one.
          expect(calls[1].json.items).toEqual([
            { item_id: 'txnitm_small', type: 'partial', amount: '800' },
            { item_id: 'txnitm_big', type: 'partial', amount: '200' },
          ])
          const tooMuch = await paddle.refund({
            paymentReference: 'txn_01',
            amount: 13.01,
            currency: 'EUR',
          })
          expect(tooMuch.error).toBe('The amount is more than this Paddle transaction can refund.')
        }
      )
    )
  })

  it('marks a refund with its key and returns the adjustment an earlier attempt created instead of refunding twice', async () => {
    const marker =
      '[ref ' +
      crypto
        .createHmac('sha256', 'paddle-refund')
        .update('refund:o-1:0:2500')
        .digest('hex')
        .slice(0, 12) +
      ']'
    let posted = 0
    await withEnv(ENV, () =>
      withFetch(
        (call) => {
          if (call.method === 'GET') {
            return {
              body: {
                data: {
                  id: 'txn_01',
                  adjustments: posted
                    ? [
                        {
                          id: 'adj_first',
                          action: 'refund',
                          status: 'pending_approval',
                          reason: 'Changed mind ' + marker,
                          currency_code: 'EUR',
                          totals: { total: '2500' },
                        },
                      ]
                    : [],
                },
              },
            }
          }
          posted += 1
          return { status: 201, body: adjustment('pending_approval', '2500') }
        },
        async (calls) => {
          const request = {
            paymentReference: 'txn_01',
            amount: 0,
            currency: 'EUR',
            reason: 'Changed mind',
            idempotencyKey: 'refund:o-1:0:2500',
          }
          const first = await paddle.refund(request)
          expect(first).toMatchObject({ success: true, refundId: 'adj_01' })
          expect(calls[0].url).toBe(SANDBOX + '/transactions/txn_01?include=adjustments')
          expect(calls[1].json).toEqual({
            action: 'refund',
            transaction_id: 'txn_01',
            reason: 'Changed mind ' + marker,
            type: 'full',
          })
          const retried = await paddle.refund(request)
          expect(retried).toEqual({
            success: true,
            refundId: 'adj_first',
            amount: 25,
            currency: 'EUR',
            status: 'pending_approval',
            error: '',
          })
          expect(posted).toBe(1)
        }
      )
    )
  })

  it('refunds again when the earlier attempt with the same key was rejected, and refuses when it cannot check', async () => {
    const marker =
      '[ref ' +
      crypto.createHmac('sha256', 'paddle-refund').update('k-1').digest('hex').slice(0, 12) +
      ']'
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.method === 'GET'
            ? {
                body: {
                  data: {
                    adjustments: [
                      {
                        id: 'adj_rejected',
                        action: 'refund',
                        status: 'rejected',
                        reason: 'x ' + marker,
                      },
                    ],
                  },
                },
              }
            : { status: 201, body: adjustment('pending_approval', '2500') },
        async (calls) => {
          const result = await paddle.refund({
            paymentReference: 'txn_01',
            amount: 0,
            currency: 'EUR',
            idempotencyKey: 'k-1',
          })
          expect(result).toMatchObject({ success: true, refundId: 'adj_01' })
          expect(calls[1].json.reason).toBe('Refund requested by the store ' + marker)
        }
      )
    )
    await withEnv(ENV, () =>
      withFetch(
        () => ({ status: 500, body: { error: { detail: 'Try later' } } }),
        async (calls) => {
          const result = await paddle.refund({
            paymentReference: 'txn_01',
            amount: 0,
            currency: 'EUR',
            idempotencyKey: 'k-1',
          })
          expect(result).toMatchObject({ success: false, error: 'Try later' })
          expect(calls.map((call) => call.method)).toEqual(['GET'])
        }
      )
    )
  })

  it('refuses a reference that is not a transaction, and reports a rejected adjustment', async () => {
    expect(
      (
        await withEnv(ENV, () =>
          paddle.refund({ paymentReference: 'sub_01', amount: 0, currency: 'EUR' })
        )
      ).error
    ).toBe('This is not a Paddle transaction reference.')
    await withEnv(ENV, () =>
      withFetch(
        () => ({ status: 201, body: adjustment('rejected', '2500') }),
        async () => {
          expect(
            await paddle.refund({ paymentReference: 'txn_01', amount: 0, currency: 'EUR' })
          ).toMatchObject({
            success: false,
            refundId: 'adj_01',
            status: 'rejected',
            error: 'Paddle rejected the refund.',
          })
        }
      )
    )
  })
})

describe('Paddle driver — webhook', () => {
  const raw = Buffer.from('{"event_type":"transaction.completed","data":{"id":"txn_01"}}')
  const sign = (timestamp: number, secret = ENV.PADDLE_WEBHOOK_SECRET) =>
    crypto
      .createHmac('sha256', secret)
      .update(timestamp + ':' + raw.toString('utf8'))
      .digest('hex')
  const now = () => Math.floor(Date.now() / 1000)
  const verify = (header: string) =>
    withEnv(ENV, () =>
      paddle.verifyWebhook({
        headers: { 'paddle-signature': header },
        rawBody: raw,
        body: { parsed: true },
      })
    )

  it('accepts a fresh signature, and any of several h1 values (secret rotation)', async () => {
    const ts = now()
    expect(await verify(`ts=${ts};h1=${sign(ts)}`)).toEqual({ ok: true, body: { parsed: true } })
    expect((await verify(`ts=${ts};h1=${sign(ts, 'old')};h1=${sign(ts)}`)).ok).toBe(true)
  })

  it('refuses a forged, stale or incomplete signature', async () => {
    const ts = now()
    expect((await verify(`ts=${ts};h1=${sign(ts, 'forged')}`)).ok).toBe(false)
    expect((await verify(`ts=${ts - 301};h1=${sign(ts - 301)}`)).ok).toBe(false)
    expect((await verify(`ts=${ts}`)).ok).toBe(false)
    expect((await verify(`h1=${sign(ts)}`)).ok).toBe(false)
  })

  it('refuses everything while no notification secret is configured', async () => {
    const ts = now()
    const result = await withEnv({ ...ENV, PADDLE_WEBHOOK_SECRET: undefined }, () =>
      paddle.verifyWebhook({
        headers: { 'paddle-signature': `ts=${ts};h1=${sign(ts)}` },
        rawBody: raw,
        body: {},
      })
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('PADDLE_WEBHOOK_SECRET')
  })
})

describe('Paddle driver — the store’s pay page', () => {
  it('hands the page the PUBLIC token and where the buyer goes, for a transaction Paddle knows', async () => {
    await withEnv(ENV, () =>
      withFetch(
        () => ({
          body: {
            data: {
              id: 'txn_01',
              status: 'ready',
              custom_data: {
                successUrl: 'https://shop.test/ok',
                cancelUrl: 'https://shop.test/checkout',
              },
            },
          },
        }),
        async (calls) => {
          expect(await paddle.checkoutPage('txn_01')).toEqual({
            transactionId: 'txn_01',
            token: 'test_client_1',
            sandbox: true,
            successUrl: 'https://shop.test/ok',
            cancelUrl: 'https://shop.test/checkout',
          })
          expect(calls[0].url).toBe(SANDBOX + '/transactions/txn_01')
        }
      )
    )
  })

  it('answers nothing for an unknown or malformed id, or without a client token', async () => {
    await withEnv(ENV, () =>
      withFetch(
        () => ({ status: 404, body: { error: { detail: 'not found' } } }),
        async (calls) => {
          expect(await paddle.checkoutPage('txn_missing')).toBeNull()
          expect(await paddle.checkoutPage('../secret')).toBeNull()
          expect(calls).toHaveLength(1)
        }
      )
    )
    expect(
      await withEnv({ ...ENV, PADDLE_CLIENT_TOKEN: undefined }, () => paddle.checkoutPage('txn_01'))
    ).toBeNull()
  })

  it('opens nothing for a transaction that no longer takes money', async () => {
    for (const status of ['billed', 'paid', 'completed', 'canceled', 'past_due']) {
      await withEnv(ENV, () =>
        withFetch(
          () => ({ body: { data: { id: 'txn_01', status, custom_data: {} } } }),
          async () => {
            expect(await paddle.checkoutPage('txn_01')).toBeNull()
          }
        )
      )
    }
  })
})

describe('Paddle driver — settling a transaction from Paddle', () => {
  const TXN = 'txn_01h04vsc0qhwtsbsxh3422wjs4'
  const settle = (status: number, body: unknown, id = TXN) =>
    withEnv(ENV, () =>
      withFetch(
        () => ({ status, body }),
        async (calls) => ({
          result: await paddle.reconcile({ kind: 'checkout', id }),
          urls: calls.map((call) => call.url),
        })
      )
    )

  it('settles a transaction by itself', () => {
    expect(paddle.reconcileKinds(' ' + TXN + ' ')).toEqual(['checkout'])
    for (const foreign of [
      'sub_01h04vsc0qhwtsbsxh3422wjs4',
      'cs_test_a1b2c3d4e5',
      'txn_',
      '538',
      '',
    ]) {
      expect(paddle.reconcileKinds(foreign)).toEqual([])
    }
  })

  it('answers a transaction as the notification Paddle sends for its status, read from Paddle alone', async () => {
    const completed = {
      id: TXN,
      status: 'completed',
      currency_code: 'EUR',
      custom_data: { orderId: 'order-1', orderNumber: 'ORD-1' },
      details: { totals: { grand_total: '2400' } },
    }
    const { result, urls } = await settle(200, { data: completed })
    expect(result).toEqual({
      ok: true,
      body: {
        event_id: 'teleport-settle:' + TXN,
        event_type: 'transaction.completed',
        occurred_at: expect.any(String),
        notification_id: 'teleport-settle:' + TXN,
        data: completed,
      },
    })
    expect(urls).toEqual([SANDBOX + '/transactions/' + TXN])
    for (const [status, eventType] of [
      ['paid', 'transaction.paid'],
      ['past_due', 'transaction.past_due'],
      ['canceled', 'transaction.canceled'],
    ]) {
      const answered = await settle(200, { data: { id: TXN, status } })
      expect(answered.result.body.event_type).toBe(eventType)
    }
  })

  it('settles nothing for a transaction that took no money yet or Paddle does not know, and retries an outage', async () => {
    for (const status of ['draft', 'ready', 'billed']) {
      expect((await settle(200, { data: { id: TXN, status } })).result).toEqual({
        ok: false,
        reason: 'Paddle transaction ' + TXN + ' is ' + status + ', with nothing to settle yet.',
      })
    }
    expect(
      (
        await settle(404, {
          error: { type: 'request_error', code: 'not_found', detail: 'Entity not found' },
        })
      ).result
    ).toEqual({ ok: false, retry: false, reason: 'Entity not found' })
    for (const status of [500, 429]) {
      expect((await settle(status, null)).result).toMatchObject({ ok: false, retry: true })
    }
  })

  it('asks Paddle nothing for a request naming no transaction, and retries without a key', async () => {
    for (const request of [
      { kind: 'checkout', id: 'txn_01h04v/../../adjustments' },
      { kind: 'checkout', id: 'sub_01h04vsc0qhwtsbsxh3422wjs4' },
      { kind: 'refund', id: TXN },
      null,
    ]) {
      const answered = await withEnv(ENV, () =>
        withFetch(
          () => ({ status: 200, body: {} }),
          async (calls) => ({ result: await paddle.reconcile(request), calls: calls.length })
        )
      )
      expect(answered).toEqual({
        result: { ok: false, reason: 'The request names no Paddle transaction to settle.' },
        calls: 0,
      })
    }
    const unconfigured = await withEnv(
      { PADDLE_API_KEY: undefined, CONFIGURATION_PADDLE_API_KEY: undefined },
      () =>
        withFetch(
          () => ({ status: 200, body: {} }),
          async (calls) => ({
            result: await paddle.reconcile({ kind: 'checkout', id: TXN }),
            calls: calls.length,
          })
        )
    )
    expect(unconfigured).toMatchObject({ result: { ok: false, retry: true }, calls: 0 })
  })
})
