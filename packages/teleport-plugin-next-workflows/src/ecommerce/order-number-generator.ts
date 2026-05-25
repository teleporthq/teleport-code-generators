// Rewriter for the AI's `ORD-<token>` order-number generator.
//
// The AI emits a customHandler like:
//
//   function customHandler(params) {
//     var createOrderResult = params[14] || {};
//     var seq = createOrderResult.order_seq;
//     var fallback = createOrderResult.id != null ? String(createOrderResult.id) : "";
//     var token = seq != null && seq !== "" ? String(seq) : fallback;
//     return { result: "ORD-" + token };
//   }
//
// The hardcoded `params[14]` index breaks the moment the place-order
// workflow's node ordering shifts — the handler then reads the wrong
// upstream value (or undefined) and emits `"ORD-"` with no token. The
// URL `/order-details/ORD-` is then unresolvable.
//
// This rewriter shape-walks for the create-item result instead.
import { STOCK_DECREMENT_MARKER } from './stock-decrement'

export const looksLikeOrderNumberGenerator = (code: string): boolean => {
  if (typeof code !== 'string') {
    return false
  }
  if (code.indexOf(STOCK_DECREMENT_MARKER) >= 0) {
    return false
  }
  // Distinguishing fragments from the AI's verbatim handler.
  if (code.indexOf('"ORD-"') < 0 && code.indexOf("'ORD-'") < 0) {
    return false
  }
  if (code.indexOf('order_seq') < 0) {
    return false
  }
  if (code.indexOf('createOrderResult') < 0) {
    return false
  }
  return true
}

// Emit a shape-walking customHandler that finds the create-item
// result by its `{ id, ... order-row-ish }` shape instead of by
// positional index. Returns `{ result: "ORD-<token>" }` so the
// downstream save-as-order_number column-write keeps working.
export const buildOrderNumberGenerator = (): string => {
  return `${STOCK_DECREMENT_MARKER}
function customHandler(previousContext, params) {
  // Shape-walk for the order row created upstream by data-create-item.
  // We accept any object whose \`id\` looks like a UUID/string AND
  // carries at least one of the canonical order-row columns. This
  // matches both the create-item canonical shape and the
  // post-update enriched shape.
  function looksLikeOrderRow(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    if (!v.id || typeof v.id !== 'string' || v.id.length === 0) return false;
    return (
      'order_seq' in v ||
      'order_number' in v ||
      'total_amount' in v ||
      'customer_email' in v ||
      'billing_email' in v ||
      'payment_method' in v
    );
  }
  var orderRow = null;
  for (var i = 0; i < params.length; i++) {
    if (looksLikeOrderRow(params[i])) { orderRow = params[i]; break; }
  }

  // Token resolution priority:
  //   1. \`order_seq\` (Postgres serial column — human-readable, e.g. "1234")
  //   2. an existing \`order_number\` column value with the "ORD-" prefix
  //      already (the AI may have wired the workflow to fill it via
  //      sequence DEFAULT; in that case we don't want to double-prefix)
  //   3. the first 8 chars of the UUID id as a last-resort fallback
  //      so the URL is never empty (and so the post-payment webhook
  //      and order-details lookup both have something to match)
  var seq = orderRow ? orderRow.order_seq : null;
  var existing = orderRow ? orderRow.order_number : null;
  if (existing != null && typeof existing === 'string' && existing.indexOf('ORD-') === 0 && existing.length > 4) {
    return { result: existing };
  }
  var token = (seq != null && seq !== '') ? String(seq) :
              (orderRow && orderRow.id ? String(orderRow.id).slice(0, 8) : '');
  return { result: 'ORD-' + (token || 'unknown') };
}`
}
