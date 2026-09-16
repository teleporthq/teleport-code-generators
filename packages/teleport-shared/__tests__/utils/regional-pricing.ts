import { generateRegionalPricingHelperCode } from '../../src/utils/regional-pricing'

/**
 * Regional pricing — the ES5 copy the published storefront runs.
 *
 * ⚠️ The fixture table below is SHARED with the editor/canvas copy in
 * teleport-gui (`features/e-commerce/utils/__tests__/regional-pricing-parity.spec.ts`).
 * Two specs, one table: that is what proves the canvas and the deployed store
 * quote the same shipping and tax for the same basket.
 */

interface RegionalPricingApi {
  normalize: (raw: unknown) => unknown
  quote: (input: unknown) => Record<string, unknown>
  parseCountries: (raw: unknown) => string[]
  weightKg: (weight: unknown, unit: unknown) => number
  readDestination: (countryCodes: unknown) => Record<string, unknown> | null
}

const loadApi = (): RegionalPricingApi =>
  new Function(
    generateRegionalPricingHelperCode() +
      '\nreturn { normalize: __rpNormalizeConfig, quote: __rpQuote, parseCountries: __rpParseCountries,' +
      ' weightKg: __rpWeightKg, readDestination: __rpReadCheckoutDestination };'
  )() as RegionalPricingApi

// ── SHARED PARITY TABLE ─────────────────────────────────────────────────────
// Byte-identical in teleport-gui `regional-pricing-parity.spec.ts` and
// teleport-code-generators `teleport-shared/__tests__/utils/regional-pricing.ts`.
// Rows are what `/api/data/.../select` returns: strings for DECIMAL columns,
// driver booleans ('t'/'f'), nullable text.
interface RegionalQuoteFixture {
  name: string
  input: {
    config: {
      zones?: Array<Record<string, unknown>>
      rates?: Array<Record<string, unknown>>
      taxRates?: Array<Record<string, unknown>>
    }
    store: {
      deliveryEnabled: boolean
      storePickupEnabled: boolean
      deliveryPrice: number
      freeDeliveryEnabled: boolean
      freeDeliveryThreshold: number
      defaultTaxRate: number
      defaultTaxIncluded: boolean
    }
    items: Array<Record<string, unknown>>
    destination: { countryCode: string; countryName: string; region: string } | null
    fulfillment: 'delivery' | 'pickup'
    selectedRateId: string | null
    currency: string
  }
  expected: Record<string, unknown>
}

const PARITY_ZONES: Array<Record<string, unknown>> = [
  {
    id: 'z-eu',
    name: 'EU',
    countries: 'DE, FR,at',
    is_rest_of_world: false,
    free_shipping_threshold: '80.00',
    cod_enabled: 'f',
    is_active: 't',
    sort_order: 1,
  },
  {
    id: 'z-row',
    name: 'Rest of world',
    countries: null,
    is_rest_of_world: true,
    free_shipping_threshold: null,
    cod_enabled: true,
    is_active: true,
    sort_order: 9,
  },
  {
    id: 'z-off',
    name: 'Disabled',
    countries: '["US"]',
    is_rest_of_world: false,
    is_active: false,
    sort_order: 0,
  },
]

const PARITY_RATES: Array<Record<string, unknown>> = [
  {
    id: 'r-eu-std',
    zone_id: 'z-eu',
    name: 'Standard',
    rate_type: 'flat',
    price: '6.00',
    estimated_days: '3-5 days',
    is_active: true,
    sort_order: 1,
  },
  {
    id: 'r-eu-exp',
    zone_id: 'z-eu',
    name: 'Express',
    rate_type: 'flat',
    price: '15',
    estimated_days: '1-2 days',
    is_active: true,
    sort_order: 2,
  },
  {
    id: 'r-eu-bulk',
    zone_id: 'z-eu',
    name: 'Bulk order',
    rate_type: 'price',
    price: 0,
    min_value: '200',
    max_value: null,
    is_active: 't',
    sort_order: 3,
  },
  {
    id: 'r-row-light',
    zone_id: 'z-row',
    name: 'Light parcel',
    rate_type: 'weight',
    price: 12,
    min_value: null,
    max_value: 2,
    is_active: true,
    sort_order: 1,
  },
  {
    id: 'r-row-heavy',
    zone_id: 'z-row',
    name: 'Heavy parcel',
    rate_type: 'weight',
    price: 30,
    min_value: 2,
    max_value: null,
    is_active: true,
    sort_order: 2,
  },
  {
    id: 'r-row-bulk',
    zone_id: 'z-row',
    name: 'Large order',
    rate_type: 'price',
    price: 20,
    min_value: 150,
    max_value: null,
    is_active: true,
    sort_order: 3,
  },
]

