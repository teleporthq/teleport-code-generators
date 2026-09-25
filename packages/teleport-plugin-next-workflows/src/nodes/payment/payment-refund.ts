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
  // Attached to the provider's refund as metadata so the store's webhook can
  // match the refund event back to its order; never decides WHAT is refunded.
  const orderId = config.orderId ? String(config.orderId).trim() : ''
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
    result = await refundWithPaypal(
      paymentReference,
      amount,
      currency,
      reason,
      idempotencyKey,
      orderId
    )
  } else {
    result = await refundWithStripe(
      paymentReference,
      amount,
      currency,
      reason,
      idempotencyKey,
      orderId
    )
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

// The payment behind a subscription invoice. Where Stripe puts it depends on
// the API version the merchant's key was created under: `payment_intent` on
// the classic shape, `payments.data[0].payment.payment_intent` from the 2025
// versions on, and only `charge` on the oldest rows. Each may be an id or the
// expanded object.
function stripeInvoicePaymentTarget(
  invoice: any
): { paymentIntent?: string; charge?: string } | null {
  function idOf(value: any): string {
    if (typeof value === 'string') {
      return value
    }
    return value && value.id ? String(value.id) : ''
  }
  if (!invoice) {
    return null
  }
  const classic = idOf(invoice.payment_intent)
  if (classic) {
    return { paymentIntent: classic }
  }
  const payments = invoice.payments && invoice.payments.data ? invoice.payments.data : []
  const latest =
    payments.length > 0 && payments[0].payment ? idOf(payments[0].payment.payment_intent) : ''
  if (latest) {
    return { paymentIntent: latest }
  }
  const charge = idOf(invoice.charge)
  if (charge) {
    return { charge }
  }
  return null
}

// A refund the provider created but reports as not going through. The reason
// is Stripe's snake_case vocabulary (`insufficient_funds`), readable enough
// once the underscores go.
function describeRefundFailure(provider: string, status: string, reason: any): string {
  const detail = reason ? ': ' + String(reason).replace(/_/g, ' ') : ''
  return provider + ' reported the refund as ' + status + detail + '.'
}

async function refundWithStripe(
  paymentReference: string,
  amount: number,
  currency: string,
  reason: string,
  idempotencyKey: string,
  orderId: string
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
    } else if (paymentReference.indexOf('in_') === 0) {
      // A subscription order stores the INVOICE Stripe settled, which is
      // refunded through the payment behind it.
      const invoice = await stripe.invoices.retrieve(paymentReference)
      const invoiceTarget = stripeInvoicePaymentTarget(invoice)
      if (!invoiceTarget) {
        return {
          success: false,
          refundId: '',
          amount: 0,
          currency,
          status: '',
          error: 'This Stripe invoice has no payment to refund.',
        }
      }
      if (invoiceTarget.charge) {
        params.charge = invoiceTarget.charge
      } else {
        params.payment_intent = invoiceTarget.paymentIntent
      }
    } else if (paymentReference.indexOf('sub_') === 0) {
      // The two ids a subscription row can also hold, neither of which Stripe
      // can refund: a refund needs the money movement, which the subscription
      // itself is not, and a refund id IS the movement back.
      return {
        success: false,
        refundId: '',
        amount: 0,
        currency,
        status: '',
        error: "A subscription id cannot be refunded; refund the order's invoice instead.",
      }
    } else if (paymentReference.indexOf('re_') === 0) {
      return {
        success: false,
        refundId: '',
        amount: 0,
        currency,
        status: '',
        error: 'This payment reference is already a refund id, so there is nothing to refund.',
      }
    } else {
      params.payment_intent = paymentReference
    }

    const minor = toProviderMinorUnits(amount, currency)
    if (amount > 0 && minor <= 0) {
      // Stripe reads a missing amount as "refund everything", so an amount too
      // small to express in this currency is refused rather than rounded away.
      return {
        success: false,
        refundId: '',
        amount: 0,
        currency,
        status: '',
        error:
          'The amount is smaller than the smallest unit of ' +
          String(currency || '').toUpperCase() +
          '.',
      }
    }
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
    if (orderId) {
      params.metadata = { orderId }
    }

    const refund = await stripe.refunds.create(params, { idempotencyKey })
    // The provider's OWN currency for the refund, not the request's: a
    // mismatch would be reported as a wrong number in the wrong currency.
    const refundCurrency = String(refund.currency || currency).toUpperCase()
    const refundStatus = String(refund.status || '')
    if (refundStatus === 'failed' || refundStatus === 'canceled') {
      return {
        success: false,
        refundId: refund.id || '',
        amount: 0,
        currency: refundCurrency,
        status: refundStatus,
        error: describeRefundFailure('Stripe', refundStatus, refund.failure_reason),
      }
    }
    return {
      success: true,
      refundId: refund.id || '',
      amount: fromProviderMinorUnits(refund.amount, refundCurrency),
      currency: refundCurrency,
      status: refundStatus,
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

// PayPal answers a gateway failure with an HTML page, which must not become
// the error text.
async function readPaypalJson(response: any): Promise<any> {
  try {
    return await response.json()
  } catch (e: unknown) {
    return null
  }
}

// The provider's own message for a failed call, which is the actionable half.
function paypalErrorMessage(data: any, fallback: string): string {
  const detail = data && data.details && data.details[0] ? data.details[0] : null
  return (detail && (detail.description || detail.issue)) || (data && data.message) || fallback
}

// One lookup of the reference under a given PayPal resource type. Only "no
// such resource" lets the caller try the next type: an expired token or a
// PayPal outage reported as an unrecognised reference would send the merchant
// hunting for a data problem that does not exist.
async function probePaypal(
  baseUrl: string,
  accessToken: string,
  path: string,
  step: string
): Promise<{ found: boolean; data: any; error: string }> {
  const response = await fetch(baseUrl + path, {
    headers: { Authorization: 'Bearer ' + accessToken },
  })
  const data = await readPaypalJson(response)
  if (response.ok) {
    return { found: true, data, error: '' }
  }
  if (response.status === 404 || (data && data.name === 'RESOURCE_NOT_FOUND')) {
    return { found: false, data: null, error: '' }
  }
  return {
    found: false,
    data: null,
    error:
      'PayPal could not look up the payment reference as ' +
      step +
      ': ' +
      paypalErrorMessage(data, 'HTTP ' + response.status),
  }
}

// PayPal refunds a money movement, never an order, and the order row stores
// whichever id its webhook reported. A one-off checkout settles as a v2
// CAPTURE (or an order id, exchanged for its completed capture). A
// subscription payment — the first order and every renewal — is a v1 SALE,
// which none of the v2 endpoints recognise.
async function resolvePaypalRefundTarget(
  baseUrl: string,
  accessToken: string,
  paymentReference: string
): Promise<{ captureId: string; saleId: string; error: string }> {
  const encoded = encodeURIComponent(paymentReference)

  // The common case, and one round trip cheaper.
  const capture = await probePaypal(
    baseUrl,
    accessToken,
    '/v2/payments/captures/' + encoded,
    'a capture'
  )
  if (capture.error) {
    return { captureId: '', saleId: '', error: capture.error }
  }
  if (capture.found) {
    return { captureId: paymentReference, saleId: '', error: '' }
  }

  const sale = await probePaypal(baseUrl, accessToken, '/v1/payments/sale/' + encoded, 'a sale')
  if (sale.error) {
    return { captureId: '', saleId: '', error: sale.error }
  }
  if (sale.found) {
    return { captureId: '', saleId: paymentReference, error: '' }
  }

  const order = await probePaypal(
    baseUrl,
    accessToken,
    '/v2/checkout/orders/' + encoded,
    'an order'
  )
  if (order.error) {
    return { captureId: '', saleId: '', error: order.error }
  }
  if (!order.found) {
    return {
      captureId: '',
      saleId: '',
      error: 'PayPal does not recognise this order payment reference.',
    }
  }
  const units = (order.data && order.data.purchase_units) || []
  const captures = units.length > 0 && units[0].payments ? units[0].payments.captures || [] : []
  let captureId = ''
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
      captureId: '',
      saleId: '',
      error: 'This PayPal order was never captured, so there is nothing to refund.',
    }
  }
  return { captureId, saleId: '', error: '' }
}

