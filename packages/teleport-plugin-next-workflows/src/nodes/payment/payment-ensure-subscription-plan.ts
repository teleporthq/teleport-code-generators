import { NodeHandlerGenerator, handlerToString } from '../types'

// Makes sure the provider has a PLAN to bill a recurring product with, and
// returns its id. Runs before `payment-charge-user` in subscription mode.
//
// Stripe needs no plan of its own: its Checkout Session takes the price
// inline (`price_data.recurring`), so the node answers `planId: ''`. PayPal
// bills a subscription against a Billing Plan, which has to exist before the
// approval link can be created: the node creates a catalog product and a plan
// when the workflow hands it no cached `planId`, and returns the ids for the
// workflow to cache in `teleport_provider_plans` so the next buyer of the same
// product and price subscribes to the same plan.
//
// Config (every amount in the MAJOR currency unit, like the charge node):
//   providerId, planId (cached, may be ''), productName, amount, currency,
//   interval ('day'|'week'|'month'|'year'), intervalCount, trialDays,
//   productId (the store's own id, kept in the provider product's description
//   so a merchant can trace it from the provider dashboard).
//
// Result (strings, for the workflow editor's comparisons):
//   ok 'true'|'false', planId, providerProductId, created 'true'|'false',
//   error (only when ok is 'false' — fatal to the caller, on purpose: a
//   checkout that cannot create its plan has nothing to redirect to).

function resolveProviderSecret(candidates: string[], prefixScan?: string): string {
  const env = (globalThis as any).process.env
  for (const key of candidates) {
    const value = env[key]
    if (value && String(value).length > 0) {
      return String(value)
    }
  }
  if (prefixScan) {
    const envKeys = Object.keys(env)
    for (const key of envKeys) {
      if (key.indexOf(prefixScan) === 0) {
        const value = env[key]
        if (value && String(value).length > 0) {
          return String(value)
        }
      }
    }
  }
  return ''
}

async function payment_ensure_subscription_plan(config: any, _context: Record<string, unknown>) {
  const providerType = String(config.providerType || config.provider || config.providerId || '')
    .trim()
    .toLowerCase()
  const cachedPlanId = String(config.planId || '').trim()
  const failure = (message: string) => ({
    ok: 'false',
    planId: '',
    providerProductId: '',
    created: 'false',
    error: message,
  })
  if (providerType === 'stripe') {
    return { ok: 'true', planId: '', providerProductId: '', created: 'false' }
  }
  if (providerType !== 'paypal') {
    return failure('Payment provider "' + providerType + '" cannot bill a subscription.')
  }
  if (cachedPlanId) {
    return {
      ok: 'true',
      planId: cachedPlanId,
      providerProductId: String(config.providerProductId || ''),
      created: 'false',
    }
  }
  return createPaypalPlan(config)
}

async function createPaypalPlan(config: any) {
  const clientId = resolveProviderSecret(
    ['PAYPAL_CLIENT_ID', 'CONFIGURATION_PAYPAL_CLIENT_ID'],
    'CONFIGURATION_PAYPAL_CLIENT_ID'
  )
  const clientSecret = resolveProviderSecret(
    ['PAYPAL_CLIENT_SECRET', 'CONFIGURATION_PAYPAL_CLIENT_SECRET'],
    'CONFIGURATION_PAYPAL_CLIENT_SECRET'
  )
  const failure = (message: string) => ({
    ok: 'false',
    planId: '',
    providerProductId: '',
    created: 'false',
    error: message,
  })
  if (!clientId || !clientSecret) {
    return failure('PayPal credentials are not configured')
  }
  const currency = String(config.currency || 'USD').toUpperCase()
  const amount = Number(config.amount)
  if (!isFinite(amount) || amount <= 0) {
    return failure('A subscription needs a positive amount to bill.')
  }
  const interval = String(config.interval || 'month').toUpperCase()
  if (['DAY', 'WEEK', 'MONTH', 'YEAR'].indexOf(interval) === -1) {
    return failure('Unknown billing interval "' + interval + '".')
  }
  const intervalCount = Math.max(1, Math.floor(Number(config.intervalCount) || 1))
  const trialDays = Math.max(0, Math.floor(Number(config.trialDays) || 0))
  const productName = String(config.productName || 'Subscription').slice(0, 127)
  // PayPal formats amounts in the major unit; zero-decimal currencies whole.
  const PAYPAL_ZERO_DECIMAL = ['HUF', 'JPY', 'TWD']
  const formatValue = (major: number) =>
    PAYPAL_ZERO_DECIMAL.indexOf(currency) >= 0 ? String(Math.round(major)) : major.toFixed(2)
  const value = formatValue(amount)
  // What the FIRST cycle bills when a gift card paid part of it at checkout:
  // PayPal bills the plan, so such a plan opens with a paid TRIAL cycle of one
  // regular period at that price, then the regular price. A free trial and a
  // reduced first cycle cannot both exist — the tender rule refuses the card.
  const firstCycleRaw = Number(config.firstCycleAmount)
  const firstCycleAmount =
    isFinite(firstCycleRaw) && firstCycleRaw > 0 && firstCycleRaw < amount ? firstCycleRaw : null
  if (firstCycleAmount !== null && trialDays > 0) {
    return failure('A subscription with a free trial cannot open with a reduced first payment.')
  }

  try {
    const auth = await paypalAuthenticate(clientId, clientSecret)
    if ('error' in auth) {
      return failure(auth.error)
    }
    const { baseUrl, accessToken } = auth
    const headers = {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
    }
    const readError = async (response: Response, fallback: string) => {
      try {
        const data: any = await response.json()
        return (
          (data &&
            (data.message || (data.details && data.details[0] && data.details[0].description))) ||
          fallback
        )
      } catch (_e) {
        return fallback
      }
    }

    const productResponse = await fetch(baseUrl + '/v1/catalogs/products', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: productName,
        description: config.productId ? 'Store product ' + String(config.productId) : undefined,
        type: 'SERVICE',
      }),
    })
    if (!productResponse.ok) {
      return failure(
        'PayPal refused to create the product: ' +
          (await readError(productResponse, 'HTTP ' + productResponse.status))
      )
    }
    const product: any = await productResponse.json()
    const providerProductId = String((product && product.id) || '')
    if (!providerProductId) {
      return failure('PayPal returned no product id.')
    }

    const billingCycles: any[] = []
    if (trialDays > 0) {
      billingCycles.push({
        frequency: { interval_unit: 'DAY', interval_count: trialDays },
        tenure_type: 'TRIAL',
        sequence: 1,
        total_cycles: 1,
        pricing_scheme: { fixed_price: { value: '0', currency_code: currency } },
      })
    } else if (firstCycleAmount !== null) {
      billingCycles.push({
        frequency: { interval_unit: interval, interval_count: intervalCount },
        tenure_type: 'TRIAL',
        sequence: 1,
        total_cycles: 1,
        pricing_scheme: {
          fixed_price: { value: formatValue(firstCycleAmount), currency_code: currency },
        },
      })
    }
    billingCycles.push({
      frequency: { interval_unit: interval, interval_count: intervalCount },
      tenure_type: 'REGULAR',
      sequence: billingCycles.length + 1,
      // 0 = until cancelled.
      total_cycles: 0,
      pricing_scheme: { fixed_price: { value, currency_code: currency } },
    })
    const planResponse = await fetch(baseUrl + '/v1/billing/plans', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        product_id: providerProductId,
        name: productName,
        status: 'ACTIVE',
        billing_cycles: billingCycles,
        payment_preferences: {
          auto_bill_outstanding: true,
          setup_fee_failure_action: 'CONTINUE',
          payment_failure_threshold: 3,
        },
      }),
    })
    if (!planResponse.ok) {
      return failure(
        'PayPal refused to create the plan: ' +
          (await readError(planResponse, 'HTTP ' + planResponse.status))
      )
    }
    const plan: any = await planResponse.json()
    const planId = String((plan && plan.id) || '')
    if (!planId) {
      return failure('PayPal returned no plan id.')
    }
    return { ok: 'true', planId, providerProductId, created: 'true' }
  } catch (err: unknown) {
    return failure((err as Error).message)
  }
}

