import { __testables as cartAvailability } from '../src/ecommerce/cart-availability'
import { STOCK_DECREMENT_MARKER } from '../src/ecommerce/stock-decrement'
import { rewriteLowStockCustomHandlers } from '../src/ecommerce-customhandler-rewriter'

const {
  looksLikeAddToCartStockCheck,
  looksLikeAddToCartLimitCheck,
  buildAddToCartStockCheck,
  buildAddToCartLimitCheck,
} = cartAvailability

// ====================================================================
// AI VERBATIM customHandler code — pasted from the regenerated dist
// so the detector matchers are validated against real input.
// ====================================================================

// Step 8 of add-product-to-cart-logic custom node (995fe692, seg-4).
// Only checks `quantity <= 0` (binary) — does not consider the
// REQUESTED add quantity vs stock.
const AI_STEP_8 = `function customHandler(previousContext, params) {
  var settingsCtx = params[2];
  var checkResult = params[7];
  var product = checkResult ? checkResult.product : null;
  if (!product) {
    return { available: false, message: "Product not found." };
  }
  var stockManagement = settingsCtx ? settingsCtx.stockManagement : false;
  var allowBackorders = settingsCtx ? settingsCtx.allowBackorders : true;
  if (stockManagement && !allowBackorders) {
    var qty = product.quantity;
    if (qty === null || qty === undefined || Number(qty) <= 0) {
      return { available: false, message: "This product is currently out of stock." };
    }
  }
  return { available: true, message: "" };
}`

// Step 11 of add-product-to-cart-logic custom node (seg-5). Only checks
// the max-per-product cap — does NOT compare against actual DB stock.
const AI_STEP_11 = `function customHandler(previousContext, params) {
  var settingsCtx = params[2];
  var extractCtx = params[0];
  var cartItems = params[13];
  var productId = extractCtx ? extractCtx.productId : "";
  var items = cartItems && Array.isArray(cartItems) ? cartItems : [];
  if (cartItems && cartItems.items) { items = cartItems.items; }
  var existingItem = null;
  var existingQuantity = 0;
  for (var i = 0; i < items.length; i++) {
    if (items[i].productId === productId) {
      existingItem = items[i];
      existingQuantity = Number(items[i].quantity) || 0;
      break;
    }
  }
  var maxQty = settingsCtx ? settingsCtx.maxQuantityPerProduct : null;
  if (maxQty !== null && maxQty !== undefined && Number(maxQty) > 0) {
    if (existingQuantity >= Number(maxQty)) {
      return {
        canAdd: false,
        message: "You have reached the maximum quantity for this product (" + maxQty + ").",
        existingItemId: existingItem ? existingItem.id : null,
        shouldIncrement: false
      };
    }
  }
  return {
    canAdd: true,
    message: "",
    existingItemId: existingItem ? existingItem.id : null,
    shouldIncrement: existingItem !== null
  };
}`

// ====================================================================
// PATTERN B: step 8 stock check
// ====================================================================
describe('looksLikeAddToCartStockCheck — pattern detection', () => {
  it('matches the AI verbatim step 8 handler', () => {
    expect(looksLikeAddToCartStockCheck(AI_STEP_8)).toBe(true)
  })

  it('rejects already-rewritten code (marker present)', () => {
    const rewritten = buildAddToCartStockCheck()
    expect(rewritten).toContain(STOCK_DECREMENT_MARKER)
    expect(looksLikeAddToCartStockCheck(rewritten)).toBe(false)
  })

  it('rejects a handler missing the params[2] / params[7] positional pattern', () => {
    const generic = `function customHandler() { return { available: true, message: '' }; }`
    expect(looksLikeAddToCartStockCheck(generic)).toBe(false)
  })

  it('rejects non-string code', () => {
    expect(looksLikeAddToCartStockCheck(null as any)).toBe(false)
    expect(looksLikeAddToCartStockCheck(123 as any)).toBe(false)
  })
})

