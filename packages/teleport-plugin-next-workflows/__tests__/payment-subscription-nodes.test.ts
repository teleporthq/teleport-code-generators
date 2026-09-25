import { loadHandler, HandlerFn } from './_helpers/load-handler'
import { paymentChargeUser } from '../src/nodes/payment/payment-charge-user'
import { paymentManageSubscription } from '../src/nodes/payment/payment-manage-subscription'
import { paymentEnsureSubscriptionPlan } from '../src/nodes/payment/payment-ensure-subscription-plan'
import { paymentBillingPortal } from '../src/nodes/payment/payment-billing-portal'
import { resolveHandlerEntryName } from '../src/nodes/types'
import { collectSecrets } from '../src/secret-collector'

/**
 * The three provider handlers behind a subscription — the recurring checkout,
 * the plan a provider needs before one, and the merchant's cancel / pause /
 * resume — EXECUTED against a fake provider: every PayPal call goes through
 * `fetch`, so the requests the store sends and the answers it accepts are
 * asserted here; Stripe's SDK is not loadable in the test process, so its
 * paths are held to their validation and to the emitted source.
 */

interface FetchCall {
  url: string
  init: { method?: string; headers?: Record<string, string>; body?: string }
}

type Responder = (
  url: string,
  init: FetchCall['init']
) => { ok: boolean; status?: number; body: unknown }

const PAYPAL_ENV = {
  PAYPAL_CLIENT_ID: 'Aclient',
  PAYPAL_CLIENT_SECRET: 'Esecret',
}

const withEnv = async <T>(
  env: Record<string, string | undefined>,
  run: () => Promise<T>
): Promise<T> => {
  const saved: Record<string, string | undefined> = {}
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key]
    if (env[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = env[key]
    }
  }
  try {
    return await run()
  } finally {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = saved[key]
      }
    }
  }
}

const withFetch = async <T>(
  respond: Responder,
  run: (calls: FetchCall[]) => Promise<T>
): Promise<T> => {
  const calls: FetchCall[] = []
  const previous = (globalThis as { fetch?: unknown }).fetch
  ;(globalThis as { fetch?: unknown }).fetch = async (
    url: string,
    init: FetchCall['init'] = {}
  ) => {
    calls.push({ url, init })
    const answer = respond(url, init)
    return {
      ok: answer.ok,
      status: answer.status ?? (answer.ok ? 200 : 400),
      json: async () => answer.body,
    }
  }
  try {
    return await run(calls)
  } finally {
    ;(globalThis as { fetch?: unknown }).fetch = previous
    ;(globalThis as { __paypalBaseUrlCache?: string }).__paypalBaseUrlCache = undefined
  }
}

const paypalAuth = (url: string) => url.endsWith('/v1/oauth2/token')

// A refused charge is not a thrown error: the handler answers an early 400
// whose body carries the provider's message, which the checkout page renders.
const refusal = (result: unknown): { status: number; error: string; provider: string } => {
  const early = (
    result as { __earlyResponse?: { status: number; body: { error: string; provider: string } } }
  ).__earlyResponse
  if (!early) {
    throw new Error('expected an early response, got ' + JSON.stringify(result))
  }
  return { status: early.status, error: early.body.error, provider: early.body.provider }
}

// The generated executor publishes `__workflowUtils` for every handler; the
// charge handler localizes its redirect URLs through it.
beforeAll(() => {
  ;(globalThis as { __workflowUtils?: unknown }).__workflowUtils = {
    localizeHref: (href: string) => href,
  }
})
afterAll(() => {
  delete (globalThis as { __workflowUtils?: unknown }).__workflowUtils
})