// Same as `payment-charge-user.ts` — serialized on its own, so it travels here.
async function paypalAuthenticate(
  clientId: string,
  clientSecret: string
): Promise<{ baseUrl: string; accessToken: string } | { error: string }> {
  const SANDBOX = 'https://api-m.sandbox.paypal.com'
  const LIVE = 'https://api-m.paypal.com'
  const basicAuth =
    'Basic ' + (globalThis as any).Buffer.from(clientId + ':' + clientSecret).toString('base64')

  async function tryAuth(baseUrl: string): Promise<{
    accessToken?: string
    invalidClient?: boolean
    errorMessage?: string
  }> {
    try {
      const res = await fetch(baseUrl + '/v1/oauth2/token', {
        method: 'POST',
        headers: { Authorization: basicAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      })
      const data: any = await res.json()
      if (data && data.access_token) {
        return { accessToken: data.access_token }
      }
      const isInvalidClient = data && data.error === 'invalid_client'
      return {
        invalidClient: isInvalidClient,
        errorMessage: (data && (data.error_description || data.error)) || 'HTTP ' + res.status,
      }
    } catch (e: unknown) {
      return { errorMessage: 'network error: ' + (e as Error).message }
    }
  }

  const cached = (globalThis as any).__paypalBaseUrlCache as string | undefined
  if (cached === SANDBOX || cached === LIVE) {
    const r = await tryAuth(cached)
    if (r.accessToken) {
      return { baseUrl: cached, accessToken: r.accessToken }
    }
    if (!r.invalidClient) {
      return { error: 'PayPal authentication failed: ' + r.errorMessage }
    }
    ;(globalThis as any).__paypalBaseUrlCache = undefined
  }
  const sandboxResult = await tryAuth(SANDBOX)
  if (sandboxResult.accessToken) {
    ;(globalThis as any).__paypalBaseUrlCache = SANDBOX
    return { baseUrl: SANDBOX, accessToken: sandboxResult.accessToken }
  }
  if (!sandboxResult.invalidClient) {
    return { error: 'PayPal authentication failed: ' + sandboxResult.errorMessage }
  }
  const liveResult = await tryAuth(LIVE)
  if (liveResult.accessToken) {
    ;(globalThis as any).__paypalBaseUrlCache = LIVE
    return { baseUrl: LIVE, accessToken: liveResult.accessToken }
  }
  return {
    error:
      'PayPal authentication failed: credentials are not valid for either sandbox or live (' +
      (liveResult.errorMessage || 'invalid_client') +
      ').',
  }
}

export const paymentEnsureSubscriptionPlan: NodeHandlerGenerator = {
  nodeType: 'payment-ensure-subscription-plan',
  executionEnv: 'server',
  generateHandler(): string {
    return (
      handlerToString(payment_ensure_subscription_plan) +
      '\n' +
      resolveProviderSecret.toString() +
      '\n' +
      createPaypalPlan.toString() +
      '\n' +
      paypalAuthenticate.toString()
    )
  },
}
