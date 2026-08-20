import { rewriteLowStockCustomHandlers, __testables } from '../src/ecommerce-customhandler-rewriter'
import { STOCK_DECREMENT_MARKER } from '../src/ecommerce/stock-decrement'

const {
  looksLikeLowStockSelectBuilder,
  looksLikeLowStockEmailPayload,
  looksLikePaymentMetadataBuilder,
  looksLikeStockDecrementBuilder,
  buildLowStockSelectBuilder,
  buildLowStockEmailPayloadNoOp,
  buildPaymentMetadataBuilder,
  buildStockDecrementBuilder,
  DEFAULT_THRESHOLD,
} = __testables

// Mirrors the AI's actual emitted shape (copied verbatim from the
// generated place-order-*-seg-server-3.js, just trimmed for the test).
const AI_SELECT_BUILDER = `function customHandler(previousContext, params) {
  var THRESHOLD = 5;
  var affected = null;
  for (var i = 0; i < params.length; i++) {
    var p = params[i];
    if (p && Array.isArray(p.affected)) { affected = p.affected; break; }
  }
  if (!affected || affected.length === 0) {
    return { query: "SELECT id, name, quantity AS stock, sku FROM teleport_products WHERE 1=0" };
  }
  var ids = affected.map(function(x) { return "'" + String(x).replace(/'/g, "''") + "'"; }).join(',');
  var query = "SELECT id, name, quantity AS stock, COALESCE(sku, '') AS sku FROM teleport_products WHERE quantity IS NOT NULL AND quantity <= " + THRESHOLD + " AND id IN (" + ids + ")";
  return { query: query };
}`

const AI_EMAIL_PAYLOAD = `function customHandler(previousContext, params) {
  var SUBJECT = '';
  var BODY = '';
  var RECIPIENTS = [];
  var THRESHOLD = 5;
  var COMPANY_NAME = 'pasca';
  var TOKEN_ENV_VAR = '';
  var token = TOKEN_ENV_VAR && typeof process !== 'undefined' && process.env ? (process.env[TOKEN_ENV_VAR] || '') : '';
  return { skip: !token };
}`

const baseStockSettings = (overrides: any = {}) =>
  ({
    workflows: {
      workflows: {
        wf1: {
          id: 'wf1',
          nodes: [
            { id: 'n1', type: 'general-custom-js', config: { code: AI_SELECT_BUILDER } },
            { id: 'n2', type: 'general-custom-js', config: { code: AI_EMAIL_PAYLOAD } },
          ],
        },
      },
      customNodes: {},
    },
    ecommerceSettings: {
      stockManagement: true,
      stockManagementConfig: {
        lowStockThreshold: 12,
        lowStockAlerts: true,
        lowStockAlertConfig: {
          provider: 'postmark',
          fromEmail: 'a@b.com',
          fromName: 'X',
          notificationEmails: ['m@example.com'],
          ...overrides.alertConfig,
        },
        ...overrides.stockConfig,
      },
      ...overrides.ecom,
    },
  } as any)

describe('pattern detection — looksLikeLowStockSelectBuilder', () => {
  it('matches the canonical AI low-stock SELECT-builder', () => {
    expect(looksLikeLowStockSelectBuilder(AI_SELECT_BUILDER)).toBe(true)
  })
  it('rejects an unrelated SELECT-builder on a different table', () => {
    const orderSelect = `function customHandler(){ var THRESHOLD = 5; return { query: "SELECT id FROM teleport_orders WHERE quantity AS stock <= 5" }; }`
    expect(looksLikeLowStockSelectBuilder(orderSelect)).toBe(false)
  })
  it('rejects a non-string code body', () => {
    expect(looksLikeLowStockSelectBuilder(null as any)).toBe(false)
    expect(looksLikeLowStockSelectBuilder(undefined as any)).toBe(false)
    expect(looksLikeLowStockSelectBuilder(123 as any)).toBe(false)
  })
  it('rejects a handler that mentions the table but lacks the projection', () => {
    const code = `function customHandler(){ var THRESHOLD = 5; return { query: "SELECT id FROM teleport_products WHERE quantity <= 5" }; }`
    expect(looksLikeLowStockSelectBuilder(code)).toBe(false)
  })
})

describe('pattern detection — looksLikeLowStockEmailPayload', () => {
  it('matches the canonical AI email-payload customHandler', () => {
    expect(looksLikeLowStockEmailPayload(AI_EMAIL_PAYLOAD)).toBe(true)
  })
  it('rejects code that has subject/body but no TOKEN_ENV_VAR (different handler)', () => {
    const code = `function customHandler(){ var SUBJECT = ''; var BODY = ''; var RECIPIENTS = []; var THRESHOLD = 5; return {}; }`
    expect(looksLikeLowStockEmailPayload(code)).toBe(false)
  })
})

