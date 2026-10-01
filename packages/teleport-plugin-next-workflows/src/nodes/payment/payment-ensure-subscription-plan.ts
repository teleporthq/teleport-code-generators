import { NodeHandlerGenerator, handlerToString } from '../types'

// Makes sure the provider has a PLAN to bill a recurring product with, and
// returns its id. Runs before `payment-charge-user` in subscription mode.
//
// Providers that take the price on each checkout (Stripe, Mollie, Paddle,
// CoinGate) answer `planId: ''`. Those that bill against a plan object (PayPal
// Billing Plans, Razorpay Plans, Square plan variations) create one when the
// workflow hands them no cached `planId`, and the workflow caches the ids in
// `teleport_provider_plans` so the next buyer of the same product and price
// subscribes to the same plan.
//
// Config (every amount in the MAJOR currency unit, like the charge node):
//   providerId, planId (cached, may be ''), providerProductId, productName,
//   amount, currency, interval ('day'|'week'|'month'|'year'), intervalCount,
//   trialDays, firstCycleAmount, productId (the store's own id, kept on the
//   provider's product so a merchant can trace it from their dashboard).
//
// Result (strings, for the workflow editor's comparisons):
//   ok 'true'|'false', planId, providerProductId, created 'true'|'false',
//   error (only when ok is 'false' — fatal to the caller, on purpose: a
//   checkout that cannot create its plan has nothing to redirect to).

async function payment_ensure_subscription_plan(config: any, _context: Record<string, unknown>) {
  const providerType = String(config.providerType || config.provider || config.providerId || '')
    .trim()
    .toLowerCase()
  const failure = (message: string) => ({
    ok: 'false',
    planId: '',
    providerProductId: '',
    created: 'false',
    error: message,
  })
  const driver =
    typeof __paymentDrivers !== 'undefined' && __paymentDrivers
      ? __paymentDrivers.get(providerType)
      : null
  if (!driver) {
    return failure('Payment provider "' + providerType + '" cannot bill a subscription.')
  }
  try {
    return await driver.ensurePlan({
      planId: String(config.planId || '').trim(),
      providerProductId: String(config.providerProductId || ''),
      productName: config.productName,
      productId: config.productId,
      amount: config.amount,
      currency: config.currency,
      interval: config.interval,
      intervalCount: config.intervalCount,
      trialDays: config.trialDays,
      firstCycleAmount: config.firstCycleAmount,
    })
  } catch (err: unknown) {
    return failure((err as Error).message)
  }
}

export const paymentEnsureSubscriptionPlan: NodeHandlerGenerator = {
  nodeType: 'payment-ensure-subscription-plan',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(payment_ensure_subscription_plan)
  },
}
