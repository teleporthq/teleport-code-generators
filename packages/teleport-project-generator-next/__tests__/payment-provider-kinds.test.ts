import {
  PAYMENT_PROVIDER_KIND_FILTER_CODE,
  paymentProviderKinds,
  toClientPaymentProvider,
} from '../src/ecommerce/payment-provider-kinds'

/**
 * Which providers a storefront cart is offered, EXECUTED: the filter the
 * context bakes runs against carts of each kind. Paddle sells digital goods
 * only and CoinGate no gift cards; Square charges in its location's currency.
 */

type Provider = ReturnType<typeof toClientPaymentProvider>
type Filter = (providers: Provider[], items: unknown[]) => Provider[]

// The context's own helpers the filter expects in scope.
const SCOPE = `
function __deBool(value, fallback) {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return fallback
}
function tqCartLineKind(line) {
  if (__deBool(line && line.isRecurring, false)) return 'subscription'
  if (__deBool(line && line.isGiftCard, false)) return 'gift-card'
  if (__deBool(line && line.isDigital, false)) return 'digital'
  return 'physical'
}
`

// eslint-disable-next-line no-new-func
const providersForCart = new Function(
  `${SCOPE}${PAYMENT_PROVIDER_KIND_FILTER_CODE}; return tqProvidersForCart;`
)() as Filter

const stripe = toClientPaymentProvider({
  type: 'stripe',
  name: 'Stripe',
  supportsSubscriptions: true,
})
const paddle = toClientPaymentProvider({
  type: 'paddle',
  name: 'Paddle',
  supportsSubscriptions: true,
  sells: { physical: false, digital: true, giftCard: false },
  recurring: { physical: false, digital: true },
})
const coingate = toClientPaymentProvider({
  type: 'coingate',
  name: 'CoinGate',
  supportsSubscriptions: true,
  sells: { physical: true, digital: true, giftCard: false },
  recurring: { physical: true, digital: true },
})
const square = toClientPaymentProvider({
  type: 'square',
  name: 'Square',
  supportsSubscriptions: true,
  currencies: ['USD', 'CAD'],
})
const all = [stripe, paddle, coingate, square]
const types = (providers: Provider[]) => providers.map((provider) => provider.type)

describe('tqProvidersForCart', () => {
  it('offers an empty cart every provider', () => {
    expect(types(providersForCart(all, []))).toEqual(['stripe', 'paddle', 'coingate', 'square'])
  })

  it('offers each kind of cart only the providers whose terms cover it', () => {
    expect(types(providersForCart(all, [{ currency: 'USD' }]))).toEqual([
      'stripe',
      'coingate',
      'square',
    ])
    expect(types(providersForCart(all, [{ isDigital: true, currency: 'USD' }]))).toEqual([
      'stripe',
      'paddle',
      'coingate',
      'square',
    ])
    expect(types(providersForCart(all, [{ isGiftCard: 'true', currency: 'USD' }]))).toEqual([
      'stripe',
      'square',
    ])
    expect(
      types(providersForCart(all, [{ isRecurring: true, isDigital: true, currency: 'USD' }]))
    ).toEqual(['stripe', 'paddle', 'coingate', 'square'])
    expect(types(providersForCart(all, [{ isRecurring: true, currency: 'USD' }]))).toEqual([
      'stripe',
      'coingate',
      'square',
    ])
  })

  it('drops a provider that cannot charge in the cart currency', () => {
    expect(types(providersForCart(all, [{ currency: 'eur' }]))).toEqual(['stripe', 'coingate'])
  })
})

describe('paymentProviderKinds', () => {
  it('reads an export that predates the capabilities as every one-time kind', () => {
    expect(paymentProviderKinds({ type: 'stripe', name: 'Stripe' })).toEqual({
      physical: true,
      digital: true,
      giftCard: true,
      recurringPhysical: false,
      recurringDigital: false,
    })
    expect(
      paymentProviderKinds({ type: 'paypal', name: 'PayPal', supportsSubscriptions: true })
    ).toMatchObject({
      recurringPhysical: true,
      recurringDigital: true,
    })
  })

  it('never lets a provider that bills no subscription take a recurring cart', () => {
    expect(
      paymentProviderKinds({ type: 'x', name: 'X', recurring: { physical: true, digital: true } })
    ).toMatchObject({ recurringPhysical: false, recurringDigital: false })
  })
})
