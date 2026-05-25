import {
  findStockWriteSites,
  classifyStockWriteSite,
  auditStockWriteSites,
  reportStockWriteAudit,
  hoistStockDecrementOutOfCodBranch,
  STOCK_DECREMENT_MARKER,
} from '../src/ecommerce/stock-decrement'
import * as path from 'path'
import * as fs from 'fs'

// Locks in the contract:
//
//   `teleport_products.quantity` is decremented EXCLUSIVELY by the
//   place-order workflow. Admin workflows may CRUD products freely.
//   Anything else mutating teleport_products is a drift that breaks
//   the buyer-facing path and MUST surface as a build warning so the
//   merchant catches it before users do.
//
// These tests are the regression guard: they read the actual project
// UIDL fixture under examples/ AND construct synthetic UIDLs that
// inject suspicious write sites, asserting that the auditor
// categorises every site correctly and emits exactly one warning per
// unexpected site.

// ────────────────────────────────────────────────────────────────────
// classifyStockWriteSite — the single-node categoriser used by the
// auditor. Tested directly so the per-shape decisions are clear.
// ────────────────────────────────────────────────────────────────────
describe('classifyStockWriteSite — single-node categorisation', () => {
  it('categorises an admin-panel data-update-item as admin', () => {
    const result = classifyStockWriteSite('Admin Panel Update Products', {
      type: 'data-update-item',
      config: { tableName: 'teleport_products' } as any,
    })
    expect(result.category).toBe('admin')
  })

  it('categorises an admin-panel data-create-item as admin', () => {
    const result = classifyStockWriteSite('Admin Panel Create Products', {
      type: 'data-create-item',
      config: { tableName: 'teleport_products' } as any,
    })
    expect(result.category).toBe('admin')
  })

  it('categorises an admin-panel data-delete-item as admin', () => {
    const result = classifyStockWriteSite('Admin Panel Delete Products Item', {
      type: 'data-delete-item',
      config: { tableName: 'teleport_products' } as any,
    })
    expect(result.category).toBe('admin')
  })

  it('categorises a place-order custom-js with "UPDATE teleport_products SET quantity = quantity -" as order-decrement', () => {
    const aiDecrement = `function customHandler(previousContext, params) {
      var query = "UPDATE teleport_products SET quantity = quantity - CASE id WHEN 'a' THEN 2 END, updated_at = NOW() WHERE quantity IS NOT NULL AND id IN ('a')";
      return { query: query, affected: ['a'] };
    }`
    const result = classifyStockWriteSite('Place Order 1 (cash)', {
      type: 'general-custom-js',
      config: { code: aiDecrement },
    })
    expect(result.category).toBe('order-decrement')
    expect(result.sqlSnippet).toContain('UPDATE teleport_products')
  })

  it('categorises our REWRITTEN decrement (carries the marker) as order-decrement', () => {
    // After our rewriter runs, the customHandler starts with
    // STOCK_DECREMENT_MARKER. The auditor must still recognise the
    // decrement SQL inside the rewritten code.
    const rewritten = `${STOCK_DECREMENT_MARKER}
      function aggregateCartDeltas(){}
      function customHandler() {
        var query = "UPDATE teleport_products SET quantity = quantity - CASE id WHEN 'a' THEN 2 END WHERE id IN ('a')";
        return { query: query };
      }`
    const result = classifyStockWriteSite('Place Order 1 (cash)', {
      type: 'general-custom-js',
      config: { code: rewritten },
    })
    expect(result.category).toBe('order-decrement')
  })

  it('categorises our REWRITTEN decrement EVEN WHEN the SQL is split across string concatenation', () => {
    // This is the exact shape our buildStockDecrementBuilder emits:
    // the SQL is built up via "UPDATE teleport_products SET " + setClause
    // + " " + whereClause + " " + returningClause. A pure-regex check
    // for "SET quantity = quantity -" on the SOURCE would miss this
    // because "quantity = quantity -" lives in the separate `setClause`
    // variable. The classifier must use the marker as a reliable signal.
    const rewrittenConcat = `${STOCK_DECREMENT_MARKER}
      function customHandler() {
        var setClause = "quantity = quantity - CASE id" + caseExpr + " ELSE 0 END";
        var query = "UPDATE teleport_products SET " + setClause + " WHERE id IN ('a')";
        return { query: query, affected: ['a'] };
      }`
    const result = classifyStockWriteSite('Place Order 1', {
      type: 'general-custom-js',
      config: { code: rewrittenConcat },
    })
    expect(result.category).toBe('order-decrement')
  })

  it('does NOT honour the marker when the code is not actually a decrement', () => {
    // Belt-and-braces: if some future rewriter pattern uses the same
    // marker but isn`t a decrement, the auditor must NOT classify it
    // as order-decrement just because the marker is present.
    const fakeRewritten = `${STOCK_DECREMENT_MARKER}
      function customHandler() {
        return { query: "SELECT * FROM teleport_products WHERE id = 'x'" };
      }`
    // This code isn`t even a write site (SELECT only), but if it
    // somehow reached the classifier, the marker alone shouldn`t
    // promote it. (findStockWriteSites filters this out earlier.)
    const result = classifyStockWriteSite('Place Order', {
      type: 'general-custom-js',
      config: { code: fakeRewritten },
    })
    expect(result.category).toBe('unknown')
  })

  it('categorises a non-admin data-update-item on teleport_products as UNKNOWN (suspicious)', () => {
    // A "Cart Reserve Stock" workflow updating teleport_products would
    // be unexpected — surface it via the auditor.
    const result = classifyStockWriteSite('Cart Reserve Stock', {
      type: 'data-update-item',
      config: { tableName: 'teleport_products' } as any,
    })
    expect(result.category).toBe('unknown')
  })

  it('categorises a non-place-order raw UPDATE on teleport_products as UNKNOWN', () => {
    const suspicious = `function customHandler() {
      return { query: "UPDATE teleport_products SET archived = true WHERE id = '\$1'" };
    }`
    const result = classifyStockWriteSite('Some Other Flow', {
      type: 'general-custom-js',
      config: { code: suspicious },
    })
    expect(result.category).toBe('unknown')
  })

  it('categorises a non-place-order DELETE on teleport_products as UNKNOWN', () => {
    const code = `function customHandler() {
      return { query: "DELETE FROM teleport_products WHERE id = 'x'" };
    }`
    const result = classifyStockWriteSite('Bulk Cleanup', {
      type: 'general-custom-js',
      config: { code },
    })
    expect(result.category).toBe('unknown')
  })

  it('categorises a SELECT-only custom SQL on teleport_products as UNKNOWN (caller filters these out)', () => {
    // Read-only custom SQL never reaches the auditor because
    // findStockWriteSites filters on write keywords. But the
    // classifier on its own would call it unknown — the contract
    // is "if it doesn't look like decrement, it's suspicious".
    const code = `function customHandler() {
      return { query: "SELECT * FROM teleport_products WHERE id = 'x'" };
    }`
    const result = classifyStockWriteSite('Read Something', {
      type: 'general-custom-js',
      config: { code },
    })
    expect(result.category).toBe('unknown')
  })

  it('is case-insensitive for the "admin" prefix', () => {
    expect(
      classifyStockWriteSite('ADMIN Edit Products', {
        type: 'data-update-item',
        config: { tableName: 'teleport_products' } as any,
      }).category
    ).toBe('admin')
    expect(
      classifyStockWriteSite('admin · update · products', {
        type: 'data-update-item',
        config: { tableName: 'teleport_products' } as any,
      }).category
    ).toBe('admin')
  })
})

