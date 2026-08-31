import { ProjectUIDL } from '@teleporthq/teleport-types'
import { rewriteLowStockCustomHandlers } from '../src/ecommerce-customhandler-rewriter'
import {
  looksLikeCartDeltasBuilder,
  isRewrittenCartDeltasBuilder,
  isParameterizedStockDecrementQuery,
  isParameterizedLowStockSelect,
  buildParameterizedStockDecrementQuery,
  buildParameterizedLowStockSelect,
  rewriteVariantPickerStockGate,
  __testables,
} from '../src/ecommerce/parameterized-stock-chain'
import { classifyStockWriteSite } from '../src/ecommerce/stock-decrement'
import { generateDataAPIRoute } from '../src/data-api-route-generator'

// Regression guard for "a variant purchase decremented NOTHING and the
// low-stock alert never fired for variants". The GUI's parameterized
// place-order chain (order-side-effects-helper.ts) ships a products-only
// UPDATE + SELECT and a cart-deltas builder that drops variant ids; the
// rewriter must upgrade all three, keep the auditor + data-api auto-fire
// contracts intact, and re-bake the settings-derived constants (threshold,
// backorders guard) on EVERY generation in either direction.

// ─── Verbatim GUI-emitted shapes (mirrors examples/uidl-samples/project.json) ─

const ORIGINAL_DELTAS_CODE = `function customHandler(previousContext, params) {
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
  var seen = {};
  if (cartItems) {
    for (var k = 0; k < cartItems.length; k++) {
      var it = cartItems[k];
      var pid = it.productId || it.product_id;
      if (!pid) { continue; }
      var key = String(pid);
      if (seen[key]) { continue; }
      var qty = parseInt(it.quantity, 10);
      if (isNaN(qty) || qty <= 0) { qty = 1; }
      seen[key] = true;
      ids.push(key);
      qtys.push(qty);
    }
  }
  return { ids: ids, qtys: qtys, affected: ids };
}`

const ORIGINAL_DECREMENT_QUERY =
  'UPDATE teleport_products AS p SET quantity = p.quantity - d.qty, updated_at = NOW() ' +
  'FROM unnest($1::text[], $2::int[]) AS d(id, qty) ' +
  'WHERE p.quantity IS NOT NULL AND p.id::text = d.id'

const ORIGINAL_DETECT_QUERY =
  "SELECT id, name, quantity AS stock, COALESCE(sku, '') AS sku FROM teleport_products " +
  'WHERE quantity IS NOT NULL AND quantity <= 5 AND id::text = ANY($1::text[])'

const DELTAS_ID = 'deltas-node'
const DECREMENT_ID = 'decrement-node'
const DETECT_ID = 'detect-node'

const wfParam = (key: string) => ({
  path: [DELTAS_ID, key],
  type: 'workflowContext',
  nodeId: DELTAS_ID,
})

interface ChainNodes {
  deltas: { id: string; type: string; config: { code: string } }
  decrement: { id: string; type: string; config: { query: string; params: unknown[] } }
  detect: { id: string; type: string; config: { query: string; params: unknown[] } }
}

const buildChainNodes = (): ChainNodes => ({
  deltas: { id: DELTAS_ID, type: 'general-custom-js', config: { code: ORIGINAL_DELTAS_CODE } },
  decrement: {
    id: DECREMENT_ID,
    type: 'data-raw-query',
    config: { query: ORIGINAL_DECREMENT_QUERY, params: [wfParam('ids'), wfParam('qtys')] },
  },
  detect: {
    id: DETECT_ID,
    type: 'data-raw-query',
    config: { query: ORIGINAL_DETECT_QUERY, params: [wfParam('affected')] },
  },
})

const buildUIDL = (
  chain: ChainNodes,
  settings: { allowBackorders?: boolean; lowStockThreshold?: number } = {}
): ProjectUIDL =>
  ({
    name: 'test',
    ecommerceSettings: {
      stockManagement: true,
      stockManagementConfig: {
        allowBackorders: settings.allowBackorders ?? true,
        lowStockThreshold: settings.lowStockThreshold ?? 5,
        lowStockAlerts: true,
        lowStockAlertConfig: { provider: 'postmark' },
      },
    },
    workflows: {
      workflows: {
        'place-order': {
          id: 'place-order',
          name: 'Place Order',
          nodes: [chain.deltas, chain.decrement, chain.detect],
          edges: [],
        },
      },
      customNodes: {},
    },
  } as unknown as ProjectUIDL)

// ─── Pattern matchers ────────────────────────────────────────────────

