// Cart-availability customHandler rewriters.
//
// THREE patterns are detected + replaced here. All three live in
// AI-generated workflows that ALREADY have the right structure
// (the surrounding IF-gate + toast nodes are wired correctly) but
// ship customHandlers that no-op the actual availability check:
//
//   1. Place-order pre-flight check (in seg-2 of the place-order
//      workflow, step 14). The AI hardcodes `var ALLOW_BACKORDERS =
//      true;` and returns `{ outOfStockItems: [] }` immediately,
//      so the buyer can place an order for products that no longer
//      have stock. We replace it with a settings-driven version that
//      reads the merchant's `allowBackorders` flag and aggregates
//      duplicate cart entries before comparing against the
//      stock-query result.
//
//   2. Add-to-cart stock check (in seg-4 of the add-product-to-cart
//      custom node, step 8). The AI only flags `quantity <= 0` and
//      its error message is generic ("This product is currently out
//      of stock."). We replace it with a richer version that
//      compares the REQUESTED add quantity against current stock and
//      names the product in the message.
//
//   3. Add-to-cart cart-aware limit check (in seg-5 of the
//      add-product-to-cart custom node, step 11). The AI only enforces
//      `maxQuantityPerProduct` and never checks against actual DB
//      stock — so a buyer can keep adding to cart past the available
//      stock as long as they stay under the per-product cap. We
//      replace it with a version that does BOTH checks (max-per-
//      product AND cart-aware stock), still names the product, and
//      preserves the existing `canAdd / shouldIncrement / existingItemId`
//      return shape so the downstream IF-gate + cart-add / cart-update
//      nodes keep working unchanged.
//
// Each replacement carries the shared `STOCK_DECREMENT_MARKER` so
// idempotent re-runs short-circuit AND the audit subsystem in
// stock-decrement.ts continues to recognise rewritten code.

import { STOCK_DECREMENT_MARKER, AGGREGATE_CART_DELTAS_HELPER } from './stock-decrement'

// ────────────────────────────────────────────────────────────────────
// PATTERN A: place-order pre-flight availability check (step 14)
// ────────────────────────────────────────────────────────────────────

// Distinguishing fragments (verbatim from the AI's emitted code):
//   * `var ALLOW_BACKORDERS = true;` — the bug we're fixing
//   * `outOfStockItems` AND `outOfStockCount` — the contract the
//     downstream IF-gate + toast node read from
//
// Together these are unique to the place-order pre-flight customHandler.
export const looksLikePlaceOrderAvailabilityCheck = (code: string): boolean => {
  if (typeof code !== 'string') {
    return false
  }
  if (code.indexOf(STOCK_DECREMENT_MARKER) >= 0) {
    return false
  }
  if (code.indexOf('outOfStockItems') < 0) {
    return false
  }
  if (code.indexOf('outOfStockCount') < 0) {
    return false
  }
  if (!/var\s+ALLOW_BACKORDERS\s*=\s*true\s*;/.test(code)) {
    return false
  }
  return true
}

