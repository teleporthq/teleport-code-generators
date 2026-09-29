import * as crypto from 'crypto'
import { loadPaymentDrivers } from './_helpers/load-payment-drivers'
import { withEnv, withFetch } from './_helpers/fake-fetch'

/**
 * The Square driver EXECUTED against Square's documented answers: payment
 * links in the location's currency, plan variations, the store's ids carried
 * in the payment note, and the base64 HMAC of notification URL + body — the
 * signature is checked against Square's own documented test vector.
 */

const square = loadPaymentDrivers({ ids: ['square'] }).get('square')
const ENV = { SQUARE_ACCESS_TOKEN: 'EAAA-token', SQUARE_WEBHOOK_SIGNATURE_KEY: 'asdf1234' }
const PRODUCTION = 'https://connect.squareup.com'
const SANDBOX = 'https://connect.squareupsandbox.com'

const location = { location: { id: 'L1', currency: 'USD', status: 'ACTIVE' } }

// Square answers /v2/locations on the environment the token belongs to.
const sandboxAccount =
  (answer: (url: string, json: any, method: string) => { status?: number; body?: unknown }) =>
  (call: { url: string; json: any; method: string }) => {
    if (call.url === PRODUCTION + '/v2/locations') {
      return { status: 401, body: { errors: [{ code: 'UNAUTHORIZED' }] } }
    }
    if (call.url === SANDBOX + '/v2/locations') {
      return { status: 200, body: { locations: [] } }
    }
    if (call.url.endsWith('/v2/locations/main')) {
      return { status: 200, body: location }
    }
    return answer(call.url, call.json, call.method)
  }

