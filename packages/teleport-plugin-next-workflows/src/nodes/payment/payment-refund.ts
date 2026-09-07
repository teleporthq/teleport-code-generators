import { NodeHandlerGenerator, handlerToString } from '../types'

// Contract for the `amount` config field:
//   A floating-point number in the MAJOR currency unit (e.g. 99.99 USD,
//   9999 JPY) — identical to `payment-charge-user`. Omit it (or send 0) to
//   refund everything still outstanding on the charge; each provider resolves
//   that itself, which is the only reading that stays correct when a partial
//   refund has already been taken.

// Resolves a secret / provider credential from `process.env` with a fallback
// chain. Duplicated from `payment-charge-user.ts` deliberately: each node's
// handler is serialized on its own via `.toString()` and dropped into a
// generated segment file, so a shared import would not travel with it.
// See that file for the full reasoning on `globalThis.process`.
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

async function payment_refund(config: any, _context: Record<string, unknown>) {
  const providerType = String(
    config.providerType || config.provider || config.providerId || 'stripe'
  ).toLowerCase()
  const paymentReference = String(config.paymentReference || config.paymentIntentId || '').trim()
  const currency = String(config.currency || 'usd')
  const reason = config.reason ? String(config.reason) : ''
  // A key the caller controls, so a retried segment cannot refund twice. When
  // the workflow did not supply one we still send something stable — the
  // reference plus the amount — rather than a random value, because a random
  // key turns the provider's replay protection off exactly when it is needed.
  const requestedAmount = Number(config.amount)
  const amount = isFinite(requestedAmount) && requestedAmount > 0 ? requestedAmount : 0
  const idempotencyKey = String(
    config.idempotencyKey || 'refund:' + paymentReference + ':' + String(amount)
  )

  if (!paymentReference) {
    return {
      success: false,
      refundId: '',
      amount: 0,
      currency,
      status: '',
      error: 'No payment reference was supplied, so there is no charge to refund.',
    }
  }

  let result
  if (providerType === 'paypal') {
    result = await refundWithPaypal(paymentReference, amount, currency, reason, idempotencyKey)
  } else {
    result = await refundWithStripe(paymentReference, amount, currency, reason, idempotencyKey)
  }

  // A declined refund is an ANSWER, not a crash: the workflow branches on
  // `success` and tells the merchant what the provider said. Throwing here
  // would take down the whole segment — including the bookkeeping steps that
  // still have to record what happened.
  return result
}

