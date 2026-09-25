import { NodeHandlerGenerator, handlerToString } from '../types'

// Cancels, pauses or resumes a subscription at the provider that bills it.
//
// Result contract (every field a string, so an if-statement compares it the
// way the workflow editor does):
//   ok                 'true' | 'false'
//   status             the store's own vocabulary after the action —
//                      'active' | 'past_due' | 'paused' | 'cancelled' |
//                      'trialing' | 'expired' | '' (unknown)
//   cancelAtPeriodEnd  'true' | 'false'
//   currentPeriodEnd   ISO 8601 or ''
//   error              a provider or configuration message, only when
//                      `ok === 'false'` — ⛔ the generated runtime treats a
//                      non-empty `error` as FATAL, so a caller that must
//                      report instead of fail runs this node with
//                      `continueOnError`.
//
// `action`: 'cancel' (now), 'cancel_at_period_end', 'pause', 'resume' — on
// Stripe a resume also withdraws a cancellation scheduled for the period end.
// PayPal has no "cancel at the end of the period": its subscriptions are
// cancelled at once, so that action cancels and reports
// `cancelAtPeriodEnd: 'false'` with the status the provider returned — the
// buyer keeps what the current cycle already paid for either way, because a
// PayPal cancellation never refunds the running cycle.

// Duplicated from `payment-charge-user.ts` deliberately: each node's handler
// is serialized on its own via `.toString()`; see that file.
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

async function payment_manage_subscription(config: any, _context: Record<string, unknown>) {
  const providerType = String(config.providerType || config.provider || config.providerId || '')
    .trim()
    .toLowerCase()
  const subscriptionId = String(config.providerSubscriptionId || config.subscriptionId || '').trim()
  const action = String(config.action || '')
    .trim()
    .toLowerCase()
  const failure = (message: string) => ({
    ok: 'false',
    status: '',
    cancelAtPeriodEnd: 'false',
    currentPeriodStart: '',
    currentPeriodEnd: '',
    error: message,
  })

  if (!subscriptionId) {
    return failure('No provider subscription id was supplied, so there is nothing to manage.')
  }
  // `refresh` changes nothing at the provider: it reads the subscription's
  // live state, for a store to reconcile a row a webhook never reached.
  if (['cancel', 'cancel_at_period_end', 'pause', 'resume', 'refresh'].indexOf(action) === -1) {
    return failure('Unknown subscription action "' + action + '".')
  }
  if (providerType === 'stripe') {
    return manageStripeSubscription(subscriptionId, action)
  }
  if (providerType === 'paypal') {
    return managePaypalSubscription(subscriptionId, action)
  }
  return failure('Payment provider "' + providerType + '" cannot manage subscriptions.')
}

// Stripe's own status words onto the store's vocabulary.
function stripeSubscriptionStatus(status: any, pauseCollection: any): string {
  if (pauseCollection && pauseCollection.behavior) {
    return 'paused'
  }
  const value = String(status || '').toLowerCase()
  if (value === 'active') {
    return 'active'
  }
  if (value === 'trialing') {
    return 'trialing'
  }
  if (value === 'past_due' || value === 'unpaid') {
    return 'past_due'
  }
  if (value === 'paused') {
    return 'paused'
  }
  if (value === 'canceled') {
    return 'cancelled'
  }
  // The same word the webhook and the merchant's panel use for it.
  if (value === 'incomplete_expired') {
    return 'expired'
  }
  if (value === 'incomplete') {
    return 'pending'
  }
  return ''
}

// Stripe's dashboard can schedule a cancellation as a DATE (`cancel_at`)
// instead of the flag; a date inside the current period is the same thing.
function stripeCancelScheduled(subscription: any): boolean {
  if (subscription && subscription.cancel_at_period_end) {
    return true
  }
  const cancelAt = Number(subscription && subscription.cancel_at)
  const periodEnd = Number(subscription && subscription.current_period_end)
  return isFinite(cancelAt) && cancelAt > 0 && (!(periodEnd > 0) || cancelAt <= periodEnd)
}

function stripeUnixToIso(value: any): string {
  const seconds = Number(value)
  return isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : ''
}

