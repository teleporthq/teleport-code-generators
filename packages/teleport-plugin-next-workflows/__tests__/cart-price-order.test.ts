import { loadHandler } from './_helpers/load-handler'

// The checkout's server pricing step. A cart line's price, the storefront tax,
// the delivery fee and every discount come from the database and the store's
// baked settings — never from what the browser says the line costs. These run
// the EMITTED handler against a stubbed data API.

type Rows = Record<string, unknown[]>

const baseSettings = {
  dataSourceId: 'ds-1',
  deliveryConfig: {
    deliveryEnabled: true,
    storePickupEnabled: false,
    deliveryPrice: 5,
    freeDeliveryEnabled: true,
    freeDeliveryThreshold: 200,
  },
  taxConfig: { storefrontTaxRate: 0 },
  vouchersEnabled: true,
  subscriptions: { enabled: false, providers: [] },
  paymentKinds: {},
  regional: null,
  discounts: null,
  giftCards: null,
}

const product = (id: string, fields: Record<string, unknown> = {}) => ({
  id,
  name: 'Product ' + id,
  price: 50,
  status: 'active',
  ...fields,
})

function withDataApi(rows: Rows, failTable?: string): { restore: () => void; calls: string[] } {
  const original = (globalThis as any).fetch
  const calls: string[] = []
  ;(globalThis as any).fetch = async (_url: string, init: { body: string; headers: any }) => {
    const body = JSON.parse(init.body)
    calls.push(body.tableName)
    if (body.tableName === failTable) {
      return { ok: false, json: async () => ({}) }
    }
    let result = rows[body.tableName] || []
    const filter = (body.filters || [])[0]
    if (filter && Array.isArray(filter.value)) {
      result = result.filter((row: any) => filter.value.indexOf(String(row[filter.field])) !== -1)
    }
    return { ok: true, json: async () => ({ rows: result }) }
  }
  return {
    calls,
    restore: () => {
      ;(globalThis as any).fetch = original
    },
  }
}

async function price(
  config: Record<string, unknown>,
  rows: Rows,
  settings: unknown = baseSettings,
  failTable?: string
): Promise<any> {
  const handler = loadHandler('cart-price-order', { cartPricingSettings: settings })
  const api = withDataApi(rows, failTable)
  try {
    return await handler(config, { __baseUrl: 'http://store.test' })
  } finally {
    api.restore()
  }
}

