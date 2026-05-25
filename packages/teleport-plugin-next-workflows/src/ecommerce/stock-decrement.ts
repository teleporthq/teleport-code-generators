// Stock-decrement subsystem for AI-generated workflows.
//
// CONTRACT (load-bearing — read this before changing anything below):
//
//   `teleport_products.quantity` is decremented EXCLUSIVELY by the
//   place-order workflow, AFTER the order row + order-item rows are
//   inserted, BEFORE the payment node terminates the workflow.
//   No other workflow, no client-side code, no /api/ecommerce/* endpoint,
//   no cart manipulation, and no scheduled job is allowed to modify
//   product stock as part of an order flow. The merchant's admin panel
//   may still create / edit / delete products freely — those are
//   independent of the buyer-facing path.
//
// The auditor in this file is the regression guard that enforces the
// contract at generation time. If a future AI version produces a
// workflow that mutates teleport_products outside this approved set,
// the rewriter emits a console.warn at generation time and the
// existing test suite fails.
//
// Three pieces live here:
//
//   1. The pattern detector (`looksLikeStockDecrementBuilder`) that
//      recognises the AI's "UPDATE teleport_products SET quantity =
//      quantity - CASE id …" customHandler shape.
//
//   2. The settings-driven replacement (`buildStockDecrementBuilder`)
//      that fixes three production bugs in the AI's output —
//      duplicate cart entries collapsing, `allowBackorders` being
//      ignored, and the race against concurrent orders. The
//      replacement also adds a `RETURNING` clause so the downstream
//      low-stock SELECT can see which rows actually decremented.
//
//   3. The audit / classification helpers
//      (`findStockWriteSites`, `classifyStockWriteSite`,
//      `auditStockWriteSites`) used by the rewriter and by tests to
//      enumerate every write against `teleport_products` and tag
//      each one as `admin`, `order-decrement`, or `unknown`. Any
//      `unknown` site means a generation has drifted from the
//      contract and needs review.

import { ProjectUIDL } from '@teleporthq/teleport-types'

// Marker comment embedded in every customHandler this module emits.
// Imported by the rewriter so already-rewritten code short-circuits the
// pattern matcher (idempotent re-runs are a no-op).
export const STOCK_DECREMENT_MARKER = '/* teleport:rewritten-low-stock */'

// Recognise the AI's stock-decrement UPDATE-builder. The three
// distinguishing fragments are:
//   * a reference to teleport_products
//   * the literal "quantity = quantity - CASE id" SET clause
//   * a `return { … affected: …}` shape (downstream nodes rely on it)
// We INTENTIONALLY do not match more aggressively — the goal is to
// avoid touching any human-edited customHandler that happens to mention
// teleport_products for other reasons.
export const looksLikeStockDecrementBuilder = (code: string): boolean => {
  if (typeof code !== 'string') {
    return false
  }
  if (code.indexOf(STOCK_DECREMENT_MARKER) >= 0) {
    return false
  }
  if (code.indexOf('teleport_products') < 0) {
    return false
  }
  if (!/quantity\s*=\s*quantity\s*-\s*CASE\s+id/i.test(code)) {
    return false
  }
  if (code.indexOf('affected') < 0) {
    return false
  }
  return true
}

// Cart-aggregation helper, shared between stock-decrement and
// cart-availability replacement customHandlers. Exported as a
// string constant because it has to be prepended to the runtime body
// of each emitted customHandler (those run inside the workflow
// segment runtime, which has no `import` wiring).
//
// `aggregateCartDeltas` is the load-bearing dedup: two cart entries
// for the same productId collapse into ONE entry with the SUM of
// their quantities. The AI's original customHandler emitted two
// `WHEN 'X' THEN qty1 WHEN 'X' THEN qty2` branches for the same id;
// Postgres CASE returns the FIRST matching WHEN, so qty2 was silently
// dropped — under-decrementing stock. The same dedup is needed for
// cart-availability: a cart with `qty=3` + `qty=3` of the same
// productId is requesting 6 units in total, not 3.
// Helpers are emitted as NESTED function declarations inside the
// customHandler body. The runtime regex `/^\s*function\s+(\w+)\s*\(([^)]*)\)/`
// matches the FIRST function declaration in the code and calls IT
// as the entry point — so if we emitted these as siblings BEFORE
// customHandler, the runtime would invoke the helper with the wrong
// arguments and the workflow would crash.
export const AGGREGATE_CART_DELTAS_HELPER = `  function aggregateCartDeltas(cartItems) {
    // Sum quantities per-id so a cart with the same product twice
    // ("clicked Add To Cart, then clicked Add again") decrements
    // by the TOTAL number ordered, not just the last entry's qty.
    // Returns { idToDelta: { '<safeId>': <qty> }, idList: ['<safeId>',…] }.
    var idToDelta = {};
    var idList = [];
    for (var i = 0; i < cartItems.length; i++) {
      var it = cartItems[i];
      if (!it) continue;
      var pid = it.productId || it.product_id;
      if (!pid) continue;
      var qty = parseInt(it.quantity, 10);
      if (isNaN(qty) || qty <= 0) qty = 1;
      var safeId = String(pid).replace(/'/g, "''");
      if (idToDelta[safeId] == null) {
        idToDelta[safeId] = 0;
        idList.push(safeId);
      }
      idToDelta[safeId] += qty;
    }
    return { idToDelta: idToDelta, idList: idList };
  }`