export const buildPlaceOrderAvailabilityCheck = (allowBackorders: boolean): string => {
  const flagLiteral = allowBackorders ? 'true' : 'false'
  return `${STOCK_DECREMENT_MARKER}
function customHandler(previousContext, params) {
${AGGREGATE_CART_DELTAS_HELPER}

  // Baked from the merchant's e-commerce settings panel
  // (\`ecommerceSettings.stockManagementConfig.allowBackorders\`).
  var ALLOW_BACKORDERS = ${flagLiteral};

  // When backorders are allowed the merchant explicitly opted in to
  // selling beyond available stock; the place-order workflow must
  // not block. Return empty so the downstream IF-gate takes the
  // "proceed" branch.
  if (ALLOW_BACKORDERS) {
    return { outOfStockItems: [], outOfStockCount: 0, message: '' };
  }

  // 1. Walk params for the cart items (matches how every other
  //    rewritten customHandler in this generator finds them).
  var cartItems = null;
  for (var i = 0; i < params.length; i++) {
    var p = params[i];
    if (p && Array.isArray(p.items)) { cartItems = p.items; break; }
    if (Array.isArray(p)) { cartItems = p; break; }
  }

  // 2. Walk params for the stock-query result rows (returned by
  //    the upstream data-raw-query node). Either shape is accepted:
  //    \`{ rows: [...] }\` or \`{ result: { rows: [...] } }\`.
  var stockRows = null;
  for (var j = 0; j < params.length; j++) {
    var q = params[j];
    if (!q || typeof q !== 'object') continue;
    if (Array.isArray(q.rows) && q.rows.length > 0 && q.rows[0] && 'stock' in q.rows[0]) {
      stockRows = q.rows;
      break;
    }
    if (q.result && Array.isArray(q.result.rows) && q.result.rows.length > 0 && 'stock' in q.result.rows[0]) {
      stockRows = q.result.rows;
      break;
    }
  }

  if (!cartItems || cartItems.length === 0 || !stockRows) {
    // Degenerate input. Returning a zero-out-of-stock result keeps
    // the workflow's downstream IF-gate happy (it takes the
    // "proceed" branch). Any data shape problem upstream has its
    // own error path.
    return { outOfStockItems: [], outOfStockCount: 0, message: '' };
  }

  // 3. Index the stock rows by id for O(1) lookup.
  var stockById = {};
  for (var s = 0; s < stockRows.length; s++) {
    var row = stockRows[s];
    if (row && row.id != null) {
      stockById[String(row.id)] = row;
    }
  }

  // 4. AGGREGATE duplicate cart entries: \`qty=3\` + \`qty=3\` of the
  //    same productId is requesting 6 units in total. The AI's old
  //    customHandler compared each cart line independently against
  //    stock — so a cart with two qty=3 lines vs stock=5 would let
  //    BOTH lines pass (3 <= 5) and the buyer would end up ordering 6.
  var agg = aggregateCartDeltas(cartItems);

  // 5. For each aggregated product, decide if there's enough stock.
  //    Use the cart's product name (or fall back to the DB row's
  //    name) so the error message is human-readable.
  function findCartNameFor(pid) {
    for (var ci = 0; ci < cartItems.length; ci++) {
      var c = cartItems[ci];
      if (!c) continue;
      var cid = c.productId || c.product_id;
      if (cid && String(cid).replace(/'/g, "''") === pid) {
        return c.name || c.productName || c.product_name || '';
      }
    }
    return '';
  }
  function truncate(s, n) {
    if (typeof s !== 'string') return '';
    if (s.length <= n) return s;
    return s.slice(0, n - 1) + '…';
  }

  var outOfStockItems = [];
  for (var k = 0; k < agg.idList.length; k++) {
    var pid2 = agg.idList[k];
    var requested = agg.idToDelta[pid2];
    var row2 = stockById[pid2];
    // Missing stock row → the product was deleted from the DB; skip
    // (defensive — we don't want to fail the whole order on a stale
    // cart entry referencing a removed product).
    if (!row2) continue;
    // \`stock\` is null/undefined when the merchant left quantity NULL
    // (i.e. "unlimited stock" for this product). Skip — always available.
    if (row2.stock == null) continue;
    var available = parseInt(row2.stock, 10);
    if (isNaN(available)) continue;
    if (requested > available) {
      var name = truncate(row2.name || findCartNameFor(pid2) || ('Item ' + pid2.slice(0, 8)), 80);
      outOfStockItems.push({
        productId: pid2,
        name: name,
        requested: requested,
        available: available,
      });
    }
  }

  // 6. Build the human-readable message that the downstream toast
  //    will display. Listing every unavailable product makes the
  //    error actionable (vs the generic "out of stock" toast in the
  //    AI's original add-to-cart flow).
  var message = '';
  if (outOfStockItems.length > 0) {
    var parts = [];
    for (var m = 0; m < outOfStockItems.length; m++) {
      var it = outOfStockItems[m];
      parts.push('"' + it.name + '" (requested ' + it.requested + ', only ' + it.available + ' left)');
    }
    message = 'Some items are no longer available: ' + parts.join(', ');
  }

  return {
    outOfStockItems: outOfStockItems,
    outOfStockCount: outOfStockItems.length,
    message: message,
  };
}`
}

// ────────────────────────────────────────────────────────────────────
// PATTERN B: add-to-cart stock check (step 8)
// ────────────────────────────────────────────────────────────────────

// Distinguishing fragments — taken verbatim from the AI:
//   * `var settingsCtx = params[2]`
//   * `var checkResult = params[7]`
//   * `available` is on the return path
// These three together are unique to step 8 of the add-to-cart
// custom node (95fe692).
export const looksLikeAddToCartStockCheck = (code: string): boolean => {
  if (typeof code !== 'string') {
    return false
  }
  if (code.indexOf(STOCK_DECREMENT_MARKER) >= 0) {
    return false
  }
  if (!/var\s+settingsCtx\s*=\s*params\[\s*2\s*\]/.test(code)) {
    return false
  }
  if (!/var\s+checkResult\s*=\s*params\[\s*7\s*\]/.test(code)) {
    return false
  }
  if (code.indexOf('available') < 0) {
    return false
  }
  if (code.indexOf('stockManagement') < 0) {
    return false
  }
  if (code.indexOf('allowBackorders') < 0) {
    return false
  }
  return true
}

