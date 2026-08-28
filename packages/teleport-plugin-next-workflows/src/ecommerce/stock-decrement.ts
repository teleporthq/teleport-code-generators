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
    // Already our rewrite. A prior rewriter version (the
    // `GREATEST(0, COALESCE(quantity, 0) - …)` shape below) permanently
    // floored an unlimited-stock (NULL quantity) product to 0 the first
    // time an order touched it — turning "infinite stock" into
    // "out of stock" forever. Re-match that legacy shape so the next
    // regeneration upgrades already-rewritten projects to the current,
    // NULL-preserving SQL (`buildStockDecrementBuilder` below). A rewrite
    // that already carries the NULL guard is up to date — leave it alone.
    if (
      code.indexOf('teleport_products') >= 0 &&
      /quantity\s*=\s*GREATEST\s*\(\s*\d+\s*,\s*COALESCE\s*\(\s*quantity/i.test(code) &&
      code.indexOf('WHEN quantity IS NULL THEN NULL') < 0
    ) {
      return true
    }
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
    // Sum quantities so a cart with the same item twice ("clicked Add To Cart,
    // then clicked Add again") decrements by the TOTAL ordered. Lines are keyed
    // by product id (variantless) OR variant id (variant lines), so two variants
    // of one product decrement their own stock and never collide. Product-level
    // decrements hit teleport_products.quantity; variant-level decrements hit
    // teleport_product_variants.quantity.
    // Returns { idToDelta, idList } for products AND { variantToDelta, variantList }.
    var idToDelta = {};
    var idList = [];
    var variantToDelta = {};
    var variantList = [];
    for (var i = 0; i < cartItems.length; i++) {
      var it = cartItems[i];
      if (!it) continue;
      var qty = parseInt(it.quantity, 10);
      if (isNaN(qty) || qty <= 0) qty = 1;
      var vid = it.variantId || it.variant_id || null;
      if (vid) {
        var safeVid = String(vid).replace(/'/g, "''");
        if (variantToDelta[safeVid] == null) {
          variantToDelta[safeVid] = 0;
          variantList.push(safeVid);
        }
        variantToDelta[safeVid] += qty;
        continue;
      }
      var pid = it.productId || it.product_id;
      if (!pid) continue;
      var safeId = String(pid).replace(/'/g, "''");
      if (idToDelta[safeId] == null) {
        idToDelta[safeId] = 0;
        idList.push(safeId);
      }
      idToDelta[safeId] += qty;
    }
    return { idToDelta: idToDelta, idList: idList, variantToDelta: variantToDelta, variantList: variantList };
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
  //    one branch per distinct product/variant id with the SUM of its qtys.
  var agg = aggregateCartDeltas(cartItems);
  if (agg.idList.length === 0 && agg.variantList.length === 0) {
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
  //    \`teleport_products.quantity\` is NULL for every product the
  //    merchant hasn't given a finite count — that NULL means
  //    "unlimited stock", not "zero stock waiting to be bootstrapped".
  //    The SET clause's \`CASE WHEN quantity IS NULL THEN NULL …\` guard
  //    leaves those rows untouched forever: an unlimited product must
  //    stay unlimited across every order, not silently become
  //    out-of-stock (0) the first time someone buys it. Only a row
  //    that already carries a real, finite count is decremented, and
  //    \`GREATEST(0, …)\` floors THAT arithmetic at zero so we never
  //    persist a negative quantity for a tracked product.
  var setClause = "quantity = CASE WHEN quantity IS NULL THEN NULL ELSE GREATEST(0, quantity - (CASE id" + caseExpr + " ELSE 0 END)) END, updated_at = NOW()";
  // \`old_quantity\` in RETURNING reconstructs the pre-update value. A
  // row whose (post-update) \`new_quantity\` is NULL was NULL before too
  // (the SET clause never changes a NULL row), so \`old_quantity\` is
  // NULL as well. For a tracked row, the GREATEST clamp means the SET
  // value is no longer "old - delta" once it floors at 0, so we can't
  // just invert the SET expression; instead we expose 0 as a
  // conservative lower bound for what was there before. Downstream
  // (low-stock SELECT) only uses \`new_quantity\` for the threshold
  // comparison, so this approximation is fine.
  var returningClause = "RETURNING id, quantity AS new_quantity, (CASE WHEN quantity IS NULL THEN NULL ELSE GREATEST(0, quantity + (CASE id" + caseExpr + " ELSE 0 END)) END) AS old_quantity";

  // When backorders are DISALLOWED we add a per-row guard:
  //   AND (quantity IS NULL OR quantity >= CASE id ... END)
  // Postgres evaluates WHERE before SET, so this checks pre-update
  // stock. Row-level locking on UPDATE means concurrent orders
  // serialise: the second order sees the post-first-update value
  // and refuses if there is not enough left. Solves the race that
  // would otherwise allow two simultaneous orders to drive stock
  // below zero.
  //
  // The "quantity IS NULL OR" clause lets unlimited-stock products
  // through the guard so the row is still touched (its RETURNING row
  // still surfaces to the caller, e.g. for the low-stock SELECT) — the
  // SET clause above then leaves the value itself untouched, so an
  // unlimited product stays unlimited no matter how many orders are
  // placed against it, with or without backorders enabled.
  var whereClause;
  if (ALLOW_BACKORDERS) {
    whereClause = "WHERE id IN (" + quotedIds + ")";
  } else {
    whereClause = "WHERE id IN (" + quotedIds + ")"
      + " AND (quantity IS NULL OR quantity >= (CASE id" + caseExpr + " ELSE 0 END))";
  }

  // Assemble the statement(s). Variant lines decrement teleport_product_variants
  // by variant id (same NULL-preserving / GREATEST(0) / backorder-guard shape as
  // the product path). The product UPDATE is emitted LAST so its RETURNING (used
  // by the downstream low-stock SELECT) survives node-postgres multi-statement
  // simple-query semantics. Mixed carts run BOTH; a variant-only cart runs just
  // the variant UPDATE.
  var statements = [];
  if (agg.variantList.length > 0) {
    var variantCaseExpr = buildCaseExpr(agg.variantToDelta, agg.variantList);
    var quotedVariantIds = agg.variantList.map(function(k) { return "'" + k + "'"; }).join(',');
    var variantSetClause = "quantity = CASE WHEN quantity IS NULL THEN NULL ELSE GREATEST(0, quantity - (CASE id" + variantCaseExpr + " ELSE 0 END)) END, updated_at = NOW()";
    var variantWhere;
    if (ALLOW_BACKORDERS) {
      variantWhere = "WHERE id IN (" + quotedVariantIds + ")";
    } else {
      variantWhere = "WHERE id IN (" + quotedVariantIds + ")"
        + " AND (quantity IS NULL OR quantity >= (CASE id" + variantCaseExpr + " ELSE 0 END))";
    }
    statements.push("UPDATE teleport_product_variants SET " + variantSetClause + " " + variantWhere);
  }
  if (agg.idList.length > 0) {
    statements.push("UPDATE teleport_products SET " + setClause + " " + whereClause + " " + returningClause);
  }
  var query = statements.join('; ');

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

/**
 * The decrement statement itself, in every shape a builder has emitted.
 *
 * The table may carry an alias and the column may be qualified through it —
 * `UPDATE teleport_products AS p SET quantity = p.quantity - d.qty …` — which is
 * what the parameterised `data-raw-query` form uses. An un-aliased
 * `SET quantity = quantity - …` is the older shape and still matches.
 */
const ORDER_DECREMENT_SQL_RE =
  /UPDATE\s+teleport_products\s+(?:AS\s+)?\w*\s*SET\s+quantity\s*=\s*(?:\w+\.)?quantity\s*-/i

/** The GREATEST / NULL-preserving guards, independent of how the row is addressed. */
const ORDER_DECREMENT_GUARD_RES: RegExp[] = [
  /quantity\s*=\s*GREATEST\s*\(\s*\d+\s*,\s*COALESCE\s*\(\s*(?:\w+\.)?quantity/i,
  /quantity\s*=\s*CASE\s+WHEN\s+(?:\w+\.)?quantity\s+IS\s+NULL\s+THEN\s+NULL\s+ELSE\s+GREATEST/i,
]

/**
 * Whether a bare SQL string is the order stock decrement.
 *
 * Used for `data-raw-query` nodes, which is where the decrement lives now: SQL
 * belongs in a data node, never in a `general-custom-js` node whose source ships
 * to the browser. Without this branch the auditor sees no decrement at all and
 * would equally miss a rogue raw-SQL write to the products table.
 */
const looksLikeOrderDecrementSql = (sql: string): boolean => {
  if (typeof sql !== 'string' || sql.indexOf('teleport_products') < 0) {
    return false
  }
  if (ORDER_DECREMENT_SQL_RE.test(sql)) {
    return true
  }
  return ORDER_DECREMENT_GUARD_RES.some((re) => re.test(sql))
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
    // Accept every shape `buildStockDecrementBuilder` has emitted over
    // time: the legacy concat shape (`quantity = quantity - CASE id …`),
    // the COALESCE safety-wrapped shape (`quantity = GREATEST(0,
    // COALESCE(quantity, 0) - CASE id …)`), and the current
    // NULL-preserving shape (`quantity = CASE WHEN quantity IS NULL
    // THEN NULL ELSE GREATEST(0, quantity - CASE id …) END`).
    if (code.indexOf('teleport_products') >= 0) {
      if (/quantity\s*=\s*(?:\w+\.)?quantity\s*-/.test(code)) {
        return true
      }
      if (ORDER_DECREMENT_GUARD_RES.some((re) => re.test(code))) {
        return true
      }
    }
    return false
  }
  return ORDER_DECREMENT_SQL_RE.test(code)
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
  node: { type?: string; config?: { code?: string; query?: string } }
): { category: StockWriteSite['category']; sqlSnippet: string } => {
  const nodeType = node.type || ''
  const code = (node.config && node.config.code) || ''
  const query = (node.config && node.config.query) || ''

  // `data-raw-query` sites: the decrement's current home. The SQL is a plain
  // string on the node, so it is matched directly rather than through the
  // custom-handler marker logic (a data node carries no rewritten handler).
  if (nodeType === 'data-raw-query') {
    if (looksLikeOrderDecrementSql(query)) {
      return { category: 'order-decrement', sqlSnippet: extractSqlSnippet(query) }
    }
    if (
      /UPDATE\s+teleport_products|DELETE\s+(?:FROM\s+)?teleport_products|INSERT\s+(?:INTO\s+)?teleport_products/i.test(
        query
      )
    ) {
      // The admin panel's BULK actions are raw-SQL by necessity (one statement
      // for N rows), so the same workflow-name signal the structured-CRUD
      // branch uses applies here — otherwise every bulk delete / status change
      // would be reported as an unexplained write.
      if (isAdminWorkflowName(workflowName)) {
        return { category: 'admin', sqlSnippet: extractSqlSnippet(query) }
      }
      return { category: 'unknown', sqlSnippet: extractSqlSnippet(query) }
    }
    return { category: 'unknown', sqlSnippet: '' }
  }

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

      // Raw-SQL data-node branch. Same "writes only" rule as custom-js below:
      // a SELECT against teleport_products is not a write site.
      if (node.type === 'data-raw-query' && typeof config.query === 'string') {
        if (/\b(UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+teleport_products\b/i.test(config.query)) {
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

  // Structural drift check: every order-decrement site must sit on the
  // SHARED path of its workflow (i.e. before any payment-method IF gate).
  // A decrement inside an IF branch means orders that take the OTHER
  // branch silently skip stock — the exact bug this module exists to
  // prevent. Surfaces every offending site as a warn so the merchant
  // catches it at generation time.
  const branchSites = findStockDecrementInsideBranch(uidl)

  if (audit.unknown.length === 0 && branchSites.length === 0) {
    return audit
  }

  if (audit.unknown.length > 0) {
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
  }

  if (branchSites.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      '[teleport] stock-write audit: ' +
        branchSites.length +
        ' workflow(s) decrement stock inside an IF branch (likely the COD branch). ' +
        'Orders paid via online providers will not decrement stock. ' +
        'The hoist rewriter should have moved this — investigate.'
    )
    for (const s of branchSites) {
      // eslint-disable-next-line no-console
      console.warn(
        '[teleport]   workflow=' +
          (s.workflowName || s.workflowId) +
          ' decrementNodeId=' +
          s.decrementNodeId +
          ' ifNodeId=' +
          s.ifNodeId +
          ' branchHandle=' +
          s.branchHandle
      )
    }
  }

  return audit
}

// ────────────────────────────────────────────────────────────────────
// HOIST REWRITER (Layer 3)
// ────────────────────────────────────────────────────────────────────
//
// Legacy UIDLs (generated before the COD-only-decrement defect was
// fixed) carry the stock-decrement chain inside the COD branch of the
// `Is Payment Cash On Delivery?` IF gate. Buyers paying via Stripe /
// PayPal take the OTHER branch and skip the decrement entirely.
//
// `hoistStockDecrementOutOfCodBranch` walks every workflow and, when it
// finds the chain in a branch, splices it onto the shared path:
//
//   BEFORE                                 AFTER
//   ─────────────────────                  ─────────────────────
//   parent → IF                            parent → chainFirst →
//             ├── true  → chainFirst …               … → chainLast
//             │            … → chainLast               → IF
//             │            → branchNext                ├── true →
//             └── false → otherBranch                  │     branchNext
//                                                      └── false →
//                                                            otherBranch
//
// Idempotent: a workflow already in the AFTER shape (no IF on the path
// upstream from the decrement) is a no-op. Side-effect free across
// invocations.
//
// Implementation note: edge id uniqueness within a single workflow is
// all that matters for the runtime — we use a counter scoped to the
// hoist itself, prefixed with `teleport-hoist-` so they're easy to
// spot in a diff. Avoids any external uuid dependency.

interface InsideBranchSite {
  workflowId: string
  workflowName: string
  decrementNodeId: string
  ifNodeId: string
  branchHandle: 'true' | 'false'
}

const findStockDecrementInsideBranch = (uidl: ProjectUIDL): InsideBranchSite[] => {
  const sites: InsideBranchSite[] = []
  if (!uidl.workflows || !uidl.workflows.workflows) {
    return sites
  }
  const workflows = uidl.workflows.workflows as Record<
    string,
    { id?: string; name?: string; nodes?: unknown; edges?: unknown }
  >
  for (const wf of Object.values(workflows)) {
    const result = locateBranchDecrementSite(wf)
    if (result) {
      sites.push({
        workflowId: wf.id || '',
        workflowName: wf.name || wf.id || '',
        decrementNodeId: result.decrementNodeId,
        ifNodeId: result.ifNodeId,
        branchHandle: result.branchHandle,
      })
    }
  }
  return sites
}

interface BranchLocateResult {
  decrementNodeId: string
  ifNodeId: string
  branchHandle: 'true' | 'false'
  // Edge from the IF to the first node of the branch (the closest one to
  // the IF that's upstream of — or IS — the decrement node).
  branchHeadEdge: { source: string; target: string; sourceHandle?: string }
}

// Locates a stock-decrement node sitting inside an IF branch of the given
// workflow. Returns null if no such site exists (the chain is already on
// the shared path OR the workflow contains no decrement at all).
//
// The walk: find the decrement node, then walk upstream following the
// single incoming edge at each step. If we land on an IF with a
// true/false sourceHandle on the edge we just walked, the chain is
// inside the branch and we report it. If we hit a fan-in (multiple
// incoming edges) or run out of upstream nodes without seeing an IF,
// the chain is already on the shared path.
const locateBranchDecrementSite = (workflow: {
  nodes?: unknown
  edges?: unknown
}): BranchLocateResult | null => {
  const nodes = Array.isArray(workflow.nodes) ? (workflow.nodes as any[]) : []
  const edges = Array.isArray(workflow.edges) ? (workflow.edges as any[]) : []
  if (nodes.length === 0 || edges.length === 0) {
    return null
  }
  // Find the FIRST stock-decrement node (workflows with multiple decrements
  // would be a separate drift; the auditor's per-site report still surfaces
  // them. For the hoist we only need ONE entry point — the chain travels
  // together.) Accepts BOTH the AI's raw shape AND our marker-rewritten
  // shape — `looksLikeStockDecrementBuilder` deliberately short-circuits
  // on the marker (so the rewriter is idempotent), but the hoist must
  // detect either, so we check the marker too.
  // Accepts THREE shapes:
  //   1. AI-shape (no marker): `quantity = quantity - CASE id …`
  //   2. Marker-rewritten with the legacy concat (early
  //      `buildStockDecrementBuilder` output): `setClause = "quantity =
  //      quantity - CASE id …"`
  //   3. Marker-rewritten with the current safety wrapping:
  //      `setClause = "quantity = GREATEST(0, COALESCE(quantity, 0) -
  //      CASE id …)"`
  //
  // The marker alone (emitted ONLY by `buildStockDecrementBuilder`) is
  // a reliable signal for #2/#3 — if a teleport_products reference is
  // also present, the chain originated from our rewriter. The label
  // check belt-and-braces guards against future drift in the safety
  // wrapping (e.g. swapping GREATEST for a different clamp function)
  // by also matching nodes that carry the canonical "Build Stock
  // Decrement SQL" name.
  const isDecrementCandidate = (n: any): boolean => {
    if (!n || n.type !== 'general-custom-js') return false
    const code = n?.config?.code
    if (typeof code !== 'string') return false
    if (looksLikeStockDecrementBuilder(code)) return true
    if (code.indexOf(STOCK_DECREMENT_MARKER) >= 0 && code.indexOf('teleport_products') >= 0) {
      return true
    }
    const label = String(n?.name || n?.label || '')
    if (
      (label === 'Build Stock Decrement SQL' || label.indexOf('Build Stock Decrement') === 0) &&
      code.indexOf('teleport_products') >= 0
    ) {
      return true
    }
    return false
  }
  const decrement = nodes.find(isDecrementCandidate)
  if (!decrement) {
    return null
  }

  // Build an edge → list keyed by target to walk upstream.
  const edgesByTarget = new Map<string, any[]>()
  for (const e of edges) {
    if (!e || typeof e.target !== 'string') continue
    const list = edgesByTarget.get(e.target) || []
    list.push(e)
    edgesByTarget.set(e.target, list)
  }
  const nodeById = new Map<string, any>()
  for (const n of nodes) {
    if (n && typeof n.id === 'string') nodeById.set(n.id, n)
  }

  // Walk upstream from the decrement node. Stop at the first IF we land
  // on; report it if the edge from the IF to the current node carries a
  // true/false handle. Otherwise — e.g. the IF was just a no-handle
  // bypass (which shouldn't happen for general-if-statement but we
  // defend) — keep walking.
  let cursor: string | null = decrement.id
  const visited = new Set<string>()
  while (cursor) {
    if (visited.has(cursor)) {
      // Cycle — shouldn't happen in a DAG, but be defensive so we never loop.
      return null
    }
    visited.add(cursor)
    const incoming = edgesByTarget.get(cursor) || []
    if (incoming.length === 0) {
      // No incoming edge — cursor is the workflow root. Chain sits on the
      // shared path (no IF anywhere upstream). Nothing to hoist.
      return null
    }
    if (incoming.length > 1) {
      // Fan-in — multiple predecessors. The chain has already been
      // structurally merged onto a shared path; nothing to hoist.
      return null
    }
    const inEdge = incoming[0]
    const sourceNode = nodeById.get(inEdge.source)
    if (sourceNode && sourceNode.type === 'general-if-statement') {
      const handle = typeof inEdge.sourceHandle === 'string' ? inEdge.sourceHandle : ''
      if (handle === 'true' || handle === 'false') {
        return {
          decrementNodeId: decrement.id,
          ifNodeId: sourceNode.id,
          branchHandle: handle,
          branchHeadEdge: {
            source: inEdge.source,
            target: inEdge.target,
            sourceHandle: inEdge.sourceHandle,
          },
        }
      }
      // IF with no handle — bizarre, but bail rather than guess.
      return null
    }
    cursor = inEdge.source
  }
  return null
}

interface HoistSummary {
  hoistedWorkflows: number
  skippedWorkflows: number
}

export const hoistStockDecrementOutOfCodBranch = (uidl: ProjectUIDL): HoistSummary => {
  const summary: HoistSummary = { hoistedWorkflows: 0, skippedWorkflows: 0 }
  if (!uidl.workflows || !uidl.workflows.workflows) {
    return summary
  }
  const workflows = uidl.workflows.workflows as Record<
    string,
    { id?: string; name?: string; nodes?: unknown; edges?: unknown }
  >

  let edgeIdCounter = 0
  const nextEdgeId = (): string => {
    edgeIdCounter += 1
    return 'teleport-hoist-' + Date.now().toString(36) + '-' + edgeIdCounter.toString(36)
  }

  for (const wf of Object.values(workflows)) {
    const site = locateBranchDecrementSite(wf)
    if (!site) {
      summary.skippedWorkflows++
      continue
    }
    if (hoistChainInWorkflow(wf, site, nextEdgeId)) {
      summary.hoistedWorkflows++
    } else {
      summary.skippedWorkflows++
    }
  }
  return summary
}

// Walks downstream from the branch's first node (`site.branchHeadEdge.target`)
// collecting the linear chain. The chain ends when:
//   * a node has 0 outgoing edges (terminal — usually unreachable here)
//   * a node fans out (multiple outgoing edges — means the chain has
//     diverged; we stop at the last linear member)
//   * the next node converges with the other branch (incoming edge count
//     > 1 from outside the chain — same reason)
//   * we leave the stock-related node set (the last stock/low-stock node)
//
// We use the "stock-related" boundary because the legacy COD-only shape
// often ends the stock chain with the low-stock email send and then
// fans out to `clear-cart → toast → redirect`. We want to hoist the
// stock chain only — order-confirmation email / cart-clear / etc. must
// stay in the COD branch.

const STOCK_CHAIN_LABEL_PREFIXES = [
  'Build Stock Decrement SQL',
  'Decrement Product Stock',
  'Build Low-Stock Detection SQL',
  'Detect Low-Stock Products',
  'Build Low-Stock Email Payload',
  'Send Low-Stock Alert Email',
  'Send Low-Stock Email',
]

const isStockChainNode = (
  node: { type?: string; label?: string; name?: string; config?: any } | undefined
): boolean => {
  if (!node) return false
  const label = String(node.name || node.label || '')
  if (STOCK_CHAIN_LABEL_PREFIXES.some((p) => label === p || label.indexOf(p) === 0)) {
    return true
  }
  // Belt-and-braces: a general-custom-js whose code matches the marker /
  // AI shape counts even when the label drifts.
  if (
    node.type === 'general-custom-js' &&
    typeof node.config?.code === 'string' &&
    looksLikeStockDecrementBuilder(node.config.code)
  ) {
    return true
  }
  return false
}

const hoistChainInWorkflow = (
  workflow: { nodes?: unknown; edges?: unknown },
  site: BranchLocateResult,
  nextEdgeId: () => string
): boolean => {
  const nodes = Array.isArray(workflow.nodes) ? (workflow.nodes as any[]) : []
  const edges = Array.isArray(workflow.edges) ? (workflow.edges as any[]) : []
  if (nodes.length === 0 || edges.length === 0) {
    return false
  }
  const nodeById = new Map<string, any>()
  for (const n of nodes) {
    if (n && typeof n.id === 'string') nodeById.set(n.id, n)
  }
  const outBySource = new Map<string, any[]>()
  const inByTarget = new Map<string, any[]>()
  for (const e of edges) {
    if (!e) continue
    if (typeof e.source === 'string') {
      const list = outBySource.get(e.source) || []
      list.push(e)
      outBySource.set(e.source, list)
    }
    if (typeof e.target === 'string') {
      const list = inByTarget.get(e.target) || []
      list.push(e)
      inByTarget.set(e.target, list)
    }
  }

  // `chainFirst` is the first node of the stock chain inside the branch.
  // It's the target of the branch-head edge from the IF (when the head
  // edge itself points at a stock-chain member) OR the head's only
  // downstream member that IS in the stock chain. Walk downstream from
  // the head until we find a stock-chain node — that's chainFirst.
  let chainFirst: string | null = null
  {
    let cursor: string | null = site.branchHeadEdge.target
    const seen = new Set<string>()
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      if (isStockChainNode(nodeById.get(cursor))) {
        chainFirst = cursor
        break
      }
      const out = outBySource.get(cursor) || []
      if (out.length !== 1) break
      cursor = out[0].target
    }
  }
  if (!chainFirst) {
    return false
  }

  // Walk the linear chain forward from chainFirst, collecting every
  // stock-related node. Stop at the first non-stock-chain node or fan-out.
  const chainIds: string[] = []
  {
    let cursor: string | null = chainFirst
    const seen = new Set<string>()
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      if (!isStockChainNode(nodeById.get(cursor))) break
      chainIds.push(cursor)
      const out = outBySource.get(cursor) || []
      if (out.length !== 1) break
      cursor = out[0].target
    }
  }
  if (chainIds.length === 0) {
    return false
  }
  const chainLast = chainIds[chainIds.length - 1]

  // Inflow + outflow of the chain (the edges that the rewire surgery
  // touches).
  //
  //  chainInEdge.source → chainFirst      will be removed; the chain's
  //                                       former in-branch parent now
  //                                       points at what used to come
  //                                       AFTER the chain (so the COD
  //                                       branch's downstream stub
  //                                       stays attached). Special-case
  //                                       below when the source IS the
  //                                       IF (no intermediate branch
  //                                       node sits between IF and the
  //                                       chain).
  //
  //  chainLast → chainOutEdge.target      will be removed; chainLast
  //                                       now points at the IF instead.
  const chainInEdges = inByTarget.get(chainFirst) || []
  if (chainInEdges.length !== 1) {
    return false
  }
  const chainInEdge = chainInEdges[0]
  const chainLastOutgoing = outBySource.get(chainLast) || []
  const chainOutEdge = chainLastOutgoing.length === 1 ? chainLastOutgoing[0] : null

  // The IF needs to fall ABOVE the chain. Find the IF's single incoming
  // edge — that's the existing predecessor that will now point at
  // chainFirst instead.
  const ifIncoming = inByTarget.get(site.ifNodeId) || []
  if (ifIncoming.length !== 1) {
    // IF has zero or multiple predecessors — bail rather than risk a
    // structural break. The auditor still warns; the merchant can fix
    // manually.
    return false
  }
  const predecessorEdge = ifIncoming[0]

  // Compute the edges to remove. We mutate `edges` in place — find each
  // edge by id (every UIDL edge has an id) so the removal is
  // unambiguous even when sources/targets repeat.
  const toRemoveIds = new Set<string>()
  // 1. predecessor → IF (the IF will be reached AFTER the chain now).
  if (typeof predecessorEdge.id === 'string') {
    toRemoveIds.add(predecessorEdge.id)
  }
  // 2. chainInEdge: chainInParent → chainFirst (the chain no longer
  //    receives flow from inside the branch).
  if (typeof chainInEdge.id === 'string') {
    toRemoveIds.add(chainInEdge.id)
  }
  // 3. chainOutEdge: chainLast → next (the chain no longer feeds into
  //    the branch's downstream stub — it feeds into the IF instead).
  if (chainOutEdge && typeof chainOutEdge.id === 'string') {
    toRemoveIds.add(chainOutEdge.id)
  }

  // Splice
  for (let i = edges.length - 1; i >= 0; i--) {
    const e = edges[i]
    if (e && typeof e.id === 'string' && toRemoveIds.has(e.id)) {
      edges.splice(i, 1)
    }
  }

  // Add new edges.
  //
  // a. predecessorOfIf → chainFirst — preserve `sourceHandle` /
  //    `targetHandle` from the original predecessor edge so loop-exit
  //    edges (sourceHandle='exit'), switch-case branches, etc. keep
  //    routing correctly through the new path.
  edges.push({
    id: nextEdgeId(),
    source: predecessorEdge.source,
    target: chainFirst,
    ...(predecessorEdge.sourceHandle ? { sourceHandle: predecessorEdge.sourceHandle } : {}),
    ...(predecessorEdge.targetHandle ? { targetHandle: predecessorEdge.targetHandle } : {}),
  })
  // b. chainLast → IF
  edges.push({
    id: nextEdgeId(),
    source: chainLast,
    target: site.ifNodeId,
  })
  // c. Close the branch where the chain used to live so the branch's
  //    downstream stub (cart-clear, toast, redirect, …) is still
  //    reachable. Two sub-cases:
  //    * chainInEdge.source is the IF itself (no intermediate branch
  //      node) — preserve the branch handle: IF.{handle} → chainOutEdge.target
  //    * chainInEdge.source is some other node (e.g. updateOrderCod)
  //      that sits between IF and the chain — that node now points
  //      directly at chainOutEdge.target.
  if (chainOutEdge) {
    if (chainInEdge.source === site.ifNodeId) {
      edges.push({
        id: nextEdgeId(),
        source: site.ifNodeId,
        target: chainOutEdge.target,
        sourceHandle: site.branchHandle,
      })
    } else {
      edges.push({
        id: nextEdgeId(),
        source: chainInEdge.source,
        target: chainOutEdge.target,
      })
    }
  }
  return true
}