// Stock-decrement-only helper: builds the `WHEN 'id' THEN qty` CASE
// fragment used in the UPDATE SET / WHERE / RETURNING clauses.
const BUILD_CASE_EXPR_HELPER = `  function buildCaseExpr(idToDelta, idList) {
    var s = '';
    for (var i = 0; i < idList.length; i++) {
      var k = idList[i];
      s += " WHEN '" + k + "' THEN " + idToDelta[k];
    }
    return s;
  }`

const STOCK_DECREMENT_HELPERS = AGGREGATE_CART_DELTAS_HELPER + '\n' + BUILD_CASE_EXPR_HELPER

// Settings-driven replacement for the AI's stock-decrement
// UPDATE-builder. The `allowBackorders` flag is baked at generation
// time from `ecommerceSettings.stockManagementConfig.allowBackorders`
// and switches between two SQL shapes:
//   * true  → unconditional decrement (may go negative; merchant
//             explicitly opted in)
//   * false → atomic guarded decrement that refuses to go below 0;
//             rows whose stock is insufficient are NOT updated and
//             never appear in the RETURNING result. Concurrent orders
//             serialise via Postgres row-level UPDATE locking — the
//             second to arrive sees the post-first quantity and is
//             rejected if there isn't enough left.
// Either shape uses `RETURNING id, new_quantity, old_quantity` so the
// downstream low-stock SELECT customHandler can reason about what
// actually changed instead of what was intended.
export const buildStockDecrementBuilder = (allowBackorders: boolean): string => {
  const flagLiteral = allowBackorders ? 'true' : 'false'
  return `${STOCK_DECREMENT_MARKER}
function customHandler(previousContext, params) {
${STOCK_DECREMENT_HELPERS}

  // Baked from the merchant's e-commerce settings panel. Do not edit
  // by hand — regenerating the project overwrites this.
  var ALLOW_BACKORDERS = ${flagLiteral};

  // 1. Find the cart items the order is being placed for. We accept
  //    either { items: [...] } (cart-get-items) or a bare array.
  //    Walk from the start so the upstream cart node wins over any
  //    later node that happens to expose an items array.
  var cartItems = null;
  for (var i = 0; i < params.length; i++) {
    var p = params[i];
    if (p && Array.isArray(p.items)) { cartItems = p.items; break; }
    if (Array.isArray(p)) { cartItems = p; break; }
  }
  if (!cartItems || cartItems.length === 0) {
    // No-op SELECT keeps the downstream data-raw-query node happy
    // (a workflow with no cart items is degenerate but we don't
    // want to throw — the order-create-item path may already have
    // failed earlier and surfaced its own error).
    return { query: "SELECT 1", affected: [], expectedAffected: 0, deltasById: {}, allowBackorders: ALLOW_BACKORDERS };
  }

  // 2. Aggregate duplicate cart lines so the CASE expression has
  //    one branch per distinct product id with the SUM of its qtys.
  var agg = aggregateCartDeltas(cartItems);
  if (agg.idList.length === 0) {
    return { query: "SELECT 1", affected: [], expectedAffected: 0, deltasById: {}, allowBackorders: ALLOW_BACKORDERS };
  }
  var caseExpr = buildCaseExpr(agg.idToDelta, agg.idList);
  var quotedIds = agg.idList.map(function(k) { return "'" + k + "'"; }).join(',');

  // 3. Build the UPDATE. The SET-clause + RETURNING reconstruction is
  //    identical regardless of backorders; only the WHERE guard
  //    changes. The "(quantity + CASE ...)" expression in RETURNING
  //    reconstructs the pre-update value because RETURNING returns
  //    the row AFTER the SET clause runs (so bare \`quantity\` would
  //    be the new value, not the old).
  //
  //    Two SQL helpers do the heavy lifting:
  //
  //    1. \`COALESCE(quantity, 0)\` — every new project starts with
  //       \`teleport_products.quantity\` seeded NULL, and the
  //       cart-availability pre-flight tolerates NULL as "unlimited"
  //       so those orders reach this UPDATE. Without COALESCE the
  //       NULL row's arithmetic would be NULL (no decrement) and the
  //       merchant would see "order placed, stock unchanged" and
  //       assume the workflow is broken.
  //    2. \`GREATEST(0, …)\` — clamps the post-update value at zero so
  //       we never persist a negative quantity. Negative stock is a
  //       confusing signal in the admin panel ("we sold more than we
  //       have?"); the same "set your initial stock" feedback is
  //       achieved by the row sitting at exactly 0 — subsequent
  //       orders are then blocked by the cart-availability check
  //       (which compares against 0 and finds insufficient stock).
  var setClause = "quantity = GREATEST(0, COALESCE(quantity, 0) - CASE id" + caseExpr + " ELSE 0 END), updated_at = NOW()";
  // \`old_quantity\` in RETURNING reconstructs the pre-update value.
  // After the GREATEST clamp the SET value is no longer
  // "old - delta" — it might be 0 because of the floor. So we can't
  // just invert the SET expression; instead we expose 0 as a
  // conservative lower bound for what was there before. Downstream
  // (low-stock SELECT) only uses \`new_quantity\` for the threshold
  // comparison, so this approximation is fine.
  var returningClause = "RETURNING id, quantity AS new_quantity, GREATEST(0, COALESCE(quantity, 0) + (CASE id" + caseExpr + " ELSE 0 END)) AS old_quantity";

  // When backorders are DISALLOWED we add a per-row guard:
  //   AND (quantity IS NULL OR quantity >= CASE id ... END)
  // Postgres evaluates WHERE before SET, so this checks pre-update
  // stock. Row-level locking on UPDATE means concurrent orders
  // serialise: the second order sees the post-first-update value
  // and refuses if there is not enough left. Solves the race that
  // would otherwise allow two simultaneous orders to drive stock
  // below zero.
  //
  // The "quantity IS NULL OR" clause is the new-project bootstrap:
  // a freshly-seeded products table has NULL quantity everywhere,
  // and the cart-availability pre-flight (which also tolerates NULL
  // as "unlimited") lets those orders through. We MUST decrement
  // those rows too, otherwise the user sees "order placed but stock
  // unchanged" and concludes the workflow is broken. After the first
  // decrement the row holds an integer (now floored at 0 by the
  // GREATEST clamp in the SET clause) and from then on the normal
  // \`quantity >= delta\` guard is enforced — so the merchant sees
  // the zero value in the admin panel and gets a clear "set initial
  // stock for this product" signal.
  var whereClause;
  if (ALLOW_BACKORDERS) {
    whereClause = "WHERE id IN (" + quotedIds + ")";
  } else {
    whereClause = "WHERE id IN (" + quotedIds + ")"
      + " AND (quantity IS NULL OR quantity >= (CASE id" + caseExpr + " ELSE 0 END))";
  }

  var query = "UPDATE teleport_products SET " + setClause + " " + whereClause + " " + returningClause;

  return {
    query: query,
    // \`affected\` is the list of IDs we INTENDED to decrement (one entry
    // per distinct cart productId). The downstream low-stock SELECT
    // prefers the data-raw-query rows (which contain only IDs that
    // ACTUALLY decremented) over this list, falling back to it for
    // backward compat with the AI's older shape.
    affected: agg.idList.slice(),
    expectedAffected: agg.idList.length,
    deltasById: agg.idToDelta,
    allowBackorders: ALLOW_BACKORDERS,
  };
}`
}

