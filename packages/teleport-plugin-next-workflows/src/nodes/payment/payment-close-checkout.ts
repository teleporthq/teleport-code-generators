import { NodeHandlerGenerator, handlerToString } from '../types'

// Closes the checkout an unpaid order has open with its provider BEFORE the
// order is settled or cancelled some other way, so no page the store opened
// can take the order's money afterwards. A buyer who kept the provider's page
// open in a tab would otherwise pay an order the merchant already marked paid
// — and a payment the order never recorded a reference for is taken as its
// own, so nobody would be told.
//
// The checkout is the one the order recorded (`reference`, the order's
// `payment_attempt_ref`) or, when it recorded none, the ones the provider
// finds for it around the time it was placed (`orderId`, `placedAt`). The
// provider work is the store's payment driver (`closeCheckout`,
// `findCheckouts`, composed by `core.closeOrderCheckouts`).
//
// `purpose` says what the caller is about to do, and so what the provider's
// answer allows:
//   'settle'  — mark the order paid by hand: allowed once every page is
//               closed, or when the provider already took the money (that is
//               the payment being recorded);
//   'cancel'  — cancel the order: allowed once every page is closed;
//   'abandon' — "Continue payment" opened a checkout it could not record
//               (another window recorded its own first): that page is closed,
//               and nothing is refused. Acts only when `attemptOutcome` is
//               'created' and `recorded` is not 'true';
//   ''        — nothing to do (a step that runs on every save).
// A payment being confirmed, a page the provider cannot close early (the
// answer says until when), or a provider that could not be asked refuses.
//
// Result contract (strings, compared the way an if-statement compares them):
//   allowed    'true' | 'false'
//   outcome    'skipped' | 'none' | 'closed' | 'paid' | 'confirming' | 'open' | 'error'
//   openUntil  when a page that cannot be closed runs out ('' when unknown)
//   message    the refusal, worded for the merchant
// Never `error`: the generated runtime treats a non-empty `error` as fatal,
// and a refusal is an answer the workflow shows.

async function payment_close_checkout(config: any, _context: Record<string, unknown>) {
  const purpose = String(config.purpose || '')
    .trim()
    .toLowerCase()
  const providerType = String(config.providerType || config.provider || config.providerId || '')
    .trim()
    .toLowerCase()
  const reference = String(config.reference || '').trim()
  const skipped = { allowed: 'true', outcome: 'skipped', openUntil: '', message: '' }
  if (!purpose || !providerType) {
    return skipped
  }
  if (purpose === 'abandon') {
    const recorded = String(config.recorded || '') === 'true'
    if (String(config.attemptOutcome || '') !== 'created' || recorded || !reference) {
      return skipped
    }
  }
  const labels: Record<string, string> = {
    stripe: 'Stripe',
    paypal: 'PayPal',
    mollie: 'Mollie',
    razorpay: 'Razorpay',
    square: 'Square',
    paddle: 'Paddle',
    coingate: 'CoinGate',
  }
  const label = labels[providerType] || providerType
  const drivers =
    typeof __paymentDrivers !== 'undefined' && __paymentDrivers ? __paymentDrivers : null
  const driver = drivers ? drivers.get(providerType) : null
  let result: any
  if (!driver || !drivers.core || typeof drivers.core.closeOrderCheckouts !== 'function') {
    result = {
      outcome: '',
      error: 'This store cannot reach ' + label + ' to close the payment page.',
    }
  } else {
    try {
      result = await drivers.core.closeOrderCheckouts(driver, {
        reference,
        orderId: String(config.orderId || '').trim(),
        placedAt: String(config.placedAt || '').trim(),
      })
    } catch (err: unknown) {
      result = { outcome: '', error: (err as Error).message }
    }
  }
  const outcome = String((result && result.outcome) || '')
  const openUntil = outcome === 'open' ? String(result.openUntil || '') : ''
  if (purpose === 'abandon') {
    return { allowed: 'true', outcome: outcome || 'error', openUntil, message: '' }
  }
  const allowed =
    outcome === 'closed' || outcome === 'none' || (outcome === 'paid' && purpose === 'settle')
  let message = ''
  if (!outcome) {
    message =
      label +
      " could not be asked to close the buyer's payment page, so nothing was changed: " +
      String((result && result.error) || 'no answer') +
      '. Try again in a moment.'
  } else if (outcome === 'paid') {
    message =
      'The buyer has already paid this order through ' +
      label +
      '. Refund the payment instead of cancelling the order.'
  } else if (outcome === 'confirming') {
    message =
      'A payment for this order is being confirmed by ' +
      label +
      '. Wait until it settles before changing the order.'
  } else if (outcome === 'open') {
    const until = new Date(openUntil)
    const when = isFinite(until.getTime())
      ? ' until ' + until.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
      : ''
    message =
      "The buyer's " +
      label +
      ' payment page for this order stays open' +
      when +
      ', and ' +
      label +
      " can't close it early. Try again after that, so the order can't be paid twice."
  }
  return allowed
    ? { allowed: 'true', outcome, openUntil: '', message: '' }
    : { allowed: 'false', outcome: outcome || 'error', openUntil, message }
}

export const paymentCloseCheckout: NodeHandlerGenerator = {
  nodeType: 'payment-close-checkout',
  executionEnv: 'server',
  // Not terminal: the workflow goes on to settle, cancel or refuse.
  isTerminal: false,
  generateHandler(): string {
    return handlerToString(payment_close_checkout)
  },
}
