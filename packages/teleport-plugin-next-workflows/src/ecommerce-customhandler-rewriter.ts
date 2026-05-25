// Settings-driven rewrites for AI-generated `general-custom-js` nodes that
// implement the e-commerce stock-management pipeline.
//
// The AI emits two customHandlers in the place-order workflow that we have
// to repair because they hard-code values the merchant configures via the
// e-commerce settings panel:
//
//   1. "low-stock SELECT-builder" — builds the post-decrement SELECT
//      statement that the data-api uses to detect low stock. The AI ships
//      `var THRESHOLD = 5;` regardless of the merchant's configured
//      `lowStockThreshold`. It also returns EVERY product at or below the
//      threshold, which causes alert spam for products that were already
//      low before this order. We replace it with a settings-driven version
//      that only returns products which CROSSED the threshold on this order.
//
//   2. "low-stock email-payload" — builds the per-alert payload (subject,
//      body, recipients, provider token). The AI ships empty strings for
//      every configurable value (SUBJECT='', BODY='', RECIPIENTS=[],
//      TOKEN_ENV_VAR='') so the node always returns {skip:true} at runtime.
//      The data-api fallback (`fireAndForgetLowStockAlert`) is what
//      actually sends the email now, so we explicitly no-op this node and
//      leave a clear marker so a future debugger doesn't think it's broken.
//
// Both rewrites are gated on a strict pattern match: we only touch nodes
// whose code shape matches the AI's known templates. Anything else is
// left untouched. If the AI's output drifts we'll surface the unrewritten
// node in the existing low-stock-rewrite test suite rather than silently
// continuing.

import { ProjectUIDL } from '@teleporthq/teleport-types'
import {
  STOCK_DECREMENT_MARKER,
  looksLikeStockDecrementBuilder,
  buildStockDecrementBuilder,
  reportStockWriteAudit,
} from './ecommerce/stock-decrement'
import {
  looksLikePlaceOrderAvailabilityCheck,
  looksLikeAddToCartStockCheck,
  looksLikeAddToCartLimitCheck,
  buildPlaceOrderAvailabilityCheck,
  buildAddToCartStockCheck,
  buildAddToCartLimitCheck,
} from './ecommerce/cart-availability'
import {
  looksLikeOrderNumberGenerator,
  buildOrderNumberGenerator,
} from './ecommerce/order-number-generator'
import {
  looksLikeOrderOwnershipHandler,
  buildOrderOwnershipReplacement,
} from './ecommerce/order-ownership'

const DEFAULT_THRESHOLD = 5

interface RewriteContext {
  threshold: number
  stockManagementEnabled: boolean
  lowStockAlertsEnabled: boolean
  allowBackorders: boolean
}

const buildContext = (uidl: ProjectUIDL): RewriteContext => {
  const ecom = uidl.ecommerceSettings as
    | {
        stockManagement?: boolean
        stockManagementConfig?: {
          lowStockThreshold?: number
          lowStockAlerts?: boolean
          allowBackorders?: boolean
          lowStockAlertConfig?: { provider?: string | null } | null
        } | null
      }
    | undefined
  const stockManagementEnabled = !!(ecom && ecom.stockManagement)
  const cfg = ecom && ecom.stockManagementConfig
  const lowStockAlertsEnabled = !!(
    stockManagementEnabled &&
    cfg &&
    cfg.lowStockAlerts &&
    cfg.lowStockAlertConfig &&
    cfg.lowStockAlertConfig.provider
  )
  const rawThreshold =
    cfg && typeof cfg.lowStockThreshold === 'number' ? cfg.lowStockThreshold : DEFAULT_THRESHOLD
  // A non-positive threshold makes the alert effectively dead (nothing is
  // ever "at or below 0" except an actual stock-out) and a negative one
  // makes the crossed-threshold math run backwards. Coerce to the safe
  // default — mirrors the same guard the data-api uses for the constant.
  const threshold = isFinite(rawThreshold) && rawThreshold >= 1 ? rawThreshold : DEFAULT_THRESHOLD
  // allowBackorders is a plain boolean in the settings panel; default to
  // FALSE (refuse to go negative) because that matches what most merchants
  // expect and what the existing stock-check endpoint already assumes.
  const allowBackorders = !!(cfg && cfg.allowBackorders === true)
  return { threshold, stockManagementEnabled, lowStockAlertsEnabled, allowBackorders }
}

