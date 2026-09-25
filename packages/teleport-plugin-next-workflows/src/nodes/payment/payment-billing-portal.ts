import { NodeHandlerGenerator, handlerToString } from '../types'

// Where a subscriber manages their billing at the provider that bills them:
//   - Stripe: a customer-portal session for the subscription's customer —
//     update the payment method, see and pay invoices. Single use; it expires
//     after a few minutes, so a caller opens it right away.
//   - PayPal: the buyer's own "automatic payments" page. PayPal has no
//     merchant-created portal; the buyer changes the funding source of a
//     subscription from their PayPal account.
//
// Result contract (every field a string, so an if-statement compares it the
// way the workflow editor does):
//   ok     'true' | 'false'
//   url    the page to send the subscriber to, '' on a failure
//   error  only when `ok === 'false'` — ⛔ the generated runtime treats a
//          non-empty `error` as FATAL, so a caller that must report instead
//          of fail runs this node with `continueOnError`.
//
// ⛔ The portal opens the customer's whole billing account. A caller must
// prove the customer belongs to the signed-in visitor BEFORE this node runs
// (the storefront reads the subscription row matched on the session's user id).

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

async function payment_billing_portal(config: any, _context: Record<string, unknown>) {
  const providerType = String(config.providerType || config.provider || config.providerId || '')
    .trim()
    .toLowerCase()
  if (providerType === 'stripe') {
    return openStripeBillingPortal(
      String(config.providerCustomerId || config.customerId || '').trim(),
      String(config.returnUrl || '').trim()
    )
  }
  if (providerType === 'paypal') {
    return openPaypalAutomaticPayments()
  }
  return {
    ok: 'false',
    url: '',
    error: 'Payment provider "' + providerType + '" has no billing portal.',
  }
}

// A Stripe account whose portal settings were never saved (every new account,
// and test mode separately) has no default configuration, and a session
// without one is refused. The store then uses — creating it once — a
// configuration of its own: payment methods and invoices only, so the
// subscription itself is still changed from the store, where it is recorded.
async function ensureStripePortalConfiguration(stripe: any): Promise<string> {
  // Marks the configuration this store creates, so a later cold start finds it
  // instead of creating another. Inline: a serialized handler carries no
  // module-level names.
  const tag = 'teleport-store-billing-portal'
  const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 100 })
  const list = (existing && existing.data) || []
  for (let i = 0; i < list.length; i++) {
    const metadata = list[i] && list[i].metadata
    if (metadata && metadata.teleport === tag) {
      return String(list[i].id)
    }
  }
  const created = await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'Manage your payment method and invoices' },
    features: {
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
    },
    metadata: { teleport: tag },
  })
  return String(created.id)
}

async function openStripeBillingPortal(customerId: string, returnUrl: string) {
  const failure = (message: string) => ({ ok: 'false', url: '', error: message })
  if (!customerId) {
    return failure('No Stripe customer is attached to this subscription yet.')
  }
  if (!/^https?:\/\/[^\s]+$/i.test(returnUrl)) {
    return failure('A return URL (http or https) is required to open the billing portal.')
  }
  const secretKey = resolveProviderSecret(
    ['STRIPE_SECRET_KEY', 'CONFIGURATION_STRIPE_SECRET_KEY', 'STRIPE_TEST_KEY'],
    'CONFIGURATION_STRIPE_SECRET_KEY'
  )
  if (!secretKey) {
    return failure('STRIPE_SECRET_KEY is not configured')
  }
  try {
    const nodeRequire =
      typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
    const Stripe = nodeRequire('stripe')
    const stripe = new Stripe(secretKey)
    const cache = globalThis as any
    const createSession = (configurationId: string) =>
      stripe.billingPortal.sessions.create(
        configurationId
          ? { customer: customerId, return_url: returnUrl, configuration: configurationId }
          : { customer: customerId, return_url: returnUrl }
      )
    let session: any
    try {
      session = await createSession(cache.__stripeBillingPortalConfigurationId || '')
    } catch (err: unknown) {
      // Only a missing (or since-deleted) configuration is worth a retry.
      if (!/configuration/i.test(String((err as Error) && (err as Error).message))) {
        throw err
      }
      cache.__stripeBillingPortalConfigurationId = await ensureStripePortalConfiguration(stripe)
      session = await createSession(cache.__stripeBillingPortalConfigurationId)
    }
    if (!session || !session.url) {
      return failure('Stripe did not return a billing portal link.')
    }
    return { ok: 'true', url: String(session.url) }
  } catch (err: unknown) {
    return failure((err as Error).message)
  }
}

async function openPaypalAutomaticPayments() {
  const clientId = resolveProviderSecret(
    ['PAYPAL_CLIENT_ID', 'CONFIGURATION_PAYPAL_CLIENT_ID'],
    'CONFIGURATION_PAYPAL_CLIENT_ID'
  )
  const clientSecret = resolveProviderSecret(
    ['PAYPAL_CLIENT_SECRET', 'CONFIGURATION_PAYPAL_CLIENT_SECRET'],
    'CONFIGURATION_PAYPAL_CLIENT_SECRET'
  )
  if (!clientId || !clientSecret) {
    return { ok: 'false', url: '', error: 'PayPal credentials are not configured' }
  }
  // The buyer's page lives on the environment the store's credentials belong
  // to: a sandbox buyer has no account on www.paypal.com.
  const auth = await paypalAuthenticate(clientId, clientSecret)
  if ('error' in auth) {
    return { ok: 'false', url: '', error: auth.error }
  }
  const site =
    auth.baseUrl.indexOf('sandbox') !== -1
      ? 'https://www.sandbox.paypal.com'
      : 'https://www.paypal.com'
  return { ok: 'true', url: site + '/myaccount/autopay/' }
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

export const paymentBillingPortal: NodeHandlerGenerator = {
  nodeType: 'payment-billing-portal',
  executionEnv: 'server',
  dependencies: {
    stripe: '^14.0.0',
  },
  generateHandler(): string {
    return (
      handlerToString(payment_billing_portal) +
      '\n' +
      resolveProviderSecret.toString() +
      '\n' +
      ensureStripePortalConfiguration.toString() +
      '\n' +
      openStripeBillingPortal.toString() +
      '\n' +
      openPaypalAutomaticPayments.toString() +
      '\n' +
      paypalAuthenticate.toString()
    )
  },
}