describe('payment-charge-user in subscription mode', () => {
  const handler: HandlerFn = loadHandler('payment-charge-user')
  const source = paymentChargeUser.generateHandler()

  it('refuses a provider the store does not dispatch to, instead of charging Stripe by default', async () => {
    const result = refusal(
      await handler({ providerId: 'adyen', mode: 'subscription', amount: 10, currency: 'usd' }, {})
    )
    expect(result).toEqual({
      status: 400,
      error: 'Payment provider "adyen" is not supported by this store.',
      provider: 'adyen',
    })
  })

  it('opens Stripe Checkout in subscription mode with an inline recurring price and the trial', () => {
    expect(source).toContain("mode: 'subscription'")
    expect(source).toMatch(/recurring: \{ interval(: interval)?, interval_count: intervalCount \}/)
    expect(source).toContain('subscriptionData.trial_period_days = trialDays')
    expect(source).toContain('subscriptionData.metadata = metadata')
    expect(resolveHandlerEntryName(source, 'payment-charge-user')).toBe('payment_charge_user')
  })

  it('validates the Stripe subscription before touching the provider', async () => {
    await withEnv({ STRIPE_SECRET_KEY: 'sk_test_1' }, async () => {
      const interval = refusal(
        await handler(
          {
            providerId: 'stripe',
            mode: 'subscription',
            amount: 10,
            currency: 'usd',
            recurringInterval: 'fortnight',
          },
          {}
        )
      )
      expect(interval.error).toBe('Unknown billing interval "fortnight"')
      const amount = refusal(
        await handler(
          {
            providerId: 'stripe',
            mode: 'subscription',
            amount: 0,
            currency: 'usd',
            recurringInterval: 'month',
          },
          {}
        )
      )
      expect(amount.error).toBe('A subscription needs a positive amount to bill')
    })
    await withEnv(
      {
        STRIPE_SECRET_KEY: undefined,
        CONFIGURATION_STRIPE_SECRET_KEY: undefined,
        STRIPE_TEST_KEY: undefined,
      },
      async () => {
        const missing = refusal(
          await handler(
            { providerId: 'stripe', mode: 'subscription', amount: 10, currency: 'usd' },
            {}
          )
        )
        expect(missing.error).toBe('STRIPE_SECRET_KEY is not configured')
      }
    )
  })

  it("takes a gift card's tender off the FIRST Stripe invoice as a one-shot coupon, and never the whole of it", async () => {
    expect(source).toContain('stripe.coupons.create({')
    expect(source).toContain('amount_off: unitAmount - firstChargeAmount')
    expect(source).toContain("duration: 'once'")
    expect(source).toContain('max_redemptions: 1')
    expect(source).toContain('sessionParams.discounts = [{ coupon: coupon.id }]')
    expect(source).toContain('if (firstChargeAmount < unitAmount) {')
    await withEnv({ STRIPE_SECRET_KEY: 'sk_test_1' }, async () => {
      const covered = refusal(
        await handler(
          {
            providerId: 'stripe',
            mode: 'subscription',
            amount: 30,
            amountDue: 0,
            currency: 'usd',
            recurringInterval: 'month',
          },
          {}
        )
      )
      expect(covered.error).toBe(
        'A gift card cannot cover the whole first payment of a subscription'
      )
    })
  })

  it('creates the PayPal subscription against the plan and sends the buyer to approve it', async () => {
    await withEnv(PAYPAL_ENV, () =>
      withFetch(
        (url) => {
          if (paypalAuth(url)) {
            return { ok: true, body: { access_token: 'tok' } }
          }
          return {
            ok: true,
            body: {
              id: 'I-ABC',
              links: [
                { rel: 'self', href: 'x' },
                { rel: 'approve', href: 'https://paypal.test/approve' },
              ],
            },
          }
        },
        async (calls) => {
          const result = (await handler(
            {
              providerId: 'paypal',
              mode: 'subscription',
              amount: 24,
              currency: 'usd',
              planId: 'P-1',
              customerEmail: 'jane@example.com',
              successUrl: 'https://shop.test/order/1',
              cancelUrl: 'https://shop.test/checkout',
              metadata: JSON.stringify({ orderId: 'order-1', subscriptionId: 'sub-row-1' }),
            },
            {}
          )) as Record<string, unknown>
          expect(result).toMatchObject({
            checkoutUrl: 'https://paypal.test/approve',
            sessionId: 'I-ABC',
            providerSubscriptionId: 'I-ABC',
            __terminal: true,
            __redirectUrl: 'https://paypal.test/approve',
          })
          const create = calls.find((call) => call.url.endsWith('/v1/billing/subscriptions'))!
          expect(create.init.method).toBe('POST')
          expect(create.init.headers?.Authorization).toBe('Bearer tok')
          const payload = JSON.parse(create.init.body!)
          expect(payload.plan_id).toBe('P-1')
          expect(payload.application_context).toMatchObject({
            user_action: 'SUBSCRIBE_NOW',
            return_url: 'https://shop.test/order/1',
            cancel_url: 'https://shop.test/checkout',
          })
          expect(JSON.parse(payload.custom_id)).toEqual({
            orderId: 'order-1',
            subscriptionId: 'sub-row-1',
          })
          // PayPal caps custom_id at 127 characters: two UUIDs fit.
          expect(payload.custom_id.length).toBeLessThanOrEqual(127)
          expect(payload.subscriber).toEqual({ email_address: 'jane@example.com' })
        }
      )
    )
  })

  it('refuses a PayPal subscription without a plan or when PayPal refuses', async () => {
    await withEnv(PAYPAL_ENV, async () => {
      const noPlan = refusal(
        await handler(
          { providerId: 'paypal', mode: 'subscription', amount: 24, currency: 'usd' },
          {}
        )
      )
      expect(noPlan.error).toBe('No PayPal billing plan was supplied for the subscription')
      await withFetch(
        (url) =>
          paypalAuth(url)
            ? { ok: true, body: { access_token: 'tok' } }
            : { ok: false, body: { message: 'PLAN_NOT_ACTIVE' } },
        async () => {
          const refused = refusal(
            await handler(
              {
                providerId: 'paypal',
                mode: 'subscription',
                amount: 24,
                currency: 'usd',
                planId: 'P-1',
              },
              {}
            )
          )
          expect(refused).toEqual({ status: 400, error: 'PLAN_NOT_ACTIVE', provider: 'paypal' })
        }
      )
    })
  })
})

