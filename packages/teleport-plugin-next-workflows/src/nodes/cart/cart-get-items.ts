import { NodeHandlerGenerator, handlerToString } from '../types'

// Returns the cart contents as an OBJECT wrapper so downstream workflow
// nodes that reference `{ type: 'workflowContext', path: [nodeId, 'items'] }`
// (e.g. the forEach loop over cart items in the place-order workflow) can
// resolve to the underlying array. A bare-array return makes `.items` on
// the context entry undefined, which silently short-circuits the loop and
// leaves `teleport_order_items` empty.
//
// Also exposes derived `itemCount`, `subtotal` (major-currency, rounded
// to 2 decimals), and an empty `currency` placeholder — matching the
// shape the `cart-get-items` node-context schema already advertises.
// Bad `price` / `quantity` values coerce to sane defaults instead of
// throwing, so a malformed localStorage blob doesn't brick checkout.
async function cart_get_items() {
  try {
    const raw = localStorage.getItem('workflow_cart')
    const parsed = raw ? JSON.parse(raw) : []
    const items: any[] = Array.isArray(parsed) ? parsed : []
    let itemCount = 0
    let subtotal = 0
    for (const item of items) {
      const qty = Number(item && item.quantity)
      const price = Number(item && item.price)
      const safeQty = isFinite(qty) && qty > 0 ? qty : 1
      const safePrice = isFinite(price) && price > 0 ? price : 0
      itemCount += safeQty
      subtotal += safeQty * safePrice
    }
    const rounded = Math.round(subtotal * 100) / 100
    return { items, itemCount, subtotal: rounded, currency: '' }
  } catch (_err) {
    return { items: [], itemCount: 0, subtotal: 0, currency: '' }
  }
}
export const cartGetItems: NodeHandlerGenerator = {
  nodeType: 'cart-get-items',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(cart_get_items)
  },
}
