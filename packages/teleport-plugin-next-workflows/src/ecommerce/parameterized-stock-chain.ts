// Rewrites for the PARAMETERIZED place-order stock chain.
//
// Newer UIDLs (built by the GUI's `order-side-effects-helper.ts`) no longer
// assemble stock SQL inside a customHandler — the SQL is a static string on a
// `data-raw-query` node and the cart-derived DATA rides as bound params:
//
//   [Build Stock Decrement Data]  general-custom-js (client)
//        returns { ids, qtys, affected }
//   [Decrement Product Stock]     data-raw-query
//        UPDATE teleport_products … FROM unnest($1::text[], $2::int[]) …
//   [Clear Cached Product Data]   cache-invalidate
//   [Detect Low-Stock Products]   data-raw-query
//        SELECT … FROM teleport_products WHERE quantity <= N AND id = ANY($1)
//   [Build Low-Stock Email Payload] general-custom-js (server)
//
// That chain shipped with three defects this module repairs at generation
// time (mutating the UIDL in place, same contract as the legacy rewriters in
// `ecommerce-customhandler-rewriter.ts`):
//
//   1. VARIANT STOCK WAS NEVER DECREMENTED. The data builder dropped
//      `variantId` on the floor and pushed every line's productId, so a
//      variant purchase decremented nothing (variant-carrying products keep
//      their own per-variant `teleport_product_variants.quantity`).
//   2. VARIANT LOW-STOCK WAS NEVER DETECTED, so the low-stock alert email
//      only ever fired for variant-less products.
//   3. Duplicate cart lines of the SAME product collapsed to the FIRST
//      line's quantity instead of the SUM (two variants of one product are
//      two cart lines sharing a productId — the second was dropped).
//
// The replacements keep every downstream contract intact:
//   * the decrement stays ONE statement (bound params forbid multi-statement
//     execution) — a data-modifying CTE updates both tables atomically;
//   * `UPDATE teleport_products AS p SET quantity = p.quantity - d.qty` is
//     preserved verbatim so the stock-write auditor keeps classifying the
//     node as `order-decrement` (see ORDER_DECREMENT_SQL_RE);
//   * the low-stock SELECT keeps `FROM teleport_products` + `quantity <= N`
//     so the data-api's `looksLikeLowStockProductSelect` auto-fire and its
//     `extractThresholdFromQuery` keep matching;
//   * both queries are re-baked from the CURRENT merchant settings on every
//     generation (threshold, backorders), in either direction, so toggling a
//     setting is always reflected on the next export.

import { STOCK_DECREMENT_MARKER } from './stock-decrement'

// ────────────────────────────────────────────────────────────────────
// Cart-deltas data builder (general-custom-js, client)
// ────────────────────────────────────────────────────────────────────

// The GUI-emitted original: `var seen = {}` first-occurrence dedup, product
// ids only, `return { ids: ids, qtys: qtys, affected: ids }`. The absence of
// any variant handling is part of the fingerprint so we never re-match our
// own replacement (which also carries the shared rewrite marker).
export const looksLikeCartDeltasBuilder = (code: string): boolean => {
  if (typeof code !== 'string') {
    return false
  }
  if (code.indexOf(STOCK_DECREMENT_MARKER) >= 0) {
    return false
  }
  if (code.indexOf('variantIds') >= 0) {
    return false
  }
  if (!/return\s*\{\s*ids:\s*ids,\s*qtys:\s*qtys,\s*affected:\s*ids\s*\}/.test(code)) {
    return false
  }
  if (code.indexOf('productId') < 0 || code.indexOf('product_id') < 0) {
    return false
  }
  return true
}

// Already-variant-aware shape: OUR rewrite (carries the marker) or the GUI's
// own current template (`buildDecrementStockScript` in
// apps/gui/.../order-side-effects-helper.ts emits the same contract with no
// marker). Idempotent re-runs leave the builder alone; the sibling queries are
// still re-baked from current settings every run.
export const isRewrittenCartDeltasBuilder = (code: string): boolean => {
  if (typeof code !== 'string') {
    return false
  }
  if (code.indexOf('variantIds') < 0 || code.indexOf('variantQtys') < 0) {
    return false
  }
  return /affected:\s*ids/.test(code)
}

