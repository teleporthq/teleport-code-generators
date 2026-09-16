/* tslint:disable:no-eval function-constructor */
import { parse } from '@babel/parser'
import { UIDLEcommerceSettings, UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import { RegionalPricing } from '@teleporthq/teleport-shared'
import { generateEcommerceContextFileContent } from '../src/ecommerce/ecommerce-context-generator'

/**
 * The storefront provider's half of shipping zones + tax jurisdictions.
 *
 * The rule itself is pinned by teleport-shared's parity table. What this pins is
 * the provider around it: a store WITHOUT the feature gets none of its code, a
 * store with it emits a module that parses, and the projections from a quote to
 * what the cart and checkout pages bind are right — run, not pattern-matched.
 */

const baseSettings = (overrides: Partial<UIDLEcommerceSettings> = {}): UIDLEcommerceSettings =>
  ({
    cashOnDelivery: true,
    deliveryEnabled: true,
    storePickupEnabled: true,
    guestCheckout: true,
    stockManagement: false,
    orderNotifications: false,
    deliveryConfig: {
      deliveryPrice: 5,
      freeDeliveryEnabled: true,
      freeDeliveryThreshold: 50,
      allowDeliveryNotes: true,
    },
    stockManagementConfig: null,
    orderNotificationConfig: null,
    paymentProviders: [],
    vouchersEnabled: true,
    ...overrides,
  } as UIDLEcommerceSettings)

const INVOICE = {
  defaultTaxRate: 19,
  taxIncludedInPrice: false,
  companyDetails: {},
} as UIDLInvoiceSettings

const REGIONAL = {
  enabled: true,
  currency: 'EUR',
  countryCodes: { germany: 'DE', france: 'FR' },
  storeCountryCode: 'DE',
}

const regionalSource = (): string =>
  generateEcommerceContextFileContent(
    baseSettings({ regionalPricing: REGIONAL }),
    INVOICE,
    'ds-1',
    false,
    false,
    false
  )

const grab = (source: string, name: string): string => {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) {
    throw new Error(`emitted provider is missing function ${name}`)
  }
  const end = source.indexOf('\n}', start)
  return source.slice(start, end + 2)
}

describe('EcommerceProvider — regional pricing is opt-in', () => {
  it('emits none of it for a store without the feature', () => {
    const legacy = generateEcommerceContextFileContent(baseSettings(), INVOICE, 'ds-1')
    expect(legacy).not.toContain('__rpQuote')
    expect(legacy).not.toContain('teleport_shipping_zones')
    expect(legacy).not.toContain('weightUnit')
    // The checkout's regional surfaces still resolve, to "nothing to show".
    expect(legacy).toContain("shippingOptionsVisible: 'false'")
    expect(legacy).toContain("shippingStatus: 'ok'")
    expect(legacy).toContain("codAvailable: 'true'")
  })

  it('stays off when the flag is present but disabled, or there is no datasource', () => {
    const disabled = generateEcommerceContextFileContent(
      baseSettings({ regionalPricing: { ...REGIONAL, enabled: false } }),
      INVOICE,
      'ds-1'
    )
    const noDataSource = generateEcommerceContextFileContent(
      baseSettings({ regionalPricing: REGIONAL }),
      INVOICE,
      null
    )
    expect(disabled).not.toContain('__rpQuote')
    expect(noDataSource).not.toContain('__rpQuote')
  })
})

