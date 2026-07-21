import { NodeHandlerGenerator, handlerToString } from '../types'

// Contract for the `amount` config field:
//   A floating-point number in the MAJOR currency unit (e.g. 99.99 USD,
//   9999 JPY). Individual line items use the same `unitAmount` semantics.
// Both Stripe and PayPal handlers convert to the correct provider-specific
// representation internally — callers must NOT pre-convert to minor units.

// Resolves a secret / provider credential from `process.env` with a fallback
// chain. Some deploys populate the canonical names (`STRIPE_SECRET_KEY`,
// `PAYPAL_CLIENT_ID`, …) while others keep the value behind a
// `CONFIGURATION_*` prefix (sometimes numbered: `CONFIGURATION_PAYPAL_CLIENT_ID2`).
// Iterate the list in order, returning the first non-empty match. If no
// primary or numbered fallback is filled, scan every `process.env` key
// beginning with the prefix so new variants don't require a code change.
function resolveProviderSecret(candidates: string[], prefixScan?: string): string {
  // Access `process` via `globalThis` rather than as a bare identifier. When
  // the GUI generates this project it bundles the code generators through
  // webpack, and `fn.toString()` captures whatever webpack rewrote a bare
  // `process` into (e.g. `payment_charge_user_process`, which is undefined on
  // the Vercel Node runtime). `globalThis.process` is a member access webpack
  // leaves untouched, so the serialized handler stays valid on the server.
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

// Stripe and PayPal both reject relative paths for success_url / cancel_url
// with a terse "Not a valid URL" error. The workflow-level
// `Build Payment Redirect URLs And Metadata` script emits root-relative paths
// (e.g. `/order-details/ORD-42`) because at build time it has no way to know
// the live host. Absolutize them here using the request's base URL, which
// the api-route generator already stores on `context.__baseUrl`
// ("http://localhost:3001", "https://example.com", …). Leave fully-qualified
// URLs untouched so callers can override with an external URL when needed.
function toAbsoluteUrl(url: string, baseUrl: string): string {
  if (!url) {
    return url
  }
  const str = String(url)
  if (/^https?:\/\//i.test(str)) {
    return str
  }
  if (!baseUrl) {
    return str
  }
  const base = String(baseUrl).replace(/\/+$/, '')
  return str.startsWith('/') ? base + str : base + '/' + str
}

async function payment_charge_user(config: any, _context: Record<string, unknown>) {
  const providerType = config.providerType || config.provider || config.providerId || 'stripe'
  const amount = config.amount
  const currency = config.currency || 'usd'
  const baseUrl = String((_context && (_context.__baseUrl as string)) || '')
  const successUrl = toAbsoluteUrl(config.successUrl || '', baseUrl)
  const cancelUrl = toAbsoluteUrl(config.cancelUrl || '', baseUrl)
  const description = config.description || 'Payment'
  const lineItems = config.lineItems

  let parsedMetadata: Record<string, string> | undefined
  if (config.metadata) {
    try {
      parsedMetadata =
        typeof config.metadata === 'string' ? JSON.parse(config.metadata) : config.metadata
    } catch (_e) {
      parsedMetadata = undefined
    }
  }

  let result
  if (providerType === 'paypal') {
    result = await chargeWithPaypal(
      config,
      currency,
      amount,
      successUrl,
      cancelUrl,
      description,
      parsedMetadata
    )
  } else {
    // Everything that isn't PayPal charges through Stripe. Apple Pay / Google
    // Pay are surfaced automatically by Stripe's hosted checkout (Dynamic
    // Payment Methods) — they aren't separate providers here.
    result = await chargeWithStripe(
      config,
      currency,
      amount,
      successUrl,
      cancelUrl,
      description,
      lineItems,
      parsedMetadata
    )
  }

  // Provider-side errors (bad keys, invalid request, wrong currency, etc.)
  // are user-actionable configuration problems, not 500s. Surfacing them as
  // 400 with the provider's own message (`invalid_client`, etc.) lets the
  // checkout page render an actionable toast instead of a generic
  // "Workflow segment error" 500. The segment runtime forwards
  // `__earlyResponse.status` / `body` straight to the HTTP response.
  if (result && typeof result.error === 'string' && result.error) {
    return {
      __earlyResponse: {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { success: false, error: result.error, provider: providerType },
      },
    }
  }

  return result
}

// Converts a major-unit amount (e.g. 99.99 USD) into Stripe's expected
// smallest-unit integer. Zero-decimal currencies pass through rounded;
// three-decimal currencies multiply by 1000; everything else multiplies by
// 100. Always returns a safe non-negative integer.
//
// The currency lists are declared LOCAL to this function rather than as
// shared top-level consts. `generateHandler()` below assembles the final
// handler by calling `.toString()` on several functions independently and
// concatenating the source; a top-level const is fine in an unminified
// build, but when this package itself is bundled + minified by a consumer
// (e.g. teleport-gui's browser packer, built with webpack/Terser), the
// minifier is free to rename the top-level const's declaration — nothing
// in the bundle calls it by name, only this runtime `.toString()` read
// does, which is invisible to the minifier. `toStripeMinorUnits.toString()`
// would then embed a reference to a name (e.g. a mangled `Oo`) that is
// never declared anywhere in the generated workflow segment file, throwing
// "<mangled name> is not defined" the first time a Stripe charge runs.
// Declaring the lists inside the function keeps the declaration and every
// reference to it in the SAME `.toString()` snapshot, so a consistent
// rename by the minifier can never separate them. See `resolveProviderSecret`
// above for the same class of bug with the `process` global.
function toStripeMinorUnits(major: any, currency: string): number {
  const zeroDecimalCurrencies = [
    'BIF',
    'CLP',
    'DJF',
    'GNF',
    'JPY',
    'KMF',
    'KRW',
    'MGA',
    'PYG',
    'RWF',
    'UGX',
    'VND',
    'VUV',
    'XAF',
    'XOF',
    'XPF',
  ]
  // Currencies where the smallest unit is 1/1000 of the major unit. Stripe
  // expects amounts in the smallest unit (e.g. 1.500 JOD -> 1500).
  const threeDecimalCurrencies = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']
  const amt = Number(major)
  if (!isFinite(amt) || amt <= 0) {
    return 0
  }
  const upper = String(currency || '').toUpperCase()
  if (zeroDecimalCurrencies.indexOf(upper) >= 0) {
    return Math.round(amt)
  }
  if (threeDecimalCurrencies.indexOf(upper) >= 0) {
    return Math.round(amt * 1000)
  }
  return Math.round(amt * 100)
}

async function chargeWithStripe(
  _config: any,
  currency: string,
  amount: any,
  successUrl: string,
  cancelUrl: string,
  description: string,
  lineItems: any[] | undefined,
  metadata: Record<string, string> | undefined
) {
  const secretKey = resolveProviderSecret(
    ['STRIPE_SECRET_KEY', 'CONFIGURATION_STRIPE_SECRET_KEY', 'STRIPE_TEST_KEY'],
    'CONFIGURATION_STRIPE_SECRET_KEY'
  )
  if (!secretKey) {
    return { checkoutUrl: '', sessionId: '', error: 'STRIPE_SECRET_KEY is not configured' }
  }

  try {
    // Use webpack's `__non_webpack_require__` when present (the GUI bundles this
    // handler through webpack, which rewrites a bare `require` into the
    // browser-only `__webpack_require__`). Falls back to the real `require` in
    // the plain tsc/dist build. See webpack-runtime-globals.d.ts.
    const nodeRequire =
      typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
    const Stripe = nodeRequire('stripe')
    const stripe = new Stripe(secretKey)

    // `payment_method_types` is intentionally omitted so Stripe uses Dynamic
    // Payment Methods — the checkout surfaces every method the merchant enabled
    // in their Stripe Dashboard (card, Apple Pay, Google Pay, Link, …) based on
    // the shopper's device/eligibility. Pinning `['card']` would suppress that.
    // (Stripe Checkout Sessions don't accept `automatic_payment_methods`; the
    // documented way to opt into Dynamic Payment Methods is to omit the list.)
    const sessionParams: any = {
      mode: 'payment',
      success_url: successUrl || undefined,
      cancel_url: cancelUrl || undefined,
    }

    if (lineItems && Array.isArray(lineItems) && lineItems.length > 0) {
      sessionParams.line_items = lineItems.map(function (item: any) {
        return {
          price_data: {
            currency,
            product_data: { name: item.name || 'Item' },
            unit_amount: toStripeMinorUnits(item.unitAmount, currency),
          },
          quantity: Number(item.quantity) || 1,
        }
      })
    } else {
      sessionParams.line_items = [
        {
          price_data: {
            currency,
            product_data: { name: description },
            unit_amount: toStripeMinorUnits(amount, currency),
          },
          quantity: 1,
        },
      ]
    }

    if (metadata) {
      sessionParams.metadata = metadata
    }

    const session = await stripe.checkout.sessions.create(sessionParams)

    // __redirectUrl signals the client-side workflow runtime to
    // navigate the browser to Stripe's hosted checkout page.
    // Without it, payment-charge-user returns __terminal but the
    // user is left stuck on the originating page (e.g. /checkout)
    // with the loading button never resetting — Stripe's
    // payment.created webhook never fires because the buyer never
    // sees the payment form. See runtime.js for the redirect step.
    const checkoutUrl = session.url || ''
    return {
      checkoutUrl,
      sessionId: session.id || '',
      __terminal: true,
      __redirectUrl: checkoutUrl,
    }
  } catch (err: unknown) {
    return { checkoutUrl: '', sessionId: '', error: (err as Error).message }
  }
}

// Authenticates with PayPal and discovers which environment (sandbox/live)
// the credentials belong to in the same call. Both PayPal environments issue
// client IDs starting with `A...` so the prefix tells us nothing — but the
// OAuth token endpoint replies with `invalid_client` when the keys belong to
// the other environment, which we use as a precise signal to fail over.
//
// The detected base URL is cached at module scope (`__paypalBaseUrlCache`)
// so the next charge in the same server instance skips the failover round
// trip. Cache is invalidated automatically if a cached URL ever returns
// `invalid_client` — covers credential rotation between envs.
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
      // PayPal's documented error code for "credentials don't match this env".
      const isInvalidClient = data && data.error === 'invalid_client'
      return {
        invalidClient: isInvalidClient,
        errorMessage: (data && (data.error_description || data.error)) || 'HTTP ' + res.status,
      }
    } catch (e: unknown) {
      return { errorMessage: 'network error: ' + (e as Error).message }
    }
  }

  // Cache hit — try it first. If credentials rotated to the other env the
  // cached URL replies invalid_client and we re-detect.
  const cached = (globalThis as any).__paypalBaseUrlCache as string | undefined
  if (cached === SANDBOX || cached === LIVE) {
    const r = await tryAuth(cached)
    if (r.accessToken) {
      return { baseUrl: cached, accessToken: r.accessToken }
    }
    if (!r.invalidClient) {
      return { error: 'PayPal authentication failed: ' + r.errorMessage }
      // invalid_client on cached env → bust cache, fall through to detection.
    }
    ;(globalThis as any).__paypalBaseUrlCache = undefined
  }

  // Detection: sandbox first (safer default — most dev setups). On
  // invalid_client try live. Anything else (network/server error) is real
  // and worth surfacing immediately so it doesn't get masked by a successful
  // live call against keys that belong to a different sandbox account.
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

  // Both environments rejected the credentials.
  return {
    error:
      'PayPal authentication failed: credentials are not valid for either sandbox or live (' +
      (liveResult.errorMessage || 'invalid_client') +
      '). Verify CONFIGURATION_PAYPAL_CLIENT_ID and CONFIGURATION_PAYPAL_CLIENT_SECRET in .env match a single PayPal app.',
  }
}