describe('payment-charge-user one-time checkout email', () => {
  const handler: HandlerFn = loadHandler('payment-charge-user')
  const source = paymentChargeUser.generateHandler()

  it('prefills the buyer email on the Stripe payment session, as the subscription session does', () => {
    const start = source.indexOf('function chargeWithStripe')
    const end = source.indexOf('function subscribeWithStripe')
    expect(start).toBeGreaterThan(-1)
    const oneTime = source.slice(start, end)
    expect(oneTime).toContain("mode: 'payment'")
    expect(oneTime).toContain('sessionParams.customer_email = String(config.customerEmail)')
  })

  it('names the buyer as the PayPal payer, and leaves the payer out when the checkout carried no email', async () => {
    const ordersCall = (calls: FetchCall[]) =>
      calls.find((call) => call.url.endsWith('/v2/checkout/orders'))!
    const respond: Responder = (url) =>
      paypalAuth(url)
        ? { ok: true, body: { access_token: 'tok' } }
        : {
            ok: true,
            body: {
              id: 'ORDER-1',
              links: [{ rel: 'approve', href: 'https://paypal.test/approve' }],
            },
          }
    await withEnv(PAYPAL_ENV, () =>
      withFetch(respond, async (calls) => {
        const result = (await handler(
          {
            providerId: 'paypal',
            amount: 24,
            currency: 'usd',
            customerEmail: 'jane@example.com',
            successUrl: 'https://shop.test/order/1',
            cancelUrl: 'https://shop.test/checkout',
            metadata: JSON.stringify({ orderId: 'order-1' }),
          },
          {}
        )) as Record<string, unknown>
        expect(result).toMatchObject({
          checkoutUrl: 'https://paypal.test/approve',
          sessionId: 'ORDER-1',
        })
        const payload = JSON.parse(ordersCall(calls).init.body!)
        expect(payload.payer).toEqual({ email_address: 'jane@example.com' })
        expect(payload.purchase_units[0].amount).toEqual({ currency_code: 'USD', value: '24.00' })
      })
    )
    await withEnv(PAYPAL_ENV, () =>
      withFetch(respond, async (calls) => {
        await handler({ providerId: 'paypal', amount: 24, currency: 'usd' }, {})
        expect(JSON.parse(ordersCall(calls).init.body!)).not.toHaveProperty('payer')
      })
    )
  })
})