describe('EcommerceProvider — regional pricing emitted module', () => {
  const source = regionalSource()

  it('parses as the JSX module Next compiles', () => {
    expect(() => parse(source, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('reads all three tables through the datasource and mirrors the snapshot for checkout', () => {
    for (const table of [
      'teleport_shipping_zones',
      'teleport_shipping_rates',
      'teleport_tax_rates',
    ]) {
      expect(source).toContain(table)
    }
    expect(source).toContain("'/api/data/' + PRODUCTS_DATA_SOURCE_ID + '/select'")
    expect(source).toContain(
      `const SHIPPING_RATE_STORAGE_KEY = '${RegionalPricing.SHIPPING_RATE_STORAGE_KEY}'`
    )
    expect(source).toContain('regional: {')
  })

  it('bakes the store defaults the quote falls back to', () => {
    expect(source).toContain(
      'const REGIONAL_STORE = {"deliveryEnabled":true,"storePickupEnabled":true,"deliveryPrice":5,"freeDeliveryEnabled":true,"freeDeliveryThreshold":50,"defaultTaxRate":19,"defaultTaxIncluded":false}'
    )
  })

  it('stamps weight and categories onto hydrated cart lines', () => {
    expect(source).toContain('weightUnit: product.weight_unit || null')
    expect(source).toContain(
      'categoryIds: __rpStringArray(product.category_filter_ids || product.category_ids).map(String)'
    )
  })

  it('prices the voucher against lines already grossed in the destination tax', () => {
    expect(source).toContain('regionalVoucherItems(regionalQuote, cartItems)')
    expect(source).not.toContain('        STOREFRONT_TAX_RATE,\n        shippingMeta,')
  })
})

describe('EcommerceProvider — quote projections', () => {
  const source = regionalSource()
  const api = new Function(
    [
      RegionalPricing.generateRegionalPricingHelperCode(),
      'var STOREFRONT_TAX_RATE = 19;',
      grab(source, 'roundMoney'),
      grab(source, 'applyStorefrontTax'),
      grab(source, 'cartItemDisplayPrice'),
      grab(source, 'cartItemQuantity'),
      grab(source, 'cartItemLineTotal'),
      grab(source, 'cartItemHasDiscount'),
      grab(source, 'cartItemOriginalLineTotal'),
      grab(source, 'formatCartMoney'),
      grab(source, 'regionalLineFor'),
      grab(source, 'regionalLinePricing'),
      grab(source, 'regionalVoucherItems'),
      grab(source, 'regionalShippingMeta'),
      grab(source, 'regionalShippingOptions'),
      grab(source, 'regionalSettingsView'),
      'return { quote: __rpQuote, normalize: __rpNormalizeConfig, linePricing: regionalLinePricing,' +
        ' voucherItems: regionalVoucherItems, shippingMeta: regionalShippingMeta,' +
        ' options: regionalShippingOptions, settingsView: regionalSettingsView };',
    ].join('\n')
  )()

  const STORE = {
    deliveryEnabled: true,
    storePickupEnabled: true,
    deliveryPrice: 5,
    freeDeliveryEnabled: true,
    freeDeliveryThreshold: 50,
    defaultTaxRate: 19,
    defaultTaxIncluded: false,
  }
  const CONFIG = api.normalize({
    zones: [{ id: 'z1', name: 'France', countries: 'FR', free_shipping_threshold: '100' }],
    rates: [
      { id: 'r1', zone_id: 'z1', name: 'Standard', price: '4.90' },
      { id: 'r2', zone_id: 'z1', name: 'Express', price: '12', estimated_days: 'Next day' },
    ],
    taxRates: [{ id: 't1', country_code: 'FR', rate: 20, tax_mode: 'added', tax_shipping: true }],
  })
  const CART = [
    { id: 'l1', productId: 'p1', price: 10, quantity: 2, originalPrice: 12.5 },
    { productId: 'p2', price: 5, quantity: 1 },
  ]
  const FRANCE = { countryCode: 'FR', countryName: 'France', region: '' }
  const quoteFor = (selectedRateId: string | null) =>
    api.quote({
      config: CONFIG,
      store: STORE,
      items: CART,
      destination: FRANCE,
      fulfillment: 'delivery',
      selectedRateId,
      currency: 'EUR',
    })

  it('prices each line in the destination tax, including the struck price and a line with no id', () => {
    const quote = quoteFor(null)
    expect(api.linePricing(quote, CART[0], 0)).toEqual({
      unitPrice: 12,
      lineTotal: 24,
      originalLineTotal: 30,
    })
    expect(api.linePricing(quote, CART[1], 1)).toEqual({
      unitPrice: 6,
      lineTotal: 6,
      originalLineTotal: null,
    })
  })

  it('hands the voucher rule gross unit prices', () => {
    const items = api.voucherItems(quoteFor(null), CART)
    expect(items.map((item: { price: number }) => item.price)).toEqual([12, 6])
    // The stored cart is never rewritten.
    expect(CART[0].price).toBe(10)
  })

  it('lists the shipping methods with taxed prices and the selection', () => {
    expect(api.options(quoteFor('r2'))).toEqual([
      {
        id: 'r1',
        name: 'Standard',
        estimatedDays: '',
        price: '5.88',
        isFree: 'false',
        selected: 'false',
      },
      {
        id: 'r2',
        name: 'Express',
        estimatedDays: 'Next day',
        price: '14.40',
        isFree: 'false',
        selected: 'true',
      },
    ])
  })

  it('feeds the shipping meta from the quote, taxed shipping included', () => {
    expect(api.shippingMeta(quoteFor(null))).toEqual({
      shippingIsFree: false,
      shippingPrice: 5.88,
      totalWithShipping: 35.88,
      freeDeliveryProgress: '30%',
      freeDeliveryRemaining: 70,
    })
  })

  it("shows the matched zone's fee and threshold through Settings.Delivery", () => {
    const settings = {
      deliveryEnabled: true,
      Delivery: { deliveryPrice: 5, allowDeliveryNotes: true },
    }
    expect(api.settingsView(settings, quoteFor(null)).Delivery).toEqual({
      deliveryPrice: 4.9,
      allowDeliveryNotes: true,
      freeDeliveryEnabled: true,
      freeDeliveryThreshold: 100,
    })
    const pickup = api.quote({
      config: CONFIG,
      store: STORE,
      items: CART,
      destination: FRANCE,
      fulfillment: 'pickup',
      selectedRateId: null,
      currency: 'EUR',
    })
    expect(api.settingsView(settings, pickup)).toBe(settings)
  })
})
