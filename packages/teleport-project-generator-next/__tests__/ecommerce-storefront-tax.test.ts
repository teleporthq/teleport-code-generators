/* tslint:disable:no-eval */
import {
  generateEcommerceContextFileContent,
  resolveStorefrontTaxRate,
} from '../src/ecommerce/ecommerce-context-generator'
import { UIDLEcommerceSettings, UIDLInvoiceSettings } from '@teleporthq/teleport-types'

/**
 * "Invoices → Tax → Added on top" means `teleport_products.price` is the NET
 * price and the customer pays `price × (1 + rate/100)`. The storefront has to
 * add that itself — the provider is what every cart and checkout page binds to.
 *
 * The invariant these lock in: the STORED cart (localStorage, and through it
 * `teleport_order_items`) keeps NET prices, and the tax is folded in only where
 * a price is displayed or totalled. Baking it into the stored cart instead
 * would double-tax on the next enrichment pass and would make the invoice
 * route — which adds VAT back on top of the order items — charge it twice.
 */

const ecommerceSettings: UIDLEcommerceSettings = {
  cashOnDelivery: true,
  deliveryEnabled: true,
  storePickupEnabled: false,
  guestCheckout: true,
  stockManagement: false,
  orderNotifications: false,
  deliveryConfig: null,
  stockManagementConfig: null,
  orderNotificationConfig: null,
  paymentProviders: [],
} as any

const invoiceSettings = (overrides: Partial<UIDLInvoiceSettings>): UIDLInvoiceSettings =>
  ({
    enabled: true,
    invoicePrefix: 'INV-',
    defaultTaxRate: 0,
    taxIncludedInPrice: false,
    showDiscount: false,
    autoGenerateOnPayment: true,
    companyDetails: {},
    ...overrides,
  } as any)

/**
 * Lifts the emitted cart-math helpers out of the generated module and makes
 * them callable, so these tests exercise the ARITHMETIC that ships rather than
 * asserting on substrings of it.
 */
function evalCartMath(source: string) {
  const grab = (name: string): string => {
    const start = source.indexOf(`function ${name}(`)
    if (start === -1) {
      throw new Error(`emitted provider is missing function ${name}`)
    }
    // Helpers are top-level, so their closing brace is the first one at column 0.
    const end = source.indexOf('\n}', start)
    return source.slice(start, end + 2)
  }
  const rateMatch = source.match(/const STOREFRONT_TAX_RATE = ([\d.]+)/)
  if (!rateMatch) {
    throw new Error('emitted provider is missing the STOREFRONT_TAX_RATE literal')
  }
  const scope = [
    `const STOREFRONT_TAX_RATE = ${rateMatch[1]}`,
    grab('roundMoney'),
    grab('applyStorefrontTax'),
    grab('cartItemDisplayPrice'),
    grab('computeCartMeta'),
    'return { STOREFRONT_TAX_RATE, applyStorefrontTax, cartItemDisplayPrice, computeCartMeta }',
  ].join('\n')
  // tslint:disable-next-line:function-constructor
  return new Function(scope)()
}

describe('EcommerceProvider — storefront tax rate resolution', () => {
  it('is 0 without invoice settings, at a zero/negative rate, or when tax is included', () => {
    expect(resolveStorefrontTaxRate(undefined)).toBe(0)
    expect(resolveStorefrontTaxRate(invoiceSettings({ defaultTaxRate: 0 }))).toBe(0)
    expect(resolveStorefrontTaxRate(invoiceSettings({ defaultTaxRate: -5 }))).toBe(0)
    expect(
      resolveStorefrontTaxRate(invoiceSettings({ defaultTaxRate: 19, taxIncludedInPrice: true }))
    ).toBe(0)
  })

  it('is the configured rate when it is added on top, including on legacy documents', () => {
    expect(resolveStorefrontTaxRate(invoiceSettings({ defaultTaxRate: 19 }))).toBe(19)
    // Documents predating `taxIncludedInPrice` coerce to false everywhere else.
    expect(
      resolveStorefrontTaxRate(
        invoiceSettings({ defaultTaxRate: 21, taxIncludedInPrice: undefined as any })
      )
    ).toBe(21)
  })
})