describe('Square driver — checkout', () => {
  it('finds the sandbox, then creates an itemised link carrying the store order in the note', async () => {
    await withEnv(ENV, () =>
      withFetch(
        sandboxAccount(() => ({
          status: 200,
          body: {
            payment_link: {
              id: 'PL1',
              order_id: 'SQORDER',
              url: 'https://sandbox.square.link/u/1',
            },
          },
        })),
        async (calls) => {
          const result = await square.createCheckout({
            amount: 25,
            currency: 'usd',
            lineItems: [
              { name: 'Mug', unitAmount: 10, quantity: 2 },
              { name: 'Shipping', unitAmount: 5, quantity: 1 },
            ],
            successUrl: 'https://shop.test/ok',
            customerEmail: 'jo@shop.test',
            metadata: { orderId: 'order-1', orderNumber: 'ORD-1' },
          })
          expect(result).toEqual({
            checkoutUrl: 'https://sandbox.square.link/u/1',
            sessionId: 'SQORDER',
            attemptRef: 'SQORDER:PL1',
          })
          const create = calls[calls.length - 1]
          expect(create.url).toBe(SANDBOX + '/v2/online-checkout/payment-links')
          expect(create.headers['Square-Version']).toBeTruthy()
          expect(create.json).toMatchObject({
            idempotency_key: 'link:order-1',
            order: {
              location_id: 'L1',
              reference_id: 'order-1',
              line_items: [
                { name: 'Mug', quantity: '2', base_price_money: { amount: 1000, currency: 'USD' } },
                {
                  name: 'Shipping',
                  quantity: '1',
                  base_price_money: { amount: 500, currency: 'USD' },
                },
              ],
            },
            checkout_options: { redirect_url: 'https://shop.test/ok' },
            payment_note: 'teleport:order-1::',
            pre_populated_data: { buyer_email: 'jo@shop.test' },
          })
        }
      )
    )
  })

  it("charges a cart in the location's currency, whatever the store's default is", async () => {
    const ronLocation = { location: { id: 'L2', currency: 'RON', status: 'ACTIVE' } }
    await withEnv(ENV, () =>
      withFetch(
        (call) => {
          if (call.url === PRODUCTION + '/v2/locations') {
            return { status: 401, body: { errors: [{ code: 'UNAUTHORIZED' }] } }
          }
          if (call.url === SANDBOX + '/v2/locations') {
            return { status: 200, body: { locations: [] } }
          }
          if (call.url.endsWith('/v2/locations/main')) {
            return { status: 200, body: ronLocation }
          }
          return {
            status: 200,
            body: {
              payment_link: {
                id: 'PL2',
                order_id: 'SQRON',
                url: 'https://sandbox.square.link/u/2',
              },
            },
          }
        },
        async (calls) => {
          const result = await square.createCheckout({
            amount: 19.99,
            currency: 'ron',
            lineItems: [{ name: 'Tennis balls', unitAmount: 19.99, quantity: 1 }],
            metadata: { orderId: 'order-29' },
          })
          expect(result.error).toBeUndefined()
          expect(result.checkoutUrl).toBe('https://sandbox.square.link/u/2')
          expect(calls[calls.length - 1].json.order).toMatchObject({
            location_id: 'L2',
            line_items: [{ base_price_money: { amount: 1999, currency: 'RON' } }],
          })
        }
      )
    )
  })

  it('refuses a location Square has not enabled card payments for, before opening a link', async () => {
    const blocked = {
      location: {
        id: 'L3',
        currency: 'RON',
        country: 'RO',
        status: 'ACTIVE',
        capabilities: ['AUTOMATIC_TRANSFERS'],
      },
    }
    await withEnv(ENV, () =>
      withFetch(
        (call) =>
          call.url.endsWith('/v2/locations') || call.url.endsWith('/v2/locations/main')
            ? { status: 200, body: call.url.endsWith('/main') ? blocked : { locations: [] } }
            : { status: 500, body: { errors: [{ detail: 'no link expected' }] } },
        async (calls) => {
          const result = await square.createCheckout({
            amount: 19.99,
            currency: 'RON',
            metadata: { orderId: 'order-30' },
          })
          expect(result.error).toBe(
            'This Square account cannot take card payments yet: Square has not enabled card ' +
              'processing for its location (RO).'
          )
          expect(calls.some((call) => call.url.includes('/payment-links'))).toBe(false)
          const plan = await square.ensurePlan({
            amount: 15,
            currency: 'RON',
            interval: 'month',
            productName: 'Club',
            productId: 'p1',
          })
          expect(plan).toMatchObject({ ok: 'false' })
          expect(plan.error).toContain('cannot take card payments yet')
        }
      )
    )
  })

  it('names a configured location the token cannot use, instead of "access forbidden"', async () => {
    await withEnv({ ...ENV, SQUARE_LOCATION_ID: 'USA' }, () =>
      withFetch(
        (call) =>
          call.url === PRODUCTION + '/v2/locations'
            ? { status: 200, body: { locations: [] } }
            : call.url.endsWith('/v2/locations/USA')
            ? {
                status: 403,
                body: {
                  errors: [
                    { code: 'FORBIDDEN', detail: 'Access forbidden to the requested location.' },
                  ],
                },
              }
            : { status: 500, body: { errors: [{ detail: 'no link expected' }] } },
        async (calls) => {
          const result = await square.createCheckout({
            amount: 10,
            currency: 'USD',
            metadata: { orderId: 'order-31' },
          })
          expect(result.error).toBe(
            'Square has no location "USA" these keys can charge through: the store needs a ' +
              'Square location ID, or none for the main location.'
          )
          expect(calls.some((call) => call.url.includes('/payment-links'))).toBe(false)
        }
      )
    )
  })

  it('refuses products priced in a currency the location cannot charge in', async () => {
    await withEnv(ENV, () =>
      withFetch(
        sandboxAccount(() => {
          throw new Error('no link expected')
        }),
        async () => {
          const result = await square.createCheckout({
            amount: 10,
            currency: 'EUR',
            metadata: { orderId: 'o' },
          })
          expect(result.error).toBe(
            'Square charges in the location currency (USD), but these products are priced in EUR.'
          )
        }
      )
    )
  })
})