describe('payment-ensure-subscription-plan', () => {
  const handler: HandlerFn = loadHandler('payment-ensure-subscription-plan')

  it('is a non-terminal server node whose credentials are collected', () => {
    expect(paymentEnsureSubscriptionPlan.executionEnv).toBe('server')
    expect(paymentEnsureSubscriptionPlan.isTerminal).toBeFalsy()
    const secrets = collectSecrets({
      workflows: {
        wf1: {
          nodes: [
            {
              id: 'n1',
              type: 'payment-ensure-subscription-plan',
              config: { clientId: 'id_1', clientSecret: 'cs_1' },
            },
          ],
        },
      },
    } as never)
    expect(secrets.map((secret) => secret.fieldName).sort()).toEqual(['clientId', 'clientSecret'])
  })

  it('needs no plan for Stripe and returns a cached PayPal plan without a call', async () => {
    const stripe = await handler({ providerId: 'stripe' }, {})
    expect(stripe).toEqual({ ok: 'true', planId: '', providerProductId: '', created: 'false' })
    await withFetch(
      () => {
        throw new Error('no call expected')
      },
      async (calls) => {
        const cached = await handler(
          { providerId: 'paypal', planId: 'P-cached', providerProductId: 'PROD-1' },
          {}
        )
        expect(cached).toEqual({
          ok: 'true',
          planId: 'P-cached',
          providerProductId: 'PROD-1',
          created: 'false',
        })
        expect(calls).toHaveLength(0)
      }
    )
    const other = (await handler({ providerId: 'square' }, {})) as { ok: string; error: string }
    expect(other.ok).toBe('false')
    expect(other.error).toBe('Payment provider "square" cannot bill a subscription.')
  })

  it('creates the PayPal product and an active plan: a trial cycle, then the regular cycle until cancelled', async () => {
    await withEnv(PAYPAL_ENV, () =>
      withFetch(
        (url) => {
          if (paypalAuth(url)) {
            return { ok: true, body: { access_token: 'tok' } }
          }
          if (url.endsWith('/v1/catalogs/products')) {
            return { ok: true, body: { id: 'PROD-9' } }
          }
          return { ok: true, body: { id: 'P-9' } }
        },
        async (calls) => {
          const result = await handler(
            {
              providerId: 'paypal',
              productId: 'product-1',
              productName: 'Coffee Club',
              amount: 24.5,
              currency: 'usd',
              interval: 'month',
              intervalCount: 3,
              trialDays: 14,
            },
            {}
          )
          expect(result).toEqual({
            ok: 'true',
            planId: 'P-9',
            providerProductId: 'PROD-9',
            created: 'true',
          })
          const product = JSON.parse(
            calls.find((call) => call.url.endsWith('/v1/catalogs/products'))!.init.body!
          )
          expect(product).toEqual({
            name: 'Coffee Club',
            description: 'Store product product-1',
            type: 'SERVICE',
          })
          const plan = JSON.parse(
            calls.find((call) => call.url.endsWith('/v1/billing/plans'))!.init.body!
          )
          expect(plan.product_id).toBe('PROD-9')
          expect(plan.status).toBe('ACTIVE')
          expect(plan.billing_cycles).toEqual([
            {
              frequency: { interval_unit: 'DAY', interval_count: 14 },
              tenure_type: 'TRIAL',
              sequence: 1,
              total_cycles: 1,
              pricing_scheme: { fixed_price: { value: '0', currency_code: 'USD' } },
            },
            {
              frequency: { interval_unit: 'MONTH', interval_count: 3 },
              tenure_type: 'REGULAR',
              sequence: 2,
              total_cycles: 0,
              pricing_scheme: { fixed_price: { value: '24.50', currency_code: 'USD' } },
            },
          ])
          expect(plan.payment_preferences).toEqual({
            auto_bill_outstanding: true,
            setup_fee_failure_action: 'CONTINUE',
            payment_failure_threshold: 3,
          })
        }
      )
    )
  })

  it('opens the plan with a paid first cycle when a gift card paid part of it, and refuses that beside a free trial', async () => {
    await withEnv(PAYPAL_ENV, () =>
      withFetch(
        (url) => {
          if (paypalAuth(url)) {
            return { ok: true, body: { access_token: 'tok' } }
          }
          if (url.endsWith('/v1/catalogs/products')) {
            return { ok: true, body: { id: 'PROD-9' } }
          }
          return { ok: true, body: { id: 'P-10' } }
        },
        async (calls) => {
          const config = {
            providerId: 'paypal',
            productId: 'product-1',
            productName: 'Coffee Club',
            amount: 24.5,
            currency: 'usd',
            interval: 'month',
            intervalCount: 1,
            trialDays: 0,
          }
          const result = await handler({ ...config, firstCycleAmount: 4.5 }, {})
          expect(result).toEqual({
            ok: 'true',
            planId: 'P-10',
            providerProductId: 'PROD-9',
            created: 'true',
          })
          const plan = JSON.parse(
            calls.find((call) => call.url.endsWith('/v1/billing/plans'))!.init.body!
          )
          expect(plan.billing_cycles).toEqual([
            {
              frequency: { interval_unit: 'MONTH', interval_count: 1 },
              tenure_type: 'TRIAL',
              sequence: 1,
              total_cycles: 1,
              pricing_scheme: { fixed_price: { value: '4.50', currency_code: 'USD' } },
            },
            {
              frequency: { interval_unit: 'MONTH', interval_count: 1 },
              tenure_type: 'REGULAR',
              sequence: 2,
              total_cycles: 0,
              pricing_scheme: { fixed_price: { value: '24.50', currency_code: 'USD' } },
            },
          ])
          // The whole first cycle: the plan opens on the regular cycle alone.
          calls.length = 0
          await handler({ ...config, firstCycleAmount: 24.5 }, {})
          const whole = JSON.parse(
            calls.find((call) => call.url.endsWith('/v1/billing/plans'))!.init.body!
          )
          expect(
            whole.billing_cycles.map((cycle: { tenure_type: string }) => cycle.tenure_type)
          ).toEqual(['REGULAR'])

          const refused = await handler({ ...config, trialDays: 14, firstCycleAmount: 4.5 }, {})
          expect(refused).toMatchObject({
            ok: 'false',
            error: 'A subscription with a free trial cannot open with a reduced first payment.',
          })
        }
      )
    )
  })

  it('formats a zero-decimal currency whole and reports a refusal as a failure, never a throw', async () => {
    await withEnv(PAYPAL_ENV, () =>
      withFetch(
        (url) => {
          if (paypalAuth(url)) {
            return { ok: true, body: { access_token: 'tok' } }
          }
          if (url.endsWith('/v1/catalogs/products')) {
            return { ok: true, body: { id: 'PROD-9' } }
          }
          return { ok: false, body: { details: [{ description: 'Currency not supported' }] } }
        },
        async (calls) => {
          const result = (await handler(
            {
              providerId: 'paypal',
              productName: 'Box',
              amount: 1200.4,
              currency: 'jpy',
              interval: 'week',
            },
            {}
          )) as { ok: string; error: string }
          expect(result.ok).toBe('false')
          expect(result.error).toBe('PayPal refused to create the plan: Currency not supported')
          const plan = JSON.parse(
            calls.find((call) => call.url.endsWith('/v1/billing/plans'))!.init.body!
          )
          expect(plan.billing_cycles[0].pricing_scheme.fixed_price).toEqual({
            value: '1200',
            currency_code: 'JPY',
          })
        }
      )
    )
    const bad = (await withEnv(PAYPAL_ENV, () =>
      handler({ providerId: 'paypal', amount: -1, currency: 'usd' }, {})
    )) as {
      error: string
    }
    expect(bad.error).toBe('A subscription needs a positive amount to bill.')
  })
})