const PARITY_TAX_RATES: Array<Record<string, unknown>> = [
  {
    id: 't-de',
    country_code: 'de',
    region: null,
    category_id: null,
    rate: '19',
    tax_mode: 'added',
    tax_shipping: 't',
    is_active: true,
  },
  {
    id: 't-de-food',
    country_code: 'DE',
    region: null,
    category_id: 'cat-food',
    rate: 7,
    tax_mode: 'inherit',
    tax_shipping: false,
    is_active: true,
  },
  {
    id: 't-fr',
    country_code: 'FR',
    region: '',
    category_id: '',
    rate: 20,
    tax_mode: 'included',
    tax_shipping: true,
    is_active: true,
  },
  {
    id: 't-jp',
    country_code: 'JP',
    region: null,
    category_id: null,
    rate: 10,
    tax_mode: 'added',
    tax_shipping: false,
    is_active: true,
  },
  {
    id: 't-us',
    country_code: 'US',
    region: null,
    category_id: null,
    rate: 0,
    tax_mode: 'inherit',
    tax_shipping: false,
    is_active: true,
  },
  {
    id: 't-us-ca',
    country_code: 'US',
    region: 'California',
    category_id: null,
    rate: 7.25,
    tax_mode: 'added',
    tax_shipping: false,
    is_active: true,
  },
]

const PARITY_STORE = {
  deliveryEnabled: true,
  storePickupEnabled: true,
  deliveryPrice: 5,
  freeDeliveryEnabled: true,
  freeDeliveryThreshold: 100,
  defaultTaxRate: 20,
  defaultTaxIncluded: false,
}

const PARITY_FOOD_LINE = {
  id: 'a',
  productId: 'p1',
  price: 10,
  quantity: 2,
  weight: 500,
  weightUnit: 'g',
  categoryIds: ['cat-food'],
}

const PARITY_TOOL_LINE = {
  id: 'b',
  productId: 'p2',
  variantId: 'v2',
  price: '25.99',
  quantity: '1',
  weight: '1.2',
  weightUnit: 'kg',
  categoryIds: '["cat-tools"]',
}

const PARITY_CONFIG = { zones: PARITY_ZONES, rates: PARITY_RATES, taxRates: PARITY_TAX_RATES }

const GERMANY = { countryCode: 'DE', countryName: 'Germany', region: '' }
const BRAZIL = { countryCode: 'BR', countryName: 'Brazil', region: '' }

