export interface StripeCall {
  method: string
  params: unknown
  options?: unknown
}

/** What each fake SDK method answers; a function may throw to act as a refusal. */
export type StripeScript = Record<string, (params: unknown, options?: unknown) => unknown>

/**
 * A recording stand-in for the `stripe` package: every method the store's
 * Stripe driver calls, each recorded as `'<resource>.<method>'` and answered
 * from `script` (or with an empty object).
 */
export const createFakeStripe = (
  script: StripeScript = {}
): { FakeStripe: unknown; calls: StripeCall[] } => {
  const calls: StripeCall[] = []
  const method = (name: string) => async (params: unknown, options?: unknown) => {
    calls.push(options === undefined ? { method: name, params } : { method: name, params, options })
    const answer = script[name]
    return answer ? answer(params, options) : {}
  }
  function FakeStripe(this: Record<string, unknown>, key: string) {
    this.key = key
    this.checkout = {
      sessions: {
        create: method('checkout.sessions.create'),
        retrieve: method('checkout.sessions.retrieve'),
        expire: method('checkout.sessions.expire'),
        list: method('checkout.sessions.list'),
      },
    }
    this.coupons = { create: method('coupons.create') }
    this.paymentIntents = { retrieve: method('paymentIntents.retrieve') }
    this.invoices = { retrieve: method('invoices.retrieve') }
    this.refunds = { create: method('refunds.create') }
    this.subscriptions = {
      retrieve: method('subscriptions.retrieve'),
      cancel: method('subscriptions.cancel'),
      update: method('subscriptions.update'),
    }
    this.billingPortal = {
      sessions: { create: method('billingPortal.sessions.create') },
      configurations: {
        list: method('billingPortal.configurations.list'),
        create: method('billingPortal.configurations.create'),
      },
    }
  }
  return { FakeStripe, calls }
}