async function chargeWithPaypal(
  _config: any,
  currency: string,
  amount: any,
  successUrl: string,
  cancelUrl: string,
  description: string,
  metadata: Record<string, string> | undefined
) {
  const clientId = resolveProviderSecret(
    ['PAYPAL_CLIENT_ID', 'CONFIGURATION_PAYPAL_CLIENT_ID'],
    'CONFIGURATION_PAYPAL_CLIENT_ID'
  )
  const clientSecret = resolveProviderSecret(
    ['PAYPAL_CLIENT_SECRET', 'CONFIGURATION_PAYPAL_CLIENT_SECRET'],
    'CONFIGURATION_PAYPAL_CLIENT_SECRET'
  )

  if (!clientId || !clientSecret) {
    return { checkoutUrl: '', sessionId: '', error: 'PayPal credentials are not configured' }
  }

  // Common .env mistake: copy-pasted CLIENT_ID into both fields. Catch it
  // before round-tripping to PayPal so the user sees an actionable message
  // instead of a generic "Failed to authenticate" 401.
  if (clientId === clientSecret) {
    return {
      checkoutUrl: '',
      sessionId: '',
      error:
        'PayPal credentials are misconfigured: CLIENT_ID and CLIENT_SECRET are identical. Update CONFIGURATION_PAYPAL_CLIENT_SECRET in .env.',
    }
  }

  try {
    const auth = await paypalAuthenticate(clientId, clientSecret)
    if ('error' in auth) {
      return { checkoutUrl: '', sessionId: '', error: auth.error }
    }
    const { baseUrl, accessToken } = auth

    // PayPal expects amounts in the MAJOR currency unit as a string:
    //   - Non-zero-decimal currencies: two decimals ("99.99")
    //   - Zero-decimal currencies (HUF/JPY/TWD): whole-number string ("9999")
    // The `amount` input is already in major units per the handler contract.
    const PAYPAL_ZERO_DECIMAL = ['HUF', 'JPY', 'TWD']
    function fmtPaypalMajor(majorAmount: number, cur: string): string {
      const amt = Number(majorAmount)
      const safe = isFinite(amt) && amt > 0 ? amt : 0
      if (PAYPAL_ZERO_DECIMAL.indexOf(String(cur || '').toUpperCase()) >= 0) {
        return String(Math.round(safe))
      }
      return safe.toFixed(2)
    }

    const orderPayload: any = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: currency.toUpperCase(),
            value: fmtPaypalMajor(Number(amount), currency),
          },
          description: description || undefined,
        },
      ],
      application_context: {
        return_url: successUrl || undefined,
        cancel_url: cancelUrl || undefined,
      },
    }

    if (metadata) {
      orderPayload.purchase_units[0].custom_id = JSON.stringify(metadata)
    }

    const orderResponse = await fetch(baseUrl + '/v2/checkout/orders', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderPayload),
    })
    const orderData = await orderResponse.json()

    if (!orderResponse.ok) {
      return {
        checkoutUrl: '',
        sessionId: '',
        error:
          orderData.message ||
          (orderData.details && orderData.details[0] && orderData.details[0].description) ||
          'Order creation failed',
      }
    }

    const approveLink =
      orderData.links &&
      orderData.links.find(function (l: any) {
        return l.rel === 'approve'
      })
    const approveUrl = approveLink ? approveLink.href : ''
    return {
      checkoutUrl: approveUrl,
      sessionId: orderData.id || '',
      __terminal: true,
      // Mirror the Stripe path — the client runtime needs the
      // approval URL to send the buyer to PayPal's hosted page.
      __redirectUrl: approveUrl,
    }
  } catch (err: unknown) {
    return { checkoutUrl: '', sessionId: '', error: (err as Error).message }
  }
}

export const paymentChargeUser: NodeHandlerGenerator = {
  nodeType: 'payment-charge-user',
  executionEnv: 'server',
  isTerminal: true,
  dependencies: {
    stripe: '^14.0.0',
  },
  generateHandler(): string {
    return (
      handlerToString(payment_charge_user) +
      '\n' +
      resolveProviderSecret.toString() +
      '\n' +
      toAbsoluteUrl.toString() +
      '\n' +
      toStripeMinorUnits.toString() +
      '\n' +
      chargeWithStripe.toString() +
      '\n' +
      paypalAuthenticate.toString() +
      '\n' +
      chargeWithPaypal.toString()
    )
  },
}