describe('payment-manage-subscription', () => {
  const handler: HandlerFn = loadHandler('payment-manage-subscription')
  const source = paymentManageSubscription.generateHandler()

  it('is a non-terminal server node whose credentials are collected', () => {
    expect(paymentManageSubscription.executionEnv).toBe('server')
    expect(paymentManageSubscription.isTerminal).toBeFalsy()
    expect(resolveHandlerEntryName(source, 'payment-manage-subscription')).toBe(
      'payment_manage_subscription'
    )
    const secrets = collectSecrets({
      workflows: {
        wf1: {
          nodes: [
            {
              id: 'n1',
              type: 'payment-manage-subscription',
              config: { secretKey: 'sk_1', clientId: 'id_1', clientSecret: 'cs_1' },
            },
          ],
        },
      },
    } as never)
    expect(secrets.map((secret) => secret.fieldName).sort()).toEqual([
      'clientId',
      'clientSecret',
      'secretKey',
    ])
  })

  it('refuses without an id, an unknown action or a provider that cannot manage one — in one result shape', async () => {
    const noId = (await handler({ providerId: 'stripe', action: 'cancel' }, {})) as Record<
      string,
      unknown
    >
    expect(noId).toEqual({
      ok: 'false',
      status: '',
      cancelAtPeriodEnd: 'false',
      currentPeriodStart: '',
      currentPeriodEnd: '',
      error: 'No provider subscription id was supplied, so there is nothing to manage.',
    })
    const badAction = (await handler(
      { providerId: 'stripe', providerSubscriptionId: 'sub_1', action: 'freeze' },
      {}
    )) as { error: string }
    expect(badAction.error).toBe('Unknown subscription action "freeze".')
    const badProvider = (await handler(
      { providerId: 'square', providerSubscriptionId: 's', action: 'cancel' },
      {}
    )) as { error: string }
    expect(badProvider.error).toBe('Payment provider "square" cannot manage subscriptions.')
    await withEnv(
      {
        STRIPE_SECRET_KEY: undefined,
        CONFIGURATION_STRIPE_SECRET_KEY: undefined,
        STRIPE_TEST_KEY: undefined,
      },
      async () => {
        const missing = (await handler(
          { providerId: 'stripe', providerSubscriptionId: 'sub_1', action: 'cancel' },
          {}
        )) as { error: string }
        expect(missing.error).toBe('STRIPE_SECRET_KEY is not configured')
      }
    )
  })

  it('maps every Stripe action onto the API and the answer onto the store vocabulary', () => {
    expect(source).toContain('stripe.subscriptions.cancel(subscriptionId)')
    expect(source).toContain('cancel_at_period_end: true')
    expect(source).toContain("pause_collection: { behavior: 'void' }")
    expect(source).toContain("pause_collection: ''")
    for (const [provider, store] of [
      ["'past_due' || value === 'unpaid'", "'past_due'"],
      ["value === 'canceled'", "'cancelled'"],
      ["value === 'incomplete_expired'", "'expired'"],
    ]) {
      expect(source).toContain(provider)
      expect(source).toContain(store)
    }
  })

  it('reads a Stripe subscription back without changing it, a dashboard `cancel_at` counting as scheduled', () => {
    expect(source).toContain("if (action === 'refresh') {")
    expect(source).toContain('stripe.subscriptions.retrieve(subscriptionId)')
    expect(source).toContain('cancelAtPeriodEnd: stripeCancelScheduled(subscription)')
    expect(source).toContain('currentPeriodStart: stripeUnixToIso(')
    // 2025 API versions carry the period on the item.
    expect(source).toContain('firstItem && firstItem.current_period_end')
  })

  it('reads a PayPal subscription back without posting anything', async () => {
    await withEnv(PAYPAL_ENV, () =>
      withFetch(
        (url) => {
          if (paypalAuth(url)) {
            return { ok: true, body: { access_token: 'tok' } }
          }
          return {
            ok: true,
            body: {
              id: 'I-ABC',
              status: 'SUSPENDED',
              start_time: '2026-09-01T10:00:00Z',
              billing_info: {
                last_payment: { time: '2026-09-22T10:00:00Z' },
                next_billing_time: '2026-10-22T10:00:00Z',
              },
            },
          }
        },
        async (calls) => {
          const result = await handler(
            { providerId: 'paypal', providerSubscriptionId: 'I-ABC', action: 'refresh' },
            {}
          )
          expect(result).toEqual({
            ok: 'true',
            status: 'paused',
            cancelAtPeriodEnd: 'false',
            currentPeriodStart: '2026-09-22T10:00:00Z',
            currentPeriodEnd: '2026-10-22T10:00:00Z',
          })
          expect(
            calls.filter((call) => call.init.method === 'POST' && !paypalAuth(call.url))
          ).toEqual([])
          expect(
            calls.some(
              (call) => !call.init.method && call.url.endsWith('/v1/billing/subscriptions/I-ABC')
            )
          ).toBe(true)
        }
      )
    )
  })

  it('cancels, suspends and reactivates a PayPal subscription and reads the state back', async () => {
    const cases: Array<[string, string, string, string]> = [
      ['cancel', '/cancel', 'CANCELLED', 'cancelled'],
      ['cancel_at_period_end', '/cancel', 'CANCELLED', 'cancelled'],
      ['pause', '/suspend', 'SUSPENDED', 'paused'],
      ['resume', '/activate', 'ACTIVE', 'active'],
    ]
    for (const [action, endpoint, providerStatus, storeStatus] of cases) {
      await withEnv(PAYPAL_ENV, () =>
        withFetch(
          (url, init) => {
            if (paypalAuth(url)) {
              return { ok: true, body: { access_token: 'tok' } }
            }
            if (init.method === 'POST') {
              return { ok: true, status: 204, body: {} }
            }
            return {
              ok: true,
              body: {
                id: 'I-ABC',
                status: providerStatus,
                billing_info: { next_billing_time: '2026-10-22T10:00:00Z' },
              },
            }
          },
          async (calls) => {
            const result = (await handler(
              { providerId: 'paypal', providerSubscriptionId: 'I-ABC', action },
              {}
            )) as Record<string, unknown>
            expect([action, result.ok]).toEqual([action, 'true'])
            expect([action, result.status]).toEqual([action, storeStatus])
            const post = calls.find((call) => call.init.method === 'POST' && !paypalAuth(call.url))!
            expect(post.url.endsWith('/v1/billing/subscriptions/I-ABC' + endpoint)).toBe(true)
            expect(post.init.headers?.Authorization).toBe('Bearer tok')
            const read = calls.find((call) => !call.init.method && !paypalAuth(call.url))!
            expect(read.url.endsWith('/v1/billing/subscriptions/I-ABC')).toBe(true)
          }
        )
      )
    }
  })

  it('reports a PayPal refusal as a failure the workflow can read', async () => {
    await withEnv(PAYPAL_ENV, () =>
      withFetch(
        (url) =>
          paypalAuth(url)
            ? { ok: true, body: { access_token: 'tok' } }
            : { ok: false, status: 422, body: { message: 'SUBSCRIPTION_STATUS_INVALID' } },
        async () => {
          const result = (await handler(
            { providerId: 'paypal', providerSubscriptionId: 'I-ABC', action: 'pause' },
            {}
          )) as {
            ok: string
            error: string
          }
          expect(result.ok).toBe('false')
          expect(result.error).toContain('SUBSCRIPTION_STATUS_INVALID')
        }
      )
    )
  })
})

