import { NodeHandlerGenerator, handlerToString } from '../types'

// Contract for the `amount` config field:
//   A floating-point number in the MAJOR currency unit (e.g. 99.99 USD,
//   9999 JPY). Individual line items use the same `unitAmount` semantics.
// Each provider's driver converts to its own representation — callers must
// NOT pre-convert to minor units.
//
// The provider work itself lives in the store's payment drivers
// (`utils/payments/drivers/<id>.js`, see `src/payments`), reached through the
// `__paymentDrivers` binding every route running this node declares. The
// handler owns what every provider shares: the redirect URLs, the metadata,
// the answer shape and the refusal of a provider the store has no driver for.

// An order may already have a checkout open with the provider (the buyer
// left it, then came back through "Continue payment"). With
// \`previousAttempt\` — the reference the store recorded for that checkout —
// the node asks the provider about it before opening another: one the buyer
// can still pay is reopened instead (\`attemptOutcome: 'reused'\`), one already
// paid or being paid opens nothing (\`'in-progress'\`, and the buyer is sent
// to where a finished payment lands), and only one that can take no more
// money gives way to a new checkout (\`'created'\`). Two open checkouts are
// how one order gets paid twice.
//
// An order that recorded no checkout names itself instead (\`lookupOrderId\`,
// \`lookupPlacedAt\`): the provider is searched for the pages its placing
// opened, and they are closed before another opens (see
// \`core.closeOrderCheckouts\`). One the provider cannot close is reopened and
// answered as \`'adopted'\`, to be recorded like a new one.
//
// \`deferRedirect\` answers with the page instead of sending the buyer there,
// so the steps after this node can record the checkout first; a navigation
// step then opens \`redirectUrl\`.
//
// \`reportRefusal\` answers a provider that refused to open the checkout as
// the node's result (\`refused: 'true'\`, the provider's own words in
// \`refusal\`) instead of ending the run with a 400, so the steps after it can
// give back what the order held and tell the buyer why. Every answer then
// names the provider and says whether it refused.

// Stripe, PayPal and every other provider reject relative paths for the
// return URLs. The place-order script emits root-relative paths (e.g.
// `/order-details/ORD-42`) because at build time it cannot know the live host,
// so they are absolutized against the request's base URL
// (`context.__baseUrl`). Fully-qualified URLs pass through untouched.
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

// The provider sends the buyer to these pages after paying, so they must stay
// on this store: a URL on another origin (or one that does not parse) becomes
// the store's home page. Without a base URL nothing can be compared, and the
// URL is left as it is.
function toStoreUrl(url: string, baseUrl: string): string {
  if (!url || !baseUrl) {
    return url
  }
  try {
    const origin = new URL(baseUrl).origin
    return new URL(url, origin + '/').origin === origin ? url : origin + '/'
  } catch (_e) {
    return String(baseUrl).replace(/\/+$/, '') + '/'
  }
}