// Variant-aware replacement. Two behaviour changes vs the original:
//   * a cart line that carries a variantId feeds the VARIANT arrays and does
//     NOT touch the product arrays — variant stock lives per-variant, and the
//     parent product's own quantity (usually NULL = untracked) must not be
//     double-decremented for the same physical unit;
//   * duplicate ids SUM their quantities instead of keeping the first line.
// Returns the same `ids` / `qtys` / `affected` keys the queries already bind,
// plus `variantIds` / `variantQtys` / `variantAffected` for the new `$3`/`$4`.
export const buildCartDeltasBuilder = (): string => {
  return `${STOCK_DECREMENT_MARKER}
function customHandler(previousContext, params) {
  var cartItems = null;
  // Walk params from the start to find a cart-get-items result or any node
  // exposing { items: [...] }. Defensive: we do not hard-code an index so
  // appending new nodes to the workflow does not break this resolver.
  for (var i = 0; i < params.length; i++) {
    var p = params[i];
    if (p && Array.isArray(p.items)) { cartItems = p.items; break; }
    if (Array.isArray(p)) { cartItems = p; break; }
  }
  var ids = [];
  var qtys = [];
  var variantIds = [];
  var variantQtys = [];
  var productIndex = {};
  var variantIndex = {};
  if (cartItems) {
    for (var k = 0; k < cartItems.length; k++) {
      var it = cartItems[k];
      if (!it) { continue; }
      var qty = parseInt(it.quantity, 10);
      if (isNaN(qty) || qty <= 0) { qty = 1; }
      var vid = it.variantId || it.variant_id;
      if (vid) {
        // Variant line: decrement the VARIANT's own stock, never the parent
        // product's (two variants of one product are independent stocks).
        var vkey = String(vid);
        if (variantIndex[vkey] == null) {
          variantIndex[vkey] = variantIds.length;
          variantIds.push(vkey);
          variantQtys.push(0);
        }
        variantQtys[variantIndex[vkey]] += qty;
        continue;
      }
      var pid = it.productId || it.product_id;
      if (!pid) { continue; }
      var key = String(pid);
      if (productIndex[key] == null) {
        productIndex[key] = ids.length;
        ids.push(key);
        qtys.push(0);
      }
      // SUM duplicate lines: qty=3 + qty=3 of the same product is 6 units.
      qtys[productIndex[key]] += qty;
    }
  }
  return {
    ids: ids,
    qtys: qtys,
    affected: ids,
    variantIds: variantIds,
    variantQtys: variantQtys,
    variantAffected: variantIds
  };
}`
}

// ────────────────────────────────────────────────────────────────────
// Stock-decrement statement (data-raw-query)
// ────────────────────────────────────────────────────────────────────

// Matches BOTH the GUI's products-only original and our variant-aware CTE, so
// every generation re-bakes the statement from the CURRENT `allowBackorders`
// setting (the toggle must reach already-rewritten projects too).
export const isParameterizedStockDecrementQuery = (query: string): boolean => {
  if (typeof query !== 'string') {
    return false
  }
  if (query.indexOf('teleport_products') < 0) {
    return false
  }
  if (query.indexOf('unnest($1::text[], $2::int[])') < 0) {
    return false
  }
  return /UPDATE\s+teleport_products\s+AS\s+p\s+SET\s+quantity\s*=\s*p\.quantity\s*-\s*d\.qty/i.test(
    query
  )
}

// One statement, both tables. The product UPDATE rides in a data-modifying
// CTE — Postgres executes it exactly once even though nothing reads its
// output — because the raw-query endpoint binds params and therefore cannot
// run two `;`-separated statements. `quantity IS NOT NULL` preserves the
// NULL-means-unlimited contract on both tables.
//
// `allowBackorders` picks the guard:
//   * true  → unconditional decrement; stock may go negative, which records
//             exactly how far the merchant oversold (they opted in);
//   * false → `quantity >= qty` refuses a decrement that would cross zero.
//             Postgres row-level UPDATE locking serialises concurrent orders,
//             so the second order re-checks against the post-first value —
//             the guard is what makes the race unable to drive stock negative.
export const buildParameterizedStockDecrementQuery = (allowBackorders: boolean): string => {
  const productGuard = allowBackorders ? '' : ' AND p.quantity >= d.qty'
  const variantGuard = allowBackorders ? '' : ' AND v.quantity >= d.qty'
  return [
    'WITH product_decrement AS (',
    'UPDATE teleport_products AS p SET quantity = p.quantity - d.qty, updated_at = NOW()',
    'FROM unnest($1::text[], $2::int[]) AS d(id, qty)',
    `WHERE p.quantity IS NOT NULL AND p.id::text = d.id${productGuard}`,
    ')',
    'UPDATE teleport_product_variants AS v SET quantity = v.quantity - d.qty, updated_at = NOW()',
    'FROM unnest($3::text[], $4::int[]) AS d(id, qty)',
    `WHERE v.quantity IS NOT NULL AND v.id::text = d.id${variantGuard}`,
  ].join(' ')
}

// ────────────────────────────────────────────────────────────────────
// Low-stock detection SELECT (data-raw-query)
// ────────────────────────────────────────────────────────────────────