// This handler runs at step 8 of the add-to-cart workflow, BEFORE
// the client-side cart-get-items node (which is step 10). So we
// cannot yet do a cart-aware check ("current_cart_qty + requested >
// stock"); that's the job of step 11. This handler catches the
// strictly product-level cases — product missing, stock=0, or the
// REQUESTED ADD quantity already exceeds total stock — and produces
// a human-readable message that includes the product name.
export const buildAddToCartStockCheck = (): string => {
  return `${STOCK_DECREMENT_MARKER}
function customHandler(previousContext, params) {
  // Shape-walk for each upstream context entry so node-order shifts
  // in future generations don't silently break this handler.
  var settingsCtx = null;
  var checkResult = null;
  var extractCtx = null;
  for (var i = 0; i < params.length; i++) {
    var p = params[i];
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
    if (!settingsCtx && 'stockManagement' in p && 'maxQuantityPerProduct' in p) settingsCtx = p;
    if (!checkResult && 'found' in p && 'product' in p) checkResult = p;
    if (!extractCtx && 'productId' in p && 'quantity' in p && !('found' in p) && !('product' in p)) extractCtx = p;
  }
  var product = checkResult && checkResult.product ? checkResult.product : null;
  if (!product) {
    // Product was deleted between page load and click — the existing
    // step 7 IF gate ("Was Product Found In Database?") covers the
    // strict "not found" case, but a downstream caller may still
    // reach this branch via a stale param. Fail closed.
    return { available: false, message: 'This product is no longer available.' };
  }

  // Honor the merchant's settings panel: turning stock management
  // OFF or opting in to backorders means we never block the add.
  var stockManagement = settingsCtx ? settingsCtx.stockManagement : false;
  var allowBackorders = settingsCtx ? settingsCtx.allowBackorders : true;
  if (!stockManagement || allowBackorders) {
    return { available: true, message: '' };
  }

  // NULL/undefined quantity means "unlimited stock" — common shape
  // for products the merchant doesn't physically warehouse.
  var stock = product.quantity;
  if (stock == null) {
    return { available: true, message: '' };
  }
  var stockN = Number(stock);
  if (isNaN(stockN)) {
    // Garbled stock value — treat as unavailable (fail closed).
    return { available: false, message: 'This product is no longer available.' };
  }

  var requested = parseInt(extractCtx && extractCtx.quantity, 10);
  if (isNaN(requested) || requested <= 0) requested = 1;

  // Product name resolution: prefer the DB record's name (definitive),
  // fall back to whatever the caller hinted.
  var name = product.name || (extractCtx && (extractCtx.name || extractCtx.productName)) || 'this product';

  if (stockN <= 0) {
    return { available: false, message: '"' + name + '" is out of stock.' };
  }
  if (requested > stockN) {
    return {
      available: false,
      message: 'Only ' + stockN + ' of "' + name + '" ' + (stockN === 1 ? 'is' : 'are') + ' in stock.',
    };
  }
  return { available: true, message: '' };
}`
}

// ────────────────────────────────────────────────────────────────────
// PATTERN C: add-to-cart cart-aware limit check (step 11)
// ────────────────────────────────────────────────────────────────────

// Distinguishing fragments — these four together don't appear in any
// other AI-generated customHandler.
export const looksLikeAddToCartLimitCheck = (code: string): boolean => {
  if (typeof code !== 'string') {
    return false
  }
  if (code.indexOf(STOCK_DECREMENT_MARKER) >= 0) {
    return false
  }
  if (code.indexOf('canAdd') < 0) {
    return false
  }
  if (code.indexOf('shouldIncrement') < 0) {
    return false
  }
  if (code.indexOf('existingItemId') < 0) {
    return false
  }
  if (code.indexOf('maxQuantityPerProduct') < 0) {
    return false
  }
  return true
}