describe('rewriteLowStockCustomHandlers — settings-driven replacement', () => {
  it('replaces the SELECT-builder with the merchant-configured threshold', () => {
    const uidl = baseStockSettings()
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.selectBuilderRewrites).toBe(1)
    expect(summary.emailPayloadRewrites).toBe(1)
    const newCode = uidl.workflows.workflows.wf1.nodes[0].config.code
    expect(newCode).toContain('var THRESHOLD = 12;')
    expect(newCode).not.toContain('var THRESHOLD = 5;')
    expect(newCode).toContain('FROM teleport_products')
    expect(newCode).toContain('quantity AS stock')
  })

  it('replaces the email-payload customHandler with a no-op that defers to the data-api auto-fire', () => {
    const uidl = baseStockSettings()
    rewriteLowStockCustomHandlers(uidl)
    const newCode = uidl.workflows.workflows.wf1.nodes[1].config.code
    expect(newCode).toContain('handled-by-data-api-autofire')
    expect(newCode).toContain('skip: true')
    expect(newCode).not.toContain('COMPANY_NAME')
    expect(newCode).not.toContain('TOKEN_ENV_VAR')
  })

  it('the rewritten SELECT-builder includes the crossed-threshold clause when cart deltas are available', () => {
    const uidl = baseStockSettings()
    rewriteLowStockCustomHandlers(uidl)
    const newCode = uidl.workflows.workflows.wf1.nodes[0].config.code
    // The rewritten code MUST construct the "quantity > THRESHOLD - CASE ..." clause
    // (the literal SQL fragment that filters out already-low products). Without
    // this guard, repeat orders against a perma-low product will spam the merchant.
    expect(newCode).toMatch(/quantity\s*>\s*"\s*\+\s*THRESHOLD/)
    expect(newCode).toContain('CASE id')
  })

  it('rewritten SELECT-builder still matches the data-api detector pattern', () => {
    const uidl = baseStockSettings()
    rewriteLowStockCustomHandlers(uidl)
    const newCode = uidl.workflows.workflows.wf1.nodes[0].config.code
    // Execute the customHandler against a synthetic predecessors list and
    // verify the produced SQL string is still recognisable by the data-api.
    const fn = new Function(newCode + '\nreturn customHandler;')() as any
    const result = fn({}, [
      {
        items: [
          { productId: 'a', quantity: 1 },
          { productId: 'b', quantity: 2 },
        ],
      },
      { affected: ['a', 'b'] },
    ])
    expect(typeof result.query).toBe('string')
    expect(result.query).toMatch(
      /SELECT[\s\S]*FROM\s+teleport_products[\s\S]*WHERE[\s\S]*quantity[\s\S]*<=\s*12/
    )
    expect(result.query).toContain("'a'")
    expect(result.query).toContain("'b'")
    // The CASE expression should reflect the per-id delta:
    expect(result.query).toContain("WHEN 'a' THEN 1")
    expect(result.query).toContain("WHEN 'b' THEN 2")
  })

  it('rewritten SELECT-builder returns the 1=0 short-circuit when affected is empty', () => {
    const uidl = baseStockSettings()
    rewriteLowStockCustomHandlers(uidl)
    const newCode = uidl.workflows.workflows.wf1.nodes[0].config.code
    const fn = new Function(newCode + '\nreturn customHandler;')() as any
    expect(fn({}, [{ affected: [] }]).query).toContain('WHERE 1=0')
    expect(fn({}, []).query).toContain('WHERE 1=0')
  })

  it('rewritten SELECT-builder is safe against single-quote injection in product IDs', () => {
    const uidl = baseStockSettings()
    rewriteLowStockCustomHandlers(uidl)
    const newCode = uidl.workflows.workflows.wf1.nodes[0].config.code
    const fn = new Function(newCode + '\nreturn customHandler;')() as any
    const result = fn({}, [
      { items: [{ productId: "x'; DROP TABLE teleport_products; --", quantity: 1 }] },
      { affected: ["x'; DROP TABLE teleport_products; --"] },
    ])
    // Single quotes inside the id MUST be doubled-up so the literal is
    // treated as data, not as a string terminator + new statement. The
    // expected SQL contains the escaped form `x''; DROP TABLE …` wrapped
    // in literal single quotes — no unescaped quote sequence that could
    // break out of the literal.
    expect(result.query).toContain("'x''; DROP TABLE teleport_products; --'")
    // The single-quote-then-semicolon sequence (`';`) is exactly what
    // an injection would need to terminate the literal and start a new
    // statement. After escaping it becomes `'';` which is just a doubled
    // quote inside a literal. Verify NO unescaped break-out sequence
    // leaked through: every `';` in the output must be preceded by another `'`.
    const breakoutPattern = /(?<!')';/g
    expect(breakoutPattern.test(result.query)).toBe(false)
  })

  it('rewritten SELECT-builder omits the crossed clause when cart items are absent', () => {
    const uidl = baseStockSettings()
    rewriteLowStockCustomHandlers(uidl)
    const newCode = uidl.workflows.workflows.wf1.nodes[0].config.code
    const fn = new Function(newCode + '\nreturn customHandler;')() as any
    const result = fn({}, [{ affected: ['a'] }])
    expect(result.query).not.toContain('CASE id')
    expect(result.query).toContain('quantity <= 12')
  })

  it('coerces a non-positive configured threshold to the safe default', () => {
    const uidl = baseStockSettings({ stockConfig: { lowStockThreshold: 0 } })
    rewriteLowStockCustomHandlers(uidl)
    const newCode = uidl.workflows.workflows.wf1.nodes[0].config.code
    expect(newCode).toContain(`var THRESHOLD = ${DEFAULT_THRESHOLD};`)
  })

  it('coerces a negative configured threshold to the safe default', () => {
    const uidl = baseStockSettings({ stockConfig: { lowStockThreshold: -1 } })
    rewriteLowStockCustomHandlers(uidl)
    const newCode = uidl.workflows.workflows.wf1.nodes[0].config.code
    expect(newCode).toContain(`var THRESHOLD = ${DEFAULT_THRESHOLD};`)
  })

  it('respects a non-integer threshold (e.g. 7.5) — the configured number flows through verbatim', () => {
    const uidl = baseStockSettings({ stockConfig: { lowStockThreshold: 7.5 } })
    rewriteLowStockCustomHandlers(uidl)
    const newCode = uidl.workflows.workflows.wf1.nodes[0].config.code
    expect(newCode).toContain('var THRESHOLD = 7.5;')
  })

  it('does NOT rewrite the SELECT-builder when stockManagement is off, but DOES neutralise the email-payload', () => {
    const uidl = baseStockSettings({ ecom: {} })
    uidl.ecommerceSettings.stockManagement = false
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.selectBuilderRewrites).toBe(0)
    expect(summary.emailPayloadRewrites).toBe(1)
    // SELECT-builder code stays untouched (still the AI's original)
    expect(uidl.workflows.workflows.wf1.nodes[0].config.code).toBe(AI_SELECT_BUILDER)
  })

  it('walks customNodes too', () => {
    const uidl = baseStockSettings()
    uidl.workflows.customNodes = {
      cn1: {
        id: 'cn1',
        nodes: [{ id: 'cnn1', type: 'general-custom-js', config: { code: AI_SELECT_BUILDER } }],
      },
    }
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.selectBuilderRewrites).toBe(2)
  })

  it('leaves unrelated custom-js nodes alone', () => {
    const unrelated = `function customHandler(){ return { ok: true }; }`
    const uidl = baseStockSettings()
    uidl.workflows.workflows.wf1.nodes.push({
      id: 'n3',
      type: 'general-custom-js',
      config: { code: unrelated },
    } as any)
    rewriteLowStockCustomHandlers(uidl)
    expect(uidl.workflows.workflows.wf1.nodes[2].config.code).toBe(unrelated)
  })

  it('is idempotent — running twice does not double-rewrite (already-rewritten code does not match the AI pattern)', () => {
    const uidl = baseStockSettings()
    const firstSummary = rewriteLowStockCustomHandlers(uidl)
    const secondSummary = rewriteLowStockCustomHandlers(uidl)
    expect(firstSummary.selectBuilderRewrites).toBe(1)
    expect(secondSummary.selectBuilderRewrites).toBe(0)
  })

  it('returns zero summary when no workflows exist', () => {
    const uidl = { workflows: undefined } as any
    expect(rewriteLowStockCustomHandlers(uidl).selectBuilderRewrites).toBe(0)
  })

  it('returns zero summary when the workflows map is empty', () => {
    const uidl = { workflows: { workflows: {} } } as any
    expect(rewriteLowStockCustomHandlers(uidl).selectBuilderRewrites).toBe(0)
  })
})

