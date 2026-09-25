/* tslint:disable:function-constructor */
import { cartUpdateItemQuantity } from '../src/nodes/cart/cart-update-item-quantity'

/**
 * A subscription is ONE unit: the provider bills the plan, not a quantity.
 * The cart page hides the stepper for such a line, but nothing stops a
 * workflow from asking — so the node itself keeps the line at one, whatever
 * the mode, and still lets it be removed.
 */

type Handler = (config: Record<string, unknown>) => Promise<{ id: string; quantity: number }>

function loadHandler(store: Record<string, string>): Handler {
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
  const source = cartUpdateItemQuantity.generateHandler()
  return new Function('config', `${source}\nreturn cart_update_item_quantity(config)`) as Handler
}

const storeWith = (line: Record<string, unknown>): Record<string, string> => ({
  workflow_cart: JSON.stringify([
    { id: 'cart_1', productId: 'p1', quantity: 1, price: 10, ...line },
  ]),
})

const storedQuantity = (store: Record<string, string>): number | undefined =>
  JSON.parse(store.workflow_cart)[0]?.quantity

afterEach(() => {
  delete (global as any).localStorage
  delete (global as any).window
  delete (global as any).CustomEvent
})

describe('cart-update-item-quantity — a subscription stays at one unit', () => {
  it('ignores an increment, however the flag is spelled', async () => {
    for (const isRecurring of [true, 'true']) {
      const store = storeWith({ isRecurring })
      const out = await loadHandler(store)({
        itemId: 'cart_1',
        quantity: 1,
        updateMode: 'increment',
      })
      expect(out).toEqual({ id: 'cart_1', quantity: 1 })
      expect(storedQuantity(store)).toBe(1)
    }
  })

  it('ignores a set above one', async () => {
    const store = storeWith({ isRecurring: true })
    await loadHandler(store)({ itemId: 'cart_1', quantity: 5, updateMode: 'set' })
    expect(storedQuantity(store)).toBe(1)
  })

  it('still removes the line when the quantity drops to zero', async () => {
    const store = storeWith({ isRecurring: true })
    const out = await loadHandler(store)({ itemId: 'cart_1', quantity: 1, updateMode: 'decrement' })
    expect(out).toEqual({ id: 'cart_1', quantity: 0 })
    expect(JSON.parse(store.workflow_cart)).toEqual([])
  })

  it('leaves an ordinary line exactly as it was', async () => {
    const store = storeWith({ isRecurring: false })
    await loadHandler(store)({ itemId: 'cart_1', quantity: 2, updateMode: 'increment' })
    expect(storedQuantity(store)).toBe(3)
  })
})