// Matches the GUI's products-only original AND our UNION replacement (both
// carry `FROM teleport_products` + a literal `quantity <= N`), so the
// threshold is re-baked from settings on every generation.
export const isParameterizedLowStockSelect = (query: string): boolean => {
  if (typeof query !== 'string') {
    return false
  }
  if (!/^\s*SELECT\b/i.test(query)) {
    return false
  }
  if (!/\bFROM\s+teleport_products\b/i.test(query)) {
    return false
  }
  if (!/quantity\s+AS\s+stock/i.test(query)) {
    return false
  }
  if (!/quantity\s*<=\s*\d+/i.test(query)) {
    return false
  }
  // Both shapes bind the id list; anything else is not this chain's SELECT.
  return query.indexOf('::text[]') >= 0
}

// Products + variants in one UNION, restricted to the rows this order
// decremented AND to the rows that CROSSED the threshold on this order
// (`quantity + qty > threshold` reconstructs the pre-order value), so a
// product that was already low before this order does not re-alert on every
// subsequent purchase.
//
// Both id columns are cast to text: `teleport_products.id` is a uuid while
// `teleport_product_variants.id` is a varchar slug — without the cast the
// UNION would fail to type-resolve.
//
// The variant row's `name` is the parent product's name plus the variant's
// sku (or its options-derived id slug, e.g. `size-xl-color-blue-1a2b3c`,
// when no sku is set) — the variants table has no display-name column, and
// `options` is a TEXT column that must NOT be cast to json in SQL (one
// malformed row would abort the whole SELECT and silence every alert).
//
// The emitted SQL keeps `FROM teleport_products` and a literal
// `quantity <= N` so the data-api auto-fire recognises it and extracts the
// threshold — that auto-fire is what actually delivers the email.
export const buildParameterizedLowStockSelect = (threshold: number): string => {
  const safeThreshold = Number.isFinite(threshold) && threshold >= 1 ? threshold : 5
  return [
    "SELECT p.id::text AS id, p.name AS name, p.quantity AS stock, COALESCE(p.sku, '') AS sku",
    'FROM teleport_products AS p',
    'JOIN unnest($1::text[], $2::int[]) AS d(id, qty) ON p.id::text = d.id',
    `WHERE p.quantity IS NOT NULL AND p.quantity <= ${safeThreshold} AND p.quantity + d.qty > ${safeThreshold}`,
    'UNION ALL',
    "SELECT v.id::text AS id, (p.name || ' — ' || COALESCE(NULLIF(v.sku, ''), v.id::text)) AS name, v.quantity AS stock, COALESCE(v.sku, '') AS sku",
    'FROM teleport_product_variants AS v',
    'JOIN teleport_products AS p ON p.id = v.product_id',
    'JOIN unnest($3::text[], $4::int[]) AS d(id, qty) ON v.id::text = d.id',
    `WHERE v.quantity IS NOT NULL AND v.quantity <= ${safeThreshold} AND v.quantity + d.qty > ${safeThreshold}`,
  ].join(' ')
}

// ────────────────────────────────────────────────────────────────────
// Chain rewrite
// ────────────────────────────────────────────────────────────────────

interface WorkflowContextParam {
  path: [string, string]
  type: 'workflowContext'
  nodeId: string
}

const wfCtxParam = (nodeId: string, key: string): WorkflowContextParam => ({
  path: [nodeId, key],
  type: 'workflowContext',
  nodeId,
})

// $1..$4 for both rewritten queries: product ids, product qtys, variant ids,
// variant qtys — all read from the (rewritten) cart-deltas builder node.
const buildChainParams = (deltasNodeId: string): WorkflowContextParam[] => [
  wfCtxParam(deltasNodeId, 'ids'),
  wfCtxParam(deltasNodeId, 'qtys'),
  wfCtxParam(deltasNodeId, 'variantIds'),
  wfCtxParam(deltasNodeId, 'variantQtys'),
]

export interface ParameterizedChainRewriteSummary {
  deltasBuilderRewrites: number
  decrementQueryRewrites: number
  lowStockSelectRewrites: number
  skippedChains: number
}

interface LooseNode {
  id?: string
  type?: string
  config?: {
    code?: string
    query?: string
    params?: unknown
  }
}

const firstParamNodeId = (node: LooseNode): string | null => {
  const params = node.config?.params
  if (!Array.isArray(params) || params.length === 0) {
    return null
  }
  const first = params[0] as { nodeId?: string; path?: unknown } | undefined
  if (!first || typeof first.nodeId !== 'string' || first.nodeId.length === 0) {
    return null
  }
  return first.nodeId
}