async function payment_charge_user(config: any, _context: Record<string, unknown>) {
  // A workflow that names no provider has always meant Stripe.
  const providerType = String(
    config.providerType || config.provider || config.providerId || 'stripe'
  )
    .trim()
    .toLowerCase()
  const currency = config.currency || 'usd'
  // 'payment' (the default) opens a one-time checkout; 'subscription' opens
  // the provider's recurring checkout for ONE plan — `amount` is then what
  // every cycle bills, `recurringInterval` / `recurringIntervalCount` the
  // cycle, `trialDays` the free days before the first charge, and `planId`
  // the plan `payment-ensure-subscription-plan` returned.
  const mode =
    String(config.mode || 'payment').toLowerCase() === 'subscription' ? 'subscription' : 'payment'
  const baseUrl = String((_context && (_context.__baseUrl as string)) || '')
  // The buyer comes back from the provider's hosted page to the language they
  // checked out in: a site-relative return path gets the run's locale prefix
  // (the segment route reads it off the client context) before it is
  // absolutized. A page on another site is never a return page (see
  // `toStoreUrl`).
  const runLocale = _context && _context.__locale
  const successUrl = toStoreUrl(
    toAbsoluteUrl(__workflowUtils.localizeHref(config.successUrl || '', runLocale), baseUrl),
    baseUrl
  )
  const cancelUrl = toStoreUrl(
    toAbsoluteUrl(__workflowUtils.localizeHref(config.cancelUrl || '', runLocale), baseUrl),
    baseUrl
  )

  let metadata: Record<string, string> | undefined
  if (config.metadata) {
    try {
      metadata = typeof config.metadata === 'string' ? JSON.parse(config.metadata) : config.metadata
    } catch (_e) {
      metadata = undefined
    }
  }

  const driver =
    typeof __paymentDrivers !== 'undefined' && __paymentDrivers
      ? __paymentDrivers.get(providerType)
      : null
  const previousAttempt = String(config.previousAttempt || '').trim()
  const lookupOrderId = String(config.lookupOrderId || '').trim()
  const deferRedirect = config.deferRedirect === true || config.deferRedirect === 'true'
  const reportRefusal = config.reportRefusal === true || config.reportRefusal === 'true'
  let attemptOutcome = 'created'
  let adoptedAttempt = ''
  let result: any
  if (
    driver &&
    !previousAttempt &&
    lookupOrderId &&
    __paymentDrivers.core &&
    typeof __paymentDrivers.core.closeOrderCheckouts === 'function'
  ) {
    // An order that recorded no checkout (placed before the store recorded
    // them, or one whose record failed): the pages the provider finds for it
    // are closed first. One that took the money, or is taking it, opens
    // nothing; one the provider cannot close is reopened and recorded
    // ('adopted'); one that cannot even be found (PayPal is not searchable)
    // is waited out.
    let earlier: any
    try {
      earlier = await __paymentDrivers.core.closeOrderCheckouts(driver, {
        orderId: lookupOrderId,
        placedAt: String(config.lookupPlacedAt || '').trim(),
      })
    } catch (err: unknown) {
      earlier = { outcome: '', error: (err as Error).message }
    }
    const found = String((earlier && earlier.outcome) || '')
    if (!found) {
      result = {
        checkoutUrl: '',
        sessionId: '',
        error: String((earlier && earlier.error) || 'The earlier payment could not be checked.'),
      }
    } else if (found === 'paid' || found === 'confirming') {
      attemptOutcome = 'in-progress'
      result = { checkoutUrl: '', sessionId: '' }
    } else if (found === 'open' && earlier.checkoutUrl && earlier.reference) {
      attemptOutcome = 'adopted'
      adoptedAttempt = String(earlier.reference)
      result = { checkoutUrl: String(earlier.checkoutUrl), sessionId: adoptedAttempt }
    } else if (found === 'open') {
      const until = new Date(String(earlier.openUntil || ''))
      result = {
        checkoutUrl: '',
        sessionId: '',
        error:
          'The payment page this order opened earlier may still take a payment' +
          (isFinite(until.getTime())
            ? ' until ' + until.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
            : '') +
          '. Finish paying there, or try again after that.',
      }
    }
  }
  if (driver && previousAttempt && typeof driver.inspectCheckout === 'function') {
    let earlier: any
    try {
      earlier = await driver.inspectCheckout({ reference: previousAttempt })
    } catch (err: unknown) {
      earlier = { error: (err as Error).message }
    }
    const state = String((earlier && earlier.state) || '')
    if (earlier && typeof earlier.error === 'string' && earlier.error) {
      // Opening another checkout while the provider cannot say what became of
      // this one could take the money twice: the buyer tries again instead.
      result = { checkoutUrl: '', sessionId: '', error: earlier.error }
    } else if (state === 'open' && earlier.checkoutUrl) {
      attemptOutcome = 'reused'
      result = { checkoutUrl: String(earlier.checkoutUrl), sessionId: previousAttempt }
    } else if (state === 'paid' || state === 'confirming') {
      attemptOutcome = 'in-progress'
      result = { checkoutUrl: '', sessionId: previousAttempt }
    }
  }
  if (!result && !driver) {
    // A provider the store carries no driver for: refusing is the only honest
    // answer — charging through another provider would take the money with
    // keys the merchant never meant for this checkout.
    result = {
      checkoutUrl: '',
      sessionId: '',
      error: 'Payment provider "' + providerType + '" is not supported by this store.',
    }
  } else if (!result) {
    const input = {
      amount: config.amount,
      currency,
      description: config.description || 'Payment',
      lineItems: config.lineItems,
      successUrl,
      cancelUrl,
      metadata,
      customerEmail: config.customerEmail,
      baseUrl,
      recurringInterval: config.recurringInterval,
      recurringIntervalCount: config.recurringIntervalCount,
      trialDays: config.trialDays,
      amountDue: config.amountDue,
      planId: config.planId,
      previousAttempt,
    }
    try {
      result =
        mode === 'subscription'
          ? await driver.createSubscriptionCheckout(input)
          : await driver.createCheckout(input)
    } catch (err: unknown) {
      result = { checkoutUrl: '', sessionId: '', error: (err as Error).message }
    }
  }

  // Provider-side errors (bad keys, invalid request, wrong currency, etc.)
  // are user-actionable configuration problems, not 500s. Surfacing them as
  // 400 with the provider's own message lets the checkout page render an
  // actionable toast instead of a generic "Workflow segment error" 500. The
  // segment runtime forwards `__earlyResponse.status` / `body` straight to the
  // HTTP response.
  if (result && typeof result.error === 'string' && result.error) {
    if (reportRefusal) {
      // Never under \`error\`: the runtime ends a run on a node that answers one.
      return {
        refused: 'true',
        refusal: result.error,
        provider: providerType,
        checkoutUrl: '',
        sessionId: '',
        attemptRef: '',
        attemptOutcome: '',
        redirectUrl: '',
      }
    }
    return {
      __earlyResponse: {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { success: false, error: result.error, provider: providerType },
      },
    }
  }

  const checkoutUrl = String((result && result.checkoutUrl) || '')
  const sessionId = String((result && result.sessionId) || '')
  const answer: Record<string, unknown> = {
    checkoutUrl,
    sessionId,
    // What the store records for this checkout: the provider's reference, or
    // more where a driver needs it to reopen the page (Square: order and link).
    attemptRef:
      attemptOutcome === 'created'
        ? String((result && result.attemptRef) || sessionId)
        : adoptedAttempt || previousAttempt,
    attemptOutcome,
    redirectUrl: attemptOutcome === 'in-progress' ? successUrl : checkoutUrl,
  }
  if (reportRefusal) {
    answer.refused = 'false'
    answer.refusal = ''
    answer.provider = providerType
  }
  if (mode === 'subscription') {
    // Known at once for a provider that creates the subscription before the
    // buyer approves it (PayPal, Razorpay); '' where the webhook reports it.
    answer.providerSubscriptionId = String((result && result.providerSubscriptionId) || '')
  }
  if (deferRedirect) {
    return answer
  }
  // __redirectUrl signals the client-side workflow runtime to navigate the
  // browser to the provider's hosted page; without it the buyer is left on the
  // checkout page with the button spinning (see runtime.js).
  answer.__terminal = true
  answer.__redirectUrl = answer.redirectUrl
  return answer
}

export const paymentChargeUser: NodeHandlerGenerator = {
  nodeType: 'payment-charge-user',
  executionEnv: 'server',
  isTerminal: true,
  generateHandler(): string {
    return (
      handlerToString(payment_charge_user) +
      '\n' +
      toAbsoluteUrl.toString() +
      '\n' +
      toStoreUrl.toString()
    )
  },
}