describe('buildAddToCartStockCheck — runtime semantics', () => {
  const fn = (() => {
    const code = buildAddToCartStockCheck()
    return new Function(code + '\nreturn customHandler;')() as (prev: any, params: any[]) => any
  })()

  const baseSettings = (overrides: any = {}) => ({
    stockManagement: true,
    allowBackorders: false,
    maxQuantityPerProduct: 5,
    ...overrides,
  })

  it('returns available:false when the product was not found', () => {
    const result = fn({}, [
      {},
      null,
      baseSettings(),
      null,
      null,
      null,
      null,
      { found: false, product: null },
    ])
    expect(result.available).toBe(false)
    expect(result.message).toContain('no longer available')
  })

  it('returns available:true when stockManagement is off (no further checks)', () => {
    const result = fn({}, [
      { productId: 'a', quantity: 1 },
      null,
      baseSettings({ stockManagement: false }),
      null,
      null,
      null,
      null,
      { found: true, product: { name: 'Apple', quantity: 0 } },
    ])
    expect(result.available).toBe(true)
  })

  it('returns available:true when allowBackorders=true (merchant opted in)', () => {
    const result = fn({}, [
      { productId: 'a', quantity: 1 },
      null,
      baseSettings({ allowBackorders: true }),
      null,
      null,
      null,
      null,
      { found: true, product: { name: 'Apple', quantity: 0 } },
    ])
    expect(result.available).toBe(true)
  })

  it('returns available:true when stock is null (unlimited)', () => {
    const result = fn({}, [
      { productId: 'a', quantity: 999 },
      null,
      baseSettings(),
      null,
      null,
      null,
      null,
      { found: true, product: { name: 'Apple', quantity: null } },
    ])
    expect(result.available).toBe(true)
  })

  it('returns available:false with product name when stock is 0', () => {
    const result = fn({}, [
      { productId: 'a', quantity: 1 },
      null,
      baseSettings(),
      null,
      null,
      null,
      null,
      { found: true, product: { name: 'Apple', quantity: 0 } },
    ])
    expect(result.available).toBe(false)
    expect(result.message).toBe('"Apple" is out of stock.')
  })

  it('returns available:false with "Only N of X are in stock." when requested > stock', () => {
    const result = fn({}, [
      { productId: 'a', quantity: 5 },
      null,
      baseSettings(),
      null,
      null,
      null,
      null,
      { found: true, product: { name: 'Apple', quantity: 2 } },
    ])
    expect(result.available).toBe(false)
    expect(result.message).toBe('Only 2 of "Apple" are in stock.')
  })

  it('uses singular grammar ("is") when only 1 unit remains', () => {
    const result = fn({}, [
      { productId: 'a', quantity: 5 },
      null,
      baseSettings(),
      null,
      null,
      null,
      null,
      { found: true, product: { name: 'Apple', quantity: 1 } },
    ])
    expect(result.message).toBe('Only 1 of "Apple" is in stock.')
  })

  it('returns available:true when requested <= stock', () => {
    const result = fn({}, [
      { productId: 'a', quantity: 2 },
      null,
      baseSettings(),
      null,
      null,
      null,
      null,
      { found: true, product: { name: 'Apple', quantity: 5 } },
    ])
    expect(result.available).toBe(true)
    expect(result.message).toBe('')
  })

  it('coerces missing/invalid requested quantity to 1', () => {
    const result = fn({}, [
      { productId: 'a' }, // no quantity field
      null,
      baseSettings(),
      null,
      null,
      null,
      null,
      { found: true, product: { name: 'Apple', quantity: 5 } },
    ])
    expect(result.available).toBe(true)
  })

  it('falls back to "this product" when DB row has no name', () => {
    const result = fn({}, [
      { productId: 'a', quantity: 5 },
      null,
      baseSettings(),
      null,
      null,
      null,
      null,
      { found: true, product: { quantity: 1 } },
    ])
    expect(result.message).toContain('"this product"')
  })

  it('uses the trigger payload`s name when DB row has no name', () => {
    const result = fn({}, [
      { productId: 'a', quantity: 5, name: 'From-Cart Name' },
      null,
      baseSettings(),
      null,
      null,
      null,
      null,
      { found: true, product: { quantity: 1 } },
    ])
    expect(result.message).toContain('"From-Cart Name"')
  })
})