// Marker string embedded in every replacement we emit. Single source
// of truth lives in `./ecommerce/stock-decrement.ts` so all of our
// generated customHandlers share one detection sentinel and idempotent
// re-runs are a no-op across every pattern below.
const REWRITER_MARKER = STOCK_DECREMENT_MARKER

// Pattern recognisers. We intentionally check several distinct fragments
// instead of one giant regex so that small AI-side wording changes
// (whitespace, variable rename) still match — the criteria are the
// SQL shape, the THRESHOLD variable, and the `quantity AS stock`
// projection that's unique to this customHandler.
const looksLikeLowStockSelectBuilder = (code: string): boolean => {
  if (typeof code !== 'string') {
    return false
  }
  if (code.indexOf(REWRITER_MARKER) >= 0) {
    return false
  }
  if (code.indexOf('teleport_products') < 0) {
    return false
  }
  if (code.indexOf('quantity AS stock') < 0) {
    return false
  }
  if (!/var\s+THRESHOLD\s*=\s*-?\d+/.test(code)) {
    return false
  }
  if (code.indexOf('quantity IS NOT NULL') < 0 && code.indexOf('quantity <=') < 0) {
    return false
  }
  return true
}

const looksLikeLowStockEmailPayload = (code: string): boolean => {
  if (typeof code !== 'string') {
    return false
  }
  if (code.indexOf(REWRITER_MARKER) >= 0) {
    return false
  }
  // Distinct combination of variables that only appears in the AI's
  // low-stock email-payload template.
  if (!/var\s+SUBJECT\s*=/.test(code)) {
    return false
  }
  if (!/var\s+BODY\s*=/.test(code)) {
    return false
  }
  if (!/var\s+RECIPIENTS\s*=/.test(code)) {
    return false
  }
  if (!/var\s+THRESHOLD\s*=/.test(code)) {
    return false
  }
  if (!/var\s+TOKEN_ENV_VAR\s*=/.test(code)) {
    return false
  }
  return true
}

// The stock-decrement customHandler pattern detector + replacement +
// audit live in `./ecommerce/stock-decrement.ts` — imported above as
// `looksLikeStockDecrementBuilder`, `buildStockDecrementBuilder`,
// and `reportStockWriteAudit`.