describe('rewritten SELECT-builder — semantic crossed-threshold math', () => {
  // These tests assert the SQL fragment with concrete deltas, then walk
  // through what the database would do.
  it('only includes products whose old stock was ABOVE threshold (i.e. crossed)', () => {
    const code = buildLowStockSelectBuilder(5)
    const fn = new Function(code + '\nreturn customHandler;')() as any
    const result = fn({}, [
      {
        items: [
          { productId: 'a', quantity: 2 },
          { productId: 'b', quantity: 1 },
        ],
      },
      { affected: ['a', 'b'] },
    ])
    // a: delta 2 → "quantity > 5 - 2" → quantity > 3 in the new state.
    //   So a row that was 7→5 (crossed) matches (5 > 3). A row that was 4→2 (already below) does NOT (2 > 3 is false).
    // b: delta 1 → "quantity > 5 - 1" → quantity > 4 in the new state.
    //   Row 6→5 matches (5 > 4). Row 5→4 does NOT (4 > 4 false). Row 4→3 does NOT.
    expect(result.query).toContain("WHEN 'a' THEN 2")
    expect(result.query).toContain("WHEN 'b' THEN 1")
    expect(result.query).toContain('ELSE 0')
  })

  it('handles aggregation of duplicate cart entries for the same product', () => {
    const code = buildLowStockSelectBuilder(5)
    const fn = new Function(code + '\nreturn customHandler;')() as any
    const result = fn({}, [
      {
        items: [
          { productId: 'a', quantity: 1 },
          { productId: 'a', quantity: 3 },
        ],
      },
      { affected: ['a'] },
    ])
    // Two cart lines for 'a' (qty 1 + qty 3) should aggregate into delta=4
    expect(result.query).toContain("WHEN 'a' THEN 4")
  })

  it('treats a missing/invalid qty as 1 (cart-line default)', () => {
    const code = buildLowStockSelectBuilder(5)
    const fn = new Function(code + '\nreturn customHandler;')() as any
    const result = fn({}, [
      { items: [{ productId: 'a', quantity: 'NaN' }, { productId: 'b' /* missing qty */ }] },
      { affected: ['a', 'b'] },
    ])
    expect(result.query).toContain("WHEN 'a' THEN 1")
    expect(result.query).toContain("WHEN 'b' THEN 1")
  })
})

describe('no-op email-payload template is callable at runtime', () => {
  it('returns the expected skip envelope', () => {
    const code = buildLowStockEmailPayloadNoOp()
    const fn = new Function(code + '\nreturn customHandler;')() as any
    expect(fn({}, [])).toEqual({ skip: true, reason: 'handled-by-data-api-autofire' })
  })
})