describe('cart-price-order', () => {
  it('prices every line from its product row, whatever the browser says it costs', async () => {
    const result = await price(
      { items: [{ id: 'l1', productId: 'p1', quantity: 2, price: 0.01 }] },
      { teleport_products: [product('p1')] }
    )
    expect(result.priced).toBe(true)
    expect(result.lines[0].price).toBe(50)
    expect(result.subtotal).toBe(100)
    expect(result.total).toBe(100)
  })

  it('applies the markdown live right now, and the storefront tax on top', async () => {
    const discounts = JSON.stringify([
      { type: 'percentage', value: 20, startsAt: null, endsAt: null },
    ])
    const result = await price(
      { items: [{ productId: 'p1', quantity: 1, price: 50 }] },
      { teleport_products: [product('p1', { discounts })] },
      { ...baseSettings, taxConfig: { storefrontTaxRate: 10 } }
    )
    expect(result.lines[0].price).toBe(40)
    expect(result.lines[0].discountAmount).toBe(10)
    expect(result.subtotal).toBe(40)
    expect(result.tax).toBe(4)
    expect(result.total).toBe(44)
  })

  it('prices a variant line at the variant, and only a variant of its own product', async () => {
    const rows = {
      teleport_products: [product('p1'), product('p2', { price: 1 })],
      teleport_product_variants: [
        { id: 'v1', product_id: 'p1', price: 70, options: {} },
        { id: 'v2', product_id: 'p2', price: 1, options: {} },
      ],
    }
    const own = await price({ items: [{ productId: 'p1', variantId: 'v1', quantity: 1 }] }, rows)
    expect(own.lines[0].price).toBe(70)
    const foreign = await price(
      { items: [{ productId: 'p1', variantId: 'v2', quantity: 1 }] },
      rows
    )
    expect(foreign).toMatchObject({ priced: false })
    expect(foreign.reason).toMatch(/no longer available/)
  })

  it('refuses a product that is not for sale, a missing product and an empty cart', async () => {
    expect(
      await price(
        { items: [{ productId: 'p1', quantity: 1 }] },
        { teleport_products: [product('p1', { status: 'draft' })] }
      )
    ).toMatchObject({ priced: false })
    expect(
      await price({ items: [{ productId: 'gone', quantity: 1 }] }, { teleport_products: [] })
    ).toMatchObject({
      priced: false,
    })
    expect(await price({ items: [] }, {})).toMatchObject({
      priced: false,
      reason: 'Your cart is empty.',
    })
  })

  it('refuses to price without the store settings or when the database cannot be read', async () => {
    const items = [{ productId: 'p1', quantity: 1 }]
    expect(await price({ items }, { teleport_products: [product('p1')] }, null)).toMatchObject({
      priced: false,
    })
    expect(
      await price(
        { items },
        { teleport_products: [product('p1')] },
        baseSettings,
        'teleport_products'
      )
    ).toMatchObject({ priced: false })
  })

  it("records the order in its products' currency, read off the rows, never the browser's", async () => {
    const result = await price(
      { items: [{ productId: 'p1', quantity: 1, currency: 'USD' }] },
      { teleport_products: [product('p1', { currency: 'ron' })] }
    )
    expect(result).toMatchObject({ priced: true, currency: 'RON' })
    expect(result.lines[0]).toMatchObject({ currency: 'RON' })
    // A product that names no currency leaves the order to the store's.
    const unnamed = await price(
      { items: [{ productId: 'p1', quantity: 1, currency: 'EUR' }] },
      { teleport_products: [product('p1')] }
    )
    expect(unnamed).toMatchObject({ priced: true, currency: '' })
  })

  it('refuses a cart whose products are priced in more than one currency', async () => {
    const result = await price(
      {
        items: [
          { productId: 'p1', quantity: 1, currency: 'USD' },
          { productId: 'p2', quantity: 1, currency: 'USD' },
          { productId: 'p3', quantity: 1, currency: 'USD' },
        ],
      },
      {
        teleport_products: [
          product('p1', { currency: 'USD' }),
          product('p2', { currency: 'EUR' }),
          product('p3', { currency: 'RON' }),
        ],
      }
    )
    expect(result).toEqual({
      priced: false,
      reason:
        'Your cart holds products priced in USD, EUR and RON. Each currency needs its own order: remove the products priced in one of them and try again.',
      lines: [],
    })
  })

  it('reports the store delivery settings the order is charged from', async () => {
    const result = await price(
      { items: [{ productId: 'p1', quantity: 1 }] },
      { teleport_products: [product('p1')] }
    )
    expect(result.deliveryConfig).toMatchObject({ deliveryPrice: 5, freeDeliveryThreshold: 200 })
  })

  it('prices the voucher the database confirmed, never the browser copy', async () => {
    const result = await price(
      {
        items: [{ productId: 'p1', quantity: 2 }],
        voucherCheck: {
          voucherRow: {
            id: 'vc1',
            code: 'TEN',
            discount_type: 'percentage',
            discount_value: 10,
            is_active: 'true',
          },
        },
        clientTotal: { voucher: { code: 'TEN', discount_type: 'percentage', discount_value: 100 } },
      },
      { teleport_products: [product('p1')] },
      { ...baseSettings, discounts: { automaticDiscounts: false } }
    )
    expect(result.priced).toBe(true)
    expect(result.discounts.voucherDiscount).toBe(10)
  })

  it('applies the gift card the database confirmed as tender', async () => {
    const result = await price(
      {
        items: [{ productId: 'p1', quantity: 2 }],
        giftCardCheck: {
          ok: 'true',
          giftCardRow: { id: 'g1', code: 'ABCD1234', balance: 30, currency: 'USD' },
        },
      },
      { teleport_products: [product('p1')] },
      { ...baseSettings, giftCards: { currency: 'USD', recurringTender: false } }
    )
    expect(result.giftCard).toMatchObject({ id: 'g1', amount: 30 })
    expect(result.displayedAmountDue).toBe(75)
  })

  it('prices shipping and tax for the address the order ships to', async () => {
    const regional = {
      store: { ...baseSettings.deliveryConfig, defaultTaxRate: 0, defaultTaxIncluded: false },
      currency: 'EUR',
      countryCodes: { romania: 'RO', germany: 'DE' },
      storeCountryCode: 'RO',
    }
    const rows = {
      teleport_products: [product('p1')],
      teleport_shipping_zones: [],
      teleport_shipping_rates: [],
      teleport_tax_rates: [
        {
          id: 't1',
          country_code: 'DE',
          region: '',
          rate: 19,
          tax_included: 'added',
          is_active: 'true',
        },
      ],
    }
    const toGermany = await price(
      {
        items: [{ productId: 'p1', quantity: 1 }],
        form: { billingCountry: 'Romania', shippingCountry: 'Germany' },
        shipToDifferent: 'true',
      },
      rows,
      { ...baseSettings, regional }
    )
    expect(toGermany.regional.destination).toMatchObject({ countryCode: 'DE' })
    const toBilling = await price(
      {
        items: [{ productId: 'p1', quantity: 1 }],
        form: { billingCountry: 'Romania', shippingCountry: 'Germany' },
        shipToDifferent: 'false',
      },
      rows,
      { ...baseSettings, regional }
    )
    expect(toBilling.regional.destination).toMatchObject({ countryCode: 'RO' })
  })
})
