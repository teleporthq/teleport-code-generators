import { NodeHandlerGenerator, handlerToString } from '../types'

// Cancels, pauses or resumes a subscription at the provider that bills it,
// or (`refresh`) reads its live state back.
//
// Result contract (every field a string, so an if-statement compares it the
// way the workflow editor does):
//   ok                 'true' | 'false'
//   status             the store's own vocabulary after the action —
//                      'active' | 'past_due' | 'paused' | 'cancelled' |
//                      'trialing' | 'expired' | 'pending' | '' (unknown)
//   cancelAtPeriodEnd  'true' | 'false'
//   currentPeriodStart ISO 8601 or ''
//   currentPeriodEnd   ISO 8601 or ''
//   error              a provider or configuration message, only when
//                      `ok === 'false'` — ⛔ the generated runtime treats a
//                      non-empty `error` as FATAL, so a caller that must
//                      report instead of fail runs this node with
//                      `continueOnError`.
//
// `action`: 'cancel' (now), 'cancel_at_period_end', 'pause', 'resume' (which
// also withdraws a cancellation scheduled for the period end), 'refresh'.
// Each provider's driver maps these onto what its API can do and says so when
// it cannot (see `src/payments`).
//
// `billingMode: 'store'` marks a subscription the STORE bills cycle by cycle
// (crypto): there is nothing at the provider to change, so the action is
// answered here and the store's own rows record it.

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

  if (['cancel', 'cancel_at_period_end', 'pause', 'resume', 'refresh'].indexOf(action) === -1) {
    return failure('Unknown subscription action "' + action + '".')
  }
  if (String(config.billingMode || '').toLowerCase() === 'store') {
    const storeStatus: Record<string, string> = {
      cancel: 'cancelled',
      cancel_at_period_end: 'active',
      pause: 'paused',
      resume: 'active',
      refresh: '',
    }
    return {
      ok: 'true',
      status: storeStatus[action],
      cancelAtPeriodEnd: action === 'cancel_at_period_end' ? 'true' : 'false',
      currentPeriodStart: '',
      currentPeriodEnd: '',
    }
  }
  if (!subscriptionId) {
    return failure('No provider subscription id was supplied, so there is nothing to manage.')
  }
  const driver =
    typeof __paymentDrivers !== 'undefined' && __paymentDrivers
      ? __paymentDrivers.get(providerType)
      : null
  if (!driver) {
    return failure('Payment provider "' + providerType + '" cannot manage subscriptions.')
  }
  try {
    return await driver.manageSubscription({ subscriptionId, action })
  } catch (err: unknown) {
    return failure((err as Error).message)
  }
}

export const paymentManageSubscription: NodeHandlerGenerator = {
  nodeType: 'payment-manage-subscription',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(payment_manage_subscription)
  },
}