// Verbatim copy of the AI's positional-index metadataJson builder that
// caused the Stripe webhook UUID error in the user's regenerated project.
const AI_PAYMENT_METADATA_BUILDER = `function customHandler(params) {
  var createOrderResult = params[14] || {};
  var orderNumberResult = params[15] || {};
  var orderId = createOrderResult.id ? String(createOrderResult.id) : "";
  var orderNumber = orderNumberResult.result || ("ORD-" + orderId);
  return {
    successUrl: "/order-details/" + orderNumber + "?payment=success",
    cancelUrl: "/checkout",
    description: "Order " + orderNumber,
    metadataJson: JSON.stringify({ orderId: orderId, orderNumber: orderNumber })
  };
}`

describe('looksLikePaymentMetadataBuilder — pattern detection', () => {
  it('matches the AI verbatim payment metadata builder', () => {
    expect(looksLikePaymentMetadataBuilder(AI_PAYMENT_METADATA_BUILDER)).toBe(true)
  })
  it('rejects a metadataJson builder that already uses shape-walking (no positional index)', () => {
    const reasonable = `function customHandler(params) { return { metadataJson: JSON.stringify({ orderId: "x", orderNumber: "y" }) }; }`
    expect(looksLikePaymentMetadataBuilder(reasonable)).toBe(false)
  })
  it('rejects an unrelated handler that uses positional indexing for something else', () => {
    const unrelated = `function customHandler(params) { var x = params[0]; return { value: x }; }`
    expect(looksLikePaymentMetadataBuilder(unrelated)).toBe(false)
  })
})

describe('buildPaymentMetadataBuilder — runtime semantics', () => {
  // Build a synthetic params array that mirrors the workflow context:
  // a mix of unrelated nodes plus an order-create-item-shaped result.
  const fn = (() => {
    const code = buildPaymentMetadataBuilder('/order-details')
    return new Function(code + '\nreturn customHandler;')() as any
  })()

  it('finds the order row even when its positional index is NOT 14/15', () => {
    const result = fn([
      { unrelated: true },
      { also: 'unrelated' },
      { id: 'ord-uuid-123', total_amount: 99.95, customer_email: 'a@b.com' },
      { result: 'ORD-1234' },
    ])
    expect(JSON.parse(result.metadataJson)).toEqual({
      orderId: 'ord-uuid-123',
      orderNumber: 'ORD-1234',
    })
    expect(result.successUrl).toContain('ORD-1234')
    expect(result.description).toContain('ORD-1234')
  })

  it('falls back to order_number column when no ORD- string is upstream', () => {
    const result = fn([{ id: 'uuid-1', order_number: 'ORD-555', total_amount: 1 }])
    expect(JSON.parse(result.metadataJson).orderNumber).toBe('ORD-555')
  })

  it('generates a fallback order number from the id slice when nothing else is available', () => {
    const result = fn([{ id: 'abcdef12-3456-7890-...', total_amount: 1 }])
    const parsed = JSON.parse(result.metadataJson)
    expect(parsed.orderId).toBe('abcdef12-3456-7890-...')
    expect(parsed.orderNumber).toMatch(/^ORD-/)
  })

  it('produces an empty orderId only when no order-shaped row exists at all (caller deals with it)', () => {
    const result = fn([{ wholly: 'unrelated' }])
    const parsed = JSON.parse(result.metadataJson)
    expect(parsed.orderId).toBe('')
    // Critically: still returns a JSON-stringified metadata blob, never undefined,
    // so the Stripe session creation gets a valid (if empty) metadata value.
  })

  it('skips arrays and primitives when shape-walking params', () => {
    const result = fn([
      'not-an-object',
      42,
      [{ id: 'fake-array-entry' }],
      { id: 'real-uuid', total_amount: 5 },
    ])
    expect(JSON.parse(result.metadataJson).orderId).toBe('real-uuid')
  })

  it('rejects an object that has an id but NO order-shaped columns', () => {
    const result = fn([
      { id: 'user-uuid', email: 'a@b.com' },
      { id: 'order-uuid', total_amount: 9, customer_email: 'c@d.com' },
    ])
    expect(JSON.parse(result.metadataJson).orderId).toBe('order-uuid')
  })

  it('rewriter integration: ai metadata builder gets replaced when present', () => {
    const uidl: any = {
      workflows: {
        workflows: {
          wfPayment: {
            id: 'wfPayment',
            nodes: [
              {
                id: 'mb',
                type: 'general-custom-js',
                config: { code: AI_PAYMENT_METADATA_BUILDER },
              },
            ],
          },
        },
        customNodes: {},
      },
      ecommerceSettings: { stockManagement: false },
    }
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.paymentMetadataBuilderRewrites).toBe(1)
    expect(uidl.workflows.workflows.wfPayment.nodes[0].config.code).toContain('looksLikeOrderRow')
    expect(uidl.workflows.workflows.wfPayment.nodes[0].config.code).not.toContain('params[14]')
  })
})