// ====================================================================
// PATTERN C: step 11 cart-aware limit + stock check
// ====================================================================
describe('looksLikeAddToCartLimitCheck — pattern detection', () => {
  it('matches the AI verbatim step 11 handler', () => {
    expect(looksLikeAddToCartLimitCheck(AI_STEP_11)).toBe(true)
  })

  it('rejects already-rewritten code (marker present)', () => {
    const rewritten = buildAddToCartLimitCheck()
    expect(rewritten).toContain(STOCK_DECREMENT_MARKER)
    expect(looksLikeAddToCartLimitCheck(rewritten)).toBe(false)
  })

  it('rejects a handler missing the distinguishing fields', () => {
    const generic = `function customHandler() { return {}; }`
    expect(looksLikeAddToCartLimitCheck(generic)).toBe(false)
  })

  it('rejects a handler that has canAdd but missing maxQuantityPerProduct', () => {
    const partial = `function customHandler() {
      var canAdd = true;
      var shouldIncrement = false;
      var existingItemId = null;
      return { canAdd, shouldIncrement, existingItemId };
    }`
    expect(looksLikeAddToCartLimitCheck(partial)).toBe(false)
  })
})

describe('buildAddToCartLimitCheck — runtime semantics', () => {
  const fn = (() => {
    const code = buildAddToCartLimitCheck()
    return new Function(code + '\nreturn customHandler;')() as (prev: any, params: any[]) => any
  })()

  const baseSettings = (overrides: any = {}) => ({
    stockManagement: true,
    allowBackorders: false,
    maxQuantityPerProduct: 5,
    ...overrides,
  })

  // The AI workflow puts these at specific positional indices:
  //   params[0] = extractCtx { productId, quantity }
  //   params[2] = settingsCtx
  //   params[6] = foundCtx { found, product }
  //   params[13] = cartItems (array)
  // We test with the AI's positional layout AND with shape-walking
  // fallback (rearranged params).
  const buildParams = (
    productId: string,
    quantity: number,
    settings: any,
    product: any,
    cartItems: any[]
  ): any[] => {
    const arr: any[] = new Array(14).fill(null)
    arr[0] = { productId, quantity }
    arr[2] = settings
    arr[6] = product ? { found: true, product } : { found: false, product: null }
    arr[13] = cartItems
    return arr
  }

  it('new item, no cart entry, under max + under stock → canAdd:true, shouldIncrement:false', () => {
    const params = buildParams('a', 1, baseSettings(), { name: 'Apple', quantity: 5 }, [])
    const result = fn({}, params)
    expect(result.canAdd).toBe(true)
    expect(result.shouldIncrement).toBe(false)
    expect(result.existingItemId).toBe(null)
  })

  it('existing item, under max + under stock → canAdd:true, shouldIncrement:true', () => {
    const params = buildParams('a', 1, baseSettings(), { name: 'Apple', quantity: 5 }, [
      { id: 'cart-1', productId: 'a', quantity: 2 },
    ])
    const result = fn({}, params)
    expect(result.canAdd).toBe(true)
    expect(result.shouldIncrement).toBe(true)
    expect(result.existingItemId).toBe('cart-1')
  })

  it('new item would exceed maxQuantityPerProduct → canAdd:false, names product', () => {
    const params = buildParams(
      'a',
      6,
      baseSettings({ maxQuantityPerProduct: 5 }),
      { name: 'Apple', quantity: 99 },
      []
    )
    const result = fn({}, params)
    expect(result.canAdd).toBe(false)
    expect(result.message).toBe('You can only have 5 of "Apple" in your cart.')
    expect(result.shouldIncrement).toBe(false)
  })

  it('existing item already at max → canAdd:false, names product', () => {
    const params = buildParams(
      'a',
      1,
      baseSettings({ maxQuantityPerProduct: 5 }),
      { name: 'Apple', quantity: 99 },
      [{ id: 'cart-1', productId: 'a', quantity: 5 }]
    )
    const result = fn({}, params)
    expect(result.canAdd).toBe(false)
    expect(result.message).toContain('"Apple"')
  })

  it('existing item + requested would exceed stock → canAdd:false, says "Only N more …"', () => {
    // Stock 5, existing 3 in cart, requested 3 more → 6 total, only 2 more can be added
    const params = buildParams(
      'a',
      3,
      baseSettings({ maxQuantityPerProduct: 100 }),
      { name: 'Apple', quantity: 5 },
      [{ id: 'cart-1', productId: 'a', quantity: 3 }]
    )
    const result = fn({}, params)
    expect(result.canAdd).toBe(false)
    expect(result.message).toBe(
      'Only 2 more of "Apple" can be added (you have 3 in cart, 5 in stock).'
    )
  })

  it('existing item exactly at stock cap → canAdd:false, "X is out of stock"', () => {
    // Stock 3, existing 3 in cart, requested 1 more → 4 > 3, but existing >= stock so OUT-OF-STOCK message
    const params = buildParams(
      'a',
      1,
      baseSettings({ maxQuantityPerProduct: 100 }),
      { name: 'Apple', quantity: 3 },
      [{ id: 'cart-1', productId: 'a', quantity: 3 }]
    )
    const result = fn({}, params)
    expect(result.canAdd).toBe(false)
    expect(result.message).toBe('"Apple" is out of stock.')
  })

  it('stock check skipped when stockManagement is off — only max enforced', () => {
    const params = buildParams(
      'a',
      99,
      baseSettings({ stockManagement: false, maxQuantityPerProduct: 100 }),
      { name: 'Apple', quantity: 1 },
      []
    )
    const result = fn({}, params)
    expect(result.canAdd).toBe(true)
  })

  it('stock check skipped when allowBackorders=true — only max enforced', () => {
    const params = buildParams(
      'a',
      99,
      baseSettings({ allowBackorders: true, maxQuantityPerProduct: 100 }),
      { name: 'Apple', quantity: 1 },
      []
    )
    const result = fn({}, params)
    expect(result.canAdd).toBe(true)
  })

  it('null product quantity (unlimited) → no stock blocking', () => {
    // Disable max-per-product cap so we isolate the stock-check
    // branch; otherwise the max cap fires first and the test no
    // longer measures what it claims to measure.
    const params = buildParams(
      'a',
      1000,
      baseSettings({ maxQuantityPerProduct: null }),
      { name: 'Apple', quantity: null },
      []
    )
    const result = fn({}, params)
    expect(result.canAdd).toBe(true)
  })

  it('no maxQuantityPerProduct cap (null) and no stock issue → canAdd:true', () => {
    const params = buildParams(
      'a',
      50,
      baseSettings({ maxQuantityPerProduct: null }),
      { name: 'Apple', quantity: 100 },
      []
    )
    const result = fn({}, params)
    expect(result.canAdd).toBe(true)
  })

  it('coerces missing/invalid requested quantity to 1', () => {
    const arr: any[] = new Array(14).fill(null)
    arr[0] = { productId: 'a' } // no quantity
    arr[2] = baseSettings()
    arr[6] = { found: true, product: { name: 'Apple', quantity: 5 } }
    arr[13] = []
    const result = fn({}, arr)
    expect(result.canAdd).toBe(true)
  })

  it('name resolution: prefers DB product name over cart/trigger names', () => {
    const params = buildParams(
      'a',
      99,
      baseSettings({ maxQuantityPerProduct: 1 }),
      { name: 'DB Name', quantity: 100 },
      []
    )
    params[0].name = 'Trigger Name'
    const result = fn({}, params)
    expect(result.message).toContain('"DB Name"')
  })

  it('name resolution: falls back to "this product" when nothing is available', () => {
    const arr: any[] = new Array(14).fill(null)
    arr[0] = { productId: 'a', quantity: 99 }
    arr[2] = baseSettings({ maxQuantityPerProduct: 1 })
    arr[6] = { found: true, product: { quantity: 100 } } // no name
    arr[13] = []
    const result = fn({}, arr)
    expect(result.message).toContain('"this product"')
  })

  it('finds cartItems via shape-walking when not at positional index 13', () => {
    // Build params with cart at a different index — handler must
    // still find it via the shape walk.
    const params: any[] = []
    params[0] = { productId: 'a', quantity: 1 }
    params[2] = baseSettings()
    params[6] = { found: true, product: { name: 'Apple', quantity: 5 } }
    params[7] = [{ id: 'cart-X', productId: 'a', quantity: 2 }] // cart at index 7 instead of 13
    const result = fn({}, params)
    expect(result.shouldIncrement).toBe(true)
    expect(result.existingItemId).toBe('cart-X')
  })

  it('accepts cart wrapped as { items: [...] }', () => {
    const params: any[] = []
    params[0] = { productId: 'a', quantity: 1 }
    params[2] = baseSettings()
    params[6] = { found: true, product: { name: 'Apple', quantity: 5 } }
    params[8] = { items: [{ id: 'cart-Y', productId: 'a', quantity: 1 }] }
    const result = fn({}, params)
    expect(result.shouldIncrement).toBe(true)
    expect(result.existingItemId).toBe('cart-Y')
  })

  it('finds foundCtx via shape-walking when not at positional index 6', () => {
    const params: any[] = []
    params[0] = { productId: 'a', quantity: 1 }
    params[2] = baseSettings()
    params[4] = { found: true, product: { name: 'Apple', quantity: 5 } } // at index 4 not 6
    params[13] = []
    const result = fn({}, params)
    expect(result.canAdd).toBe(true)
  })
})