// Step 11 runs AFTER cart-get-items at step 10, so it has full cart
// context (params[13]) AND product context (params[6] — the product
// fetched in step 5). This handler does the FULL combined check:
//   * max-per-product cap (the AI already did this)
//   * cart-aware stock check: "existing cart qty + requested add qty
//     <= current DB stock?" (the AI didn't do this at all)
// Returns the same `{canAdd, message, existingItemId, shouldIncrement}`
// shape so the downstream IF-gate + cart-add / cart-update nodes
// keep working unchanged.
export const buildAddToCartLimitCheck = (): string => {
  return `${STOCK_DECREMENT_MARKER}
function customHandler(previousContext, params) {
  // Shape-walk every upstream context entry so node-order shifts in
  // future generations don't silently break this handler.
  var settingsCtx = null;
  var extractCtx = null;
  var foundCtx = null;
  var cartItems = [];
  for (var i = 0; i < params.length; i++) {
    var p = params[i];
    if (!p) continue;
    if (Array.isArray(p)) {
      // bare array of cart-items
      if (cartItems.length === 0 && p.length > 0 && p[0] && (p[0].productId || p[0].product_id)) {
        cartItems = p;
      }
      continue;
    }
    if (typeof p !== 'object') continue;
    if (!settingsCtx && 'stockManagement' in p && 'maxQuantityPerProduct' in p) settingsCtx = p;
    if (!foundCtx && 'found' in p && 'product' in p) foundCtx = p;
    if (!extractCtx && 'productId' in p && 'quantity' in p && !('found' in p) && !('product' in p)) extractCtx = p;
    if (cartItems.length === 0 && Array.isArray(p.items) && p.items.length > 0) cartItems = p.items;
  }

  var productId = extractCtx ? extractCtx.productId : '';
  var requestedQty = parseInt(extractCtx && extractCtx.quantity, 10);
  if (isNaN(requestedQty) || requestedQty <= 0) requestedQty = 1;

  // Find the existing cart entry for this product (if any).
  var existingItem = null;
  var existingQuantity = 0;
  for (var k = 0; k < cartItems.length; k++) {
    if (cartItems[k] && cartItems[k].productId === productId) {
      existingItem = cartItems[k];
      existingQuantity = Number(cartItems[k].quantity) || 0;
      break;
    }
  }
  var existingItemId = existingItem ? existingItem.id : null;
  var newQuantity = existingQuantity + requestedQty;

  // Name resolution: DB (definitive), then cart line, then trigger
  // payload, then a safe fallback.
  var product = foundCtx ? foundCtx.product : null;
  var name = (product && product.name) ||
    (existingItem && (existingItem.name || existingItem.productName)) ||
    (extractCtx && (extractCtx.name || extractCtx.productName)) ||
    'this product';

  // 1. Max-per-product cap (applies regardless of stock settings —
  //    a merchant who set maxQuantityPerProduct=5 wants that cap
  //    enforced even with backorders on).
  var maxQty = settingsCtx ? settingsCtx.maxQuantityPerProduct : null;
  if (maxQty != null && Number(maxQty) > 0 && newQuantity > Number(maxQty)) {
    return {
      canAdd: false,
      message: 'You can only have ' + maxQty + ' of "' + name + '" in your cart.',
      existingItemId: existingItemId,
      shouldIncrement: false,
    };
  }

  // 2. Cart-aware stock check (only when stock management is on
  //    AND backorders are NOT allowed). The new quantity (existing
  //    + requested) must not exceed available stock. NULL stock
  //    means "unlimited" — skipped.
  var stockManagement = settingsCtx ? settingsCtx.stockManagement : false;
  var allowBackorders = settingsCtx ? settingsCtx.allowBackorders : true;
  if (stockManagement && !allowBackorders && product) {
    var stock = product.quantity;
    if (stock != null) {
      var stockN = Number(stock);
      if (!isNaN(stockN) && newQuantity > stockN) {
        if (existingQuantity >= stockN) {
          return {
            canAdd: false,
            message: '"' + name + '" is out of stock.',
            existingItemId: existingItemId,
            shouldIncrement: false,
          };
        }
        var remaining = stockN - existingQuantity;
        return {
          canAdd: false,
          message: 'Only ' + remaining + ' more of "' + name + '" can be added (you have ' +
            existingQuantity + ' in cart, ' + stockN + ' in stock).',
          existingItemId: existingItemId,
          shouldIncrement: false,
        };
      }
    }
  }

  return {
    canAdd: true,
    message: '',
    existingItemId: existingItemId,
    shouldIncrement: existingItem !== null,
  };
}`
}

// Exposed for direct unit testing of the patterns + builders without
// going through the orchestrator.
export const __testables = {
  looksLikePlaceOrderAvailabilityCheck,
  looksLikeAddToCartStockCheck,
  looksLikeAddToCartLimitCheck,
  buildPlaceOrderAvailabilityCheck,
  buildAddToCartStockCheck,
  buildAddToCartLimitCheck,
}