// Verbatim copy of the AI's stock-decrement UPDATE-builder. The three
// production bugs we're fixing are visible right here:
//   * no aggregation of duplicate cart entries (each cart line gets its
//     own WHEN, the dup id silently collapses to the first WHEN)
//   * no allowBackorders check (always decrements, may go negative)
//   * no race protection (no WHERE quantity >= delta guard)
const AI_STOCK_DECREMENT_BUILDER = `function customHandler(previousContext, params) {
  var cartItems = null;
  for (var i = 0; i < params.length; i++) {
    var p = params[i];
    if (p && Array.isArray(p.items)) { cartItems = p.items; break; }
    if (Array.isArray(p)) { cartItems = p; break; }
  }
  if (!cartItems || cartItems.length === 0) {
    return { query: "SELECT 1", affected: [] };
  }
  var affected = [];
  var caseExpr = '';
  var ids = [];
  for (var k = 0; k < cartItems.length; k++) {
    var it = cartItems[k];
    var pid = it.productId || it.product_id;
    if (!pid) { continue; }
    var qty = parseInt(it.quantity, 10);
    if (isNaN(qty) || qty <= 0) { qty = 1; }
    var safeId = String(pid).replace(/'/g, "''");
    caseExpr += " WHEN '" + safeId + "' THEN " + qty;
    ids.push("'" + safeId + "'");
    affected.push(String(pid));
  }
  if (ids.length === 0) {
    return { query: "SELECT 1", affected: [] };
  }
  var query = "UPDATE teleport_products SET quantity = quantity - CASE id" + caseExpr + " END, updated_at = NOW() WHERE quantity IS NOT NULL AND id IN (" + ids.join(',') + ")";
  return { query: query, affected: affected };
}`

describe('looksLikeStockDecrementBuilder — pattern detection', () => {
  it('matches the AI stock-decrement UPDATE-builder', () => {
    expect(looksLikeStockDecrementBuilder(AI_STOCK_DECREMENT_BUILDER)).toBe(true)
  })
  it('rejects an UPDATE on a different table', () => {
    const other = `function customHandler() { return { query: "UPDATE teleport_orders SET quantity = quantity - CASE id WHEN 'a' THEN 1 END", affected: [] }; }`
    expect(looksLikeStockDecrementBuilder(other)).toBe(false)
  })
  it('rejects a handler that returns no affected field', () => {
    const noAffected = `function customHandler() { return { query: "UPDATE teleport_products SET quantity = quantity - CASE id WHEN 'a' THEN 1 END" }; }`
    expect(looksLikeStockDecrementBuilder(noAffected)).toBe(false)
  })
  it('rejects already-rewritten code (marker present)', () => {
    const rewritten = buildStockDecrementBuilder(false)
    expect(looksLikeStockDecrementBuilder(rewritten)).toBe(false)
  })

  it('self-heals a legacy rewrite that permanently zeroes NULL (unlimited) stock', () => {
    // A project generated before the NULL-preserving fix already carries
    // the marker, so the marker check alone can't distinguish "already
    // correct" from "already rewritten but still buggy". Detect the old
    // `GREATEST(0, COALESCE(quantity, 0) - …)` shape specifically so the
    // NEXT regeneration upgrades it to the NULL-preserving SQL instead of
    // leaving an existing project's unlimited-stock products stuck at 0
    // forever.
    const legacyRewrite = `${STOCK_DECREMENT_MARKER}
      function customHandler() {
        var setClause = "quantity = GREATEST(0, COALESCE(quantity, 0) - CASE id" + caseExpr + " ELSE 0 END)";
        return { query: "UPDATE teleport_products SET " + setClause, affected: ['a'] };
      }`
    expect(looksLikeStockDecrementBuilder(legacyRewrite)).toBe(true)
  })
})