describe('Square driver — plans and subscriptions', () => {
  it('creates a plan and one STATIC-priced variation, and knows which cadences Square bills', async () => {
    await withEnv(ENV, () =>
      withFetch(
        sandboxAccount((_url, json) =>
          json.object.type === 'SUBSCRIPTION_PLAN'
            ? { status: 200, body: { catalog_object: { id: 'PLAN1' } } }
            : { status: 200, body: { catalog_object: { id: 'VAR1' } } }
        ),
        async (calls) => {
          const created = await square.ensurePlan({
            amount: 15,
            currency: 'USD',
            interval: 'month',
            intervalCount: 3,
            productName: 'Club',
            productId: 'p1',
          })
          expect(created).toEqual({
            ok: 'true',
            planId: 'VAR1',
            providerProductId: 'PLAN1',
            created: 'true',
          })
          const variation = calls[calls.length - 1].json
          expect(variation.object.subscription_plan_variation_data).toEqual({
            name: 'Club',
            subscription_plan_id: 'PLAN1',
            phases: [
              {
                cadence: 'QUARTERLY',
                pricing: { type: 'STATIC', price_money: { amount: 1500, currency: 'USD' } },
              },
            ],
          })
          expect(
            (
              await square.ensurePlan({
                amount: 15,
                currency: 'USD',
                interval: 'month',
                intervalCount: 5,
              })
            ).error
          ).toBe('Square cannot bill every 5 month(s).')
          expect(
            (
              await square.ensurePlan({
                amount: 15,
                currency: 'USD',
                interval: 'month',
                trialDays: 7,
              })
            ).error
          ).toContain('free trial')
        }
      )
    )
  })

  it("refuses a plan in another currency than the location's before touching the catalog", async () => {
    await withEnv(ENV, () =>
      withFetch(
        sandboxAccount(() => ({ status: 200, body: { catalog_object: { id: 'NEVER' } } })),
        async (calls) => {
          const refused = await square.ensurePlan({
            amount: 15,
            currency: 'RON',
            interval: 'month',
            productName: 'Club',
            productId: 'p1',
          })
          expect(refused).toMatchObject({
            ok: 'false',
            error:
              'Square charges in the location currency (USD), but these products are priced in RON.',
          })
          expect(calls.some((call) => call.url.includes('/v2/catalog/object'))).toBe(false)
        }
      )
    )
  })

  it('opens a quick-pay link on the variation, the note naming the store rows', async () => {
    await withEnv(ENV, () =>
      withFetch(
        sandboxAccount(() => ({
          status: 200,
          body: {
            payment_link: { id: 'PL2', order_id: 'SQO2', url: 'https://sandbox.square.link/u/2' },
          },
        })),
        async (calls) => {
          const result = await square.createSubscriptionCheckout({
            planId: 'VAR1',
            amount: 15,
            currency: 'USD',
            description: 'Club',
            metadata: { orderId: 'order-1', subscriptionId: 'sub-row-1' },
          })
          expect(result).toEqual({
            checkoutUrl: 'https://sandbox.square.link/u/2',
            sessionId: 'SQO2',
            attemptRef: 'SQO2:PL2',
            providerSubscriptionId: '',
          })
          expect(calls[calls.length - 1].json).toMatchObject({
            quick_pay: {
              name: 'Club',
              price_money: { amount: 1500, currency: 'USD' },
              location_id: 'L1',
            },
            checkout_options: { subscription_plan_id: 'VAR1' },
            payment_note: 'teleport:order-1:sub-row-1:VAR1',
          })
        }
      )
    )
  })

  it('cancels at the end of the paid period and withdraws that cancellation on a resume', async () => {
    await withEnv(ENV, () =>
      withFetch(
        sandboxAccount((url, _json, method) => {
          if (url.endsWith('/cancel')) {
            return {
              status: 200,
              body: {
                subscription: {
                  id: 'S1',
                  status: 'ACTIVE',
                  canceled_date: '2026-03-01',
                  charged_through_date: '2026-03-01',
                },
              },
            }
          }
          if (method === 'GET') {
            return {
              status: 200,
              body: { subscription: { id: 'S1', status: 'ACTIVE', canceled_date: '2026-03-01' } },
            }
          }
          return {
            status: 200,
            body: {
              subscription: { id: 'S1', status: 'ACTIVE', charged_through_date: '2026-03-01' },
            },
          }
        }),
        async (calls) => {
          expect(
            await square.manageSubscription({
              subscriptionId: 'S1',
              action: 'cancel_at_period_end',
            })
          ).toEqual({
            ok: 'true',
            status: 'active',
            cancelAtPeriodEnd: 'true',
            currentPeriodStart: '',
            currentPeriodEnd: '2026-03-01T00:00:00.000Z',
          })
          expect(
            await square.manageSubscription({ subscriptionId: 'S1', action: 'resume' })
          ).toMatchObject({ status: 'active', cancelAtPeriodEnd: 'false' })
          const resume = calls[calls.length - 1]
          expect(resume).toMatchObject({
            method: 'PUT',
            json: { subscription: { canceled_date: null } },
          })
        }
      )
    )
  })

  it('refuses to cancel now, as the worker does: Square only cancels at the end of the paid period', async () => {
    await withEnv(ENV, () =>
      withFetch(
        sandboxAccount(() => ({ status: 200, body: {} })),
        async (calls) => {
          expect(
            await square.manageSubscription({ subscriptionId: 'S1', action: 'cancel' })
          ).toEqual({
            ok: 'false',
            status: '',
            cancelAtPeriodEnd: 'false',
            currentPeriodStart: '',
            currentPeriodEnd: '',
            error:
              'Square cannot end a subscription immediately: it always cancels at the end of the paid period. Cancel at the period end instead.',
          })
          expect(calls).toHaveLength(0)
        }
      )
    )
  })

  it('says a pause waits for the next billing cycle, and a resume deletes the pause still waiting', async () => {
    await withEnv(ENV, () =>
      withFetch(
        sandboxAccount((url, _json, method) => {
          if (url.endsWith('/pause')) {
            return {
              status: 200,
              body: {
                subscription: { id: 'S1', status: 'ACTIVE', charged_through_date: '2026-03-01' },
                actions: [{ id: 'ACT1', type: 'PAUSE', effective_date: '2026-03-01' }],
              },
            }
          }
          if (method === 'GET') {
            return {
              status: 200,
              body: {
                subscription: {
                  id: 'S1',
                  status: 'ACTIVE',
                  actions: [{ id: 'ACT1', type: 'PAUSE', effective_date: '2026-03-01' }],
                },
              },
            }
          }
          return {
            status: 200,
            body: {
              subscription: { id: 'S1', status: 'ACTIVE', charged_through_date: '2026-03-01' },
            },
          }
        }),
        async (calls) => {
          expect(
            await square.manageSubscription({ subscriptionId: 'S1', action: 'pause' })
          ).toEqual({
            ok: 'true',
            status: 'active',
            cancelAtPeriodEnd: 'false',
            currentPeriodStart: '',
            currentPeriodEnd: '2026-03-01T00:00:00.000Z',
            message:
              'Square pauses a subscription from the start of its next billing cycle, so it stays active until the current period ends.',
          })
          expect(
            await square.manageSubscription({ subscriptionId: 'S1', action: 'resume' })
          ).toMatchObject({ ok: 'true', status: 'active' })
          const own = calls.filter((call) => call.url.includes('/v2/subscriptions/'))
          expect(own.map((call) => call.method + ' ' + call.url.replace(SANDBOX, ''))).toEqual([
            'POST /v2/subscriptions/S1/pause',
            'GET /v2/subscriptions/S1?include=actions',
            'DELETE /v2/subscriptions/S1/actions/ACT1',
          ])
        }
      )
    )
  })

  it('resumes a paused subscription at once', async () => {
    await withEnv(ENV, () =>
      withFetch(
        sandboxAccount((_url, _json, method) => ({
          status: 200,
          body: {
            subscription: {
              id: 'S1',
              status: method === 'GET' ? 'PAUSED' : 'ACTIVE',
              actions: method === 'GET' ? [{ id: 'ACT2', type: 'RESUME' }] : undefined,
            },
          },
        })),
        async (calls) => {
          expect(
            (await square.manageSubscription({ subscriptionId: 'S1', action: 'resume' })).status
          ).toBe('active')
          expect(calls[calls.length - 1]).toMatchObject({
            method: 'POST',
            json: { resume_change_timing: 'IMMEDIATE' },
          })
        }
      )
    )
  })

  it('checks a cached plan variation against the catalog of the current token, and creates it there when missing', async () => {
    await withEnv(ENV, () =>
      withFetch(
        sandboxAccount((url, json, method) => {
          if (method === 'GET' && url.includes('/v2/catalog/object/')) {
            return url.endsWith('/VAR_KNOWN')
              ? { status: 200, body: { object: { id: 'VAR_KNOWN' } } }
              : { status: 404, body: { errors: [{ code: 'NOT_FOUND' }] } }
          }
          return json.object.type === 'SUBSCRIPTION_PLAN'
            ? { status: 200, body: { catalog_object: { id: 'PLAN2' } } }
            : { status: 200, body: { catalog_object: { id: 'VAR2' } } }
        }),
        async () => {
          expect(
            await square.ensurePlan({
              planId: 'VAR_KNOWN',
              providerProductId: 'PLAN_KNOWN',
              amount: 15,
              currency: 'USD',
              interval: 'month',
            })
          ).toEqual({
            ok: 'true',
            planId: 'VAR_KNOWN',
            providerProductId: 'PLAN_KNOWN',
            created: 'false',
          })
          expect(
            await square.ensurePlan({
              planId: 'VAR_PRODUCTION',
              providerProductId: 'PLAN_PRODUCTION',
              amount: 15,
              currency: 'USD',
              interval: 'month',
              productId: 'p1',
            })
          ).toEqual({ ok: 'true', planId: 'VAR2', providerProductId: 'PLAN2', created: 'true' })
        }
      )
    )
  })
})