const REGIONAL_QUOTE_FIXTURES: RegionalQuoteFixture[] = [
  {
    name: 'no tables: the flat fee and the default rate, rounded to cents',
    input: {
      config: {},
      store: PARITY_STORE,
      items: [PARITY_FOOD_LINE, PARITY_TOOL_LINE],
      destination: null,
      fulfillment: 'delivery',
      selectedRateId: null,
      currency: 'USD',
    },
    expected: {
      status: 'ok',
      fulfillment: 'delivery',
      taxRegional: false,
      zonesActive: false,
      goodsNet: 45.99,
      goodsTax: 9.2,
      goodsGross: 55.19,
      breakdown: [{ rate: 20, included: false, gross: 55.19, tax: 9.2 }],
      shippingBase: 5,
      shippingNet: 5,
      shippingGross: 5,
      shippingIsFree: false,
      freeShippingThreshold: 100,
      freeShippingRemaining: 44.81,
      codAvailable: true,
      total: 60.19,
    },
  },
  {
    name: 'no tables: tax-inclusive prices meet the free-delivery threshold exactly',
    input: {
      config: {},
      store: { ...PARITY_STORE, defaultTaxIncluded: true },
      items: [{ id: 'c', price: 100, quantity: 1 }],
      destination: null,
      fulfillment: 'delivery',
      selectedRateId: null,
      currency: 'USD',
    },
    expected: {
      goodsTax: 0,
      goodsGross: 100,
      breakdown: [{ rate: 20, included: true, gross: 100, tax: 16.67 }],
      shippingIsFree: true,
      shippingNet: 0,
      freeShippingProgress: 100,
      freeShippingRemaining: 0,
      total: 100,
    },
  },
  {
    name: 'store pickup: no shipping and no zone check, taxed by the address like any order',
    input: {
      config: PARITY_CONFIG,
      store: PARITY_STORE,
      items: [PARITY_FOOD_LINE],
      destination: GERMANY,
      fulfillment: 'pickup',
      selectedRateId: null,
      currency: 'EUR',
    },
    expected: {
      status: 'ok',
      fulfillment: 'pickup',
      zonesActive: false,
      taxRate: 19,
      lines: [{ key: 'a', unitGross: 10.7, taxRate: 7, taxIncluded: false }],
      goodsTax: 1.4,
      shippingNet: 0,
      shippingTax: 0,
      zone: null,
      options: [],
      codAvailable: true,
      total: 21.4,
    },
  },
  {
    name: 'Germany: category override, cheapest rate, zone threshold not reached, shipping taxed',
    input: {
      config: PARITY_CONFIG,
      store: PARITY_STORE,
      items: [PARITY_FOOD_LINE, PARITY_TOOL_LINE],
      destination: GERMANY,
      fulfillment: 'delivery',
      selectedRateId: null,
      currency: 'EUR',
    },
    expected: {
      status: 'ok',
      zonesActive: true,
      taxRegional: true,
      lines: [
        { key: 'a', productId: 'p1', unitGross: 10.7, lineGross: 21.4, taxRate: 7 },
        { key: 'b', productId: 'p2', variantId: 'v2', unitGross: 30.93, taxRate: 19 },
      ],
      goodsNet: 45.99,
      goodsTax: 6.34,
      goodsGross: 52.33,
      taxRate: 19,
      taxIncluded: false,
      breakdown: [
        { rate: 7, included: false, gross: 21.4, tax: 1.4 },
        { rate: 19, included: false, gross: 30.93, tax: 4.94 },
      ],
      zone: { id: 'z-eu', name: 'EU' },
      options: [
        {
          id: 'r-eu-std',
          name: 'Standard',
          estimatedDays: '3-5 days',
          price: 6,
          gross: 7.14,
          isFree: false,
        },
        {
          id: 'r-eu-exp',
          name: 'Express',
          estimatedDays: '1-2 days',
          price: 15,
          gross: 17.85,
          isFree: false,
        },
      ],
      selectedRateId: 'r-eu-std',
      rateName: 'Standard',
      freeShippingThreshold: 80,
      freeShippingRemaining: 27.67,
      shippingNet: 6,
      shippingTax: 1.14,
      shippingGross: 7.14,
      codAvailable: false,
      total: 59.47,
    },
  },
  {
    name: 'Germany: the chosen rate is kept, and the zone threshold makes it free',
    input: {
      config: PARITY_CONFIG,
      store: PARITY_STORE,
      items: [{ ...PARITY_TOOL_LINE, quantity: 3 }],
      destination: GERMANY,
      fulfillment: 'delivery',
      selectedRateId: 'r-eu-exp',
      currency: 'EUR',
    },
    expected: {
      goodsGross: 92.79,
      selectedRateId: 'r-eu-exp',
      shippingBase: 15,
      shippingIsFree: true,
      shippingNet: 0,
      shippingTax: 0,
      options: [
        { id: 'r-eu-std', gross: 0, isFree: true },
        { id: 'r-eu-exp', gross: 0, isFree: true },
      ],
      total: 92.79,
    },
  },
  {
    name: 'rest of world: price tier included at its lower bound, a stale choice falls back to the cheapest',
    input: {
      config: PARITY_CONFIG,
      store: PARITY_STORE,
      items: [{ id: 'd', price: 150, quantity: 1 }],
      destination: BRAZIL,
      fulfillment: 'delivery',
      selectedRateId: 'r-gone',
      currency: 'USD',
    },
    expected: {
      zone: { id: 'z-row', name: 'Rest of world' },
      options: [
        { id: 'r-row-light', price: 12 },
        { id: 'r-row-bulk', price: 20 },
      ],
      selectedRateId: 'r-row-light',
      freeShippingThreshold: null,
      shippingNet: 12,
      codAvailable: true,
      total: 192,
    },
  },
  {
    name: 'rest of world: a weight tier upper bound is exclusive',
    input: {
      config: PARITY_CONFIG,
      store: PARITY_STORE,
      items: [{ id: 'e', price: 10, quantity: 1, weight: 2000, weightUnit: 'g' }],
      destination: BRAZIL,
      fulfillment: 'delivery',
      selectedRateId: null,
      currency: 'USD',
    },
    expected: {
      options: [{ id: 'r-row-heavy', price: 30 }],
      selectedRateId: 'r-row-heavy',
      shippingNet: 30,
      total: 42,
    },
  },
  {
    name: 'United States: a region row outranks the country row, shipping untaxed',
    input: {
      config: PARITY_CONFIG,
      store: PARITY_STORE,
      items: [{ id: 'f', price: 19.99, quantity: 2 }],
      destination: { countryCode: 'US', countryName: 'United States', region: 'california' },
      fulfillment: 'delivery',
      selectedRateId: null,
      currency: 'USD',
    },
    expected: {
      lines: [{ key: 'f', unitGross: 21.44, lineGross: 42.88, taxRate: 7.25 }],
      goodsTax: 2.9,
      taxRate: 7.25,
      shippingTax: 0,
      shippingGross: 12,
      total: 54.88,
    },
  },
  {
    name: 'United States: another region falls to the zero-rate country row',
    input: {
      config: PARITY_CONFIG,
      store: PARITY_STORE,
      items: [{ id: 'f', price: 19.99, quantity: 2 }],
      destination: { countryCode: 'US', countryName: 'United States', region: 'Texas' },
      fulfillment: 'delivery',
      selectedRateId: null,
      currency: 'USD',
    },
    expected: {
      goodsTax: 0,
      goodsGross: 39.98,
      taxRate: 0,
      breakdown: [],
      total: 51.98,
    },
  },
  {
    name: 'France: prices include tax, nothing is added and the shipping tax is contained',
    input: {
      config: PARITY_CONFIG,
      store: PARITY_STORE,
      items: [PARITY_TOOL_LINE],
      destination: { countryCode: 'FR', countryName: 'France', region: '' },
      fulfillment: 'delivery',
      selectedRateId: null,
      currency: 'EUR',
    },
    expected: {
      lines: [{ key: 'b', unitGross: 25.99, taxRate: 20, taxIncluded: true }],
      goodsTax: 0,
      goodsGross: 25.99,
      taxIncluded: true,
      breakdown: [{ rate: 20, included: true, gross: 25.99, tax: 4.33 }],
      shippingNet: 6,
      shippingTax: 1,
      shippingGross: 6,
      total: 31.99,
    },
  },
  {
    name: 'no zone covers the country and there is no rest of world: unavailable',
    input: {
      config: { zones: [PARITY_ZONES[0]], rates: PARITY_RATES, taxRates: PARITY_TAX_RATES },
      store: PARITY_STORE,
      items: [PARITY_FOOD_LINE],
      destination: BRAZIL,
      fulfillment: 'delivery',
      selectedRateId: null,
      currency: 'USD',
    },
    expected: {
      status: 'unavailable',
      zone: null,
      options: [],
      selectedRateId: null,
      shippingNet: 0,
      total: 24,
    },
  },
  {
    name: 'a zone whose rates do not fit the basket: no rate',
    input: {
      config: { zones: [PARITY_ZONES[1]], rates: [PARITY_RATES[4]], taxRates: [] },
      store: PARITY_STORE,
      items: [PARITY_FOOD_LINE],
      destination: BRAZIL,
      fulfillment: 'delivery',
      selectedRateId: null,
      currency: 'USD',
    },
    expected: {
      status: 'no-rate',
      taxRegional: false,
      zone: { id: 'z-row', name: 'Rest of world' },
      options: [],
      shippingNet: 0,
    },
  },
  {
    name: 'zones configured but no address yet: pending',
    input: {
      config: PARITY_CONFIG,
      store: PARITY_STORE,
      items: [PARITY_FOOD_LINE],
      destination: null,
      fulfillment: 'delivery',
      selectedRateId: null,
      currency: 'EUR',
    },
    expected: {
      status: 'pending',
      taxRate: 20,
      shippingNet: 0,
      shippingIsFree: false,
      total: 24,
    },
  },
  {
    name: 'a zero-decimal currency rounds regional tax to the whole unit',
    input: {
      config: { taxRates: [PARITY_TAX_RATES[3]] },
      store: { ...PARITY_STORE, deliveryPrice: 500, freeDeliveryEnabled: false },
      items: [{ id: 'g', price: 999, quantity: 3 }],
      destination: { countryCode: 'JP', countryName: 'Japan', region: '' },
      fulfillment: 'delivery',
      selectedRateId: null,
      currency: 'JPY',
    },
    expected: {
      lines: [{ key: 'g', unitGross: 1099, lineGross: 3297 }],
      goodsNet: 2997,
      goodsTax: 300,
      zonesActive: false,
      shippingNet: 500,
      freeShippingThreshold: null,
      total: 3797,
    },
  },
  {
    name: 'inactive rows count as no rows',
    input: {
      config: { zones: [PARITY_ZONES[2]], rates: PARITY_RATES },
      store: PARITY_STORE,
      items: [PARITY_FOOD_LINE],
      destination: { countryCode: 'US', countryName: 'United States', region: '' },
      fulfillment: 'delivery',
      selectedRateId: null,
      currency: 'USD',
    },
    expected: {
      taxRegional: false,
      zonesActive: false,
      shippingNet: 5,
      freeShippingRemaining: 76,
      total: 29,
    },
  },
  {
    name: 'a store that does not deliver prices every order as a pickup',
    input: {
      config: PARITY_CONFIG,
      store: { ...PARITY_STORE, deliveryEnabled: false },
      items: [PARITY_FOOD_LINE],
      destination: GERMANY,
      fulfillment: 'delivery',
      selectedRateId: null,
      currency: 'EUR',
    },
    expected: {
      fulfillment: 'pickup',
      zonesActive: false,
      taxRate: 19,
      shippingNet: 0,
      total: 21.4,
    },
  },
  {
    name: 'a zero-decimal currency without regional tax keeps cent-precise goods and total',
    input: {
      config: {},
      store: {
        ...PARITY_STORE,
        deliveryPrice: 500,
        freeDeliveryEnabled: false,
        defaultTaxRate: 10,
      },
      items: [{ id: 'j', price: 999, quantity: 1 }],
      destination: { countryCode: 'JP', countryName: 'Japan', region: '' },
      fulfillment: 'delivery',
      selectedRateId: null,
      currency: 'JPY',
    },
    expected: {
      taxRegional: false,
      taxDecimals: 2,
      goodsGross: 1098.9,
      shippingGross: 500,
      total: 1598.9,
    },
  },
  {
    name: 'a tier with a negative or inverted range is skipped, never read as unbounded',
    input: {
      config: {
        zones: [PARITY_ZONES[1]],
        rates: [
          {
            id: 'r-bad-negative',
            zone_id: 'z-row',
            name: 'Negative bound',
            rate_type: 'price',
            price: 1,
            min_value: null,
            max_value: '-1',
            is_active: true,
            sort_order: 1,
          },
          {
            id: 'r-bad-inverted',
            zone_id: 'z-row',
            name: 'Inverted range',
            rate_type: 'weight',
            price: 2,
            min_value: 50,
            max_value: 20,
            is_active: true,
            sort_order: 2,
          },
          {
            id: 'r-flat',
            zone_id: 'z-row',
            name: 'Flat, stray bounds ignored',
            rate_type: 'flat',
            price: 9,
            min_value: -5,
            max_value: null,
            is_active: true,
            sort_order: 3,
          },
        ],
      },
      store: PARITY_STORE,
      items: [{ id: 'k', price: 10, quantity: 1 }],
      destination: BRAZIL,
      fulfillment: 'delivery',
      selectedRateId: null,
      currency: 'USD',
    },
    expected: {
      status: 'ok',
      options: [{ id: 'r-flat' }],
      selectedRateId: 'r-flat',
      shippingNet: 9,
      total: 21,
    },
  },
  {
    name: 'a region typed with other spacing and case still finds its row',
    input: {
      config: {
        taxRates: [
          PARITY_TAX_RATES[4],
          {
            id: 't-us-ny',
            country_code: 'US',
            region: 'New York',
            category_id: null,
            rate: 4,
            tax_mode: 'added',
            tax_shipping: false,
            is_active: true,
          },
        ],
      },
      store: PARITY_STORE,
      items: [{ id: 'l', price: 100, quantity: 1 }],
      destination: { countryCode: 'US', countryName: 'United States', region: ' new   YORK ' },
      fulfillment: 'delivery',
      selectedRateId: null,
      currency: 'USD',
    },
    expected: {
      taxRate: 4,
      goodsTax: 4,
      shippingIsFree: true,
      total: 104,
    },
  },
]
// ── end of shared parity table ──────────────────────────────────────────────