describe('buildStockDecrementBuilder — semantic behaviour', () => {
  // allowBackorders: false (the production default)
  describe('with allowBackorders = false', () => {
    const fn = (() => {
      const code = buildStockDecrementBuilder(false)
      return new Function(code + '\nreturn customHandler;')() as any
    })()

    it('builds a SET clause that subtracts the per-id delta and clamps at 0', () => {
      const r = fn({}, [
        {
          items: [
            { productId: 'a', quantity: 2 },
            { productId: 'b', quantity: 3 },
          ],
        },
      ])
      // Two semantic guards in the SET clause:
      //   * \`CASE WHEN quantity IS NULL THEN NULL …\` leaves an
      //     unlimited-stock product (quantity never set by the
      //     merchant) untouched forever — an order must never turn
      //     "infinite stock" into a finite, trackable 0.
      //   * \`GREATEST(0, …)\` floors a TRACKED row's post-decrement
      //     value at 0 so we never persist a negative stock value —
      //     that would be a confusing signal in the admin panel ("we
      //     sold more than we have?"). Once a row sits at exactly 0
      //     the cart-availability pre-flight refuses further orders
      //     against it.
      expect(r.query).toContain(
        'SET quantity = CASE WHEN quantity IS NULL THEN NULL ELSE GREATEST(0, quantity - (CASE id'
      )
      expect(r.query).toContain("WHEN 'a' THEN 2")
      expect(r.query).toContain("WHEN 'b' THEN 3")
      expect(r.query).toContain('ELSE 0')
    })

    it('aggregates duplicate cart entries into a single CASE branch per id', () => {
      // Two cart lines for the same productId — must collapse to one WHEN
      // with the SUM of the two quantities. The old code shipped two
      // WHENs for the same id and only the first counted.
      //
      // Note: the same CASE expression appears in multiple SQL clauses
      // (SET / WHERE / RETURNING) by design, so we don't count global
      // WHEN occurrences. Instead we assert via the structured outputs
      // (deltasById + affected) which are the load-bearing fields, and
      // verify the CASE has the AGGREGATED qty (5) — never the
      // un-aggregated original (1 or 4).
      const r = fn({}, [
        {
          items: [
            { productId: 'p1', quantity: 1 },
            { productId: 'p1', quantity: 4 },
            { productId: 'p2', quantity: 2 },
          ],
        },
      ])
      expect(r.query).toContain("WHEN 'p1' THEN 5")
      expect(r.query).toContain("WHEN 'p2' THEN 2")
      expect(r.query).not.toMatch(/WHEN 'p1' THEN 1\b/)
      expect(r.query).not.toMatch(/WHEN 'p1' THEN 4\b/)
      // affected array should likewise dedupe
      expect(r.affected.filter((x: string) => x === 'p1')).toHaveLength(1)
      expect(r.expectedAffected).toBe(2)
      expect(r.deltasById).toEqual({ p1: 5, p2: 2 })
    })

    it('adds the race-safe `quantity >= delta` guard to the WHERE clause (NULL rows tolerated)', () => {
      const r = fn({}, [{ items: [{ productId: 'a', quantity: 3 }] }])
      // The guard must reference the SAME per-id CASE expression so each
      // row is checked against its own would-be delta. We also let NULL
      // through ("quantity IS NULL OR …") so freshly-seeded products
      // bootstrap on first order — the SET clause's COALESCE turns a
      // NULL row into the negative bootstrap value.
      expect(r.query).toMatch(
        /AND \(quantity IS NULL OR quantity\s*>=\s*\(CASE id\s+WHEN 'a' THEN 3\s+ELSE 0 END\)\)/
      )
    })

    it('includes a RETURNING clause exposing id, new_quantity, old_quantity', () => {
      const r = fn({}, [{ items: [{ productId: 'a', quantity: 2 }] }])
      expect(r.query).toContain('RETURNING id')
      expect(r.query).toContain('quantity AS new_quantity')
      // \`old_quantity\` reconstructs an approximate pre-SET value. A row
      // whose (post-update) \`new_quantity\` is NULL was NULL before too
      // (the SET clause never touches a NULL row); for a tracked row,
      // the GREATEST(0, …) clamp in SET means we can't perfectly invert
      // the arithmetic (a row that decremented from 1 → 0 with delta 2
      // also would have shown 0 with delta 1), but for the downstream
      // low-stock SELECT only \`new_quantity\` matters, so a conservative
      // floored approximation is fine.
      expect(r.query).toMatch(
        /\(CASE WHEN quantity IS NULL THEN NULL ELSE GREATEST\(0,\s*quantity\s*\+\s*\(CASE id[\s\S]*?\)\)\s*END\)\s*AS old_quantity/
      )
    })

    it('exposes allowBackorders flag in the return value so downstream nodes can branch on it', () => {
      const r = fn({}, [{ items: [{ productId: 'a', quantity: 1 }] }])
      expect(r.allowBackorders).toBe(false)
    })

    it('short-circuits to SELECT 1 when the cart is empty', () => {
      expect(fn({}, [{ items: [] }]).query).toBe('SELECT 1')
      expect(fn({}, []).query).toBe('SELECT 1')
    })

    it('short-circuits to SELECT 1 when no cart entry has a productId', () => {
      expect(fn({}, [{ items: [{ quantity: 1 }, { quantity: 2 }] }]).query).toBe('SELECT 1')
    })

    it('coerces invalid quantity to 1 (matches the AI`s original behaviour)', () => {
      const r = fn({}, [{ items: [{ productId: 'a', quantity: 'abc' }, { productId: 'b' }] }])
      expect(r.query).toContain("WHEN 'a' THEN 1")
      expect(r.query).toContain("WHEN 'b' THEN 1")
    })

    it('escapes single quotes in productId (SQL injection defence)', () => {
      const r = fn({}, [{ items: [{ productId: "x'; DROP TABLE users; --", quantity: 1 }] }])
      // Doubled-up quote inside the SQL literal
      expect(r.query).toContain("'x''; DROP TABLE users; --'")
      // The IN list and the CASE branch both use the safely-escaped id.
      // No bare unescaped break-out sequence anywhere.
      expect(/(?<!')';/.test(r.query)).toBe(false)
    })

    it('lets orders proceed against NULL-quantity (unlimited stock) rows WITHOUT ever making them finite', () => {
      // A new project's products table is seeded with NULL quantity
      // everywhere, and the cart-availability pre-flight treats NULL as
      // "unlimited stock" — so those orders reach this UPDATE. The
      // WHERE guard's "quantity IS NULL OR …" lets the row through, but
      // the SET clause's "CASE WHEN quantity IS NULL THEN NULL …" must
      // leave the value untouched: an unlimited product decrementing on
      // its first order would otherwise floor to 0 and become
      // permanently out-of-stock, even though the merchant never set a
      // finite count. Only rows that already carry a real, finite
      // quantity are actually decremented.
      const r = fn({}, [{ items: [{ productId: 'a', quantity: 1 }] }])
      expect(r.query).toContain('quantity IS NULL OR quantity >=')
      expect(r.query).toContain(
        'CASE WHEN quantity IS NULL THEN NULL ELSE GREATEST(0, quantity - (CASE id'
      )
      // The legacy "quantity IS NOT NULL" filter that used to skip NULL
      // rows entirely must stay gone — the row still needs to be
      // touched (so its RETURNING row is available to callers), just
      // without changing its value.
      expect(r.query).not.toContain('quantity IS NOT NULL')
      // The old (buggy) shape unconditionally bootstrapped a NULL row
      // to 0 via COALESCE — that must be gone entirely now.
      expect(r.query).not.toContain('COALESCE(quantity, 0)')
    })

    it('accepts a bare cart-items array (legacy callers pass [items] directly)', () => {
      const r = fn({}, [[{ productId: 'a', quantity: 2 }]])
      expect(r.query).toContain("WHEN 'a' THEN 2")
    })
  })

  // allowBackorders: true (merchant opted in to negative stock)
  describe('with allowBackorders = true', () => {
    const fn = (() => {
      const code = buildStockDecrementBuilder(true)
      return new Function(code + '\nreturn customHandler;')() as any
    })()

    it('omits the `quantity >= delta` guard so the decrement always proceeds', () => {
      const r = fn({}, [{ items: [{ productId: 'a', quantity: 3 }] }])
      expect(r.query).not.toContain('quantity >=')
      // The legacy "quantity IS NOT NULL" filter has been removed; the
      // SET clause now uses "CASE WHEN quantity IS NULL THEN NULL …" so
      // NULL-quantity (unlimited-stock) rows stay untouched — even with
      // backorders allowed, an unlimited product is never turned into a
      // finite, trackable one. Tracked rows still floor at 0 —
      // backorders semantically mean "let the order through even if
      // stock is short", not "let the stock counter go negative".
      expect(r.query).not.toContain('quantity IS NOT NULL')
      expect(r.query).toContain(
        'CASE WHEN quantity IS NULL THEN NULL ELSE GREATEST(0, quantity - (CASE id'
      )
    })

    it('still uses RETURNING so the low-stock SELECT sees what changed', () => {
      const r = fn({}, [{ items: [{ productId: 'a', quantity: 2 }] }])
      expect(r.query).toContain('RETURNING id')
    })

    it('flags allowBackorders=true in the return value', () => {
      const r = fn({}, [{ items: [{ productId: 'a', quantity: 1 }] }])
      expect(r.allowBackorders).toBe(true)
    })

    it('still aggregates duplicate cart entries (the dedup is unrelated to backorders)', () => {
      const r = fn({}, [
        {
          items: [
            { productId: 'p', quantity: 2 },
            { productId: 'p', quantity: 3 },
          ],
        },
      ])
      expect(r.deltasById).toEqual({ p: 5 })
      expect(r.affected).toEqual(['p'])
      expect(r.query).toContain("WHEN 'p' THEN 5")
      expect(r.query).not.toMatch(/WHEN 'p' THEN 2\b/)
      expect(r.query).not.toMatch(/WHEN 'p' THEN 3\b/)
    })
  })
})

describe('rewriteLowStockCustomHandlers — stock-decrement integration', () => {
  const baseUidl = (allowBackorders: boolean, stockManagement: boolean = true) =>
    ({
      workflows: {
        workflows: {
          wfPlaceOrder: {
            id: 'wfPlaceOrder',
            nodes: [
              {
                id: 'sdb',
                type: 'general-custom-js',
                config: { code: AI_STOCK_DECREMENT_BUILDER },
              },
            ],
          },
        },
        customNodes: {},
      },
      ecommerceSettings: {
        stockManagement,
        stockManagementConfig: {
          allowBackorders,
          lowStockThreshold: 5,
          lowStockAlerts: false,
        },
      },
    } as any)

  it('replaces the AI stock-decrement builder when stockManagement is on', () => {
    const uidl = baseUidl(false)
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.stockDecrementBuilderRewrites).toBe(1)
    const code = uidl.workflows.workflows.wfPlaceOrder.nodes[0].config.code
    expect(code).toContain('aggregateCartDeltas')
    expect(code).toContain('var ALLOW_BACKORDERS = false;')
  })

  it('respects the merchant`s allowBackorders=true setting', () => {
    const uidl = baseUidl(true)
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.stockDecrementBuilderRewrites).toBe(1)
    const code = uidl.workflows.workflows.wfPlaceOrder.nodes[0].config.code
    expect(code).toContain('var ALLOW_BACKORDERS = true;')
  })

  it('leaves the stock-decrement builder untouched when stockManagement is off', () => {
    const uidl = baseUidl(false, false)
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.stockDecrementBuilderRewrites).toBe(0)
    expect(uidl.workflows.workflows.wfPlaceOrder.nodes[0].config.code).toBe(
      AI_STOCK_DECREMENT_BUILDER
    )
  })

  it('is idempotent — running the rewriter twice does not re-rewrite', () => {
    const uidl = baseUidl(false)
    expect(rewriteLowStockCustomHandlers(uidl).stockDecrementBuilderRewrites).toBe(1)
    expect(rewriteLowStockCustomHandlers(uidl).stockDecrementBuilderRewrites).toBe(0)
  })
})

