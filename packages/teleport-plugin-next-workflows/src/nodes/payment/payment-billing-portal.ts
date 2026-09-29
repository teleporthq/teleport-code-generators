import { NodeHandlerGenerator, handlerToString } from '../types'

// Where a subscriber manages their billing at the provider that bills them:
// Stripe's and Paddle's customer portals (a single-use session, opened at
// once), PayPal's own "automatic payments" page; providers without one say so.
//
// Result contract (every field a string, so an if-statement compares it the
// way the workflow editor does):
//   ok     'true' | 'false'
//   url    the page to send the subscriber to, '' on a failure
//   error  only when `ok === 'false'` — ⛔ the generated runtime treats a
//          non-empty `error` as FATAL, so a caller that must report instead
//          of fail runs this node with `continueOnError`.
//
// ⛔ A portal opens the customer's whole billing account. A caller must
// prove the customer belongs to the signed-in visitor BEFORE this node runs
// (the storefront reads the subscription row matched on the session's user id).

async function payment_billing_portal(config: any, _context: Record<string, unknown>) {
  const providerType = String(config.providerType || config.provider || config.providerId || '')
    .trim()
    .toLowerCase()
  const driver =
    typeof __paymentDrivers !== 'undefined' && __paymentDrivers
      ? __paymentDrivers.get(providerType)
      : null
  if (!driver) {
    return {
      ok: 'false',
      url: '',
      error: 'Payment provider "' + providerType + '" has no billing portal.',
    }
  }
  try {
    return await driver.billingPortal({
      customerId: String(config.providerCustomerId || config.customerId || '').trim(),
      subscriptionId: String(config.providerSubscriptionId || '').trim(),
      returnUrl: String(config.returnUrl || '').trim(),
    })
  } catch (err: unknown) {
    return { ok: 'false', url: '', error: (err as Error).message }
  }
}

export const paymentBillingPortal: NodeHandlerGenerator = {
  nodeType: 'payment-billing-portal',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(payment_billing_portal)
  },
}