// ====================================================================
// Rewriter integration — both patterns
// ====================================================================
describe('rewriter integration — add-to-cart patterns', () => {
  const buildUidl = (stockManagement: boolean = true) =>
    ({
      workflows: {
        workflows: {},
        customNodes: {
          atc: {
            id: 'atc',
            name: 'Add Product To Cart Logic',
            nodes: [
              { id: 'step8', type: 'general-custom-js', config: { code: AI_STEP_8 } },
              { id: 'step11', type: 'general-custom-js', config: { code: AI_STEP_11 } },
            ],
          },
        },
      },
      ecommerceSettings: {
        stockManagement,
        stockManagementConfig: {
          allowBackorders: false,
          lowStockThreshold: 5,
          lowStockAlerts: false,
          maxQuantityPerProduct: 5,
        },
      },
    } as any)

  it('rewrites both step 8 AND step 11 customHandlers when stockManagement is on', () => {
    const uidl = buildUidl(true)
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.addToCartStockCheckRewrites).toBe(1)
    expect(summary.addToCartLimitCheckRewrites).toBe(1)
    expect(uidl.workflows.customNodes.atc.nodes[0].config.code).toContain(STOCK_DECREMENT_MARKER)
    expect(uidl.workflows.customNodes.atc.nodes[1].config.code).toContain(STOCK_DECREMENT_MARKER)
  })

  it('SKIPS step 8 stock check rewrite when stockManagement is off', () => {
    const uidl = buildUidl(false)
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.addToCartStockCheckRewrites).toBe(0)
    expect(uidl.workflows.customNodes.atc.nodes[0].config.code).toBe(AI_STEP_8)
  })

  it('STILL rewrites step 11 even when stockManagement is off (max-per-product cap is independent)', () => {
    const uidl = buildUidl(false)
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.addToCartLimitCheckRewrites).toBe(1)
    expect(uidl.workflows.customNodes.atc.nodes[1].config.code).toContain(STOCK_DECREMENT_MARKER)
  })

  it('is idempotent — second run does NOT re-rewrite', () => {
    const uidl = buildUidl(true)
    rewriteLowStockCustomHandlers(uidl)
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.addToCartStockCheckRewrites).toBe(0)
    expect(summary.addToCartLimitCheckRewrites).toBe(0)
  })
})
