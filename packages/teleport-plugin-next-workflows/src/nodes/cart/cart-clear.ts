import { NodeHandlerGenerator, handlerToString } from '../types'

async function cart_clear() {
  try {
    localStorage.setItem('workflow_cart', JSON.stringify([]))

    // Mirror the empty cart into the DATABASE cart as well.
    //
    // `EcommerceProvider` re-hydrates from `/api/cart/load` whenever
    // localStorage is empty on mount (see `cartDbMountEffect` in
    // ecommerce-context-generator). Clearing only localStorage therefore
    // leaves the server copy intact, and the very next full page load
    // (checkout -> order-details, or any hard reload) resurrects the cart the
    // buyer just ordered. The provider's own debounced persist would push the
    // empty state eventually, but it fires 300ms later — after a post-order
    // redirect has already navigated away.
    //
    // `/api/cart/sync` is the same endpoint the provider persists through: it
    // resolves identity server-side (NextAuth token for signed-in users, the
    // client `sessionId` for guests) and transactionally replaces the active
    // cart's items — so an empty payload empties the stored cart for BOTH
    // identities. Deliberately does NOT flip the cart's status to ordered:
    // this handler also backs the storefront's plain "Clear cart" button, and
    // that cart was never ordered. Checkout owns that signal (see the
    // data-create-item handler).
    //
    // Fire-and-forget and fully guarded: the route only exists for Postgres
    // datasources (see `isPostgresCartDataSource`), so a 404 here is a normal,
    // expected outcome that must never surface to the shopper or abort the
    // workflow.
    if (typeof window !== 'undefined') {
      try {
        // Marks this empty cart as DELIBERATE. `EcommerceProvider`'s DB
        // reconcile effect reads the stamp (`wasCartJustCleared`) so it can
        // tell "just checked out" apart from "first visit, restore my cart"
        // and skip re-hydrating while the sync below is still in flight.
        localStorage.setItem('workflow_cart_cleared_at', String(Date.now()))
        const sessionId = localStorage.getItem('workflow_cart_session_id') || null
        fetch('/api/cart/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [], sessionId }),
        }).catch(function () {})
      } catch (_dbErr) {
        /* localStorage or fetch unavailable — local clear already succeeded */
      }
      window.dispatchEvent(new CustomEvent('teleport:cart-changed'))
    }
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}
export const cartClear: NodeHandlerGenerator = {
  nodeType: 'cart-clear',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(cart_clear)
  },
}