describe('regional pricing — storefront copy against the shared parity table', () => {
  const api = loadApi()

  // Titled through `%s`: this jest predates `$name` interpolation of object rows.
  it.each(REGIONAL_QUOTE_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    '%s',
    (_name, { input, expected }) => {
      const quote = api.quote({ ...input, config: api.normalize(input.config) })
      expect(quote).toMatchObject(expected)
    }
  )
})

describe('regional pricing — row parsing', () => {
  const api = loadApi()

  it('reads countries from a typed list or a JSON array, keeping only ISO codes', () => {
    expect(api.parseCountries('de, FR;at  it')).toEqual(['DE', 'FR', 'AT', 'IT'])
    expect(api.parseCountries('["us","US","Canada"]')).toEqual(['US'])
    expect(api.parseCountries(null)).toEqual([])
    expect(api.parseCountries('[not json')).toEqual([])
  })

  it('converts every weight unit to kilograms and treats a missing weight as nothing', () => {
    expect(api.weightKg('1500', 'g')).toBe(1.5)
    expect(api.weightKg('1500', 'gr')).toBe(1.5)
    expect(api.weightKg(2, 'lb')).toBeCloseTo(0.90718474, 8)
    expect(api.weightKg(16, 'oz')).toBeCloseTo(0.45359237, 8)
    expect(api.weightKg(3, 'KG')).toBe(3)
    expect(api.weightKg(null, 'kg')).toBe(0)
    expect(api.weightKg(-1, 'kg')).toBe(0)
  })

  it('never throws on a malformed quote input', () => {
    expect(() => api.quote(null)).not.toThrow()
    expect(api.quote(undefined)).toMatchObject({ status: 'ok', total: 0, lines: [] })
  })
})

