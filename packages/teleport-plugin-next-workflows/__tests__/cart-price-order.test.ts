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
  paymentMethods: { cashOnDelivery: false, providers: ['stripe'] },
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
  // Every checkout names its payment method; the store above takes Stripe.
  const named = 'paymentMethod' in config ? config : { paymentMethod: 'stripe', ...config }
  try {
    return await handler(named, { __baseUrl: 'http://store.test' })
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
      stockDeltas: { productIds: [], productQtys: [], variantIds: [], variantQtys: [] },
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

// How the buyer pays is the store's to decide, not the browser's: the method
// a checkout names is checked against the methods the store was exported
// with, and an order nobody pays for is never placed as cash on delivery.
describe('cart-price-order payment method', () => {
  const rows = { teleport_products: [product('p1')] }
  const items = [{ productId: 'p1', quantity: 1 }]
  const codStore = {
    ...baseSettings,
    paymentMethods: { cashOnDelivery: true, providers: ['stripe'] },
  }

  it('refuses cash on delivery on a store that only takes online payment', async () => {
    const result = await price({ items, paymentMethod: 'cash_on_delivery' }, rows)
    expect(result).toMatchObject({ priced: false, lines: [] })
    expect(result.reason).toMatch(/payment on delivery/)
    expect(result.paymentMethod).toBeUndefined()
  })

  it('refuses an empty method instead of reading it as cash on delivery', async () => {
    for (const settings of [baseSettings, codStore]) {
      const result = await price({ items, paymentMethod: '' }, rows, settings)
      expect(result).toMatchObject({ priced: false, lines: [] })
      expect(result.reason).toMatch(/Choose a payment method/)
    }
  })

  it('refuses a provider the store has not enabled', async () => {
    const result = await price({ items, paymentMethod: 'paypal' }, rows)
    expect(result).toMatchObject({ priced: false, lines: [] })
    expect(result.reason).toMatch(/isn't available/)
  })

  it('refuses a checkout that does not name its method, and a store snapshot without methods', async () => {
    const handler = loadHandler('cart-price-order', { cartPricingSettings: baseSettings })
    const api = withDataApi(rows)
    try {
      expect(await handler({ items }, { __baseUrl: 'http://store.test' })).toMatchObject({
        priced: false,
        lines: [],
      })
    } finally {
      api.restore()
    }
    const { paymentMethods: _dropped, ...withoutMethods } = baseSettings
    expect(await price({ items, paymentMethod: 'stripe' }, rows, withoutMethods)).toMatchObject({
      priced: false,
    })
  })

  it('accepts cash on delivery where the store takes it, and an enabled provider, and says which', async () => {
    const cod = await price({ items, paymentMethod: 'cash_on_delivery' }, rows, codStore)
    expect(cod).toMatchObject({ priced: true, paymentMethod: 'cash_on_delivery' })
    const online = await price({ items, paymentMethod: ' stripe ' }, rows)
    expect(online).toMatchObject({ priced: true, paymentMethod: 'stripe' })
  })
})

// The address the order is priced for is the address it records: the step
// hands back the form and the ship-to-different flag it priced.
describe('cart-price-order priced address', () => {
  it('echoes the form and the flag it priced, and nothing for an order it refused', async () => {
    const form = {
      addressLine1: '1 Billing Street',
      billingCountry: 'Canada',
      shippingCountry: 'Germany',
    }
    const result = await price(
      { items: [{ productId: 'p1', quantity: 1 }], form, shipToDifferent: 'true' },
      { teleport_products: [product('p1')] }
    )
    expect(result).toMatchObject({ priced: true, pricedForm: form, pricedShipToDifferent: 'true' })
    const refused = await price({ items: [{ productId: 'gone', quantity: 1 }], form }, {})
    expect(refused.pricedForm).toBeUndefined()
  })
})

// What the order takes from stock, read off the lines priced here: the
// statement that reserves stock with the order binds these four arrays.
describe('cart-price-order stock deltas', () => {
  it('sums lines per product and per variant, a variant line never counting for its product', async () => {
    const result = await price(
      {
        items: [
          { productId: 'p1', quantity: 2 },
          { productId: 'p1', quantity: 3 },
          { productId: 'p2', variantId: 'v1', quantity: 1 },
          { productId: 'p2', variantId: 'v1', quantity: 4 },
          { productId: 'p2', variantId: 'v2', quantity: 0 },
        ],
      },
      {
        teleport_products: [product('p1'), product('p2')],
        teleport_product_variants: [
          { id: 'v1', product_id: 'p2', price: 10 },
          { id: 'v2', product_id: 'p2', price: 10 },
        ],
      }
    )
    expect(result.priced).toBe(true)
    expect(result.stockDeltas).toEqual({
      productIds: ['p1'],
      productQtys: [5],
      variantIds: ['v1', 'v2'],
      variantQtys: [5, 1],
    })
  })

  it('takes nothing from stock for an order it refused', async () => {
    const result = await price({ items: [{ productId: 'gone', quantity: 1 }] }, {})
    expect(result.stockDeltas).toEqual({
      productIds: [],
      productQtys: [],
      variantIds: [],
      variantQtys: [],
    })
  })
})

// Orders that reserved stock but never reached a payment page get no provider
// event: the checkout's server step releases them itself, at most once per
// instance every five minutes, in the background where the runtime allows.
describe('cart-price-order releases stalled reservations', () => {
  const rows = { teleport_products: [product('p1')] }
  const items = [{ productId: 'p1', quantity: 1 }]
  const scope = globalThis as any
  const vercel = process.env.VERCEL
  const RECORD = JSON.stringify({ stockReservation: [{ kind: 'product', id: 'p1', qty: 1 }] })
  afterEach(() => {
    delete scope.__tqReservationSweepAt
    delete scope.__tqWaitUntil
    delete scope.__tqUnreadableReservations
    if (vercel === undefined) {
      delete process.env.VERCEL
    } else {
      process.env.VERCEL = vercel
    }
  })

  const run = async (
    settings: unknown,
    pass?: () => Promise<unknown>,
    refuse?: (query: string) => string | undefined,
    candidates: Array<{ id: string; metadata: string }> = [{ id: 'o-1', metadata: RECORD }]
  ) => {
    const handler = loadHandler('cart-price-order', { cartPricingSettings: settings })
    const original = scope.fetch
    const sent: Array<{ url: string; body: any }> = []
    scope.fetch = async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body)
      sent.push({ url, body })
      if (/\/raw-query$/.test(url)) {
        const code = refuse ? refuse(body.query) : undefined
        if (code) {
          return { ok: false, status: 500, json: async () => ({ error: 'Raw query failed', code }) }
        }
        if (/^SELECT o\.id::text AS id, o\.metadata/.test(body.query)) {
          return { ok: true, json: async () => ({ rows: candidates }) }
        }
        const released = pass ? await pass() : undefined
        return { ok: true, json: async () => ({ rows: [{ released: String(released || 0) }] }) }
      }
      const result = (rows as any)[body.tableName] || []
      return { ok: true, json: async () => ({ rows: result }) }
    }
    try {
      const result: any = await handler(
        { items, paymentMethod: 'stripe' },
        { __baseUrl: 'http://store.test' }
      )
      return {
        result,
        passes: sent.filter(
          (call) => /\/raw-query$/.test(call.url) && /^WITH stale AS \(/.test(call.body.query)
        ),
        listings: sent.filter(
          (call) => /\/raw-query$/.test(call.url) && /^SELECT o\.id::text/.test(call.body.query)
        ),
      }
    } finally {
      scope.fetch = original
    }
  }

  it('runs one release pass, then none for five minutes', async () => {
    const settings = { ...baseSettings, releaseStalledReservations: true }
    const first = await run(settings)
    expect(first.result.priced).toBe(true)
    expect(first.passes).toHaveLength(1)
    expect(first.passes[0].url).toBe('http://store.test/api/data/ds-1/raw-query')
    expect(first.passes[0].body.query).toMatch(/^WITH stale AS \(/)
    expect(first.passes[0].body.query).toContain('FOR UPDATE SKIP LOCKED')
    expect((await run(settings)).passes).toHaveLength(0)
    scope.__tqReservationSweepAt = Date.now() - 5 * 60 * 1000 - 1
    expect((await run(settings)).passes).toHaveLength(1)
  })

  it('never waits for the pass on a long-running server', async () => {
    delete process.env.VERCEL
    const stuck = await run(
      { ...baseSettings, releaseStalledReservations: true },
      () => new Promise(() => undefined)
    )
    expect(stuck.result.priced).toBe(true)
    expect(stuck.passes).toHaveLength(1)
  })

  it('on Vercel hands the pass to waitUntil when the app has one, else waits for it', async () => {
    process.env.VERCEL = '1'
    const kept: unknown[] = []
    scope.__tqWaitUntil = (promise: unknown) => kept.push(promise)
    const stuck = await run(
      { ...baseSettings, releaseStalledReservations: true },
      () => new Promise(() => undefined)
    )
    expect(stuck.result.priced).toBe(true)
    expect(kept).toHaveLength(1)

    delete scope.__tqWaitUntil
    delete scope.__tqReservationSweepAt
    let finished = false
    const waited = await run({ ...baseSettings, releaseStalledReservations: true }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      finished = true
    })
    expect(waited.passes).toHaveLength(1)
    expect(finished).toBe(true)
  })

  it('runs the next pass at once while a pass releases a full batch', async () => {
    process.env.VERCEL = '1'
    const settings = { ...baseSettings, releaseStalledReservations: true }
    expect((await run(settings, async () => 10)).passes).toHaveLength(1)
    expect((await run(settings, async () => 3)).passes).toHaveLength(1)
    expect((await run(settings)).passes).toHaveLength(0)
  })

  it("logs each released order, and still releases where the store's ledger is older or missing", async () => {
    process.env.VERCEL = '1'
    const settings = { ...baseSettings, releaseStalledReservations: true }
    const logged = await run(settings)
    expect(logged.passes).toHaveLength(1)
    expect(logged.passes[0].body.query).toContain(
      'INSERT INTO teleport_events (event_type, dedupe_key, order_id, entity_type'
    )

    delete scope.__tqReservationSweepAt
    const older = await run(settings, undefined, (query) =>
      query.includes('entity_type') ? '42703' : undefined
    )
    expect(older.passes).toHaveLength(2)
    expect(older.passes[1].body.query).toContain(
      'INSERT INTO teleport_events (event_type, dedupe_key, order_id, payload'
    )

    delete scope.__tqReservationSweepAt
    const missing = await run(settings, undefined, (query) =>
      query.includes('teleport_events') ? '42P01' : undefined
    )
    expect(missing.passes).toHaveLength(3)
    expect(missing.passes[2].body.query).not.toContain('teleport_events')

    // Any other failure (a deadlock victim, a timeout) waits for the next pass.
    delete scope.__tqReservationSweepAt
    expect(
      (await run(settings, undefined, (query) => (/^WITH stale/.test(query) ? '40P01' : undefined)))
        .passes
    ).toHaveLength(1)
  })

  it('releases only orders whose metadata it could read, and logs each unreadable one once', async () => {
    process.env.VERCEL = '1'
    const settings = { ...baseSettings, releaseStalledReservations: true }
    const candidates = [
      { id: 'o-1', metadata: RECORD },
      { id: 'o-2', metadata: '{"stockReservation": [{"kind": "product"' },
      { id: 'o-3', metadata: JSON.stringify({ billingDetails: { stockReservation: 'yes' } }) },
      { id: 'o-4', metadata: RECORD },
    ]
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const first = await run(settings, undefined, undefined, candidates)
      expect(first.listings).toHaveLength(1)
      expect(first.listings[0].body.query).toContain('LIMIT 50')
      expect(first.listings[0].body.query).not.toContain('FOR UPDATE')
      expect(first.passes).toHaveLength(1)
      expect(first.passes[0].body.params).toEqual([['o-1', 'o-4']])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain(
        'order o-2 has metadata that is not valid JSON'
      )

      delete scope.__tqReservationSweepAt
      await run(settings, undefined, undefined, candidates)
      expect(warn).toHaveBeenCalledTimes(1)

      delete scope.__tqReservationSweepAt
      const none = await run(settings, undefined, undefined, [candidates[1], candidates[2]])
      expect(none.passes).toHaveLength(0)
    } finally {
      warn.mockRestore()
    }
  })

  it('never runs the pass where stock is not reserved', async () => {
    expect((await run(baseSettings)).passes).toHaveLength(0)
  })

  it('still prices the order when the pass fails', async () => {
    const handler = loadHandler('cart-price-order', {
      cartPricingSettings: { ...baseSettings, releaseStalledReservations: true },
    })
    const original = scope.fetch
    scope.fetch = async (url: string, init: { body: string }) => {
      if (/\/raw-query$/.test(url)) {
        throw new Error('connection reset')
      }
      const body = JSON.parse(init.body)
      return { ok: true, json: async () => ({ rows: (rows as any)[body.tableName] || [] }) }
    }
    try {
      const result: any = await handler(
        { items, paymentMethod: 'stripe' },
        { __baseUrl: 'http://store.test' }
      )
      expect(result.priced).toBe(true)
    } finally {
      scope.fetch = original
    }
  })
})
