import { cartClear } from '../src/nodes/cart/cart-clear'

// Regression: after a cash-on-delivery order the buyer's cart came back.
//
// `cart-clear` only emptied `localStorage.workflow_cart`. The database copy
// (`teleport_cart` / `teleport_cart_items`) stayed active, and
// `EcommerceProvider` re-hydrates from `/api/cart/load` on any mount where the
// local cart is empty — so the very next full page load (the post-order
// redirect, or a plain refresh) restored the cart the shopper had just ordered
// and wrote it straight back into localStorage.

describe('cart-clear mirrors the empty cart into the database cart', () => {
  const handlerCode = cartClear.generateHandler()

  it('still clears localStorage first — the DB mirror is best-effort on top', () => {
    expect(handlerCode).toContain("localStorage.setItem('workflow_cart'")
    expect(handlerCode).toContain("dispatchEvent(new CustomEvent('teleport:cart-changed'))")
  })

  it('pushes an empty cart through /api/cart/sync with the guest session id', () => {
    expect(handlerCode).toContain("'/api/cart/sync'")
    expect(handlerCode).toContain("localStorage.getItem('workflow_cart_session_id')")
    expect(handlerCode).toMatch(/items:\s*\[\s*\]/)
  })

  it('never awaits the sync and never lets it fail the node', () => {
    // The route only exists for Postgres datasources, so a 404 here is a
    // normal outcome — it must not surface to the shopper or abort the
    // workflow (which would strand the order mid-chain).
    const syncSection = handlerCode.slice(handlerCode.indexOf("'/api/cart/sync'"))
    expect(syncSection).not.toMatch(/await\s+fetch/)
    expect(syncSection).toContain('.catch(')
  })

  it('does NOT mark the cart as ordered — this handler also backs "Clear cart"', () => {
    // `mark-ordered` is the checkout-only signal and stays owned by
    // data-create-item. Flipping the status here would mislabel a cart the
    // shopper simply emptied by hand.
    expect(handlerCode).not.toContain('mark-ordered')
  })

  it('stamps the clear so the provider can tell it apart from a first visit', () => {
    expect(handlerCode).toContain("localStorage.setItem('workflow_cart_cleared_at'")
  })
})