describe('parameterized stock chain — pattern matchers', () => {
  it('recognises the GUI cart-deltas builder and not its replacement', () => {
    expect(looksLikeCartDeltasBuilder(ORIGINAL_DELTAS_CODE)).toBe(true)
    const chain = buildChainNodes()
    rewriteLowStockCustomHandlers(buildUIDL(chain))
    expect(looksLikeCartDeltasBuilder(chain.deltas.config.code)).toBe(false)
    expect(isRewrittenCartDeltasBuilder(chain.deltas.config.code)).toBe(true)
  })

  it('recognises BOTH decrement shapes (products-only and CTE) for re-baking', () => {
    expect(isParameterizedStockDecrementQuery(ORIGINAL_DECREMENT_QUERY)).toBe(true)
    expect(isParameterizedStockDecrementQuery(buildParameterizedStockDecrementQuery(true))).toBe(
      true
    )
    expect(isParameterizedStockDecrementQuery(buildParameterizedStockDecrementQuery(false))).toBe(
      true
    )
    // The legacy string-assembled decrement (customHandler-built SQL) must NOT match.
    expect(
      isParameterizedStockDecrementQuery(
        "UPDATE teleport_products SET quantity = quantity - CASE id WHEN 'a' THEN 2 END WHERE id IN ('a')"
      )
    ).toBe(false)
  })

  it('recognises BOTH low-stock SELECT shapes for threshold re-baking', () => {
    expect(isParameterizedLowStockSelect(ORIGINAL_DETECT_QUERY)).toBe(true)
    expect(isParameterizedLowStockSelect(buildParameterizedLowStockSelect(5))).toBe(true)
    // An unrelated stock SELECT (no bound id array) must not match.
    expect(
      isParameterizedLowStockSelect(
        'SELECT id, name, quantity AS stock FROM teleport_products WHERE quantity <= 5'
      )
    ).toBe(false)
  })
})

// ─── Full chain rewrite ─────────────────────────────────────────────