// The AI emits this customHandler right before `payment-charge-user`
// to build the Stripe checkout-session metadata. It reads the order-
// create result via a HARDCODED positional index (`params[14]`,
// `params[15]`) — fragile against any node addition/removal upstream.
// When the index is wrong, `orderId` becomes "" and Stripe stores an
// empty orderId in metadata; the post-payment webhook then SELECTs
// `WHERE id = ''` which Postgres rejects as an invalid UUID, the
// webhook 500s, the order stays at "pending", and the invoice is
// never generated.
const looksLikePaymentMetadataBuilder = (code: string): boolean => {
  if (typeof code !== 'string') {
    return false
  }
  if (code.indexOf(REWRITER_MARKER) >= 0) {
    return false
  }
  // Must build a metadataJson with orderId.
  if (code.indexOf('metadataJson') < 0) {
    return false
  }
  if (!/JSON\.stringify\s*\(\s*\{\s*orderId\s*:/.test(code)) {
    return false
  }
  // Must use the positional anti-pattern (params[<digit>]). Without
  // this we'd risk over-matching a future shape-walking version we
  // ourselves emit; but the REWRITER_MARKER short-circuit above
  // already handles that, so this check is belt-and-braces.
  if (!/params\[\s*\d+\s*\]/.test(code)) {
    return false
  }
  return true
}

// Settings-driven replacement: walks `params` to find both the cart items
// (for per-id deltas) and the upstream UPDATE-builder result (for the
// affected id list), then builds a SELECT that only returns products whose
// stock CROSSED the threshold on this order.
//
// The data-api's `looksLikeLowStockProductSelect` regex still matches
// because the SELECT keeps the same `FROM teleport_products WHERE
// quantity ... <= THRESHOLD` shape. `extractThresholdFromQuery` pulls
// the literal threshold straight from the WHERE clause, so the data-api
// stays in sync with the merchant's configured value automatically.
const buildLowStockSelectBuilder = (threshold: number): string => {
  const safeThreshold = JSON.stringify(threshold)
  return `${REWRITER_MARKER}
function customHandler(previousContext, params) {
  // Threshold baked from the merchant's e-commerce settings at generation
  // time. Do not hand-edit — regenerating the project will overwrite this.
  var THRESHOLD = ${safeThreshold};

  // 1. Prefer the IDs that the data-raw-query node ACTUALLY decremented
  //    (RETURNING result). When backorders are disallowed, some cart
  //    products may have been refused (insufficient stock) and we don't
  //    want them in the low-stock alert. The raw-query node returns
  //    { rows: [{id, new_quantity, old_quantity}, …] } — those are the
  //    rows that successfully decremented. If no such shape exists in
  //    params, fall back to the upstream { affected: […] } list
  //    (legacy / unrewritten UPDATE-builder).
  var affected = null;
  for (var i = 0; i < params.length; i++) {
    var p = params[i];
    if (p && Array.isArray(p.rows) && p.rows.length > 0 &&
        p.rows[0] && p.rows[0].id && 'new_quantity' in p.rows[0]) {
      affected = p.rows.map(function(r) { return String(r.id); });
      break;
    }
  }
  if (!affected) {
    for (var ai = 0; ai < params.length; ai++) {
      var pa = params[ai];
      if (pa && Array.isArray(pa.affected)) { affected = pa.affected; break; }
    }
  }
  if (!affected || affected.length === 0) {
    return { query: "SELECT id, name, quantity AS stock, COALESCE(sku, '') AS sku FROM teleport_products WHERE 1=0" };
  }

  // 2. Find the cart items that drove the decrement so we can compute the
  //    per-id delta. We accept either { items: [...] } (cart-get-items
  //    shape) or a bare array (legacy callers). Multiple cart entries for
  //    the same product id sum into the same delta.
  var cartItems = null;
  for (var ci = 0; ci < params.length; ci++) {
    var c = params[ci];
    if (c && Array.isArray(c.items)) { cartItems = c.items; break; }
    if (Array.isArray(c) && c.length > 0 && c[0] && (c[0].productId || c[0].product_id)) {
      cartItems = c; break;
    }
  }
  var deltas = {};
  if (cartItems) {
    for (var k = 0; k < cartItems.length; k++) {
      var it = cartItems[k];
      if (!it) continue;
      var pid = it.productId || it.product_id;
      if (!pid) continue;
      var qty = parseInt(it.quantity, 10);
      if (isNaN(qty) || qty <= 0) qty = 1;
      var key = String(pid);
      deltas[key] = (deltas[key] || 0) + qty;
    }
  }

  // 3. Build SELECT with crossed-threshold filter. The CASE-expression
  //    evaluates the per-row delta, so the final guard is
  //      quantity > THRESHOLD - delta_for_this_row
  //    which is equivalent to: old_stock (= quantity + delta) > THRESHOLD.
  //    Products that were already at or below the threshold BEFORE this
  //    order are skipped — no alert spam on repeat orders.
  var ids = [];
  var caseExpr = '';
  for (var ai = 0; ai < affected.length; ai++) {
    var raw = String(affected[ai]);
    var safeId = raw.replace(/'/g, "''");
    ids.push("'" + safeId + "'");
    var d = deltas[raw] || 0;
    if (d > 0) {
      caseExpr += " WHEN '" + safeId + "' THEN " + d;
    }
  }
  if (ids.length === 0) {
    return { query: "SELECT id, name, quantity AS stock, COALESCE(sku, '') AS sku FROM teleport_products WHERE 1=0" };
  }
  // If we have no deltas (cart items unavailable for any reason) we fall
  // back to "any row at or below threshold". Worst case: a single spammy
  // alert on the next request — same behaviour as before the rewrite.
  var crossedClause = caseExpr.length > 0
    ? " AND quantity > " + THRESHOLD + " - (CASE id" + caseExpr + " ELSE 0 END)"
    : "";
  var query = "SELECT id, name, quantity AS stock, COALESCE(sku, '') AS sku FROM teleport_products"
    + " WHERE quantity IS NOT NULL AND quantity <= " + THRESHOLD
    + " AND id IN (" + ids.join(',') + ")"
    + crossedClause;
  return { query: query };
}`
}

// Settings-driven replacement for the AI's positional-index payment-
// metadata builder. Instead of reading `params[14]` we walk params
// looking for the order-create-item result by shape — same approach
// the AI uses correctly elsewhere in the same workflow (e.g. the
// cart-deltas customHandler at the top of seg-3). The shape signal
// is "an object with an id and at least one column unique to the
// orders table" (total_amount / customer_email / order_number / …).
// This makes the lookup robust against ANY upstream reordering.
const buildPaymentMetadataBuilder = (): string => {
  return `${REWRITER_MARKER}
function customHandler(params) {
  // Walk params looking for the order-create-item result. We accept
  // either the canonical shape (id + total_amount, set by
  // data-create-item) or any object whose id field is a non-empty
  // string. The first match wins because the create-item node is
  // upstream of any post-create reads.
  function looksLikeOrderRow(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    if (!v.id || typeof v.id !== 'string' || v.id.length === 0) return false;
    return (
      'total_amount' in v ||
      'order_number' in v ||
      'customer_email' in v ||
      'billing_email' in v ||
      'shipping_email' in v ||
      'payment_method' in v ||
      'fulfillment_method' in v
    );
  }
  var orderRow = null;
  for (var i = 0; i < params.length; i++) {
    if (looksLikeOrderRow(params[i])) { orderRow = params[i]; break; }
  }

  // Walk params again for an upstream order-number generator. The AI
  // typically emits a node that returns { result: "ORD-1234" }; if we
  // can't find one, fall back to the order row's own order_number
  // column, then to the id as a last resort so the URL is non-empty.
  var orderNumberFromUpstream = '';
  for (var j = 0; j < params.length; j++) {
    var q = params[j];
    if (q && typeof q === 'object' && !Array.isArray(q) &&
        typeof q.result === 'string' && /^[A-Z]{2,6}-/.test(q.result)) {
      orderNumberFromUpstream = q.result;
      break;
    }
  }

  var orderId = orderRow ? String(orderRow.id) : '';
  var orderNumber = orderNumberFromUpstream ||
    (orderRow && orderRow.order_number ? String(orderRow.order_number) : '') ||
    (orderId ? 'ORD-' + orderId.slice(0, 8) : '');

  return {
    successUrl: '/order-details/' + (orderNumber || 'unknown') + '?payment=success',
    cancelUrl: '/checkout',
    description: 'Order ' + (orderNumber || orderId || 'pending'),
    // Stripe / PayPal stash this string in their session metadata; the
    // post-payment webhook customHandler reads metadata.orderId to
    // look up the row. An empty string here breaks the webhook with a
    // UUID coercion error in Postgres — the safe-query wrapper in
    // /api/data degrades to "no rows" so the webhook returns a clean
    // "Order not found" instead of a 500.
    metadataJson: JSON.stringify({ orderId: orderId, orderNumber: orderNumber }),
  };
}`
}

// Settings-driven replacement for the AI's broken email-payload node.
// We intentionally do NOT dispatch the email from this node — the
// data-api auto-fire in `pages/api/data/[...params].js` already POSTs
// to `/api/ecommerce/low-stock-alert` on every detected SELECT, and the
// alert endpoint renders the merchant's configured subject + body
// templates. Doing it twice would deliver duplicates.
const buildLowStockEmailPayloadNoOp = (): string => {
  return `${REWRITER_MARKER}
function customHandler(previousContext, params) {
  // Low-stock email dispatch is handled by the data-api auto-fire
  // (see pages/api/data/[...params].js -> fireAndForgetLowStockAlert),
  // which POSTs to /api/ecommerce/low-stock-alert with the rows from the
  // upstream SELECT. The endpoint renders the subject + body templates
  // configured in the e-commerce settings panel. Returning skip:true
  // here keeps the workflow chain happy without producing a duplicate
  // email.
  return { skip: true, reason: 'handled-by-data-api-autofire' };
}`
}

interface RewriteSummary {
  selectBuilderRewrites: number
  emailPayloadRewrites: number
  paymentMetadataBuilderRewrites: number
  stockDecrementBuilderRewrites: number
  placeOrderAvailabilityRewrites: number
  addToCartStockCheckRewrites: number
  addToCartLimitCheckRewrites: number
  orderNumberGeneratorRewrites: number
  orderOwnershipRewrites: number
}

// Walks the project UIDL, locates every workflow node that matches one of
// the AI's low-stock customHandler patterns, and replaces its `config.code`
// with a settings-driven version. Mutates the UIDL in place; returns a
// summary for tests / debug logging.
export const rewriteLowStockCustomHandlers = (uidl: ProjectUIDL): RewriteSummary => {
  const summary: RewriteSummary = {
    selectBuilderRewrites: 0,
    emailPayloadRewrites: 0,
    paymentMetadataBuilderRewrites: 0,
    stockDecrementBuilderRewrites: 0,
    placeOrderAvailabilityRewrites: 0,
    addToCartStockCheckRewrites: 0,
    addToCartLimitCheckRewrites: 0,
    orderNumberGeneratorRewrites: 0,
    orderOwnershipRewrites: 0,
  }
  if (!uidl.workflows || !uidl.workflows.workflows) {
    return summary
  }

  const ctx = buildContext(uidl)
  // If stock management is off entirely we still neutralise the broken
  // email-payload node (so it doesn't end up dispatching nothing forever)
  // but we leave the SELECT-builder alone — the data-api gate is also
  // off, so its output is harmless either way.
  const replacementSelect = buildLowStockSelectBuilder(ctx.threshold)
  const replacementEmailNoOp = buildLowStockEmailPayloadNoOp()
  const replacementMetadataBuilder = buildPaymentMetadataBuilder()
  const replacementStockDecrement = buildStockDecrementBuilder(ctx.allowBackorders)
  // Cart-availability replacements: bake `allowBackorders` into the
  // place-order pre-flight check so the runtime doesn't have to read
  // settings on every order. The add-to-cart builders read settings
  // from `params[2]` (the upstream ecommerce-get-settings node), so
  // they don't need the flag baked in.
  const replacementPlaceOrderAvailability = buildPlaceOrderAvailabilityCheck(ctx.allowBackorders)
  const replacementAddToCartStockCheck = buildAddToCartStockCheck()
  const replacementAddToCartLimitCheck = buildAddToCartLimitCheck()
  const replacementOrderNumberGenerator = buildOrderNumberGenerator()

  const visit = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) {
      return
    }
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i] as { type?: string; config?: { code?: string } } | undefined
      if (!node || node.type !== 'general-custom-js') {
        continue
      }
      const code = node.config && node.config.code
      if (typeof code !== 'string' || code.length === 0) {
        continue
      }
      if (looksLikeLowStockSelectBuilder(code) && ctx.stockManagementEnabled) {
        node.config!.code = replacementSelect
        summary.selectBuilderRewrites++
        continue
      }
      if (looksLikeLowStockEmailPayload(code)) {
        node.config!.code = replacementEmailNoOp
        summary.emailPayloadRewrites++
        continue
      }
      // Payment-metadata rewrite is independent of e-commerce settings
      // — it's a correctness fix (positional indexing → shape-walking)
      // that applies wherever the AI emitted this pattern, even if the
      // merchant later toggles e-commerce off.
      if (looksLikePaymentMetadataBuilder(code)) {
        node.config!.code = replacementMetadataBuilder
        summary.paymentMetadataBuilderRewrites++
        continue
      }
      // Stock-decrement UPDATE-builder. Only rewrite when stock
      // management is on — if the merchant turned it off entirely we
      // leave the AI's customHandler alone (the SQL will still run
      // but the merchant has explicitly opted out of stock concerns).
      if (ctx.stockManagementEnabled && looksLikeStockDecrementBuilder(code)) {
        node.config!.code = replacementStockDecrement
        summary.stockDecrementBuilderRewrites++
        continue
      }
      // Place-order pre-flight availability check. Only meaningful
      // when stock management is on; otherwise the AI's no-op
      // shortcut already returns "all available" which is what we'd
      // emit anyway.
      if (ctx.stockManagementEnabled && looksLikePlaceOrderAvailabilityCheck(code)) {
        node.config!.code = replacementPlaceOrderAvailability
        summary.placeOrderAvailabilityRewrites++
        continue
      }
      // Add-to-cart step 8 stock check. Same gate — only when stock
      // management is on; otherwise the AI's permissive check is
      // already correct behaviour.
      if (ctx.stockManagementEnabled && looksLikeAddToCartStockCheck(code)) {
        node.config!.code = replacementAddToCartStockCheck
        summary.addToCartStockCheckRewrites++
        continue
      }
      // Add-to-cart step 11 cart-aware limit + stock check. Rewrite
      // unconditionally because the new builder ALWAYS enforces
      // maxQuantityPerProduct, even when stock management is off —
      // that cap is independent of stock and shipping in the AI's
      // original behaviour. (The stock-check branch inside the
      // builder is itself gated on the merchant's settings at
      // runtime.)
      if (looksLikeAddToCartLimitCheck(code)) {
        node.config!.code = replacementAddToCartLimitCheck
        summary.addToCartLimitCheckRewrites++
        continue
      }
      // Order-number generator. The AI emits a positional-params
      // handler that hardcodes \`params[14]\` for the create-item
      // result; when the node order shifts in a future generation
      // the handler reads the wrong upstream and returns \`"ORD-"\`
      // with no token, breaking the order-details URL and the
      // post-payment webhook lookup. Rewrite unconditionally —
      // shape-walking is always correct regardless of stock
      // management or backorder settings.
      if (looksLikeOrderNumberGenerator(code)) {
        node.config!.code = replacementOrderNumberGenerator
        summary.orderNumberGeneratorRewrites++
        continue
      }
      // Orders-list / order-details ownership SQL. The AI's default
      // builder OR-merges a localStorage-supplied \`anonymousUserId\`
      // into the WHERE clause, which (a) leaks orders to logged-in
      // users that don't belong to them and (b) is trivially spoofable.
      // The rewriter swaps in a strict variant that scopes by the
      // authenticated session ONLY for logged-in users, by anon-id
      // ONLY for anonymous users, and \`1=0\` when no identity is
      // present. Rewrite unconditionally — this is a security boundary
      // and we want it enforced regardless of stock / e-commerce
      // settings.
      if (looksLikeOrderOwnershipHandler(code)) {
        node.config!.code = buildOrderOwnershipReplacement(code)
        summary.orderOwnershipRewrites++
        continue
      }
    }
  }

  const workflows = uidl.workflows.workflows as Record<string, { nodes?: unknown }>
  for (const wf of Object.values(workflows)) {
    visit(wf && wf.nodes)
  }

  const customNodes = (uidl.workflows.customNodes || {}) as Record<string, { nodes?: unknown }>
  for (const cn of Object.values(customNodes)) {
    visit(cn && cn.nodes)
  }

  // After our own rewrites have run, audit the FINAL workflow set for
  // any teleport_products write site that isn't a known-good shape
  // (admin CRUD or the place-order decrement). Anything unexpected is
  // surfaced via console.warn so a future AI version that drifts gets
  // caught at generation time, not in production. See
  // ./ecommerce/stock-decrement.ts for the contract.
  reportStockWriteAudit(uidl)

  return summary
}

// Exposed for direct unit testing of the pattern matchers and code
// templates without spinning up a full project UIDL fixture.
export const __testables = {
  looksLikeLowStockSelectBuilder,
  looksLikeLowStockEmailPayload,
  looksLikePaymentMetadataBuilder,
  looksLikeStockDecrementBuilder,
  buildLowStockSelectBuilder,
  buildLowStockEmailPayloadNoOp,
  buildPaymentMetadataBuilder,
  buildStockDecrementBuilder,
  DEFAULT_THRESHOLD,
}