// Converts a major-unit amount into the provider's smallest-unit integer.
//
// The currency lists are declared INSIDE the function, not at module scope: the
// handler is assembled by concatenating `.toString()` of several functions, and
// a minifier that renames a top-level const would separate the declaration from
// this reference. See `payment-charge-user.ts` for the full account of that bug.
function toProviderMinorUnits(major: any, currency: string): number {
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

function fromProviderMinorUnits(minor: any, currency: string): number {
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
  const threeDecimalCurrencies = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']
  const amt = Number(minor)
  if (!isFinite(amt)) {
    return 0
  }
  const upper = String(currency || '').toUpperCase()
  if (zeroDecimalCurrencies.indexOf(upper) >= 0) {
    return amt
  }
  if (threeDecimalCurrencies.indexOf(upper) >= 0) {
    return amt / 1000
  }
  return amt / 100
}

async function refundWithStripe(
  paymentReference: string,
  amount: number,
  currency: string,
  reason: string,
  idempotencyKey: string
) {
  const secretKey = resolveProviderSecret(
    ['STRIPE_SECRET_KEY', 'CONFIGURATION_STRIPE_SECRET_KEY', 'STRIPE_TEST_KEY'],
    'CONFIGURATION_STRIPE_SECRET_KEY'
  )
  if (!secretKey) {
    return {
      success: false,
      refundId: '',
      amount: 0,
      currency,
      status: '',
      error: 'STRIPE_SECRET_KEY is not configured',
    }
  }

  try {
    const nodeRequire =
      typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
    const Stripe = nodeRequire('stripe')
    const stripe = new Stripe(secretKey)

    // The order row stores whatever the payment webhook happened to see: a
    // PaymentIntent on most orders, a Checkout Session when the intent was
    // absent, a Charge on older rows. `refunds.create` takes an intent or a
    // charge, so a session has to be exchanged for its intent first —
    // refunding "the id we stored" without this step fails on exactly the
    // orders a merchant is most likely to be refunding.
    const params: any = {}
    if (paymentReference.indexOf('ch_') === 0 || paymentReference.indexOf('py_') === 0) {
      params.charge = paymentReference
    } else if (paymentReference.indexOf('cs_') === 0) {
      const session = await stripe.checkout.sessions.retrieve(paymentReference)
      const intentId =
        session && session.payment_intent
          ? typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent.id
          : ''
      if (!intentId) {
        return {
          success: false,
          refundId: '',
          amount: 0,
          currency,
          status: '',
          error: 'The Stripe checkout session for this order has no payment to refund.',
        }
      }
      params.payment_intent = intentId
    } else {
      params.payment_intent = paymentReference
    }

    const minor = toProviderMinorUnits(amount, currency)
    if (minor > 0) {
      params.amount = minor
    }
    // Stripe accepts only three reasons and rejects the whole call for anything
    // else, so a merchant's free text is kept in our own record and left out of
    // the API call rather than failing the refund.
    const normalizedReason = String(reason || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
    if (
      normalizedReason === 'duplicate' ||
      normalizedReason === 'fraudulent' ||
      normalizedReason === 'requested_by_customer'
    ) {
      params.reason = normalizedReason
    }

    const refund = await stripe.refunds.create(params, { idempotencyKey })
    return {
      success: true,
      refundId: refund.id || '',
      amount: fromProviderMinorUnits(refund.amount, currency),
      currency: String(refund.currency || currency).toUpperCase(),
      status: refund.status || '',
      error: '',
    }
  } catch (err: unknown) {
    return {
      success: false,
      refundId: '',
      amount: 0,
      currency,
      status: '',
      error: (err as Error).message,
    }
  }
}

// Authenticates with PayPal and discovers which environment the credentials
// belong to, mirroring `payment-charge-user.ts` — including the module-scope
// cache, which is safe here because a generated app serves exactly one
// merchant.
async function paypalAuthenticateForRefund(
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
      'PayPal authentication failed: credentials are not valid for either sandbox or live. Verify CONFIGURATION_PAYPAL_CLIENT_ID and CONFIGURATION_PAYPAL_CLIENT_SECRET in .env match a single PayPal app.',
  }
}

async function refundWithPaypal(
  paymentReference: string,
  amount: number,
  currency: string,
  reason: string,
  idempotencyKey: string
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
    return {
      success: false,
      refundId: '',
      amount: 0,
      currency,
      status: '',
      error: 'PayPal credentials are not configured',
    }
  }

  const auth = await paypalAuthenticateForRefund(clientId, clientSecret)
  if ('error' in auth) {
    return {
      success: false,
      refundId: '',
      amount: 0,
      currency,
      status: '',
      error: auth.error,
    }
  }

  try {
    // PayPal refunds a CAPTURE, never an order, and the webhook may have stored
    // either. Try the reference as a capture first (the common case and one
    // round trip cheaper), then resolve the order's completed capture.
    let captureId = ''
    const asCapture = await fetch(
      auth.baseUrl + '/v2/payments/captures/' + encodeURIComponent(paymentReference),
      { headers: { Authorization: 'Bearer ' + auth.accessToken } }
    )
    if (asCapture.ok) {
      captureId = paymentReference
    } else {
      const asOrder = await fetch(
        auth.baseUrl + '/v2/checkout/orders/' + encodeURIComponent(paymentReference),
        { headers: { Authorization: 'Bearer ' + auth.accessToken } }
      )
      if (!asOrder.ok) {
        return {
          success: false,
          refundId: '',
          amount: 0,
          currency,
          status: '',
          error: 'PayPal does not recognise this order payment reference.',
        }
      }
      const orderData: any = await asOrder.json()
      const units = (orderData && orderData.purchase_units) || []
      const captures = units.length > 0 && units[0].payments ? units[0].payments.captures || [] : []
      for (let i = 0; i < captures.length; i++) {
        if (captures[i] && captures[i].status === 'COMPLETED') {
          captureId = captures[i].id
          break
        }
      }
      if (!captureId && captures.length > 0) {
        captureId = captures[0].id
      }
      if (!captureId) {
        return {
          success: false,
          refundId: '',
          amount: 0,
          currency,
          status: '',
          error: 'This PayPal order was never captured, so there is nothing to refund.',
        }
      }
    }

    const body: any = {}
    if (amount > 0) {
      const paypalZeroDecimal = ['HUF', 'JPY', 'TWD']
      const upper = String(currency || '').toUpperCase()
      body.amount = {
        value:
          paypalZeroDecimal.indexOf(upper) >= 0 ? String(Math.round(amount)) : amount.toFixed(2),
        currency_code: upper,
      }
    }
    const note = String(reason || '').trim()
    if (note) {
      // PayPal rejects the whole call when this is over 255 characters, so the
      // merchant's text is truncated rather than losing the refund.
      body.note_to_payer = note.slice(0, 255)
    }

    const response = await fetch(
      auth.baseUrl + '/v2/payments/captures/' + encodeURIComponent(captureId) + '/refund',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + auth.accessToken,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': idempotencyKey,
        },
        body: JSON.stringify(body),
      }
    )
    const data: any = await response.json()

    if (!response.ok) {
      const detail = data && data.details && data.details[0] ? data.details[0] : null
      return {
        success: false,
        refundId: '',
        amount: 0,
        currency,
        status: '',
        error:
          (detail && (detail.description || detail.issue)) ||
          (data && data.message) ||
          'PayPal refund failed (HTTP ' + response.status + ')',
      }
    }

    const refundedValue = data && data.amount ? Number(data.amount.value) : NaN
    return {
      success: true,
      refundId: (data && data.id) || '',
      amount: isFinite(refundedValue) ? refundedValue : amount,
      currency: String(
        (data && data.amount && data.amount.currency_code) || currency
      ).toUpperCase(),
      status: (data && data.status) || '',
      error: '',
    }
  } catch (err: unknown) {
    return {
      success: false,
      refundId: '',
      amount: 0,
      currency,
      status: '',
      error: (err as Error).message,
    }
  }
}

export const paymentRefund: NodeHandlerGenerator = {
  nodeType: 'payment-refund',
  executionEnv: 'server',
  // NOT terminal, unlike `payment-charge-user`: a charge ends the request by
  // redirecting the buyer to a hosted page, while a refund returns to the
  // workflow so the steps that record it, restock it and email the buyer can
  // run. Marking it terminal would silently drop every one of those.
  isTerminal: false,
  dependencies: {
    stripe: '^14.0.0',
  },
  generateHandler(): string {
    // Entry FIRST: `resolveHandlerEntryName` picks the first statement-level
    // 2-parameter function declaration in the concatenated source, and every
    // helper below takes a different arity or comes after it.
    return (
      handlerToString(payment_refund) +
      '\n' +
      resolveProviderSecret.toString() +
      '\n' +
      toProviderMinorUnits.toString() +
      '\n' +
      fromProviderMinorUnits.toString() +
      '\n' +
      refundWithStripe.toString() +
      '\n' +
      paypalAuthenticateForRefund.toString() +
      '\n' +
      refundWithPaypal.toString()
    )
  },
}
