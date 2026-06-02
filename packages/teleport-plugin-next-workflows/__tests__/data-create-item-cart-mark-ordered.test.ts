import { dataCreateItem } from '../src/nodes/data/data-create-item'

// When the place-order workflow inserts a teleport_orders row, the
// data-create-item node must also retire the buyer's active database cart via
// a fire-and-forget POST to /api/cart/mark-ordered. This covers the AI
// place-order path that bypasses /api/ecommerce/checkout. It is keyed by the
// order's owner id (the real user_id when logged in, else the guest anon id)
// because the server-to-server call carries no auth cookies. It must never
// affect the placed order.

describe('data-create-item — marks the database cart ordered on order insert', () => {
  const handler = dataCreateItem.generateHandler()

  it('fires a mark-ordered call only for teleport_orders inserts', () => {
    expect(handler).toContain('/api/cart/mark-ordered')
    // Inside the orders-only branch.
    const ordersBranch = handler.indexOf("tableName === 'teleport_orders'")
    const markCall = handler.indexOf('/api/cart/mark-ordered')
    expect(ordersBranch).toBeGreaterThan(-1)
    expect(markCall).toBeGreaterThan(ordersBranch)
  })

  it('keys by the order owner id (user_id or guest anon id) and is fire-and-forget', () => {
    expect(handler).toContain('item.user_id')
    expect(handler).toContain('__anonymousUserId')
    expect(handler).toContain('anonymousUserId: __orderOwnerId')
    // Fire-and-forget + guarded so it never breaks the order.
    expect(handler).toMatch(/mark-ordered[\s\S]*\.catch\(/)
  })
})