describe('Square driver — refunds', () => {
  it('refunds what is left of the payment, with an idempotency key Square accepts', async () => {
    await withEnv(ENV, () =>
      withFetch(
        sandboxAccount((url) =>
          url.includes('/v2/payments/')
            ? {
                status: 200,
                body: {
                  payment: {
                    id: 'P1',
                    total_money: { amount: 2500, currency: 'USD' },
                    refunded_money: { amount: 500, currency: 'USD' },
                  },
                },
              }
            : {
                status: 200,
                body: {
                  refund: {
                    id: 'R1',
                    status: 'PENDING',
                    amount_money: { amount: 2000, currency: 'USD' },
                  },
                },
              }
        ),
        async (calls) => {
          const longKey = 'refund:' + 'x'.repeat(60) + ':0'
          const result = await square.refund({
            paymentReference: 'P1',
            amount: 0,
            currency: 'USD',
            idempotencyKey: longKey,
            reason: 'Damaged',
          })
          expect(result).toEqual({
            success: true,
            refundId: 'R1',
            amount: 20,
            currency: 'USD',
            status: 'PENDING',
            error: '',
          })
          const body = calls[calls.length - 1].json
          expect(body.amount_money).toEqual({ amount: 2000, currency: 'USD' })
          expect(body.idempotency_key.length).toBeLessThanOrEqual(45)
          expect(body.reason).toBe('Damaged')
        }
      )
    )
  })
})