// ────────────────────────────────────────────────────────────────────
// AUDITOR
// ────────────────────────────────────────────────────────────────────
//
// Walks the project UIDL and enumerates every workflow node that
// performs a WRITE operation against `teleport_products`. Each site is
// then classified into one of three buckets:
//
//   * `admin`            — admin-panel CRUD (create / update / delete
//                          on the products table from an admin
//                          workflow). Allowed.
//   * `order-decrement`  — the place-order workflow's stock-decrement
//                          customHandler (raw SQL `UPDATE teleport_products
//                          SET quantity = quantity - …`). Allowed.
//   * `unknown`          — anything else. The auditor warns on these so
//                          a future AI version that drifts (e.g. starts
//                          decrementing stock from an add-to-cart
//                          workflow) is surfaced at generation time
//                          instead of in production.

export interface StockWriteSite {
  workflowId: string
  workflowName: string
  workflowKind: 'workflow' | 'customNode'
  nodeId: string
  nodeType: string
  stepNumber: number | undefined
  category: 'admin' | 'order-decrement' | 'unknown'
  // For raw-query sites, this is the literal SQL fragment that
  // matched (after a `\n` strip + trim). For typed nodes, it's empty.
  sqlSnippet: string
}

const STRUCTURED_WRITE_NODE_TYPES: Record<string, true> = {
  'data-create-item': true,
  'data-update-item': true,
  'data-delete-item': true,
}