/** A stand-in Stripe SDK: records every portal call and answers from the scripted replies. */
interface FakeStripeScript {
  sessionErrors?: string[]
  configurations?: Array<{ id: string; metadata?: Record<string, string> }>
}

const withFakeStripe = async <T>(
  script: FakeStripeScript,
  run: (calls: Array<{ method: string; params: Record<string, unknown> }>) => Promise<T>
): Promise<T> => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = []
  const errors = [...(script.sessionErrors || [])]
  class FakeStripe {
    billingPortal = {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          calls.push({ method: 'sessions.create', params })
          const error = errors.shift()
          if (error) {
            throw new Error(error)
          }
          return { url: 'https://billing.stripe.com/p/session/test_1' }
        },
      },
      configurations: {
        list: async (params: Record<string, unknown>) => {
          calls.push({ method: 'configurations.list', params })
          return { data: script.configurations || [] }
        },
        create: async (params: Record<string, unknown>) => {
          calls.push({ method: 'configurations.create', params })
          return { id: 'bpc_created' }
        },
      },
    }
  }
  const scope = globalThis as {
    __non_webpack_require__?: unknown
    __stripeBillingPortalConfigurationId?: string
  }
  scope.__non_webpack_require__ = (name: string) => {
    if (name !== 'stripe') {
      throw new Error('unexpected require ' + name)
    }
    return FakeStripe
  }
  try {
    return await withEnv({ STRIPE_SECRET_KEY: 'sk_test_1' }, () => run(calls))
  } finally {
    delete scope.__non_webpack_require__
    delete scope.__stripeBillingPortalConfigurationId
  }
}