describe('Square driver — webhook', () => {
  // Square's documented test vector: URL, key and body give this signature.
  const vectorUrl = 'https://example.com/webhook'
  const vectorBody = Buffer.from('{"hello":"world"}')
  const vectorSignature = '2kRE5qRU2tR+tBGlDwMEw2avJ7QM4ikPYD/PJ3bd9Og='

  it("verifies Square's documented test vector against the request's own URL", async () => {
    await withEnv(ENV, async () => {
      const result = await square.verifyWebhook({
        headers: { 'x-square-hmacsha256-signature': vectorSignature },
        rawBody: vectorBody,
        body: { hello: 'world' },
        url: vectorUrl,
      })
      expect(result).toEqual({ ok: true, body: { hello: 'world' } })
      const wrongUrl = await square.verifyWebhook({
        headers: { 'x-square-hmacsha256-signature': vectorSignature },
        rawBody: vectorBody,
        body: {},
        url: 'https://example.com/other',
      })
      expect(wrongUrl.ok).toBe(false)
    })
  })

  it("accepts the store's canonical origin when a proxy hides the public host", async () => {
    await withEnv({ ...ENV, NEXTAUTH_URL: 'https://example.com/' }, async () => {
      const result = await square.verifyWebhook({
        headers: { 'x-square-hmacsha256-signature': vectorSignature },
        rawBody: vectorBody,
        body: {},
        url: 'http://internal:3000/webhook',
      })
      expect(result.ok).toBe(true)
      // The origin is the only thing it stands in for: another path is not signed.
      const otherPath = await square.verifyWebhook({
        headers: { 'x-square-hmacsha256-signature': vectorSignature },
        rawBody: vectorBody,
        body: {},
        url: 'http://internal:3000/other',
      })
      expect(otherPath.ok).toBe(false)
    })
  })

  it('never takes a URL the merchant typed: only where Square posted, or the canonical origin', async () => {
    await withEnv({ ...ENV, SQUARE_NOTIFICATION_URL: vectorUrl }, async () => {
      const result = await square.verifyWebhook({
        headers: { 'x-square-hmacsha256-signature': vectorSignature },
        rawBody: vectorBody,
        body: {},
        url: 'http://internal/api/webhooks/square-payment',
      })
      expect(result).toMatchObject({ ok: false })
      expect(String((result as { reason?: string }).reason)).toContain(
        'http://internal/api/webhooks/square-payment'
      )
    })
  })

  it('finds the subscription Square created for the first charge, and asks again until it exists', async () => {
    const payment = {
      id: 'PAY1',
      status: 'COMPLETED',
      customer_id: 'CUST1',
      note: 'teleport:order-1:sub-row-1:VAR1',
      total_money: { amount: 1500, currency: 'USD' },
    }
    const body = { type: 'payment.updated', data: { object: { payment } } }
    const raw = Buffer.from(JSON.stringify(body))
    const signature = crypto
      .createHmac('sha256', 'asdf1234')
      .update('https://shop.test/api/webhooks/square-payment' + raw.toString('utf8'))
      .digest('base64')
    const input = () => ({
      headers: { 'x-square-hmacsha256-signature': signature },
      rawBody: raw,
      body: JSON.parse(raw.toString('utf8')),
      url: 'https://shop.test/api/webhooks/square-payment',
    })
    await withEnv(ENV, () =>
      withFetch(
        sandboxAccount(() => ({ status: 200, body: { subscriptions: [] } })),
        async () => {
          expect(await square.verifyWebhook(input())).toMatchObject({ ok: false, retry: true })
        }
      )
    )
    await withEnv(ENV, () =>
      withFetch(
        sandboxAccount(() => ({
          status: 200,
          body: {
            subscriptions: [
              { id: 'OLD', plan_variation_id: 'VAR1', created_at: '2025-01-01T00:00:00Z' },
              { id: 'NEW', plan_variation_id: 'VAR1', created_at: '2026-01-01T00:00:00Z' },
              { id: 'OTHER', plan_variation_id: 'VAR9', created_at: '2026-02-01T00:00:00Z' },
            ],
          },
        })),
        async (calls) => {
          const result = await square.verifyWebhook(input())
          expect(result.ok).toBe(true)
          expect(result.body.data.object.payment.teleport).toEqual({
            orderId: 'order-1',
            subscriptionId: 'sub-row-1',
            variationId: 'VAR1',
          })
          expect(result.body.data.object.payment.teleportSubscription.id).toBe('NEW')
          expect(calls[calls.length - 1].json).toEqual({
            query: { filter: { customer_ids: ['CUST1'] } },
          })
        }
      )
    )
  })

  it("never takes a returning subscriber's old subscription for the one this payment opens", async () => {
    const payment = {
      id: 'PAY2',
      status: 'COMPLETED',
      customer_id: 'CUST1',
      created_at: '2026-03-01T10:00:00.000Z',
      note: 'teleport:order-2:sub-row-2:VAR1',
      total_money: { amount: 1500, currency: 'USD' },
    }
    const body = { type: 'payment.updated', data: { object: { payment } } }
    const raw = Buffer.from(JSON.stringify(body))
    const signature = crypto
      .createHmac('sha256', 'asdf1234')
      .update('https://shop.test/api/webhooks/square-payment' + raw.toString('utf8'))
      .digest('base64')
    const verify = (subscriptions: unknown[]): Promise<any> =>
      withEnv(ENV, () =>
        withFetch(
          sandboxAccount(() => ({ status: 200, body: { subscriptions } })),
          () =>
            square.verifyWebhook({
              headers: { 'x-square-hmacsha256-signature': signature },
              rawBody: raw,
              body: JSON.parse(raw.toString('utf8')),
              url: 'https://shop.test/api/webhooks/square-payment',
            })
        )
      )
    const cancelled = {
      id: 'CANCELLED',
      plan_variation_id: 'VAR1',
      status: 'CANCELED',
      created_at: '2026-03-01T10:00:30Z',
    }
    const deactivated = {
      id: 'DEACTIVATED',
      plan_variation_id: 'VAR1',
      status: 'DEACTIVATED',
      created_at: '2026-03-01T10:00:20Z',
    }
    const older = {
      id: 'OLDER',
      plan_variation_id: 'VAR1',
      status: 'ACTIVE',
      created_at: '2025-06-01T00:00:00Z',
    }
    // Square has not created the new one yet: ask it to deliver again.
    expect(await verify([cancelled, deactivated, older])).toMatchObject({ ok: false, retry: true })
    // Square records the subscription a moment before the charge.
    const created = {
      id: 'CREATED',
      plan_variation_id: 'VAR1',
      status: 'ACTIVE',
      created_at: '2026-03-01T09:59:40Z',
    }
    const result = await verify([cancelled, deactivated, older, created])
    expect(result.ok).toBe(true)
    expect(result.body.data.object.payment.teleportSubscription.id).toBe('CREATED')
  })

  it('names the payment behind a renewal invoice', async () => {
    const body = {
      type: 'invoice.payment_made',
      data: { object: { invoice: { id: 'inv:1', subscription_id: 'S1', order_id: 'O1' } } },
    }
    const raw = Buffer.from(JSON.stringify(body))
    const signature = crypto
      .createHmac('sha256', 'asdf1234')
      .update('https://shop.test/hook' + raw.toString('utf8'))
      .digest('base64')
    await withEnv(ENV, () =>
      withFetch(
        sandboxAccount(() => ({
          status: 200,
          body: { order: { id: 'O1', tenders: [{ id: 'T1', payment_id: 'PAY9' }] } },
        })),
        async () => {
          const result = await square.verifyWebhook({
            headers: { 'x-square-hmacsha256-signature': signature },
            rawBody: raw,
            body: JSON.parse(raw.toString('utf8')),
            url: 'https://shop.test/hook',
          })
          expect(result.body.data.object.invoice.teleportPaymentId).toBe('PAY9')
        }
      )
    )
  })

  it('refuses everything while no signature key is configured', async () => {
    await withEnv(
      {
        ...ENV,
        SQUARE_WEBHOOK_SIGNATURE_KEY: undefined,
        CONFIGURATION_SQUARE_WEBHOOK_SIGNATURE_KEY: undefined,
      },
      async () => {
        const result = await square.verifyWebhook({
          headers: { 'x-square-hmacsha256-signature': vectorSignature },
          rawBody: vectorBody,
          body: {},
          url: vectorUrl,
        })
        expect(result.ok).toBe(false)
        expect(result.reason).toContain('SQUARE_WEBHOOK_SIGNATURE_KEY')
      }
    )
  })
})