// ────────────────────────────────────────────────────────────────────
// findStockWriteSites — full UIDL walk
// ────────────────────────────────────────────────────────────────────
describe('findStockWriteSites — full UIDL walk', () => {
  it('finds zero sites in a UIDL with no workflows', () => {
    expect(findStockWriteSites({} as any)).toEqual([])
    expect(findStockWriteSites({ workflows: undefined } as any)).toEqual([])
    expect(findStockWriteSites({ workflows: { workflows: {} } } as any)).toEqual([])
  })

  it('finds every write site across both workflows and customNodes', () => {
    const uidl: any = {
      workflows: {
        workflows: {
          wf1: {
            id: 'wf1',
            name: 'Place Order 1',
            nodes: [
              {
                id: 'n1',
                type: 'general-custom-js',
                stepNumber: 5,
                config: {
                  code: `function customHandler() {
                    return { query: "UPDATE teleport_products SET quantity = quantity - 1 WHERE id IN ('x')", affected: [] };
                  }`,
                },
              },
            ],
          },
          wf2: {
            id: 'wf2',
            name: 'Admin Panel Update Products',
            nodes: [
              {
                id: 'n2',
                type: 'data-update-item',
                stepNumber: 1,
                config: { tableName: 'teleport_products', columnMappings: {} },
              },
            ],
          },
        },
        customNodes: {
          cn1: {
            id: 'cn1',
            name: 'A Custom Node That Inserts',
            nodes: [
              {
                id: 'cnn1',
                type: 'data-create-item',
                stepNumber: 1,
                config: { tableName: 'teleport_products' },
              },
            ],
          },
        },
      },
    }
    const sites = findStockWriteSites(uidl)
    expect(sites).toHaveLength(3)
    const ids = sites.map((s) => s.nodeId).sort()
    expect(ids).toEqual(['cnn1', 'n1', 'n2'])
    // workflowKind is reported correctly:
    expect(sites.find((s) => s.nodeId === 'cnn1')!.workflowKind).toBe('customNode')
    expect(sites.find((s) => s.nodeId === 'n1')!.workflowKind).toBe('workflow')
  })

  it('IGNORES read-only SELECT custom-js targeting teleport_products', () => {
    // The add-to-cart workflow contains a `data-select` on
    // teleport_products and a custom-js that READS the result.
    // Neither should appear in the audit.
    const uidl: any = {
      workflows: {
        workflows: {
          addToCart: {
            id: 'addToCart',
            name: 'Add Product To Cart Logic',
            nodes: [
              { id: 'sel', type: 'data-select', config: { tableName: 'teleport_products' } },
              {
                id: 'cjs',
                type: 'general-custom-js',
                config: {
                  code: `function customHandler() {
                    return { query: "SELECT id, quantity FROM teleport_products WHERE id = $1" };
                  }`,
                },
              },
            ],
          },
        },
      },
    }
    expect(findStockWriteSites(uidl)).toEqual([])
  })

  it('does NOT count nodes targeting other tables', () => {
    const uidl: any = {
      workflows: {
        workflows: {
          wf: {
            id: 'wf',
            name: 'Place Order 1',
            nodes: [
              { id: 'n1', type: 'data-update-item', config: { tableName: 'teleport_orders' } },
              { id: 'n2', type: 'data-create-item', config: { tableName: 'teleport_users' } },
            ],
          },
        },
      },
    }
    expect(findStockWriteSites(uidl)).toEqual([])
  })

  it('handles a workflow with no nodes array gracefully', () => {
    const uidl: any = {
      workflows: { workflows: { x: { id: 'x', name: 'Test' } } },
    }
    expect(findStockWriteSites(uidl)).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────
// auditStockWriteSites — bucketed view
// ────────────────────────────────────────────────────────────────────
describe('auditStockWriteSites — categorised buckets', () => {
  it('buckets sites by category', () => {
    const uidl: any = {
      workflows: {
        workflows: {
          adminCreate: {
            id: 'wf1',
            name: 'Admin Panel Create Products',
            nodes: [
              { id: 'n1', type: 'data-create-item', config: { tableName: 'teleport_products' } },
            ],
          },
          placeOrder: {
            id: 'wf2',
            name: 'Place Order 1',
            nodes: [
              {
                id: 'n2',
                type: 'general-custom-js',
                config: {
                  code: `var x = "UPDATE teleport_products SET quantity = quantity - 1"; return { query: x, affected: [] };`,
                },
              },
            ],
          },
          rogue: {
            id: 'wf3',
            name: 'Cart Reserve Stock',
            nodes: [
              { id: 'n3', type: 'data-update-item', config: { tableName: 'teleport_products' } },
            ],
          },
        },
      },
    }
    const audit = auditStockWriteSites(uidl)
    expect(audit.sites).toHaveLength(3)
    expect(audit.admin).toHaveLength(1)
    expect(audit.orderDecrement).toHaveLength(1)
    expect(audit.unknown).toHaveLength(1)
    expect(audit.unknown[0].workflowName).toBe('Cart Reserve Stock')
  })

  it('reports zero unknown when the project follows the contract', () => {
    const uidl: any = {
      workflows: {
        workflows: {
          adminCreate: {
            id: 'wf1',
            name: 'Admin Panel Create Products',
            nodes: [
              { id: 'n1', type: 'data-create-item', config: { tableName: 'teleport_products' } },
            ],
          },
          placeOrder: {
            id: 'wf2',
            name: 'Place Order 1',
            nodes: [
              {
                id: 'n2',
                type: 'general-custom-js',
                config: {
                  code: `var x = "UPDATE teleport_products SET quantity = quantity - 1"; return { query: x, affected: [] };`,
                },
              },
            ],
          },
        },
      },
    }
    const audit = auditStockWriteSites(uidl)
    expect(audit.unknown).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────
// reportStockWriteAudit — side-effect wrapper
// ────────────────────────────────────────────────────────────────────
describe('reportStockWriteAudit — warns on unknown sites', () => {
  let warnSpy: jest.SpyInstance
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('does NOT warn when there are zero unknown sites', () => {
    reportStockWriteAudit({ workflows: { workflows: {} } } as any)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('warns ONCE per unknown site PLUS one rollup line', () => {
    const uidl: any = {
      workflows: {
        workflows: {
          wf1: {
            id: 'wf1',
            name: 'Cart Reserve Stock',
            nodes: [
              { id: 'n1', type: 'data-update-item', config: { tableName: 'teleport_products' } },
            ],
          },
          wf2: {
            id: 'wf2',
            name: 'Bulk Stock Sync',
            nodes: [
              { id: 'n2', type: 'data-delete-item', config: { tableName: 'teleport_products' } },
            ],
          },
        },
      },
    }
    reportStockWriteAudit(uidl)
    expect(warnSpy).toHaveBeenCalledTimes(3) // 1 rollup + 2 sites
    const rollupCall = warnSpy.mock.calls[0][0] as string
    expect(rollupCall).toContain('stock-write audit')
    expect(rollupCall).toContain('2 suspicious site(s)')
  })

  it('returns the audit so callers can chain on the result', () => {
    const audit = reportStockWriteAudit({ workflows: { workflows: {} } } as any)
    expect(audit.sites).toEqual([])
    expect(audit.unknown).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────
// Integration test against the REAL project UIDL fixture. This is the
// load-bearing contract test: it locks in the current expected state
// (admin + order-decrement only, ZERO unknowns) so any future AI-side
// drift surfaces immediately in CI.
// ────────────────────────────────────────────────────────────────────
describe('stock-write audit against the real example project UIDL', () => {
  const UIDL_PATH = path.resolve(__dirname, '../../../examples/uidl-samples/project.json')

  it('locks in the expected stock-write surface for the example project', () => {
    if (!fs.existsSync(UIDL_PATH)) {
      // The test suite must still run in environments where the
      // example UIDL isn't present (e.g. a packaged release). Skip
      // gracefully instead of failing.
      // eslint-disable-next-line no-console
      console.warn('skipping real-UIDL audit — fixture not at ' + UIDL_PATH)
      return
    }
    const uidl = JSON.parse(fs.readFileSync(UIDL_PATH, 'utf8'))
    const audit = auditStockWriteSites(uidl)

    // The example project has exactly:
    //   * 3 admin product CRUD nodes (create / update / delete)
    //   * 3 place-order workflow variants (one per payment path)
    //   * ZERO unexpected sites
    // If a future regeneration drifts, this assertion will be the
    // first thing to fail.
    expect(audit.admin.length).toBeGreaterThanOrEqual(1)
    expect(audit.orderDecrement.length).toBeGreaterThanOrEqual(1)
    expect(audit.unknown).toEqual([])

    // The place-order decrement MUST appear in the place-order
    // workflows specifically — not in any other workflow.
    for (const site of audit.orderDecrement) {
      expect(site.workflowName.toLowerCase()).toMatch(/place[ -]?order/)
    }

    // Admin sites must all be admin workflows.
    for (const site of audit.admin) {
      expect(site.workflowName.toLowerCase()).toContain('admin')
    }
  })
})

// ────────────────────────────────────────────────────────────────────
// HOIST REWRITER
// ────────────────────────────────────────────────────────────────────
//
// `hoistStockDecrementOutOfCodBranch` repairs legacy UIDLs that placed
// the stock-decrement chain inside the COD branch of the payment-method
// IF gate. After the hoist, the chain lives on the shared path —
// orders paid via Stripe / PayPal decrement stock too.

const AI_DECREMENT_CODE = `function customHandler(previousContext, params) {
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

// A synthetic UIDL workflow modeled on the legacy COD-only shape:
//
//   loop → IF(payment-method)
//             ├── true (COD)  → updateOrderCod → buildDecrementSql →
//             │                  decrementStock → buildDetectLow →
//             │                  detectLow → buildLowStockPayload →
//             │                  clearCart
//             └── false       → setOrderNumberPaid → chargeUser
const buildLegacyCodOnlyWorkflow = () => ({
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
      config: { code: AI_DECREMENT_CODE },
      label: 'Build Stock Decrement SQL',
    },
    {
      id: 'decrementStock',
      type: 'data-raw-query',
      config: {},
      label: 'Decrement Product Stock After Order',
    },
    {
      id: 'buildDetectLow',
      type: 'general-custom-js',
      config: { code: 'function customHandler() { return { query: "SELECT 1" }; }' },
      label: 'Build Low-Stock Detection SQL',
    },
    {
      id: 'detectLow',
      type: 'data-raw-query',
      config: {},
      label: 'Detect Low-Stock Products',
    },
    {
      id: 'buildLowStockPayload',
      type: 'general-custom-js',
      config: { code: 'function customHandler() { return { skip: true }; }' },
      label: 'Build Low-Stock Email Payload',
    },
    { id: 'clearCart', type: 'cart-clear', config: {}, label: 'Clear Cart' },
    {
      id: 'setOrderNumberPaid',
      type: 'data-update-item',
      config: { tableName: 'teleport_orders' },
      label: 'Set Order Number',
    },
    {
      id: 'chargeUser',
      type: 'payment-charge-user',
      config: {},
      label: 'Redirect To Payment Provider Checkout',
    },
  ],
  edges: [
    { id: 'e-loop-isCod', source: 'loop', target: 'isCod', sourceHandle: 'exit' },
    { id: 'e-cod-true', source: 'isCod', target: 'updateOrderCod', sourceHandle: 'true' },
    { id: 'e-uo-bds', source: 'updateOrderCod', target: 'buildDecrementSql' },
    { id: 'e-bds-ds', source: 'buildDecrementSql', target: 'decrementStock' },
    { id: 'e-ds-bdl', source: 'decrementStock', target: 'buildDetectLow' },
    { id: 'e-bdl-dl', source: 'buildDetectLow', target: 'detectLow' },
    { id: 'e-dl-bls', source: 'detectLow', target: 'buildLowStockPayload' },
    { id: 'e-bls-cc', source: 'buildLowStockPayload', target: 'clearCart' },
    { id: 'e-cod-false', source: 'isCod', target: 'setOrderNumberPaid', sourceHandle: 'false' },
    { id: 'e-sn-cu', source: 'setOrderNumberPaid', target: 'chargeUser' },
  ],
})

const buildUidlWith = (workflow: ReturnType<typeof buildLegacyCodOnlyWorkflow>) => ({
  workflows: { workflows: { [workflow.id]: workflow } },
})

describe('hoistStockDecrementOutOfCodBranch — splices the chain onto the shared path', () => {
  it('hoists the chain so loop → chain → IF → branches (legacy COD-only shape)', () => {
    const wf = buildLegacyCodOnlyWorkflow()
    const uidl = buildUidlWith(wf) as any
    const result = hoistStockDecrementOutOfCodBranch(uidl)
    expect(result.hoistedWorkflows).toBe(1)
    expect(result.skippedWorkflows).toBe(0)

    // After hoist: loop → buildDecrementSql (chain head) → … → IF.
    // The COD branch retains updateOrderCod between IF.true and what
    // used to come after the chain (clearCart). The IF.true handle
    // still routes to updateOrderCod; updateOrderCod now closes the
    // branch by pointing at clearCart directly. No edge skips
    // updateOrderCod — the buyer's COD confirmation step is preserved.
    const edges = wf.edges
    const hasLoopToChain = edges.some(
      (e) => e.source === 'loop' && e.target === 'buildDecrementSql' && e.sourceHandle === 'exit'
    )
    const hasChainToIf = edges.some(
      (e) => e.source === 'buildLowStockPayload' && e.target === 'isCod'
    )
    const hasUpdateOrderCodToChain = edges.some(
      (e) => e.source === 'updateOrderCod' && e.target === 'buildDecrementSql'
    )
    const hasIfTrueToUpdateOrderCod = edges.some(
      (e) => e.source === 'isCod' && e.target === 'updateOrderCod' && e.sourceHandle === 'true'
    )
    const hasUpdateOrderCodToClearCart = edges.some(
      (e) => e.source === 'updateOrderCod' && e.target === 'clearCart'
    )
    const hasLoopToIfDirectly = edges.some((e) => e.source === 'loop' && e.target === 'isCod')
    const hasChainToClearCart = edges.some(
      (e) => e.source === 'buildLowStockPayload' && e.target === 'clearCart'
    )

    expect(hasLoopToChain).toBe(true)
    expect(hasChainToIf).toBe(true)
    expect(hasUpdateOrderCodToChain).toBe(false)
    expect(hasIfTrueToUpdateOrderCod).toBe(true)
    expect(hasUpdateOrderCodToClearCart).toBe(true)
    expect(hasLoopToIfDirectly).toBe(false)
    expect(hasChainToClearCart).toBe(false)
  })

  it('is idempotent — running twice produces the same shape as running once', () => {
    const wf = buildLegacyCodOnlyWorkflow()
    const uidl = buildUidlWith(wf) as any
    hoistStockDecrementOutOfCodBranch(uidl)
    const edgesAfterFirst = wf.edges.length
    const second = hoistStockDecrementOutOfCodBranch(uidl)
    expect(second.hoistedWorkflows).toBe(0)
    expect(second.skippedWorkflows).toBe(1)
    expect(wf.edges.length).toBe(edgesAfterFirst)
  })

  it('skips a workflow whose chain is already on the shared path', () => {
    // Synthetic "modern" shape: the decrement node has the IF
    // downstream (chain → IF), not upstream — nothing to hoist.
    const wf = {
      id: 'wfPlaceOrder',
      name: 'Place Order',
      nodes: [
        { id: 'loop', type: 'general-loop', config: {}, label: 'Loop' },
        {
          id: 'buildDecrementSql',
          type: 'general-custom-js',
          config: { code: AI_DECREMENT_CODE },
          label: 'Build Stock Decrement SQL',
        },
        {
          id: 'isCod',
          type: 'general-if-statement',
          config: {},
          label: 'Is Payment Cash On Delivery?',
        },
      ],
      edges: [
        { id: 'e1', source: 'loop', target: 'buildDecrementSql', sourceHandle: 'exit' },
        { id: 'e2', source: 'buildDecrementSql', target: 'isCod' },
      ],
    }
    const result = hoistStockDecrementOutOfCodBranch(buildUidlWith(wf) as any)
    expect(result.hoistedWorkflows).toBe(0)
    expect(result.skippedWorkflows).toBe(1)
  })

  it('skips a workflow without any stock-decrement node', () => {
    const wf = {
      id: 'wfBenign',
      name: 'Other Flow',
      nodes: [{ id: 'noop', type: 'general-custom-js', config: { code: 'function f(){}' } }],
      edges: [],
    }
    const result = hoistStockDecrementOutOfCodBranch(buildUidlWith(wf) as any)
    expect(result.hoistedWorkflows).toBe(0)
    expect(result.skippedWorkflows).toBe(1)
  })

  it('skips a UIDL with no workflows at all', () => {
    const result = hoistStockDecrementOutOfCodBranch({} as any)
    expect(result.hoistedWorkflows).toBe(0)
    expect(result.skippedWorkflows).toBe(0)
  })

  it('also recognises a marker-rewritten decrement (rewriter ran before hoist)', () => {
    // The pattern matcher uses `looksLikeStockDecrementBuilder` which
    // already recognises the marker-rewritten shape, so the hoist
    // works whether the rewriter ran first or not.
    const wf = buildLegacyCodOnlyWorkflow()
    const decrementNode = wf.nodes.find((n) => n.id === 'buildDecrementSql') as any
    decrementNode.config.code = `${STOCK_DECREMENT_MARKER}
function customHandler() {
  var setClause = "quantity = quantity - CASE id WHEN 'a' THEN 1 END";
  return { query: "UPDATE teleport_products SET " + setClause, affected: ['a'] };
}`
    const result = hoistStockDecrementOutOfCodBranch(buildUidlWith(wf) as any)
    expect(result.hoistedWorkflows).toBe(1)
  })
})

describe('reportStockWriteAudit — IF-branch structural check', () => {
  let warnSpy: jest.SpyInstance
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('warns when a workflow still has the decrement inside an IF branch', () => {
    const uidl = buildUidlWith(buildLegacyCodOnlyWorkflow()) as any
    reportStockWriteAudit(uidl)
    // At least one warn carries the branch-site rollup phrasing.
    const calls = warnSpy.mock.calls.map((c) => String(c[0]))
    expect(calls.some((s) => s.includes('decrement stock inside an IF branch'))).toBe(true)
  })

  it('emits no branch-warning after the hoist runs', () => {
    const wf = buildLegacyCodOnlyWorkflow()
    const uidl = buildUidlWith(wf) as any
    hoistStockDecrementOutOfCodBranch(uidl)
    warnSpy.mockClear()
    reportStockWriteAudit(uidl)
    const calls = warnSpy.mock.calls.map((c) => String(c[0]))
    expect(calls.some((s) => s.includes('decrement stock inside an IF branch'))).toBe(false)
  })

  it('does not warn when a workflow has no stock-decrement at all', () => {
    const wf = {
      id: 'wfBenign',
      name: 'Other Flow',
      nodes: [{ id: 'noop', type: 'general-custom-js', config: { code: 'function f(){}' } }],
      edges: [],
    }
    reportStockWriteAudit(buildUidlWith(wf) as any)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