// Rewrites one workflow's (or custom node's) parameterized stock chain in
// place. The chain is located from the DECREMENT query (the one node whose
// shape is unambiguous), then the companion nodes are resolved through the
// param wiring — never through positional assumptions:
//   * the cart-deltas builder is the node the decrement's `$1` reads from;
//   * the low-stock SELECT is the sibling raw-query whose params read from
//     that same builder.
// If the builder node is missing or does not match any known shape (AI /
// template drift), the WHOLE chain is left untouched and a warn is emitted —
// a decrement rewritten to expect `$3`/`$4` that nothing provides would
// silently stop decrementing anything.
export const rewriteParameterizedStockChainInNodes = (
  nodes: unknown,
  ownerName: string,
  options: { threshold: number; allowBackorders: boolean },
  summary: ParameterizedChainRewriteSummary
): void => {
  if (!Array.isArray(nodes)) {
    return
  }
  const nodeById = new Map<string, LooseNode>()
  for (const n of nodes as LooseNode[]) {
    if (n && typeof n.id === 'string') {
      nodeById.set(n.id, n)
    }
  }

  for (const node of nodes as LooseNode[]) {
    if (!node || node.type !== 'data-raw-query') {
      continue
    }
    const query = node.config?.query
    if (typeof query !== 'string' || !isParameterizedStockDecrementQuery(query)) {
      continue
    }

    const deltasNodeId = firstParamNodeId(node)
    const deltasNode = deltasNodeId ? nodeById.get(deltasNodeId) : undefined
    const deltasCode = deltasNode?.config?.code

    if (
      !deltasNodeId ||
      !deltasNode ||
      typeof deltasCode !== 'string' ||
      !(looksLikeCartDeltasBuilder(deltasCode) || isRewrittenCartDeltasBuilder(deltasCode))
    ) {
      summary.skippedChains++
      // eslint-disable-next-line no-console
      console.warn(
        '[teleport] parameterized stock chain: found the decrement query in "' +
          ownerName +
          '" but its cart-deltas builder node is missing or has drifted — ' +
          'leaving the chain untouched. Variant stock will NOT decrement for this workflow.'
      )
      continue
    }

    if (looksLikeCartDeltasBuilder(deltasCode)) {
      deltasNode.config!.code = buildCartDeltasBuilder()
      summary.deltasBuilderRewrites++
    }

    node.config!.query = buildParameterizedStockDecrementQuery(options.allowBackorders)
    node.config!.params = buildChainParams(deltasNodeId)
    summary.decrementQueryRewrites++

    // The low-stock SELECT is the sibling raw-query bound to the same
    // builder. Matched by wiring + shape rather than by label so a renamed
    // node still rewrites, and an unrelated raw-query never does.
    for (const sibling of nodes as LooseNode[]) {
      if (!sibling || sibling === node || sibling.type !== 'data-raw-query') {
        continue
      }
      const siblingQuery = sibling.config?.query
      if (typeof siblingQuery !== 'string' || !isParameterizedLowStockSelect(siblingQuery)) {
        continue
      }
      if (firstParamNodeId(sibling) !== deltasNodeId) {
        continue
      }
      sibling.config!.query = buildParameterizedLowStockSelect(options.threshold)
      sibling.config!.params = buildChainParams(deltasNodeId)
      summary.lowStockSelectRewrites++
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// Variant-picker resolver (general-custom-js, client)
// ────────────────────────────────────────────────────────────────────

// The storefront variant picker's click resolver gates `selectedId` /
// `addEnabled` through this exact helper. With backorders (or with stock
// management off) an EXISTING combination must stay purchasable at zero
// stock — only a combination that does not exist remains unavailable.
// The swap is a targeted line replacement (not a whole-handler rewrite): the
// rest of the resolver evolves with the GUI template and must ride through
// untouched. It is BIDIRECTIONAL so toggling the setting re-bakes projects
// in either direction on their next generation.
const PICKER_IN_STOCK_GATED =
  'function inStock(v){ return !v ? false : (v.quantity == null || v.quantity > 0); }'
const PICKER_IN_STOCK_UNGATED = 'function inStock(v){ /* teleport:allow-backorders */ return !!v; }'

export const rewriteVariantPickerStockGate = (
  code: string,
  stockNeverBlocks: boolean
): string | null => {
  if (typeof code !== 'string') {
    return null
  }
  // Fingerprint of the picker resolver — both fields are load-bearing in its
  // return shape and appear in no other generated handler.
  if (code.indexOf('addEnabled') < 0 || code.indexOf('variantsJson') < 0) {
    return null
  }
  if (stockNeverBlocks && code.indexOf(PICKER_IN_STOCK_GATED) >= 0) {
    return code.split(PICKER_IN_STOCK_GATED).join(PICKER_IN_STOCK_UNGATED)
  }
  if (!stockNeverBlocks && code.indexOf(PICKER_IN_STOCK_UNGATED) >= 0) {
    return code.split(PICKER_IN_STOCK_UNGATED).join(PICKER_IN_STOCK_GATED)
  }
  return null
}

// Exposed for direct unit testing.
export const __testables = {
  PICKER_IN_STOCK_GATED,
  PICKER_IN_STOCK_UNGATED,
}
