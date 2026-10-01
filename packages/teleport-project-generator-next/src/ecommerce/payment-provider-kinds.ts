import { UIDLEcommercePaymentProvider } from '@teleporthq/teleport-types'

/**
 * Which providers a cart may be paid with. Every provider's terms cover some
 * kinds of goods and not others — Paddle sells digital goods only, CoinGate no
 * gift cards — so the checkout offers, for each cart, only the providers that
 * may take it, and the place-order script refuses the rest on the server.
 */

/** The kinds a cart is paid as, one per order (the cart holds one kind). */
export interface PaymentProviderKinds {
  physical: boolean
  digital: boolean
  giftCard: boolean
  recurringPhysical: boolean
  recurringDigital: boolean
}

/** A provider as the storefront's browser code sees it: never the names of its secrets. */
export interface ClientPaymentProvider {
  type: string
  name: string
  supportsSubscriptions: boolean
  kinds: PaymentProviderKinds
  currencies?: string[]
}

/** An export that predates the capabilities reads as every one-time kind, recurring as its flag says. */
export const paymentProviderKinds = (
  provider: UIDLEcommercePaymentProvider
): PaymentProviderKinds => {
  const sells = provider.sells || { physical: true, digital: true, giftCard: true }
  const billsRecurring = provider.supportsSubscriptions === true
  const recurring = provider.recurring || { physical: billsRecurring, digital: billsRecurring }
  return {
    physical: sells.physical !== false,
    digital: sells.digital !== false,
    giftCard: sells.giftCard !== false,
    recurringPhysical: billsRecurring && recurring.physical !== false,
    recurringDigital: billsRecurring && recurring.digital !== false,
  }
}

export const toClientPaymentProvider = (
  provider: UIDLEcommercePaymentProvider
): ClientPaymentProvider => ({
  type: provider.type,
  name: provider.name,
  supportsSubscriptions: provider.supportsSubscriptions === true,
  kinds: paymentProviderKinds(provider),
  ...(Array.isArray(provider.currencies) && provider.currencies.length > 0
    ? { currencies: provider.currencies }
    : {}),
})

/**
 * The context's runtime filter. Expects `tqCartLineKind` and `__deBool` in
 * scope; the cart's currency is its first line's, as the rest of the context
 * reads it.
 */
export const PAYMENT_PROVIDER_KIND_FILTER_CODE = `
// The kind the cart is paid as — the cart holds one kind, so its first line
// says — or null for an empty cart, which every provider may take.
function tqCartPaymentKind(items) {
  const line = (items || [])[0]
  if (!line) return null
  const kind = tqCartLineKind(line)
  if (kind === 'subscription') return __deBool(line.isDigital, false) ? 'recurringDigital' : 'recurringPhysical'
  return kind === 'gift-card' ? 'giftCard' : kind
}

// The providers whose terms cover what the cart holds, in the currency it is
// priced in.
function tqProvidersForCart(providers, items) {
  const kind = tqCartPaymentKind(items)
  const currency = items && items[0] ? String(items[0].currency || '').toUpperCase() : ''
  return providers.filter(
    (provider) =>
      (!kind || !provider.kinds || provider.kinds[kind] !== false) &&
      (!currency || !Array.isArray(provider.currencies) || provider.currencies.indexOf(currency) !== -1)
  )
}
`
