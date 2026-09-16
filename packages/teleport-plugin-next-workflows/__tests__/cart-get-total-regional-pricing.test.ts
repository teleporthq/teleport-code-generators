/* tslint:disable:no-eval */
import { cartGetTotal } from '../src/nodes/cart/cart-get-total'
import { resolveHandlerEntryName } from '../src/nodes/types'

/**
 * `cart-get-total` is where the place-order workflow's money comes from, so on
 * a store with shipping zones and tax jurisdictions it re-prices the basket AT
 * SUBMIT — for the address on the checkout form at that moment, from the rows
 * the provider displayed — with the same shared rule the provider uses.
 *
 * A store without the feature must come out exactly as before: no `regional`
 * key, and the untouched single-rate fields.
 */

function evalHandler(code: string): any {
  return eval('(' + code + ')')
}

const runHandler = async () => evalHandler(cartGetTotal.generateHandler())()

function mount(storage: Record<string, unknown>, fields: Record<string, string>): void {
  const store: Record<string, string> = {}
  for (const key of Object.keys(storage)) {
    const value = storage[key]
    store[key] = typeof value === 'string' ? value : JSON.stringify(value)
  }
  ;(global as any).localStorage = {
    getItem: (key: string) => (key in store ? store[key] : null),
  }
  ;(global as any).document = {
    querySelector: (selector: string) => {
      const match = /^\[name="([^"]+)"\]$/.exec(selector)
      const name = match ? match[1] : ''
      return name in fields ? { value: fields[name] } : null
    },
  }
}

afterEach(() => {
  delete (global as any).localStorage
  delete (global as any).document
})

const STORE = {
  deliveryEnabled: true,
  storePickupEnabled: true,
  deliveryPrice: 5,
  freeDeliveryEnabled: false,
  freeDeliveryThreshold: 0,
  defaultTaxRate: 20,
  defaultTaxIncluded: false,
}

const ROWS = {
  zones: [{ id: 'z1', name: 'Germany', countries: 'DE', cod_enabled: 'f', is_active: 't' }],
  rates: [
    { id: 'r1', zone_id: 'z1', name: 'Standard', rate_type: 'flat', price: '10.00' },
    { id: 'r2', zone_id: 'z1', name: 'Express', rate_type: 'flat', price: '20.00', sort_order: 1 },
  ],
  taxRates: [{ id: 't1', country_code: 'DE', rate: '19', tax_mode: 'added', tax_shipping: true }],
}

const CART = [{ id: 'l1', productId: 'p1', price: 100, quantity: 1 }]

const settingsWith = (regional: Record<string, unknown> | null) => ({
  maxQuantityPerProduct: null,
  deliveryConfig: { deliveryPrice: 5, freeDeliveryEnabled: false, freeDeliveryThreshold: 0 },
  taxConfig: { storefrontTaxRate: 20 },
  ...(regional ? { regional } : {}),
})

const REGIONAL = {
  store: STORE,
  currency: 'EUR',
  countryCodes: { germany: 'DE', brazil: 'BR' },
  rows: ROWS,
}

describe('cart-get-total — regional pricing', () => {
  it('stays one function expression whose entry point still resolves', () => {
    const source = cartGetTotal.generateHandler()
    expect(source.trim().startsWith('async function cart_get_total()')).toBe(true)
    expect(resolveHandlerEntryName(source, 'cart-get-total')).toBe('cart_get_total')
  })

  it('adds no regional figures for a store without the feature', async () => {
    mount({ workflow_cart: CART, workflow_cart_settings: settingsWith(null) }, {})
    const out = await runHandler()
    expect(out.regional).toBeUndefined()
    expect(out.tax).toBe(20)
    expect(out.total).toBe(120)
  })

  it("prices the destination read off the form, with the buyer's chosen rate", async () => {
    mount(
      {
        workflow_cart: CART,
        workflow_cart_settings: settingsWith(REGIONAL),
        workflow_shipping_rate: 'r2',
      },
      { billingCountry: 'Germany', state: '' }
    )
    const out = await runHandler()
    expect(out.subtotal).toBe(100)
    expect(out.tax).toBe(19)
    expect(out.total).toBe(119)
    expect(out.regional).toMatchObject({
      status: 'ok',
      destination: { countryCode: 'DE', countryName: 'Germany' },
      zoneName: 'Germany',
      rateName: 'Express',
      codAvailable: false,
      goodsGross: 119,
      shippingNet: 20,
      shippingTax: 3.8,
      shippingGross: 23.8,
      taxRate: 19,
      lines: [{ key: 'l1', productId: 'p1', unitGross: 119, taxRate: 19 }],
    })
  })

  it('reports an address no zone covers as unavailable', async () => {
    mount(
      { workflow_cart: CART, workflow_cart_settings: settingsWith(REGIONAL) },
      { billingCountry: 'Brazil', state: '' }
    )
    const out = await runHandler()
    expect(out.regional).toMatchObject({ status: 'unavailable', shippingGross: 0 })
    // Brazil has no tax row: the store default applies.
    expect(out.tax).toBe(20)
  })

  it('prices the shipping address once its block is on the form', async () => {
    mount(
      { workflow_cart: CART, workflow_cart_settings: settingsWith(REGIONAL) },
      { billingCountry: 'Germany', state: '', shippingCountry: 'Brazil', shippingState: '' }
    )
    const out = await runHandler()
    expect(out.regional).toMatchObject({
      status: 'unavailable',
      destination: { countryCode: 'BR' },
    })
  })

  it('falls back to the single-rate figures while the rows are still loading', async () => {
    mount(
      {
        workflow_cart: CART,
        workflow_cart_settings: settingsWith({ ...REGIONAL, rows: null }),
      },
      { billingCountry: 'Germany', state: '' }
    )
    const out = await runHandler()
    expect(out.tax).toBe(20)
    expect(out.regional).toMatchObject({ status: 'ok', shippingNet: 5, taxRate: 20 })
  })
})