describe('EcommerceProvider — emitted cart math', () => {
  it('is an exact identity when no tax is configured', () => {
    const out = generateEcommerceContextFileContent(ecommerceSettings, undefined, 'ds-1')
    expect(out).toContain('const STOREFRONT_TAX_RATE = 0')

    const math = evalCartMath(out)
    expect(math.applyStorefrontTax(19.999)).toBe(19.999) // not even rounded
    expect(math.computeCartMeta([{ price: 100, quantity: 2 }])).toEqual({
      total: 200,
      itemCount: 2,
    })
  })

  it('adds the tax to the unit price and to the cart subtotal', () => {
    const out = generateEcommerceContextFileContent(
      ecommerceSettings,
      invoiceSettings({ defaultTaxRate: 19 }),
      'ds-1'
    )
    expect(out).toContain('const STOREFRONT_TAX_RATE = 19')

    const math = evalCartMath(out)
    expect(math.cartItemDisplayPrice({ price: 100 })).toBe(119)
    // Per-unit rounding: 19.99 → 23.79, so unit price × quantity is exactly the
    // line total the page prints beside it (rounding the sum gives 71.36).
    expect(math.cartItemDisplayPrice({ price: 19.99 })).toBe(23.79)
    expect(math.computeCartMeta([{ price: 19.99, quantity: 3 }]).total).toBe(71.37)
    expect(math.computeCartMeta([{ price: 100, quantity: 2 }])).toEqual({
      total: 238,
      itemCount: 2,
    })
  })

  it('leaves prices alone when the merchant prices tax-inclusive', () => {
    const out = generateEcommerceContextFileContent(
      ecommerceSettings,
      invoiceSettings({ defaultTaxRate: 19, taxIncludedInPrice: true }),
      'ds-1'
    )
    expect(out).toContain('const STOREFRONT_TAX_RATE = 0')
    expect(evalCartMath(out).computeCartMeta([{ price: 100, quantity: 2 }]).total).toBe(200)
  })

  it('coerces a missing or non-numeric price to 0 rather than NaN', () => {
    const out = generateEcommerceContextFileContent(
      ecommerceSettings,
      invoiceSettings({ defaultTaxRate: 19 }),
      'ds-1'
    )
    const math = evalCartMath(out)
    expect(math.cartItemDisplayPrice({})).toBe(0)
    expect(math.cartItemDisplayPrice(null)).toBe(0)
    expect(math.computeCartMeta([{ quantity: 2 }]).total).toBe(0)
  })
})

describe('EcommerceProvider — where the tax is (and is not) applied', () => {
  const taxed = () =>
    generateEcommerceContextFileContent(
      ecommerceSettings,
      invoiceSettings({ defaultTaxRate: 19 }),
      'ds-1'
    )

  it('exposes taxed prices on the context while the stored cart stays net', () => {
    const out = taxed()
    // The context projection the cart/checkout pages bind their line price to.
    expect(out).toContain('const displayCartItems = useMemo(')
    expect(out).toContain('price: cartItemDisplayPrice(item)')
    expect(out).toContain('items: displayCartItems,')
    // What gets persisted is still the raw `cartItems` state.
    expect(out).toContain('saveCartToStorage(next)')
    expect(out).not.toContain('saveCartToStorage(displayCartItems)')
  })

  it('mirrors the rate into workflow_cart_settings for the standalone handlers', () => {
    // cart-get-total runs outside React and charges the buyer; localStorage is
    // the only channel it shares with this provider.
    expect(taxed()).toContain('taxConfig: { storefrontTaxRate: STOREFRONT_TAX_RATE }')
  })

  it('does not tax enrichCartItems, which rewrites the STORED net price', () => {
    const out = taxed()
    expect(out).toContain('price: price,')
    expect(out).not.toContain('price: applyStorefrontTax(price)')
  })
})