describe('low-stock SELECT-builder prefers RETURNING rows over intended affected list', () => {
  // After the stock-decrement rewrite uses RETURNING, the data-raw-query
  // node downstream gets { rows: [{id, new_quantity, old_quantity}] }
  // containing only the rows that ACTUALLY decremented. When backorders
  // are disallowed, products with insufficient stock are absent from this
  // list. The low-stock SELECT must honor that so it doesn't alert on
  // products that did not actually change.
  const code = buildLowStockSelectBuilder(5)
  const fn = new Function(code + '\nreturn customHandler;')() as any

  it('reads affected IDs from raw-query rows when present', () => {
    const result = fn({}, [
      {
        items: [
          { productId: 'a', quantity: 1 },
          { productId: 'b', quantity: 1 },
        ],
      },
      { affected: ['a', 'b'] },
      // The data-raw-query result: only 'a' actually decremented;
      // 'b' was refused (insufficient stock + backorders disallowed).
      { rows: [{ id: 'a', new_quantity: 4, old_quantity: 5 }] },
    ])
    expect(result.query).toContain("'a'")
    expect(result.query).not.toContain("'b'")
  })

  it('falls back to upstream affected when no raw-query rows are present', () => {
    const result = fn({}, [{ items: [{ productId: 'a', quantity: 1 }] }, { affected: ['a'] }])
    expect(result.query).toContain("'a'")
  })

  it('falls back to affected when raw-query rows are present but empty', () => {
    const result = fn({}, [
      { items: [{ productId: 'a', quantity: 1 }] },
      { affected: ['a'] },
      { rows: [] },
    ])
    expect(result.query).toContain("'a'")
  })
})

