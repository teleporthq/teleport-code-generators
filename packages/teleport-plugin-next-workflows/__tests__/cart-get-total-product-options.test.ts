/* tslint:disable:no-eval function-constructor */
import { cartGetTotal } from '../src/nodes/cart/cart-get-total'
import { cartUpdateItemQuantity } from '../src/nodes/cart/cart-update-item-quantity'
import { cartRemoveItem } from '../src/nodes/cart/cart-remove-item'
import { cartGetItems } from '../src/nodes/cart/cart-get-items'
import { cartClear } from '../src/nodes/cart/cart-clear'

/**
 * Configured lines need nothing new from the cart totals: a line's `price` is
 * already the NET unit price charged — the charged base plus the options'
 * surcharge — so the subtotal, the storefront tax and the regional quote price
 * it like any other line, and `productDiscountTotal` (which reads only the
 * base's `discountAmount`) counts the base saving alone. Two configurations of
 * one product are two lines, each changed and removed by its own id; reading
 * and clearing the cart need no change either.
 */

function evalHandler(code: string): any {
  return eval('(' + code + ')')
}

const runTotal = async () => evalHandler(cartGetTotal.generateHandler())()

const load = (generator: { generateHandler: () => string }, entry: string) =>
  new Function('config', `${generator.generateHandler()}\nreturn ${entry}(config)`) as (
    config: Record<string, unknown>
  ) => Promise<unknown>

function mount(storage: Record<string, unknown>, fields: Record<string, string> = {}) {
  const store: Record<string, string> = {}
  for (const key of Object.keys(storage)) {
    const value = storage[key]
    store[key] = typeof value === 'string' ? value : JSON.stringify(value)
  }
  ;(global as any).localStorage = {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value
    },
  }
  ;(global as any).window = { dispatchEvent: () => true }
  ;(global as any).CustomEvent = function CustomEvent() {
    return {}
  }
  ;(global as any).document = {
    querySelector: (selector: string) => {
      const match = /^\[name="([^"]+)"\]$/.exec(selector)
      const name = match ? match[1] : ''
      return name in fields ? { value: fields[name] } : null
    },
  }
  return store
}

afterEach(() => {
  delete (global as any).localStorage
  delete (global as any).window
  delete (global as any).CustomEvent
  delete (global as any).document
})

// The worked print example: base $10 with a 10% product discount (charged base
// 9), A3 +9 and Glossy-on-A3 +8 → 26 per unit; A5 Matte adds nothing.
const PRINT_LINES = [
  {
    id: 'l-a3',
    productId: 'print',
    quantity: 2,
    price: 26,
    basePrice: 9,
    configuration: '[{"key":"paper","value":"glossy"},{"key":"size","value":"a3"}]',
    configurationKey: '0123456789abcdef',
    configurationLabel: 'Size: A3 · Paper: Glossy',
    configurationPriceDelta: 17,
    originalPrice: 27,
    discountType: 'percentage',
    discountValue: 10,
    discountAmount: 1,
  },
  {
    id: 'l-a5',
    productId: 'print',
    quantity: 1,
    price: 9,
    basePrice: 9,
    configuration: '[{"key":"paper","value":"matte"},{"key":"size","value":"a5"}]',
    configurationKey: 'fedcba9876543210',
    configurationLabel: 'Size: A5 · Paper: Matte',
    configurationPriceDelta: 0,
    originalPrice: 10,
    discountType: 'percentage',
    discountValue: 10,
    discountAmount: 1,
  },
]

const SETTINGS = {
  maxQuantityPerProduct: null,
  deliveryConfig: { deliveryPrice: 0, freeDeliveryEnabled: false, freeDeliveryThreshold: 0 },
  taxConfig: { storefrontTaxRate: 20 },
}

describe('cart-get-total — configured lines', () => {
  it('totals each configured line at its own price, taxed per unit', async () => {
    mount({ workflow_cart: PRINT_LINES, workflow_cart_settings: SETTINGS })
    const out = await runTotal()
    expect(out.subtotal).toBe(61)
    // 26 → 31.20 gross per unit, 9 → 10.80.
    expect(out.total).toBe(73.2)
    expect(out.tax).toBe(12.2)
    expect(out.itemCount).toBe(3)
  })

  it('counts the product discount on the base only, never on the options', async () => {
    mount({ workflow_cart: PRINT_LINES, workflow_cart_settings: SETTINGS })
    expect((await runTotal()).productDiscountTotal).toBe(3)
  })

  it('quotes a regional line per configured line', async () => {
    mount(
      {
        workflow_cart: PRINT_LINES,
        workflow_cart_settings: {
          ...SETTINGS,
          regional: {
            store: {
              deliveryEnabled: true,
              storePickupEnabled: false,
              deliveryPrice: 0,
              freeDeliveryEnabled: false,
              freeDeliveryThreshold: 0,
              defaultTaxRate: 20,
              defaultTaxIncluded: false,
            },
            currency: 'EUR',
            countryCodes: { germany: 'DE' },
            rows: {
              zones: [{ id: 'z1', name: 'DE', countries: 'DE', is_active: 't' }],
              rates: [{ id: 'r1', zone_id: 'z1', name: 'Std', rate_type: 'flat', price: '0' }],
              taxRates: [{ id: 't1', country_code: 'DE', rate: '19', tax_mode: 'added' }],
            },
          },
        },
      },
      { billingCountry: 'Germany', state: '' }
    )
    const out = await runTotal()
    expect(out.regional.lines).toMatchObject([
      { key: 'l-a3', productId: 'print', unitGross: 30.94, taxRate: 19 },
      { key: 'l-a5', productId: 'print', unitGross: 10.71, taxRate: 19 },
    ])
  })
})

describe('cart line changes by id — two configurations of one product', () => {
  it('increments only the line it names', async () => {
    const store = mount({ workflow_cart: PRINT_LINES })
    await load(
      cartUpdateItemQuantity,
      'cart_update_item_quantity'
    )({
      itemId: 'l-a5',
      quantity: 2,
      updateMode: 'increment',
    })
    const cart = JSON.parse(store.workflow_cart)
    expect(cart.map((line: { quantity: number }) => line.quantity)).toEqual([2, 3])
    expect(cart[1].configurationKey).toBe('fedcba9876543210')
  })

  it('removes only the line it names', async () => {
    const store = mount({ workflow_cart: PRINT_LINES })
    await load(cartRemoveItem, 'cart_remove_item')({ itemId: 'l-a3' })
    const cart = JSON.parse(store.workflow_cart)
    expect(cart.map((line: { id: string }) => line.id)).toEqual(['l-a5'])
  })
})

describe('cart-get-items and cart-clear — configured lines', () => {
  it('hands the workflow every configured line as stored, at its own price', async () => {
    mount({ workflow_cart: PRINT_LINES })
    expect(await load(cartGetItems, 'cart_get_items')({})).toEqual({
      items: PRINT_LINES,
      itemCount: 3,
      subtotal: 61,
      currency: '',
    })
  })

  it('clears every configuration', async () => {
    const store = mount({ workflow_cart: PRINT_LINES })
    expect(await load(cartClear, 'cart_clear')({})).toEqual({ success: true })
    expect(JSON.parse(store.workflow_cart)).toEqual([])
  })
})