describe('Square driver — settling a checkout from Square', () => {
  const ORDER = 'CAISENgvlJ6jLWAzERDzjyHVybY'
  const LINK = 'JE6RMWQK5KUAXLYS'
  const PAYMENT = 'GQTFp1ZlXdpoW4o6eGiZhbjosiDFf'
  const paidOrder = {
    order: { id: ORDER, state: 'OPEN', tenders: [{ id: 'T1', payment_id: PAYMENT }] },
  }
  const settle = (
    answer: (url: string) => { status?: number; body?: unknown },
    id = ORDER + ':' + LINK
  ) =>
    withEnv(ENV, () =>
      withFetch(
        sandboxAccount((url) => answer(url)),
        async (calls) => ({
          result: await square.reconcile({ kind: 'checkout', id }),
          urls: calls.map((call) => call.url),
        })
      )
    )

  it('settles the checkout the store recorded by its order', () => {
    expect(square.reconcileKinds(ORDER + ':' + LINK)).toEqual(['checkout'])
    expect(square.reconcileKinds(ORDER)).toEqual(['checkout'])
    for (const foreign of ['cs_test_a1b2c3d4e5', 'tr_WDqYK6vllg', ORDER + ':' + LINK + ':x', '']) {
      expect(square.reconcileKinds(foreign)).toEqual([])
    }
  })

  it("answers a paid order as the payment.updated Square sends for its payment, the store's rows read off its note", async () => {
    const payment = {
      id: PAYMENT,
      status: 'COMPLETED',
      order_id: ORDER,
      note: 'teleport:order-1::',
      total_money: { amount: 2400, currency: 'USD' },
    }
    const { result, urls } = await settle((url) =>
      url.endsWith('/v2/orders/' + ORDER)
        ? { body: paidOrder }
        : url.endsWith('/v2/payments/' + PAYMENT)
        ? { body: { payment } }
        : { status: 404, body: {} }
    )
    expect(result).toEqual({
      ok: true,
      body: {
        type: 'payment.updated',
        event_id: 'teleport-settle:' + PAYMENT,
        created_at: expect.any(String),
        data: {
          type: 'payment',
          id: PAYMENT,
          object: {
            payment: {
              ...payment,
              teleport: { orderId: 'order-1', subscriptionId: '', variationId: '' },
            },
          },
        },
      },
    })
    expect(urls.slice(-2)).toEqual([
      SANDBOX + '/v2/orders/' + ORDER,
      SANDBOX + '/v2/payments/' + PAYMENT,
    ])
  })

  it('attaches the subscription a first charge opened, as its webhook does, and asks again until it exists', async () => {
    const payment = {
      id: PAYMENT,
      status: 'COMPLETED',
      customer_id: 'CUST1',
      note: 'teleport:order-1:sub-row-1:VAR1',
      total_money: { amount: 1500, currency: 'USD' },
    }
    const answer = (subscriptions: unknown[]) => (url: string) =>
      url.endsWith('/v2/orders/' + ORDER)
        ? { body: paidOrder }
        : url.endsWith('/v2/payments/' + PAYMENT)
        ? { body: { payment } }
        : { body: { subscriptions } }
    expect((await settle(answer([]))).result).toMatchObject({ ok: false, retry: true })
    const { result } = await settle(
      answer([{ id: 'NEW', plan_variation_id: 'VAR1', created_at: '2026-01-01T00:00:00Z' }])
    )
    expect(result.body.data.object.payment.teleportSubscription.id).toBe('NEW')
  })

  it('settles nothing for an order nobody paid, never retries one Square does not know, and retries an outage', async () => {
    const unpaid = await settle(() => ({ body: { order: { id: ORDER, state: 'OPEN' } } }))
    expect(unpaid.result).toEqual({
      ok: false,
      reason: 'Nobody has paid Square order ' + ORDER + ' yet.',
    })
    const unknown = await settle(() => ({
      status: 404,
      body: { errors: [{ code: 'NOT_FOUND', detail: 'Order not found' }] },
    }))
    expect(unknown.result).toEqual({ ok: false, retry: false, reason: 'Order not found' })
    expect((await settle(() => ({ status: 503, body: {} }))).result).toMatchObject({
      ok: false,
      retry: true,
    })
    const paymentDown = await settle((url) =>
      url.endsWith('/v2/orders/' + ORDER) ? { body: paidOrder } : { status: 500, body: {} }
    )
    expect(paymentDown.result).toMatchObject({ ok: false, retry: true })
  })

  it('asks Square nothing for a request naming no checkout, and retries without a token', async () => {
    for (const request of [
      { kind: 'checkout', id: ORDER + '/../../v2/refunds' },
      { kind: 'checkout', id: 'cs_test_a1b2c3d4e5' },
      { kind: 'refund', id: ORDER },
      null,
    ]) {
      const answered = await withEnv(ENV, () =>
        withFetch(
          () => ({ status: 200, body: {} }),
          async (calls) => ({ result: await square.reconcile(request), calls: calls.length })
        )
      )
      expect(answered).toEqual({
        result: { ok: false, reason: 'The request names no Square checkout to settle.' },
        calls: 0,
      })
    }
    const unconfigured = await withEnv(
      { SQUARE_ACCESS_TOKEN: undefined, CONFIGURATION_SQUARE_ACCESS_TOKEN: undefined },
      () =>
        withFetch(
          () => ({ status: 200, body: {} }),
          async (calls) => ({
            result: await square.reconcile({ kind: 'checkout', id: ORDER }),
            calls: calls.length,
          })
        )
    )
    expect(unconfigured).toMatchObject({ result: { ok: false, retry: true }, calls: 0 })
  })
})