describe('payment-billing-portal', () => {
  const handler: HandlerFn = loadHandler('payment-billing-portal')
  const source = paymentBillingPortal.generateHandler()
  const RETURN_URL = 'https://store.test/my-profile?tab=subscriptions'
  const NO_DEFAULT_CONFIGURATION =
    'No configuration provided and your test mode default configuration has not been created.'

  it('is a non-terminal server node whose credentials are collected', () => {
    expect(paymentBillingPortal.executionEnv).toBe('server')
    expect(paymentBillingPortal.isTerminal).toBeFalsy()
    expect(resolveHandlerEntryName(source, 'payment-billing-portal')).toBe('payment_billing_portal')
    const secrets = collectSecrets({
      workflows: {
        wf1: {
          nodes: [
            {
              id: 'n1',
              type: 'payment-billing-portal',
              config: { secretKey: 'sk_1', clientId: 'id_1', clientSecret: 'cs_1' },
            },
          ],
        },
      },
    } as never)
    expect(secrets.map((secret) => secret.fieldName).sort()).toEqual([
      'clientId',
      'clientSecret',
      'secretKey',
    ])
  })

  it('refuses, in one result shape, what it cannot open', async () => {
    expect(
      await handler({ providerId: 'square', providerCustomerId: 'c', returnUrl: RETURN_URL }, {})
    ).toEqual({
      ok: 'false',
      url: '',
      error: 'Payment provider "square" has no billing portal.',
    })
    const noCustomer = (await handler({ providerId: 'stripe', returnUrl: RETURN_URL }, {})) as {
      error: string
    }
    expect(noCustomer.error).toBe('No Stripe customer is attached to this subscription yet.')
    for (const returnUrl of ['', '/my-profile', 'javascript:alert(1)']) {
      const badUrl = (await handler(
        { providerId: 'stripe', providerCustomerId: 'cus_1', returnUrl },
        {}
      )) as {
        error: string
      }
      expect(badUrl.error).toBe(
        'A return URL (http or https) is required to open the billing portal.'
      )
    }
    await withEnv(
      {
        STRIPE_SECRET_KEY: undefined,
        CONFIGURATION_STRIPE_SECRET_KEY: undefined,
        STRIPE_TEST_KEY: undefined,
      },
      async () => {
        const missing = (await handler(
          { providerId: 'stripe', providerCustomerId: 'cus_1', returnUrl: RETURN_URL },
          {}
        )) as { error: string }
        expect(missing.error).toBe('STRIPE_SECRET_KEY is not configured')
      }
    )
  })

  it("opens a Stripe portal session for the subscription's customer", async () => {
    await withFakeStripe({}, async (calls) => {
      const result = await handler(
        { providerId: 'stripe', providerCustomerId: 'cus_1', returnUrl: RETURN_URL },
        {}
      )
      expect(result).toEqual({ ok: 'true', url: 'https://billing.stripe.com/p/session/test_1' })
      expect(calls).toEqual([
        { method: 'sessions.create', params: { customer: 'cus_1', return_url: RETURN_URL } },
      ])
    })
  })

  it('creates the store portal configuration once when the account has none, then reuses it', async () => {
    await withFakeStripe({ sessionErrors: [NO_DEFAULT_CONFIGURATION] }, async (calls) => {
      const first = await handler(
        { providerId: 'stripe', providerCustomerId: 'cus_1', returnUrl: RETURN_URL },
        {}
      )
      expect(first).toEqual({ ok: 'true', url: 'https://billing.stripe.com/p/session/test_1' })
      expect(calls.map((call) => call.method)).toEqual([
        'sessions.create',
        'configurations.list',
        'configurations.create',
        'sessions.create',
      ])
      expect(calls[2].params).toEqual({
        business_profile: { headline: 'Manage your payment method and invoices' },
        features: { payment_method_update: { enabled: true }, invoice_history: { enabled: true } },
        metadata: { teleport: 'teleport-store-billing-portal' },
      })
      expect(calls[3].params).toEqual({
        customer: 'cus_1',
        return_url: RETURN_URL,
        configuration: 'bpc_created',
      })

      // The next subscriber goes straight to a session with it.
      calls.length = 0
      await handler(
        { providerId: 'stripe', providerCustomerId: 'cus_2', returnUrl: RETURN_URL },
        {}
      )
      expect(calls).toEqual([
        {
          method: 'sessions.create',
          params: { customer: 'cus_2', return_url: RETURN_URL, configuration: 'bpc_created' },
        },
      ])
    })
  })

  it('finds the configuration a previous cold start created instead of creating another', async () => {
    await withFakeStripe(
      {
        sessionErrors: [NO_DEFAULT_CONFIGURATION],
        configurations: [
          { id: 'bpc_merchant', metadata: {} },
          { id: 'bpc_store', metadata: { teleport: 'teleport-store-billing-portal' } },
        ],
      },
      async (calls) => {
        await handler(
          { providerId: 'stripe', providerCustomerId: 'cus_1', returnUrl: RETURN_URL },
          {}
        )
        expect(calls.map((call) => call.method)).toEqual([
          'sessions.create',
          'configurations.list',
          'sessions.create',
        ])
        expect(calls[2].params.configuration).toBe('bpc_store')
      }
    )
  })

  it('reports any other Stripe refusal without touching the configuration', async () => {
    await withFakeStripe({ sessionErrors: ['No such customer: cus_gone'] }, async (calls) => {
      const result = await handler(
        { providerId: 'stripe', providerCustomerId: 'cus_gone', returnUrl: RETURN_URL },
        {}
      )
      expect(result).toEqual({ ok: 'false', url: '', error: 'No such customer: cus_gone' })
      expect(calls.map((call) => call.method)).toEqual(['sessions.create'])
    })
  })

  it("sends a PayPal subscriber to the automatic-payments page of the store's environment", async () => {
    for (const [sandboxAnswers, expected] of [
      [true, 'https://www.sandbox.paypal.com/myaccount/autopay/'],
      [false, 'https://www.paypal.com/myaccount/autopay/'],
    ] as Array<[boolean, string]>) {
      await withEnv(PAYPAL_ENV, () =>
        withFetch(
          (url) =>
            url.startsWith('https://api-m.sandbox.paypal.com') && !sandboxAnswers
              ? { ok: false, status: 401, body: { error: 'invalid_client' } }
              : { ok: true, body: { access_token: 'tok' } },
          async () => {
            expect(await handler({ providerId: 'paypal', returnUrl: RETURN_URL }, {})).toEqual({
              ok: 'true',
              url: expected,
            })
          }
        )
      )
    }
    await withEnv({ PAYPAL_CLIENT_ID: undefined, PAYPAL_CLIENT_SECRET: undefined }, async () => {
      expect(await handler({ providerId: 'paypal' }, {})).toEqual({
        ok: 'false',
        url: '',
        error: 'PayPal credentials are not configured',
      })
    })
  })
})
