import { NodeHandlerGenerator, handlerToString } from '../types'
import {
  COMMERCE_TRACKING_HELPER_SOURCE,
  assertHandlerHasNoModuleRefs,
} from '../analytics/commerce-tracking'

// AMBIENT, not imported. A cross-module call compiles to
// `(0, commerce_tracking_1.trackCommerceStep)(...)`, which survives
// `.toString()` and throws ReferenceError in the browser — the runtime has no
// module scope. Declaring the name emits nothing and leaves a bare identifier
// that the appended helper source defines. See `commerce-tracking.ts`.
declare function trackCommerceStep(step: { name: string; detail?: Record<string, unknown> }): void

async function cart_remove_item(config: any) {
  const itemId = config.itemId

  try {
    const raw = localStorage.getItem('workflow_cart')
    const cart: any[] = raw ? JSON.parse(raw) : []
    const removed = cart.find((item: any) => item.id === itemId)
    const newCart = cart.filter((item: any) => item.id !== itemId)

    localStorage.setItem('workflow_cart', JSON.stringify(newCart))
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('teleport:cart-changed'))
    }
    // Only when a line was actually removed: a remove call for an id that is no
    // longer in the cart (a double click, a stale button) changed nothing, and
    // counting it would overstate the abandonment the merchant reads here.
    if (removed) {
      trackCommerceStep({
        name: 'remove_from_cart',
        detail: {
          currency: removed.currency,
          value: (Number(removed.price) || 0) * (Number(removed.quantity) || 0),
          items: [
            {
              item_id: removed.productId,
              item_name: removed.name,
              price: removed.price,
              quantity: removed.quantity,
            },
          ],
        },
      })
    }
    return { success: true, cart: newCart }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}
export const cartRemoveItem: NodeHandlerGenerator = {
  nodeType: 'cart-remove-item',
  executionEnv: 'client',
  generateHandler(): string {
    return assertHandlerHasNoModuleRefs(
      handlerToString(cart_remove_item) + '\n' + COMMERCE_TRACKING_HELPER_SOURCE,
      'cart-remove-item'
    )
  },
}
