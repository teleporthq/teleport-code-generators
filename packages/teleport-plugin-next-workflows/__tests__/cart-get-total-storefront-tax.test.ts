/* tslint:disable:no-eval */
import { cartGetTotal } from '../src/nodes/cart/cart-get-total'

/**
 * The merchant's "Invoices → Tax → Added on top" setting decides what a buyer
 * actually pays. `teleport_products.price` is the NET price in that mode, so
 * the storefront has to add the tax at every point a price is shown or charged
 * — and `cart-get-total` is the point the PLACE-ORDER workflow charges from.
 *
 * Three contracts are locked in here, each of which silently breaks money:
 *
 *  1. `subtotal` stays NET. Two generations of baked place-order workflows read
 *     it and add shipping to produce `teleport_orders.total_amount`. If a NEW
 *     handler made it gross, an OLD baked workflow would write a taxed order
 *     total while still emitting untaxed payment line items — and Stripe
 *     Checkout totals `line_items` and ignores the top-level amount, so the
 *     buyer would be undercharged.
 *  2. `tax` is `gross − net`, never a fresh percentage of the sum, so
 *     `net line items + tax` reconciles to `total` to the cent.
 *  3. Rounding is PER UNIT, matching `EcommerceProvider`'s
 *     `cartItemDisplayPrice`, so the amount charged equals the Subtotal the
 *     cart page printed.
 */

function evalHandler(code: string): any {
  return eval('(' + code + ')')
}

interface StoredSettings {
  maxQuantityPerProduct?: number | null
  deliveryConfig?: unknown
  taxConfig?: { storefrontTaxRate: number }
}

function withLocalStorage(cart: unknown, settings: StoredSettings | null): void {
  const store: Record<string, string> = { workflow_cart: JSON.stringify(cart) }
  if (settings) {
    store.workflow_cart_settings = JSON.stringify(settings)
  }
  ;(global as any).localStorage = {
    getItem: (key: string) => (key in store ? store[key] : null),
  }
}

const runHandler = async () => evalHandler(cartGetTotal.generateHandler())()

afterEach(() => {
  delete (global as any).localStorage
})

describe('cart-get-total — storefront tax', () => {
  it('leaves every total untouched when no tax config is stored (legacy storefront)', async () => {
    withLocalStorage([{ price: 100, quantity: 2 }], { maxQuantityPerProduct: null })

    const out = await runHandler()

    expect(out.subtotal).toBe(200)
    expect(out.tax).toBe(0)
    expect(out.total).toBe(200)
    expect(out.itemCount).toBe(2)
    expect(out.taxConfig).toEqual({ storefrontTaxRate: 0 })
  })

  it('leaves every total untouched when the rate is zero', async () => {
    withLocalStorage([{ price: 100, quantity: 2 }], { taxConfig: { storefrontTaxRate: 0 } })

    const out = await runHandler()

    expect(out.subtotal).toBe(200)
    expect(out.tax).toBe(0)
    expect(out.total).toBe(200)
  })

  it('keeps subtotal NET and reports the tax separately', async () => {
    withLocalStorage([{ price: 100, quantity: 2 }], { taxConfig: { storefrontTaxRate: 19 } })

    const out = await runHandler()

    expect(out.subtotal).toBe(200)
    expect(out.tax).toBe(38)
    expect(out.total).toBe(238)
  })

  it('rounds per unit, so the charge matches the cart page line by line', async () => {
    // 19.99 net → 23.79 gross per unit → 71.37 for three.
    // Rounding the SUM instead would give 71.36 and disagree with the page.
    withLocalStorage([{ price: 19.99, quantity: 3 }], { taxConfig: { storefrontTaxRate: 19 } })

    const out = await runHandler()

    expect(out.subtotal).toBe(59.97)
    expect(out.total).toBe(71.37)
    expect(out.tax).toBe(11.4)
  })

  it('reconciles: net line items + tax === total, for a mixed basket', async () => {
    withLocalStorage(
      [
        { price: 19.99, quantity: 3 },
        { price: 5.5, quantity: 1 },
        { price: 100, quantity: 2 },
      ],
      { taxConfig: { storefrontTaxRate: 7.5 } }
    )

    const out = await runHandler()

    // This is the invariant the payment line items depend on: the provider is
    // sent NET item lines plus one "Tax" line, and their sum has to be the
    // order's goods total to the cent.
    expect(out.subtotal + out.tax).toBeCloseTo(out.total, 10)
    // net 59.97 + 5.50 + 200.00
    expect(out.subtotal).toBe(265.47)
    // per-unit gross 21.49×3 + 5.91 + 107.50×2
    expect(out.total).toBe(285.38)
    expect(out.tax).toBe(19.91)
  })

  it('still surfaces the delivery config alongside the tax config', async () => {
    withLocalStorage([{ price: 10, quantity: 1 }], {
      deliveryConfig: { deliveryPrice: 15, freeDeliveryEnabled: true, freeDeliveryThreshold: 50 },
      taxConfig: { storefrontTaxRate: 19 },
    })

    const out = await runHandler()

    expect(out.deliveryConfig).toEqual({
      deliveryPrice: 15,
      freeDeliveryEnabled: true,
      freeDeliveryThreshold: 50,
    })
    expect(out.taxConfig).toEqual({ storefrontTaxRate: 19 })
  })

  it('ignores a malformed or negative rate instead of corrupting the charge', async () => {
    withLocalStorage([{ price: 100, quantity: 1 }], {
      taxConfig: { storefrontTaxRate: -5 },
    })
    expect((await runHandler()).total).toBe(100)

    withLocalStorage([{ price: 100, quantity: 1 }], {
      taxConfig: { storefrontTaxRate: 'nonsense' as unknown as number },
    })
    expect((await runHandler()).total).toBe(100)
  })

  it('returns a fully zeroed shape when localStorage is unreadable', async () => {
    ;(global as any).localStorage = {
      getItem: () => {
        throw new Error('denied')
      },
    }

    const out = await runHandler()

    expect(out).toEqual({
      subtotal: 0,
      tax: 0,
      total: 0,
      itemCount: 0,
      deliveryConfig: null,
      taxConfig: { storefrontTaxRate: 0 },
    })
  })
})
