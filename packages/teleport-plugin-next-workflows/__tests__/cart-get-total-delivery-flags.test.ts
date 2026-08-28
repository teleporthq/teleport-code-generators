/* tslint:disable:no-eval */
import { cartGetTotal } from '../src/nodes/cart/cart-get-total'

/**
 * `cart-get-total` is the ONLY channel by which the place-order workflow learns
 * the merchant's CURRENT delivery settings: the workflow's assemble script is
 * baked once, when the checkout page is built, while `EcommerceProvider`
 * re-writes `workflow_cart_settings` on every page load.
 *
 * Two of those settings decide whether a delivery fee may be charged at all —
 * whether the store delivers, and whether it offers store pickup — so they have
 * to survive the trip. And they have to survive it as `undefined` when the
 * storefront predates them: reading a missing flag as `false` would silently
 * stop charging delivery on a store that does deliver.
 */

function evalHandler(code: string): any {
  return eval('(' + code + ')')
}

function withStoredSettings(settings: Record<string, unknown> | null): void {
  const store: Record<string, string> = {
    workflow_cart: JSON.stringify([{ price: 100, quantity: 1 }]),
  }
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

describe('cart-get-total — fulfilment flags', () => {
  it('surfaces deliveryEnabled and storePickupEnabled from the stored snapshot', async () => {
    withStoredSettings({
      deliveryConfig: {
        deliveryPrice: 10,
        freeDeliveryEnabled: false,
        freeDeliveryThreshold: 0,
        deliveryEnabled: false,
        storePickupEnabled: true,
      },
    })

    const out = await runHandler()

    expect(out.deliveryConfig).toEqual({
      deliveryPrice: 10,
      freeDeliveryEnabled: false,
      freeDeliveryThreshold: 0,
      deliveryEnabled: false,
      storePickupEnabled: true,
    })
  })

  it('leaves the flags absent when the storefront predates them', async () => {
    // The assemble script distinguishes absent from false and falls back to its
    // own build-time snapshot — asserting the keys are missing, not `false`.
    withStoredSettings({
      deliveryConfig: {
        deliveryPrice: 10,
        freeDeliveryEnabled: false,
        freeDeliveryThreshold: 0,
      },
    })

    const out = await runHandler()

    expect('deliveryEnabled' in out.deliveryConfig).toBe(false)
    expect('storePickupEnabled' in out.deliveryConfig).toBe(false)
  })

  it('returns a null deliveryConfig when nothing is stored at all', async () => {
    withStoredSettings(null)

    const out = await runHandler()

    expect(out.deliveryConfig).toBeNull()
  })
})