describe('parameterized stock chain — rewrite', () => {
  it('rewrites all three nodes and wires $1..$4 to the deltas builder', () => {
    const chain = buildChainNodes()
    const summary = rewriteLowStockCustomHandlers(buildUIDL(chain))

    expect(summary.parameterizedChain.deltasBuilderRewrites).toBe(1)
    expect(summary.parameterizedChain.decrementQueryRewrites).toBe(1)
    expect(summary.parameterizedChain.lowStockSelectRewrites).toBe(1)
    expect(summary.parameterizedChain.skippedChains).toBe(0)

    expect(chain.decrement.config.query).toContain('teleport_product_variants')
    expect(chain.detect.config.query).toContain('teleport_product_variants')

    for (const node of [chain.decrement, chain.detect]) {
      expect(node.config.params).toEqual([
        wfParam('ids'),
        wfParam('qtys'),
        wfParam('variantIds'),
        wfParam('variantQtys'),
      ])
    }
  })

  it('bakes the backorders guard OFF→refuse-below-zero, ON→unconditional', () => {
    const withBackorders = buildChainNodes()
    rewriteLowStockCustomHandlers(buildUIDL(withBackorders, { allowBackorders: true }))
    expect(withBackorders.decrement.config.query).not.toContain('>=')

    const strict = buildChainNodes()
    rewriteLowStockCustomHandlers(buildUIDL(strict, { allowBackorders: false }))
    expect(strict.decrement.config.query).toContain('p.quantity >= d.qty')
    expect(strict.decrement.config.query).toContain('v.quantity >= d.qty')
  })

  it('re-bakes threshold + guard when settings change on a later generation', () => {
    const chain = buildChainNodes()
    rewriteLowStockCustomHandlers(buildUIDL(chain, { allowBackorders: true, lowStockThreshold: 5 }))
    expect(chain.detect.config.query).toContain('<= 5')

    // Same (already-rewritten) nodes, new settings — the toggle must land.
    const summary = rewriteLowStockCustomHandlers(
      buildUIDL(chain, { allowBackorders: false, lowStockThreshold: 12 })
    )
    expect(summary.parameterizedChain.deltasBuilderRewrites).toBe(0)
    expect(summary.parameterizedChain.decrementQueryRewrites).toBe(1)
    expect(chain.decrement.config.query).toContain('p.quantity >= d.qty')
    expect(chain.detect.config.query).toContain('<= 12')
    expect(chain.detect.config.query).not.toContain('<= 5')
  })

  it('is idempotent — a second run with the same settings changes nothing', () => {
    const chain = buildChainNodes()
    rewriteLowStockCustomHandlers(buildUIDL(chain))
    const afterFirst = JSON.parse(JSON.stringify(chain))
    rewriteLowStockCustomHandlers(buildUIDL(chain))
    expect(chain).toEqual(afterFirst)
  })

  it('accepts a GUI-fresh variant-aware chain (marker-less builder) and re-bakes settings', () => {
    // The GUI's current order-side-effects-helper template already emits the
    // variant-aware contract, with NO rewrite marker. That must be accepted
    // (no drift warn, no skipped chain) and its queries still re-baked.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const chain = buildChainNodes()
      chain.deltas.config.code = [
        'function customHandler(previousContext, params) {',
        '  var ids = []; var qtys = []; var variantIds = []; var variantQtys = [];',
        '  return { ids: ids, qtys: qtys, affected: ids, variantIds: variantIds, variantQtys: variantQtys, variantAffected: variantIds };',
        '}',
      ].join('\n')
      chain.decrement.config.query = buildParameterizedStockDecrementQuery(true)
      chain.detect.config.query = buildParameterizedLowStockSelect(5)
      const summary = rewriteLowStockCustomHandlers(
        buildUIDL(chain, { allowBackorders: false, lowStockThreshold: 9 })
      )
      expect(summary.parameterizedChain.skippedChains).toBe(0)
      expect(summary.parameterizedChain.deltasBuilderRewrites).toBe(0)
      expect(chain.decrement.config.query).toContain('p.quantity >= d.qty')
      expect(chain.detect.config.query).toContain('<= 9')
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('leaves the WHOLE chain untouched when the deltas builder has drifted', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const chain = buildChainNodes()
      chain.deltas.config.code = 'function customHandler() { return {}; }'
      const summary = rewriteLowStockCustomHandlers(buildUIDL(chain))
      expect(summary.parameterizedChain.skippedChains).toBe(1)
      expect(chain.decrement.config.query).toBe(ORIGINAL_DECREMENT_QUERY)
      expect(chain.detect.config.query).toBe(ORIGINAL_DETECT_QUERY)
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('does not touch the chain when stock management is off', () => {
    const chain = buildChainNodes()
    const uidl = buildUIDL(chain)
    ;(uidl.ecommerceSettings as { stockManagement?: boolean }).stockManagement = false
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.parameterizedChain.decrementQueryRewrites).toBe(0)
    expect(chain.decrement.config.query).toBe(ORIGINAL_DECREMENT_QUERY)
  })
})

// ─── Rewritten deltas builder behaviour (executed) ──────────────────

describe('rewritten cart-deltas builder — executed against a mixed cart', () => {
  const runDeltas = (cartItems: unknown[]): Record<string, unknown> => {
    const chain = buildChainNodes()
    rewriteLowStockCustomHandlers(buildUIDL(chain))
    const handler = new Function(chain.deltas.config.code + '\nreturn customHandler;')() as (
      prev: unknown,
      params: unknown[]
    ) => Record<string, unknown>
    return handler(null, [{ items: cartItems }])
  }

  it('routes variant lines to the variant arrays and sums duplicates', () => {
    const result = runDeltas([
      { productId: 'p1', quantity: 2 },
      { productId: 'p1', quantity: '3' }, // duplicate product line → SUM, not first-wins
      { productId: 'p2', variantId: 'v1', quantity: 1 },
      { product_id: 'p2', variant_id: 'v1', quantity: 2 }, // snake_case + duplicate variant
      { productId: 'p2', variantId: 'v2', quantity: 5 }, // second variant of the SAME product
    ])
    expect(result.ids).toEqual(['p1'])
    expect(result.qtys).toEqual([5])
    expect(result.affected).toEqual(['p1'])
    expect(result.variantIds).toEqual(['v1', 'v2'])
    expect(result.variantQtys).toEqual([3, 5])
  })

  it('a variant line never decrements the parent product', () => {
    const result = runDeltas([{ productId: 'p1', variantId: 'v1', quantity: 4 }])
    expect(result.ids).toEqual([])
    expect(result.variantIds).toEqual(['v1'])
    expect(result.variantQtys).toEqual([4])
  })

  it('coerces missing/garbled quantities to 1 and skips id-less lines', () => {
    const result = runDeltas([
      { productId: 'p1' },
      { productId: 'p1', quantity: 'zero' },
      { quantity: 3 },
      null,
    ])
    expect(result.ids).toEqual(['p1'])
    expect(result.qtys).toEqual([2])
    expect(result.variantIds).toEqual([])
  })
})

// ─── Downstream contracts ───────────────────────────────────────────

describe('rewritten queries keep the auditor + data-api contracts', () => {
  it('the CTE decrement still classifies as order-decrement (no audit warn)', () => {
    for (const allowBackorders of [true, false]) {
      const result = classifyStockWriteSite('Place Order', {
        type: 'data-raw-query',
        config: { query: buildParameterizedStockDecrementQuery(allowBackorders) },
      })
      expect(result.category).toBe('order-decrement')
    }
  })

  it('a full rewrite emits no stock-write audit warnings', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      rewriteLowStockCustomHandlers(buildUIDL(buildChainNodes()))
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('the UNION SELECT still triggers the data-api auto-fire and threshold extraction', () => {
    // Evaluate the DETECTOR functions from the emitted data-api route itself,
    // so this test breaks if either side of the contract drifts.
    const routeCode = generateDataAPIRoute({ lowStockAlertsEnabled: true, lowStockThreshold: 5 })
    const extractFn = (decl: string): string => {
      const start = routeCode.indexOf(decl)
      expect(start).toBeGreaterThan(-1)
      let depth = 0
      let i = routeCode.indexOf('{', start)
      for (; i < routeCode.length; i++) {
        if (routeCode.charAt(i) === '{') depth++
        if (routeCode.charAt(i) === '}') {
          depth--
          if (depth === 0) return routeCode.slice(start, i + 1)
        }
      }
      throw new Error('unbalanced braces for ' + decl)
    }
    const constants = 'var LOW_STOCK_THRESHOLD = 5;\n'
    const looksLike = new Function(
      constants +
        extractFn('function looksLikeLowStockProductSelect') +
        '\nreturn looksLikeLowStockProductSelect;'
    )() as (q: string) => boolean
    const extractThreshold = new Function(
      constants +
        extractFn('function extractThresholdFromQuery') +
        '\nreturn extractThresholdFromQuery;'
    )() as (q: string) => number

    const query = buildParameterizedLowStockSelect(7)
    expect(looksLike(query)).toBe(true)
    expect(extractThreshold(query)).toBe(7)
  })

  it('never casts the TEXT options column to json in SQL', () => {
    // One malformed options row would abort the whole SELECT (and the
    // auto-fire with it) if the SQL cast options::json — the variant label
    // must come from sku / the id slug instead.
    expect(buildParameterizedLowStockSelect(5)).not.toMatch(/options/)
  })
})

// ─── Variant picker gate ────────────────────────────────────────────

describe('variant-picker inStock gate — bidirectional re-bake', () => {
  const PICKER_CODE = [
    'function customHandler(params) {',
    '  var ctx = params[params.length - 1] || {};',
    '  function parse(j){ if (j == null) return []; try { var r = JSON.parse(j); return Array.isArray(r) ? r : []; } catch(e){ return []; } }',
    '  ' + __testables.PICKER_IN_STOCK_GATED,
    '  var variants = parse(ctx.variantsJson);',
    '  var selectedId = (variants[0] && inStock(variants[0])) ? String(variants[0].id) : "";',
    '  return { selectedId: selectedId, addEnabled: selectedId ? "true" : "false" };',
    '}',
  ].join('\n')

  it('swaps the gate out when stock never blocks, and back when it does', () => {
    const ungated = rewriteVariantPickerStockGate(PICKER_CODE, true)
    expect(ungated).not.toBeNull()
    expect(ungated).toContain(__testables.PICKER_IN_STOCK_UNGATED)
    expect(ungated).not.toContain(__testables.PICKER_IN_STOCK_GATED)

    const regated = rewriteVariantPickerStockGate(ungated as string, false)
    expect(regated).toContain(__testables.PICKER_IN_STOCK_GATED)

    // Already in the requested state → no-op.
    expect(rewriteVariantPickerStockGate(ungated as string, true)).toBeNull()
    expect(rewriteVariantPickerStockGate(PICKER_CODE, false)).toBeNull()
  })

  it('a zero-stock variant becomes addable only in the ungated form', () => {
    const run = (code: string): Record<string, unknown> => {
      const handler = new Function(code + '\nreturn customHandler;')() as (
        params: unknown[]
      ) => Record<string, unknown>
      return handler([{ variantsJson: JSON.stringify([{ id: 'v1', quantity: 0 }]) }])
    }
    expect(run(PICKER_CODE).addEnabled).toBe('false')
    const ungated = rewriteVariantPickerStockGate(PICKER_CODE, true) as string
    expect(run(ungated).addEnabled).toBe('true')
    expect(run(ungated).selectedId).toBe('v1')
  })

  it('never touches a handler that is not the picker resolver', () => {
    expect(
      rewriteVariantPickerStockGate(
        'function customHandler() { return { addEnabled: "x" }; }',
        true
      )
    ).toBeNull()
  })

  it('runs through rewriteLowStockCustomHandlers on workflow nodes', () => {
    const uidl = buildUIDL(buildChainNodes())
    const wf = (uidl.workflows as unknown as { workflows: Record<string, { nodes: unknown[] }> })
      .workflows['place-order']
    wf.nodes.push({
      id: 'picker-node',
      type: 'general-custom-js',
      config: { code: PICKER_CODE },
    })
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.variantPickerGateRewrites).toBe(1)
    const picker = wf.nodes[wf.nodes.length - 1] as { config: { code: string } }
    expect(picker.config.code).toContain(__testables.PICKER_IN_STOCK_UNGATED)
  })
})
