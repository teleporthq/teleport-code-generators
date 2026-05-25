import { __testables as cartAvailability } from '../src/ecommerce/cart-availability'
import { STOCK_DECREMENT_MARKER } from '../src/ecommerce/stock-decrement'
import { rewriteLowStockCustomHandlers } from '../src/ecommerce-customhandler-rewriter'

const { looksLikePlaceOrderAvailabilityCheck, buildPlaceOrderAvailabilityCheck } = cartAvailability

// Verbatim copy of the AI's step 14 customHandler from the place-order
// workflow seg-server-2.js. Contains the load-bearing bug we're fixing:
//   `var ALLOW_BACKORDERS = true;` is hardcoded and the handler returns
//   `{ outOfStockItems: [], message: '' }` immediately, so the
//   downstream IF-gate at step 15 NEVER takes the "unavailable" branch.
const AI_VERBATIM = `function customHandler(previousContext, params) {
  var ALLOW_BACKORDERS = true;
  if (ALLOW_BACKORDERS) {
    return { outOfStockItems: [], message: '' };
  }
  var cartItems = null;
  var stockRows = null;
  for (var i = 0; i < params.length; i++) {
    var p = params[i];
    if (!p || typeof p !== "object") { continue; }
    if (!cartItems && Array.isArray(p.items)) { cartItems = p.items; continue; }
    if (!stockRows && Array.isArray(p.rows)) { stockRows = p.rows; continue; }
    if (!stockRows && p.result && Array.isArray(p.result.rows)) { stockRows = p.result.rows; continue; }
  }
  if (!cartItems || !stockRows) {
    return { outOfStockItems: [], message: '' };
  }
  var out = [];
  return { outOfStockItems: out, outOfStockCount: out.length, message: '' };
}`