async function manageStripeSubscription(subscriptionId: string, action: string) {
  const secretKey = resolveProviderSecret(
    ['STRIPE_SECRET_KEY', 'CONFIGURATION_STRIPE_SECRET_KEY', 'STRIPE_TEST_KEY'],
    'CONFIGURATION_STRIPE_SECRET_KEY'
  )
  if (!secretKey) {
    return {
      ok: 'false',
      status: '',
      cancelAtPeriodEnd: 'false',
      currentPeriodStart: '',
      currentPeriodEnd: '',
      error: 'STRIPE_SECRET_KEY is not configured',
    }
  }
  try {
    const nodeRequire =
      typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
    const Stripe = nodeRequire('stripe')
    const stripe = new Stripe(secretKey)
    let subscription: any
    if (action === 'refresh') {
      subscription = await stripe.subscriptions.retrieve(subscriptionId)
    } else if (action === 'cancel') {
      subscription = await stripe.subscriptions.cancel(subscriptionId)
    } else if (action === 'cancel_at_period_end') {
      subscription = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      })
    } else if (action === 'pause') {
      // Collection pauses; the subscription stays and resumes without a new
      // mandate. `void` marks the paused invoices uncollectible.
      subscription = await stripe.subscriptions.update(subscriptionId, {
        pause_collection: { behavior: 'void' },
      })
    } else {
      subscription = await stripe.subscriptions.update(subscriptionId, {
        pause_collection: '',
        cancel_at_period_end: false,
      })
    }
    // 2025 API versions carry the period on the item, not the subscription.
    const firstItem =
      subscription && subscription.items && subscription.items.data && subscription.items.data[0]
    return {
      ok: 'true',
      status: stripeSubscriptionStatus(
        subscription && subscription.status,
        subscription && subscription.pause_collection
      ),
      cancelAtPeriodEnd: stripeCancelScheduled(subscription) ? 'true' : 'false',
      currentPeriodStart: stripeUnixToIso(
        (subscription && subscription.current_period_start) ||
          (firstItem && firstItem.current_period_start)
      ),
      currentPeriodEnd: stripeUnixToIso(
        (subscription && subscription.current_period_end) ||
          (firstItem && firstItem.current_period_end)
      ),
    }
  } catch (err: unknown) {
    return {
      ok: 'false',
      status: '',
      cancelAtPeriodEnd: 'false',
      currentPeriodStart: '',
      currentPeriodEnd: '',
      error: (err as Error).message,
    }
  }
}

// PayPal's own status words onto the store's vocabulary.
function paypalSubscriptionStatus(status: any): string {
  const value = String(status || '').toUpperCase()
  if (value === 'ACTIVE') {
    return 'active'
  }
  if (value === 'SUSPENDED') {
    return 'paused'
  }
  if (value === 'CANCELLED') {
    return 'cancelled'
  }
  if (value === 'EXPIRED') {
    return 'expired'
  }
  if (value === 'APPROVAL_PENDING' || value === 'APPROVED') {
    return 'pending'
  }
  return ''
}

async function managePaypalSubscription(subscriptionId: string, action: string) {
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
    status: '',
    cancelAtPeriodEnd: 'false',
    currentPeriodStart: '',
    currentPeriodEnd: '',
    error: message,
  })
  if (!clientId || !clientSecret) {
    return failure('PayPal credentials are not configured')
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
    const verb = action === 'pause' ? 'suspend' : action === 'resume' ? 'activate' : 'cancel'
    const reason =
      verb === 'cancel'
        ? 'Cancelled by the store'
        : verb === 'suspend'
        ? 'Paused by the store'
        : 'Resumed by the store'
    // A refresh only reads the subscription back.
    const actionResponse =
      action === 'refresh'
        ? null
        : await fetch(
            baseUrl +
              '/v1/billing/subscriptions/' +
              encodeURIComponent(subscriptionId) +
              '/' +
              verb,
            { method: 'POST', headers, body: JSON.stringify({ reason }) }
          )
    if (actionResponse && !actionResponse.ok) {
      let message = 'HTTP ' + actionResponse.status
      try {
        const data: any = await actionResponse.json()
        message =
          (data &&
            (data.message || (data.details && data.details[0] && data.details[0].description))) ||
          message
      } catch (_e) {
        // The 204 success and some errors carry no body.
      }
      return failure('PayPal refused the ' + verb + ': ' + message)
    }
    // The action reply has no body; read the subscription back for its state.
    const detailResponse = await fetch(
      baseUrl + '/v1/billing/subscriptions/' + encodeURIComponent(subscriptionId),
      { headers }
    )
    if (action === 'refresh' && !detailResponse.ok) {
      return failure('PayPal could not read the subscription: HTTP ' + detailResponse.status)
    }
    const detail: any = detailResponse.ok ? await detailResponse.json() : {}
    const billingInfo = (detail && detail.billing_info) || {}
    const lastPayment = billingInfo.last_payment || {}
    return {
      ok: 'true',
      status: paypalSubscriptionStatus(detail && detail.status),
      cancelAtPeriodEnd: 'false',
      currentPeriodStart: lastPayment.time
        ? String(lastPayment.time)
        : detail && detail.start_time
        ? String(detail.start_time)
        : '',
      currentPeriodEnd: billingInfo.next_billing_time ? String(billingInfo.next_billing_time) : '',
    }
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

export const paymentManageSubscription: NodeHandlerGenerator = {
  nodeType: 'payment-manage-subscription',
  executionEnv: 'server',
  dependencies: {
    stripe: '^14.0.0',
  },
  generateHandler(): string {
    return (
      handlerToString(payment_manage_subscription) +
      '\n' +
      resolveProviderSecret.toString() +
      '\n' +
      stripeSubscriptionStatus.toString() +
      '\n' +
      manageStripeSubscription.toString() +
      '\n' +
      paypalSubscriptionStatus.toString() +
      '\n' +
      managePaypalSubscription.toString() +
      '\n' +
      paypalAuthenticate.toString()
    )
  },
}
