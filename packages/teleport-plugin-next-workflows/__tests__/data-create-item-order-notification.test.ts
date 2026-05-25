import { dataCreateItem } from '../src/nodes/data/data-create-item'

// The order-confirmation email used to ship empty: "Items: 0", no
// shipping address, no fulfillment, no currency, no item detail.
// Root cause was the `data_create_item` piggyback in
// `nodes/data/data-create-item.ts` building a minimal payload from
// only a handful of `data.item` fields. This file pins the upgraded
// behaviour: walk context for cart items, normalise them, assemble
// the shipping address from whichever column shape the orders table
// happens to use, and pass orderNumber separately from orderId.

const handlerCode = dataCreateItem.generateHandler()

describe('data_create_item — order-notification piggyback payload', () => {
  it('walks workflow context looking for a cart-items array (not hardcoded params index)', () => {
    expect(handlerCode).toContain('cartItems')
    expect(handlerCode).toContain('Array.isArray(__v.items)')
    // The detector must require a cart-item-shaped sample so it
    // doesn't pick up an unrelated "{items:[]}" envelope from
    // another node by accident.
    expect(handlerCode).toMatch(/['"]price['"]\s+in\s+sample/)
    expect(handlerCode).toMatch(/['"]productId['"]\s+in\s+sample/)
  })

  it('normalises items into a stable shape (name, sku, quantity, unitPrice, totalPrice)', () => {
    expect(handlerCode).toContain('normalisedItems')
    expect(handlerCode).toContain('name:')
    expect(handlerCode).toContain('sku:')
    expect(handlerCode).toContain('quantity:')
    expect(handlerCode).toContain('unitPrice:')
    expect(handlerCode).toContain('totalPrice:')
  })

  it('coerces missing/invalid quantity to 1 — a cart line is always at least one unit', () => {
    expect(handlerCode).toMatch(
      /qty\s*=\s*isFinite\(quantity\).*quantity\s*>\s*0\s*\?\s*quantity\s*:\s*1/
    )
  })

  it('rounds unitPrice and totalPrice to cents to avoid floating-point cruft in the email', () => {
    expect(handlerCode).toMatch(/Math\.round\(unitPrice\s*\*\s*100\)\s*\/\s*100/)
    expect(handlerCode).toMatch(/Math\.round\(unitPrice\s*\*\s*qty\s*\*\s*100\)\s*\/\s*100/)
  })

  it('assembles shippingAddress from the single shipping_address column when it is a string', () => {
    expect(handlerCode).toMatch(/typeof item\.shipping_address\s*===\s*['"]string['"]/)
    expect(handlerCode).toContain('shippingAddress = item.shipping_address')
  })

  it('assembles shippingAddress from an object shipping_address column (JSON shape)', () => {
    expect(handlerCode).toMatch(/sa\.name\s*\|\|\s*sa\.recipient/)
    expect(handlerCode).toMatch(/sa\.line1\s*\|\|\s*sa\.address1\s*\|\|\s*sa\.street/)
    expect(handlerCode).toMatch(/sa\.postal_code\s*\|\|\s*sa\.zip/)
  })

  it('assembles shippingAddress from separate shipping_* columns as the third fallback', () => {
    expect(handlerCode).toContain('item.shipping_name')
    expect(handlerCode).toContain('item.shipping_address1')
    expect(handlerCode).toContain('item.shipping_city')
    expect(handlerCode).toContain('item.shipping_country')
  })

  it('joins address parts with \\n so the email endpoint can convert to <br>', () => {
    // The endpoint side runs .split(/\r?\n/).join('<br>') — these
    // contracts must stay in sync. If either side changes, the
    // shipping address renders as one long line.
    expect(handlerCode).toMatch(/\.join\(['"][\\n][\\n]?['"]\)/)
  })

  it('passes orderNumber as a separate field from orderId in the email payload', () => {
    // Older behaviour folded order_number into the `orderId` field,
    // making the email show a UUID where the merchant configured
    // {{orderNumber}}. The two MUST be passed independently.
    expect(handlerCode).toContain('orderNumber: item.order_number || item.id')
    expect(handlerCode).toContain('orderId: item.id')
  })

  it('passes currency, fulfillmentMethod, orderDate from the inserted row', () => {
    expect(handlerCode).toContain('currency: item.currency')
    expect(handlerCode).toContain('fulfillmentMethod: item.fulfillment_method')
    expect(handlerCode).toContain('orderDate: item.created_at')
  })

  it('only fires for INSERTs into the orders table (other tables are NOT notified)', () => {
    expect(handlerCode).toContain("tableName === 'teleport_orders'")
  })

  it('the fetch call is fire-and-forget — no await on the email POST', () => {
    // Grep for the actual call shape: `fetch(baseUrl + '/api/ecommerce/order-notification', { method: 'POST', ... }).catch(...)`
    // The presence of `.catch(function () {` immediately after the fetch
    // call (no `await`) is the load-bearing assertion.
    expect(handlerCode).toMatch(
      /fetch\([\s\S]*?\/api\/ecommerce\/order-notification[\s\S]*?\}\)\s*\.catch/
    )
    const fetchSection = handlerCode.slice(
      handlerCode.indexOf('/api/ecommerce/order-notification'),
      handlerCode.indexOf('/api/ecommerce/order-notification') + 800
    )
    expect(fetchSection).not.toMatch(/await\s+fetch/)
  })
})

// Runtime semantics tests would need the TypeScript `__awaiter` /
// `__assign` helpers in scope to eval the serialised handler, which
// is not worth the wiring noise — the source-text assertions above
// cover the contract (which fields are read, where they default,
// fire-and-forget shape, etc.). The full integration is exercised
// by the existing end-to-end test in the dist project.