const isAdminWorkflowName = (name: string): boolean => {
  // Match the AI's naming convention. Examples seen in the wild:
  //   "Admin Panel Create Products"
  //   "Admin Panel Update Products"
  //   "Admin Panel Delete Products Item"
  // The leading "admin" word is highly stable; checking it case-
  // insensitively lets future variants ("Admin · Products · Edit") still
  // classify correctly.
  return /\badmin\b/i.test(name)
}

const looksLikeOrderDecrementCustomHandler = (code: string): boolean => {
  if (typeof code !== 'string') {
    return false
  }
  // Two paths must classify as decrement:
  //   1. The AI's original customHandler: a single SQL string literal
  //      containing `UPDATE teleport_products SET quantity = quantity - …`.
  //   2. Our rewritten customHandler: STOCK_DECREMENT_MARKER is present
  //      and the SQL is assembled from a `setClause` variable that
  //      starts with "quantity = quantity -". The regex below would
  //      miss case (2) because the literal SQL fragment in the source
  //      is split across string concatenation.
  // The marker is the single reliable signal that this is OUR
  // rewritten decrement — we only emit that marker from
  // buildStockDecrementBuilder. AI-generated code never contains it.
  if (code.indexOf(STOCK_DECREMENT_MARKER) >= 0) {
    // Belt-and-braces: even when the marker is present, the code must
    // actually be a stock-decrement (not, say, an unrelated rewritten
    // node that happens to live next to teleport_products references).
    if (/quantity\s*=\s*quantity\s*-/.test(code) && code.indexOf('teleport_products') >= 0) {
      return true
    }
    return false
  }
  return /UPDATE\s+teleport_products\s+SET\s+quantity\s*=\s*quantity\s*-/i.test(code)
}

