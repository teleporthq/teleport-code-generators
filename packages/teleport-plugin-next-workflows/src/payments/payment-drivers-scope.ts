/**
 * Where a store's payment drivers live, which providers have one, and which
 * generated code needs them.
 *
 * Every provider a store can take money with has ONE driver module in the
 * generated app (`utils/payments/drivers/<id>.js`), behind one registry
 * (`utils/payments/index.js`). The payment workflow nodes and the payment
 * webhook routes reach it through the `__paymentDrivers` binding a route's
 * preamble declares (see `generatePaymentDriversPreamble`); nothing else in
 * the store talks to a provider.
 */

export const PAYMENT_DRIVERS_FILE_KEY = 'payment-drivers'
export const PAYMENT_DRIVERS_PATH = ['utils', 'payments']
export const PAYMENT_DRIVERS_DIRECTORY = ['utils', 'payments', 'drivers']

/** The providers the generated store can charge, refund and bill through. */
export const PAYMENT_DRIVER_IDS = [
  'stripe',
  'paypal',
  'mollie',
  'razorpay',
  'square',
  'paddle',
  'coingate',
] as const

export type PaymentDriverId = (typeof PAYMENT_DRIVER_IDS)[number]

/**
 * The NAMES (never the values) of the secrets the merchant saved for each
 * provider, by the provider form's field key.
 */
export type DeclaredPaymentCredentials = Partial<Record<PaymentDriverId, Record<string, string>>>

/**
 * Drivers every store that takes online payments carries, whatever it
 * configured: a workflow authored (or AI-generated) before providers were
 * explicit names no provider and has always meant Stripe, or PayPal by name.
 */
export const DEFAULT_PAYMENT_DRIVER_IDS: readonly PaymentDriverId[] = ['stripe', 'paypal']

/** The workflow nodes whose handler calls a driver. */
export const PAYMENT_DRIVER_NODE_TYPES = new Set([
  'payment-charge-user',
  'payment-refund',
  'payment-ensure-subscription-plan',
  'payment-manage-subscription',
  'payment-billing-portal',
  'payment-close-checkout',
])

/** The webhook signature scheme a payment webhook verifies with. */
export const PAYMENT_DRIVER_SIGNATURE_ALGORITHM = 'payment-driver'

export const isPaymentDriverId = (value: unknown): value is PaymentDriverId =>
  typeof value === 'string' && (PAYMENT_DRIVER_IDS as readonly string[]).includes(value)

export const usesPaymentDriverNode = (nodeTypes: Iterable<string>): boolean => {
  for (const nodeType of nodeTypes) {
    if (PAYMENT_DRIVER_NODE_TYPES.has(nodeType)) {
      return true
    }
  }
  return false
}