// ────────────────────────────────────────────────────────────────────
// Pattern detection
// ────────────────────────────────────────────────────────────────────
describe('looksLikePlaceOrderAvailabilityCheck — pattern detection', () => {
  it('matches the AI verbatim customHandler shape', () => {
    expect(looksLikePlaceOrderAvailabilityCheck(AI_VERBATIM)).toBe(true)
  })

  it('rejects already-rewritten code (marker present)', () => {
    const rewritten = buildPlaceOrderAvailabilityCheck(false)
    expect(rewritten).toContain(STOCK_DECREMENT_MARKER)
    expect(looksLikePlaceOrderAvailabilityCheck(rewritten)).toBe(false)
  })

  it('rejects a similar handler that does NOT have ALLOW_BACKORDERS = true', () => {
    // A future AI version that already honors settings would set the
    // variable from a parameter. We must NOT touch it.
    const honoursSettings = `function customHandler() {
      var allowBackorders = settingsCtx.allowBackorders;
      return { outOfStockItems: [], outOfStockCount: 0, message: '' };
    }`
    expect(looksLikePlaceOrderAvailabilityCheck(honoursSettings)).toBe(false)
  })

  it('rejects a handler missing the outOfStockItems contract', () => {
    const unrelated = `function customHandler() { var ALLOW_BACKORDERS = true; return {}; }`
    expect(looksLikePlaceOrderAvailabilityCheck(unrelated)).toBe(false)
  })

  it('rejects non-string code', () => {
    expect(looksLikePlaceOrderAvailabilityCheck(null as any)).toBe(false)
    expect(looksLikePlaceOrderAvailabilityCheck(undefined as any)).toBe(false)
    expect(looksLikePlaceOrderAvailabilityCheck(123 as any)).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────
// Builder source assertions
// ────────────────────────────────────────────────────────────────────
describe('buildPlaceOrderAvailabilityCheck — source assertions', () => {
  it('bakes the merchant`s allowBackorders setting as a literal', () => {
    expect(buildPlaceOrderAvailabilityCheck(true)).toContain('var ALLOW_BACKORDERS = true;')
    expect(buildPlaceOrderAvailabilityCheck(false)).toContain('var ALLOW_BACKORDERS = false;')
  })

  it('embeds the marker so the auditor + idempotency recognise it', () => {
    expect(buildPlaceOrderAvailabilityCheck(false)).toContain(STOCK_DECREMENT_MARKER)
  })

  it('reuses the aggregateCartDeltas helper from stock-decrement.ts', () => {
    expect(buildPlaceOrderAvailabilityCheck(false)).toContain(
      'function aggregateCartDeltas(cartItems)'
    )
  })

  it('returns the canonical shape with outOfStockItems + outOfStockCount + message', () => {
    const src = buildPlaceOrderAvailabilityCheck(false)
    expect(src).toContain('outOfStockItems')
    expect(src).toContain('outOfStockCount')
    expect(src).toContain('message')
  })
})

// ────────────────────────────────────────────────────────────────────
// Runtime semantics — execute the emitted customHandler
// ────────────────────────────────────────────────────────────────────
const evalHandler = (allowBackorders: boolean) => {
  const code = buildPlaceOrderAvailabilityCheck(allowBackorders)
  return new Function(code + '\nreturn customHandler;')() as (prev: any, params: any[]) => any
}

describe('buildPlaceOrderAvailabilityCheck runtime — allowBackorders = true', () => {
  const fn = evalHandler(true)

  it('returns empty outOfStockItems regardless of cart shape', () => {
    expect(
      fn({}, [
        { items: [{ productId: 'a', quantity: 999 }] },
        { rows: [{ id: 'a', stock: 0, name: 'Test' }] },
      ])
    ).toEqual({ outOfStockItems: [], outOfStockCount: 0, message: '' })
  })

  it('returns empty even when params are empty', () => {
    expect(fn({}, [])).toEqual({ outOfStockItems: [], outOfStockCount: 0, message: '' })
  })
})

describe('buildPlaceOrderAvailabilityCheck runtime — allowBackorders = false', () => {
  const fn = evalHandler(false)

  it('reports zero out-of-stock when every cart item has enough stock', () => {
    const result = fn({}, [
      {
        items: [
          { productId: 'a', quantity: 2 },
          { productId: 'b', quantity: 1 },
        ],
      },
      {
        rows: [
          { id: 'a', stock: 5, name: 'Apple' },
          { id: 'b', stock: 3, name: 'Berry' },
        ],
      },
    ])
    expect(result.outOfStockCount).toBe(0)
    expect(result.outOfStockItems).toEqual([])
    expect(result.message).toBe('')
  })

  it('reports a single unavailable item with the product name + requested + available', () => {
    const result = fn({}, [
      { items: [{ productId: 'a', quantity: 10 }] },
      { rows: [{ id: 'a', stock: 3, name: 'Apple' }] },
    ])
    expect(result.outOfStockCount).toBe(1)
    expect(result.outOfStockItems).toEqual([
      {
        productId: 'a',
        name: 'Apple',
        requested: 10,
        available: 3,
      },
    ])
    expect(result.message).toBe(
      'Some items are no longer available: "Apple" (requested 10, only 3 left)'
    )
  })

  it('AGGREGATES duplicate cart entries for the same product before comparing', () => {
    // Two cart lines for product `a` (qty 3 + qty 3) is requesting 6
    // total. Stock is 5. The AI's original handler checked each line
    // independently against stock (3 <= 5, 3 <= 5) and let BOTH pass,
    // which would have over-sold by 1 unit.
    const result = fn({}, [
      {
        items: [
          { productId: 'a', quantity: 3, name: 'Apple' },
          { productId: 'a', quantity: 3, name: 'Apple' },
        ],
      },
      { rows: [{ id: 'a', stock: 5, name: 'Apple' }] },
    ])
    expect(result.outOfStockCount).toBe(1)
    expect(result.outOfStockItems[0].requested).toBe(6)
    expect(result.outOfStockItems[0].available).toBe(5)
  })

  it('lists multiple unavailable products in the message, comma-separated', () => {
    const result = fn({}, [
      {
        items: [
          { productId: 'a', quantity: 10, name: 'Apple' },
          { productId: 'b', quantity: 5, name: 'Berry' },
        ],
      },
      {
        rows: [
          { id: 'a', stock: 3, name: 'Apple' },
          { id: 'b', stock: 1, name: 'Berry' },
        ],
      },
    ])
    expect(result.outOfStockCount).toBe(2)
    expect(result.message).toContain('"Apple"')
    expect(result.message).toContain('"Berry"')
    expect(result.message).toContain(', ')
  })

  it('falls back to the DB row`s name when the cart line has none', () => {
    const result = fn({}, [
      { items: [{ productId: 'a', quantity: 10 }] }, // no name in cart line
      { rows: [{ id: 'a', stock: 1, name: 'DB Name' }] },
    ])
    expect(result.outOfStockItems[0].name).toBe('DB Name')
  })

  it('falls back to the cart line name when the DB row has none', () => {
    const result = fn({}, [
      { items: [{ productId: 'a', quantity: 10, name: 'Cart Name' }] },
      { rows: [{ id: 'a', stock: 1 }] }, // no name in DB row
    ])
    expect(result.outOfStockItems[0].name).toBe('Cart Name')
  })

  it('falls back to an "Item <pid-prefix>" placeholder when no name is available anywhere', () => {
    const result = fn({}, [
      { items: [{ productId: 'abcdef1234567890', quantity: 10 }] },
      { rows: [{ id: 'abcdef1234567890', stock: 1 }] },
    ])
    expect(result.outOfStockItems[0].name).toMatch(/^Item /)
  })

  it('SKIPS products with null/undefined stock (unlimited) — never flagged', () => {
    const result = fn({}, [
      { items: [{ productId: 'a', quantity: 9999 }] },
      { rows: [{ id: 'a', stock: null, name: 'Apple' }] },
    ])
    expect(result.outOfStockCount).toBe(0)
  })

  it('SKIPS cart entries with no productId', () => {
    const result = fn({}, [
      { items: [{ quantity: 5 }, { productId: 'a', quantity: 1 }] },
      { rows: [{ id: 'a', stock: 5, name: 'Apple' }] },
    ])
    expect(result.outOfStockCount).toBe(0)
  })

  it('SKIPS cart items missing from the DB result (deleted product — defensive)', () => {
    // If the product was deleted from the DB between page load and
    // checkout, the SELECT result won't include it. We don't fail the
    // whole order over this — the order-create-item path will surface
    // the foreign-key error if applicable. For the availability check
    // specifically, it's a non-blocker.
    const result = fn({}, [
      {
        items: [
          { productId: 'ghost', quantity: 5 },
          { productId: 'a', quantity: 1 },
        ],
      },
      { rows: [{ id: 'a', stock: 5, name: 'Apple' }] },
    ])
    expect(result.outOfStockCount).toBe(0)
  })

  it('returns empty when there are no cart items', () => {
    const result = fn({}, [{ items: [] }, { rows: [] }])
    expect(result.outOfStockCount).toBe(0)
  })

  it('returns empty when params have no stock-rows shape', () => {
    const result = fn({}, [
      { items: [{ productId: 'a', quantity: 1 }] },
      // No `rows` shape — only an unrelated object
      { somethingElse: true },
    ])
    expect(result.outOfStockCount).toBe(0)
  })

  it('handles the alternate { result: { rows: [...] } } params shape', () => {
    const result = fn({}, [
      { items: [{ productId: 'a', quantity: 10 }] },
      { result: { rows: [{ id: 'a', stock: 3, name: 'Apple' }] } },
    ])
    expect(result.outOfStockCount).toBe(1)
  })

  it('treats negative or NaN quantity as 1 (matches aggregateCartDeltas)', () => {
    const result = fn({}, [
      { items: [{ productId: 'a', quantity: 'NaN' }, { productId: 'a' }] },
      { rows: [{ id: 'a', stock: 1, name: 'Apple' }] },
    ])
    // NaN → 1, missing → 1, aggregated to 2, exceeds stock 1
    expect(result.outOfStockItems[0].requested).toBe(2)
  })

  it('truncates a very long product name to 80 chars + ellipsis', () => {
    const longName = 'X'.repeat(200)
    const result = fn({}, [
      { items: [{ productId: 'a', quantity: 10 }] },
      { rows: [{ id: 'a', stock: 1, name: longName }] },
    ])
    expect(result.outOfStockItems[0].name.length).toBe(80)
    expect(result.outOfStockItems[0].name.endsWith('…')).toBe(true)
  })

  it('escapes single quotes in productId consistently with aggregateCartDeltas', () => {
    const result = fn({}, [
      { items: [{ productId: "x'malicious", quantity: 10 }] },
      // The cart aggregator escapes \"'\" → \"''\" — so the lookup id is `x''malicious`.
      { rows: [{ id: "x''malicious", stock: 1, name: 'Bad' }] },
    ])
    expect(result.outOfStockCount).toBe(1)
  })
})

// ────────────────────────────────────────────────────────────────────
// Rewriter integration
// ────────────────────────────────────────────────────────────────────
describe('rewriter integration — place-order availability check', () => {
  const buildUidl = (allowBackorders: boolean) =>
    ({
      workflows: {
        workflows: {
          placeOrder: {
            id: 'wfPO',
            name: 'Place Order',
            nodes: [{ id: 'check', type: 'general-custom-js', config: { code: AI_VERBATIM } }],
          },
        },
        customNodes: {},
      },
      ecommerceSettings: {
        stockManagement: true,
        stockManagementConfig: {
          allowBackorders,
          lowStockThreshold: 5,
          lowStockAlerts: false,
          maxQuantityPerProduct: 5,
        },
      },
    } as any)

  it('rewrites the AI customHandler when stockManagement is on', () => {
    const uidl = buildUidl(false)
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.placeOrderAvailabilityRewrites).toBe(1)
    const code = uidl.workflows.workflows.placeOrder.nodes[0].config.code
    expect(code).toContain(STOCK_DECREMENT_MARKER)
    expect(code).toContain('var ALLOW_BACKORDERS = false;')
  })

  it('bakes allowBackorders=true correctly', () => {
    const uidl = buildUidl(true)
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.placeOrderAvailabilityRewrites).toBe(1)
    const code = uidl.workflows.workflows.placeOrder.nodes[0].config.code
    expect(code).toContain('var ALLOW_BACKORDERS = true;')
  })

  it('SKIPS the rewrite when stockManagement is off', () => {
    const uidl = buildUidl(false)
    uidl.ecommerceSettings.stockManagement = false
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.placeOrderAvailabilityRewrites).toBe(0)
    expect(uidl.workflows.workflows.placeOrder.nodes[0].config.code).toBe(AI_VERBATIM)
  })

  it('is idempotent — second run does NOT re-rewrite', () => {
    const uidl = buildUidl(false)
    expect(rewriteLowStockCustomHandlers(uidl).placeOrderAvailabilityRewrites).toBe(1)
    expect(rewriteLowStockCustomHandlers(uidl).placeOrderAvailabilityRewrites).toBe(0)
  })
})