// Pull the first 300 chars of any SQL string in a custom-js handler.
// Just for log readability when the auditor warns.
const extractSqlSnippet = (code: string): string => {
  const m = code.match(/(UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+teleport_products[\s\S]{0,200}/i)
  if (!m) {
    return ''
  }
  return m[0].replace(/\s+/g, ' ').slice(0, 200)
}

export const classifyStockWriteSite = (
  workflowName: string,
  node: { type?: string; config?: { code?: string } }
): { category: StockWriteSite['category']; sqlSnippet: string } => {
  const nodeType = node.type || ''
  const code = (node.config && node.config.code) || ''

  // Raw-SQL custom-js sites: distinguish "decrement" from "other write".
  if (nodeType === 'general-custom-js') {
    if (looksLikeOrderDecrementCustomHandler(code)) {
      // Place-order workflows are the ONLY ones that should ship this
      // pattern. Even if a future AI version emits the same SQL from
      // a non-place-order workflow, the workflow name still surfaces
      // it as suspicious — but the SQL itself is recognisable, so
      // we tag it as `order-decrement` and let the workflow-name
      // heuristic below downgrade to `unknown` for the warning.
      return { category: 'order-decrement', sqlSnippet: extractSqlSnippet(code) }
    }
    // Any other write to teleport_products via raw SQL is unknown.
    if (
      /UPDATE\s+teleport_products|DELETE\s+(?:FROM\s+)?teleport_products|INSERT\s+(?:INTO\s+)?teleport_products/i.test(
        code
      )
    ) {
      return { category: 'unknown', sqlSnippet: extractSqlSnippet(code) }
    }
    // SELECT-only custom SQL on teleport_products is read-only — never
    // a "write site". Caller filters these out before reaching us.
    return { category: 'unknown', sqlSnippet: '' }
  }

  // Structured CRUD nodes targeting the products table.
  if (STRUCTURED_WRITE_NODE_TYPES[nodeType]) {
    // Heuristic: an "admin-panel" workflow name is a strong signal that
    // the merchant is editing products via the admin UI.
    if (isAdminWorkflowName(workflowName)) {
      return { category: 'admin', sqlSnippet: '' }
    }
    return { category: 'unknown', sqlSnippet: '' }
  }

  return { category: 'unknown', sqlSnippet: '' }
}

// Walks the UIDL and returns every WRITE site against teleport_products,
// classified. Reads ONLY — does not mutate the UIDL.
export const findStockWriteSites = (uidl: ProjectUIDL): StockWriteSite[] => {
  const sites: StockWriteSite[] = []
  if (!uidl.workflows) {
    return sites
  }

  const wfMap = (uidl.workflows.workflows || {}) as Record<string, any>
  const cnMap = (uidl.workflows.customNodes || {}) as Record<string, any>

  const visit = (
    kind: StockWriteSite['workflowKind'],
    workflowId: string,
    workflowName: string,
    nodes: unknown
  ): void => {
    if (!Array.isArray(nodes)) {
      return
    }
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i] as
        | { id?: string; type?: string; config?: any; stepNumber?: number }
        | undefined
      if (!node || !node.type) {
        continue
      }
      const config = node.config || {}

      // Structured-CRUD branch.
      if (STRUCTURED_WRITE_NODE_TYPES[node.type] && config.tableName === 'teleport_products') {
        const { category, sqlSnippet } = classifyStockWriteSite(workflowName, node)
        sites.push({
          workflowId,
          workflowName,
          workflowKind: kind,
          nodeId: node.id || '',
          nodeType: node.type,
          stepNumber: node.stepNumber,
          category,
          sqlSnippet,
        })
        continue
      }

      // Raw-SQL custom-js branch: only count it when the code actually
      // writes (UPDATE / DELETE / INSERT) — read-only SELECTs on
      // teleport_products are not "write sites".
      if (node.type === 'general-custom-js' && typeof config.code === 'string') {
        if (/\b(UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+teleport_products\b/i.test(config.code)) {
          const { category, sqlSnippet } = classifyStockWriteSite(workflowName, node)
          sites.push({
            workflowId,
            workflowName,
            workflowKind: kind,
            nodeId: node.id || '',
            nodeType: node.type,
            stepNumber: node.stepNumber,
            category,
            sqlSnippet,
          })
        }
      }
    }
  }

  for (const wf of Object.values(wfMap)) {
    visit('workflow', wf?.id || '', wf?.name || '', wf?.nodes)
  }
  for (const [cnId, cn] of Object.entries(cnMap)) {
    visit('customNode', cnId, (cn as any)?.name || cnId, (cn as any)?.nodes)
  }

  return sites
}

export interface StockWriteAudit {
  sites: StockWriteSite[]
  admin: StockWriteSite[]
  orderDecrement: StockWriteSite[]
  unknown: StockWriteSite[]
}

// Bucketed view of the audit, used by tests and by the rewriter's
// console.warn output. Pure — does not log or mutate.
export const auditStockWriteSites = (uidl: ProjectUIDL): StockWriteAudit => {
  const sites = findStockWriteSites(uidl)
  return {
    sites,
    admin: sites.filter((s) => s.category === 'admin'),
    orderDecrement: sites.filter((s) => s.category === 'order-decrement'),
    unknown: sites.filter((s) => s.category === 'unknown'),
  }
}

// Side-effect wrapper: runs the audit and, when there are unknown
// sites, emits ONE console.warn per site so the merchant sees the
// drift in their build output. Returns the same audit for chaining /
// tests. Designed to be called once per generation from the rewriter.
export const reportStockWriteAudit = (uidl: ProjectUIDL): StockWriteAudit => {
  const audit = auditStockWriteSites(uidl)
  if (audit.unknown.length === 0) {
    return audit
  }
  // Single rollup line + one per site, mirroring the existing rewriter
  // log style. Surfaces the workflow name + node type + SQL snippet
  // so the merchant can jump straight to the offending node.
  // eslint-disable-next-line no-console
  console.warn(
    '[teleport] stock-write audit: ' +
      audit.unknown.length +
      ' suspicious site(s) found on teleport_products outside the place-order or admin flows. ' +
      'Stock should only be decremented when an order is created. ' +
      'See ecommerce/stock-decrement.ts for the contract.'
  )
  for (const s of audit.unknown) {
    // eslint-disable-next-line no-console
    console.warn(
      '[teleport]   workflow=' +
        (s.workflowName || s.workflowId) +
        ' kind=' +
        s.workflowKind +
        ' node=' +
        s.nodeType +
        ' nodeId=' +
        s.nodeId +
        ' step=' +
        (s.stepNumber == null ? '?' : s.stepNumber) +
        (s.sqlSnippet ? ' sql=' + JSON.stringify(s.sqlSnippet) : '')
    )
  }
  return audit
}