async function refundWithPaypal(
  paymentReference: string,
  amount: number,
  currency: string,
  reason: string,
  idempotencyKey: string,
  orderId: string
) {
  // PayPal wants the ISO code upper-case in every request and answers in kind.
  const currencyCode = String(currency || '').toUpperCase()
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
      currency: currencyCode,
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
      currency: currencyCode,
      status: '',
      error: auth.error,
    }
  }

  try {
    const target = await resolvePaypalRefundTarget(auth.baseUrl, auth.accessToken, paymentReference)
    if (target.error) {
      return {
        success: false,
        refundId: '',
        amount: 0,
        currency: currencyCode,
        status: '',
        error: target.error,
      }
    }

    // A sale is refunded through the v1 API, whose request and response use
    // different field names for the same things (`total`/`currency` and
    // `state` against v2's `value`/`currency_code` and `status`).
    const isSale = target.saleId !== ''
    const resourceId = isSale ? target.saleId : target.captureId
    const body: any = {}
    if (amount > 0) {
      const paypalZeroDecimal = ['HUF', 'JPY', 'TWD']
      const value =
        paypalZeroDecimal.indexOf(currencyCode) >= 0
          ? String(Math.round(amount))
          : amount.toFixed(2)
      if (Number(value) <= 0) {
        // Omitting the amount is a FULL refund, so an amount too small to
        // express in this currency is refused rather than rounded away.
        return {
          success: false,
          refundId: '',
          amount: 0,
          currency: currencyCode,
          status: '',
          error: 'The amount is smaller than the smallest unit of ' + currencyCode + '.',
        }
      }
      body.amount = isSale
        ? { total: value, currency: currencyCode }
        : { value, currency_code: currencyCode }
    }
    const note = String(reason || '').trim()
    if (note) {
      // PayPal rejects the whole call when this is over 255 characters, so the
      // merchant's text is truncated rather than losing the refund.
      body[isSale ? 'description' : 'note_to_payer'] = note.slice(0, 255)
    }
    if (!isSale && orderId) {
      // Read back by the store's webhook to match the refund event to its
      // order. PayPal caps the field at 127 characters and a cut-off JSON
      // document parses as nothing, so an id that does not fit is left off
      // rather than sent broken. The v1 refund has no equivalent field —
      // `invoice_number` must be unique per refund and PayPal rejects a repeat.
      const customId = JSON.stringify({ orderId })
      if (customId.length <= 127) {
        body.custom_id = customId
      }
    }

    const response = await fetch(
      auth.baseUrl +
        (isSale ? '/v1/payments/sale/' : '/v2/payments/captures/') +
        encodeURIComponent(resourceId) +
        '/refund',
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
    const data: any = await readPaypalJson(response)

    if (!response.ok) {
      return {
        success: false,
        refundId: '',
        amount: 0,
        currency: currencyCode,
        status: '',
        error: paypalErrorMessage(data, 'PayPal refund failed (HTTP ' + response.status + ')'),
      }
    }

    const refundStatus = String((data && (data.status || data.state)) || '')
    const refundedAmount = data && data.amount ? data.amount : null
    const refundedValue = refundedAmount
      ? Number(refundedAmount.value !== undefined ? refundedAmount.value : refundedAmount.total)
      : NaN
    const refundedCurrency = String(
      (refundedAmount && (refundedAmount.currency_code || refundedAmount.currency)) || currencyCode
    ).toUpperCase()
    const upperStatus = refundStatus.toUpperCase()
    if (upperStatus === 'FAILED' || upperStatus === 'CANCELLED' || upperStatus === 'CANCELED') {
      return {
        success: false,
        refundId: (data && data.id) || '',
        amount: 0,
        currency: refundedCurrency,
        status: refundStatus,
        error: describeRefundFailure('PayPal', refundStatus, ''),
      }
    }
    return {
      success: true,
      refundId: (data && data.id) || '',
      amount: isFinite(refundedValue) ? refundedValue : amount,
      currency: refundedCurrency,
      status: refundStatus,
      error: '',
    }
  } catch (err: unknown) {
    return {
      success: false,
      refundId: '',
      amount: 0,
      currency: currencyCode,
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
      stripeInvoicePaymentTarget.toString() +
      '\n' +
      describeRefundFailure.toString() +
      '\n' +
      refundWithStripe.toString() +
      '\n' +
      paypalAuthenticateForRefund.toString() +
      '\n' +
      readPaypalJson.toString() +
      '\n' +
      paypalErrorMessage.toString() +
      '\n' +
      probePaypal.toString() +
      '\n' +
      resolvePaypalRefundTarget.toString() +
      '\n' +
      refundWithPaypal.toString()
    )
  },
}
