import { NodeHandlerGenerator, handlerToString } from '../types'

// Contract for the `amount` config field:
//   A floating-point number in the MAJOR currency unit (e.g. 99.99 USD,
//   9999 JPY) — identical to `payment-charge-user`. Omit it (or send 0) to
//   refund everything still outstanding on the charge; each provider resolves
//   that itself, which is the only reading that stays correct when a partial
//   refund has already been taken.
//
// Result contract, the same on every path so a downstream node can bind to it
// without knowing which branch ran:
//   { success, refundId, amount, currency, status, error }
//
// The provider work lives in the store's payment drivers (see `src/payments`).

async function payment_refund(config: any, _context: Record<string, unknown>) {
  // A workflow that names no provider has always meant Stripe.
  const providerType = String(
    config.providerType || config.provider || config.providerId || 'stripe'
  )
    .trim()
    .toLowerCase()
  const paymentReference = String(config.paymentReference || config.paymentIntentId || '').trim()
  const currency = String(config.currency || 'usd')
  const reason = config.reason ? String(config.reason) : ''
  // Attached to the provider's refund as metadata so the store's webhook can
  // match the refund event back to its order; never decides WHAT is refunded.
  const orderId = config.orderId ? String(config.orderId).trim() : ''
  // A key the caller controls (a refund request's id), so a retried segment
  // cannot refund twice; it is sent untouched. Without one, the key is unique
  // to this run of the node: a key of the reference and amount alone made a
  // second, equal partial refund replay the first, and the provider answered
  // with the first refund instead of paying the second.
  const requestedAmount = Number(config.amount)
  const amount = isFinite(requestedAmount) && requestedAmount > 0 ? requestedAmount : 0
  const idempotencyKey = String(
    config.idempotencyKey ||
      'refund:' +
        paymentReference +
        ':' +
        String(amount) +
        ':' +
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 10)
  )
  const refusal = (message: string) => ({
    success: false,
    refundId: '',
    amount: 0,
    currency,
    status: '',
    error: message,
  })

  if (!paymentReference) {
    return refusal('No payment reference was supplied, so there is no charge to refund.')
  }
  const driver =
    typeof __paymentDrivers !== 'undefined' && __paymentDrivers
      ? __paymentDrivers.get(providerType)
      : null
  if (!driver) {
    // Never another provider's refund API: that would refund with keys that
    // never took this money, or fail with an error naming the wrong provider.
    return refusal('Payment provider "' + providerType + '" cannot refund through this store.')
  }

  // A declined refund is an ANSWER, not a crash: the workflow branches on
  // `success` and tells the merchant what the provider said. Throwing here
  // would take down the whole segment — including the bookkeeping steps that
  // still have to record what happened.
  try {
    return await driver.refund({
      paymentReference,
      amount,
      currency,
      reason,
      idempotencyKey,
      orderId,
    })
  } catch (err: unknown) {
    return refusal((err as Error).message)
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
  generateHandler(): string {
    return handlerToString(payment_refund)
  },
}