describe('regional pricing — reading the destination off the checkout form', () => {
  const api = loadApi()
  const CODES = { germany: 'DE', 'united states': 'US' }
  const originalDocument = (global as { document?: unknown }).document

  const mountFields = (fields: Record<string, string>) => {
    ;(global as { document?: unknown }).document = {
      querySelector: (selector: string) => {
        const match = /^\[name="([^"]+)"\]$/.exec(selector)
        const name = match ? match[1] : ''
        return name in fields ? { value: fields[name] } : null
      },
    }
  }

  afterEach(() => {
    ;(global as { document?: unknown }).document = originalDocument
  })

  it('is null anywhere the checkout form is not on the page', () => {
    mountFields({})
    expect(api.readDestination(CODES)).toBeNull()
  })

  it('uses the billing address until the shipping address block is in the page', () => {
    mountFields({ billingCountry: ' Germany ', state: 'Bavaria' })
    expect(api.readDestination(CODES)).toEqual({
      countryCode: 'DE',
      countryName: 'Germany',
      region: 'Bavaria',
    })
  })

  it('uses the shipping address once its block is in the page', () => {
    mountFields({
      billingCountry: 'Germany',
      state: 'Bavaria',
      shippingCountry: 'United States',
      shippingState: 'California',
    })
    expect(api.readDestination(CODES)).toEqual({
      countryCode: 'US',
      countryName: 'United States',
      region: 'California',
    })
  })

  it('accepts a typed ISO code and leaves an unknown country without one', () => {
    mountFields({ billingCountry: 'fr' })
    expect(api.readDestination(CODES)).toMatchObject({ countryCode: 'FR' })
    mountFields({ billingCountry: 'Atlantis' })
    expect(api.readDestination(CODES)).toMatchObject({ countryCode: '' })
  })
})