// ────────────────────────────────────────────────────────────────────
// rewriteLowStockCustomHandlers — end-to-end with the hoist
// ────────────────────────────────────────────────────────────────────
//
// The full rewriter pipeline does THREE things to a legacy place-order
// workflow:
//   1. Swap each AI-shape customHandler for the settings-driven body
//      (this was the original module behaviour — already tested above).
//   2. Hoist the stock-decrement chain out of the COD branch onto the
//      shared path, so online buyers also decrement stock.
//   3. Run the audit and emit a console.warn for any unknown sites.
//
// This block exercises step 2 specifically — that the call to
// `hoistStockDecrementOutOfCodBranch` inside
// `rewriteLowStockCustomHandlers` actually fires when stock management
// is enabled.

describe('rewriteLowStockCustomHandlers → hoists chain out of COD branch', () => {
  const AI_DECREMENT = `function customHandler(previousContext, params) {
  var cartItems = null;
  for (var i = 0; i < params.length; i++) {
    var p = params[i];
    if (p && Array.isArray(p.items)) { cartItems = p.items; break; }
  }
  if (!cartItems || cartItems.length === 0) {
    return { query: "SELECT 1", affected: [] };
  }
  var query = "UPDATE teleport_products SET quantity = quantity - CASE id END WHERE id IN ('a')";
  return { query: query, affected: ['a'] };
}`

  const legacyCodOnlyUidl = () =>
    ({
      workflows: {
        workflows: {
          wfPlaceOrder: {
            id: 'wfPlaceOrder',
            name: 'Place Order',
            nodes: [
              { id: 'loop', type: 'general-loop', config: {}, label: 'Loop' },
              {
                id: 'isCod',
                type: 'general-if-statement',
                config: {},
                label: 'Is Payment Cash On Delivery?',
              },
              {
                id: 'updateOrderCod',
                type: 'data-update-item',
                config: { tableName: 'teleport_orders' },
                label: 'Mark COD Confirmed',
              },
              {
                id: 'buildDecrementSql',
                type: 'general-custom-js',
                config: { code: AI_DECREMENT },
                label: 'Build Stock Decrement SQL',
              },
              {
                id: 'decrementStock',
                type: 'data-raw-query',
                config: {},
                label: 'Decrement Product Stock After Order',
              },
              { id: 'clearCart', type: 'cart-clear', config: {}, label: 'Clear Cart' },
              {
                id: 'chargeUser',
                type: 'payment-charge-user',
                config: {},
                label: 'Charge User',
              },
            ],
            edges: [
              { id: 'e1', source: 'loop', target: 'isCod', sourceHandle: 'exit' },
              { id: 'e2', source: 'isCod', target: 'updateOrderCod', sourceHandle: 'true' },
              { id: 'e3', source: 'updateOrderCod', target: 'buildDecrementSql' },
              { id: 'e4', source: 'buildDecrementSql', target: 'decrementStock' },
              { id: 'e5', source: 'decrementStock', target: 'clearCart' },
              { id: 'e6', source: 'isCod', target: 'chargeUser', sourceHandle: 'false' },
            ],
          },
        },
      },
      ecommerceSettings: {
        stockManagement: true,
        stockManagementConfig: {
          lowStockThreshold: 5,
          lowStockAlerts: false,
          allowBackorders: false,
          lowStockAlertConfig: { provider: null },
        },
      },
    } as any)

  it('rewires the chain onto the shared path when stockManagement is on', () => {
    const uidl = legacyCodOnlyUidl()
    rewriteLowStockCustomHandlers(uidl)
    const edges = uidl.workflows.workflows.wfPlaceOrder.edges
    // After hoist: loop → buildDecrementSql (NOT loop → isCod directly).
    expect(
      edges.some(
        (e: any) =>
          e.source === 'loop' && e.target === 'buildDecrementSql' && e.sourceHandle === 'exit'
      )
    ).toBe(true)
    // The chain's tail (decrementStock) feeds into the IF.
    expect(edges.some((e: any) => e.source === 'decrementStock' && e.target === 'isCod')).toBe(true)
    // The IF.true handle still routes to updateOrderCod.
    expect(
      edges.some(
        (e: any) =>
          e.source === 'isCod' && e.target === 'updateOrderCod' && e.sourceHandle === 'true'
      )
    ).toBe(true)
    // updateOrderCod now closes the branch by pointing at clearCart.
    expect(edges.some((e: any) => e.source === 'updateOrderCod' && e.target === 'clearCart')).toBe(
      true
    )
  })

  it('does NOT hoist when stockManagement is off', () => {
    const uidl = legacyCodOnlyUidl()
    uidl.ecommerceSettings.stockManagement = false
    rewriteLowStockCustomHandlers(uidl)
    const edges = uidl.workflows.workflows.wfPlaceOrder.edges
    // Original loop → isCod edge is still there because the hoist was
    // gated off — merchant opted out of stock concerns.
    expect(edges.some((e: any) => e.source === 'loop' && e.target === 'isCod')).toBe(true)
    expect(
      edges.some((e: any) => e.source === 'updateOrderCod' && e.target === 'buildDecrementSql')
    ).toBe(true)
  })
})
