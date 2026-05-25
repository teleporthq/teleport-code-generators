import {
  looksLikeOrderNumberGenerator,
  buildOrderNumberGenerator,
} from '../src/ecommerce/order-number-generator'
import { STOCK_DECREMENT_MARKER } from '../src/ecommerce/stock-decrement'
import { rewriteLowStockCustomHandlers } from '../src/ecommerce-customhandler-rewriter'

// Verbatim copy of the AI's step-19 customHandler from the place-order
// workflow seg-server-3.js. Contains the load-bearing bug we're
// fixing: `params[14]` is positional, so any shift in the workflow's
// upstream node ordering reads the wrong value and emits `"ORD-"`
// with no token.
const AI_VERBATIM = `function customHandler(params) {
  var createOrderResult = params[14] || {};
  var seq = createOrderResult.order_seq;
  var fallback = createOrderResult.id != null ? String(createOrderResult.id) : "";
  var token = seq != null && seq !== "" ? String(seq) : fallback;
  return { result: "ORD-" + token };
}`

// Helper: evaluate the emitted customHandler with a stub previousContext
// and a controlled `params` array, the same way the runtime calls it.
const evalHandler = (params: unknown[]): { result: string } => {
  const code = buildOrderNumberGenerator()
  // The emitted code starts with `function customHandler(...)`; pull
  // the body out and call it directly the way the runtime does.
  const match = code.match(/function\s+customHandler\s*\(([^)]*)\)/)
  expect(match).not.toBeNull()
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(
    'previousContext',
    'params',
    code + '\nreturn customHandler(previousContext, params);'
  )
  return fn({}, params) as { result: string }
}

describe('looksLikeOrderNumberGenerator — pattern detection', () => {
  it('matches the AI verbatim customHandler shape', () => {
    expect(looksLikeOrderNumberGenerator(AI_VERBATIM)).toBe(true)
  })

  it('rejects already-rewritten code (marker present)', () => {
    const rewritten = buildOrderNumberGenerator()
    expect(rewritten).toContain(STOCK_DECREMENT_MARKER)
    expect(looksLikeOrderNumberGenerator(rewritten)).toBe(false)
  })

  it('rejects unrelated customHandlers', () => {
    expect(looksLikeOrderNumberGenerator('function customHandler() { return {}; }')).toBe(false)
    expect(
      looksLikeOrderNumberGenerator(
        'function customHandler(params) { return { result: "ORD-1234" }; }'
      )
    ).toBe(false)
  })

  it('rejects non-string inputs without throwing', () => {
    expect(looksLikeOrderNumberGenerator(null as unknown as string)).toBe(false)
    expect(looksLikeOrderNumberGenerator(undefined as unknown as string)).toBe(false)
    expect(looksLikeOrderNumberGenerator(42 as unknown as string)).toBe(false)
  })
})

describe('buildOrderNumberGenerator — runtime semantics', () => {
  it('returns ORD-<seq> when order_seq is present', () => {
    const result = evalHandler([
      { unrelated: 'thing' },
      { id: '37d7971e-c0fe-4e8c-bc7e-40c9809bd5e8', order_seq: 42, total_amount: '100.00' },
    ])
    expect(result.result).toBe('ORD-42')
  })

  it('falls back to existing order_number column when already prefixed', () => {
    const result = evalHandler([
      { id: 'abc-uuid', order_number: 'ORD-99', customer_email: 'x@y.com' },
    ])
    expect(result.result).toBe('ORD-99')
  })

  it('falls back to the first 8 chars of the UUID id when no seq or order_number', () => {
    const result = evalHandler([
      { id: '37d7971e-c0fe-4e8c-bc7e-40c9809bd5e8', total_amount: '100.00' },
    ])
    expect(result.result).toBe('ORD-37d7971e')
  })

  it('walks past unrelated params to find the order row by shape', () => {
    const result = evalHandler([
      { settingsCtx: true }, // not an order row
      ['some', 'array'], // not an object
      null, // null entry
      { id: 'x', order_seq: 7, total_amount: '50' }, // THIS is the order row
      { foundCtx: true },
    ])
    expect(result.result).toBe('ORD-7')
  })

  it('handles missing order row gracefully (returns ORD-unknown so URL is non-empty)', () => {
    const result = evalHandler([{ unrelated: 'thing' }, { another: 'thing' }])
    expect(result.result).toBe('ORD-unknown')
  })

  it('does not double-prefix an existing ORD- order_number', () => {
    const result = evalHandler([
      { id: 'abc', order_seq: 5, order_number: 'ORD-12345', customer_email: 'x@y.com' },
    ])
    // order_number wins over order_seq when it's already prefixed
    expect(result.result).toBe('ORD-12345')
  })

  it('rejects garbage order_number values and falls through to seq', () => {
    const result = evalHandler([{ id: 'abc', order_seq: 8, order_number: '', total_amount: '10' }])
    expect(result.result).toBe('ORD-8')
  })

  it('handles params with non-string id correctly', () => {
    // looksLikeOrderRow REQUIRES id to be a non-empty string — a numeric
    // id should not be picked as the order row.
    const result = evalHandler([
      { id: 42, order_seq: 99, total_amount: '100' }, // numeric id - skipped
      { id: 'real-uuid', order_seq: 7, total_amount: '100' },
    ])
    expect(result.result).toBe('ORD-7')
  })

  it('emits the STOCK_DECREMENT_MARKER for idempotent re-runs', () => {
    const code = buildOrderNumberGenerator()
    expect(code).toContain(STOCK_DECREMENT_MARKER)
  })

  it('emits customHandler as the FIRST function declaration so the runtime regex picks it up', () => {
    const code = buildOrderNumberGenerator()
    // After the marker comment, the first `function …` token must be `customHandler`.
    const afterMarker = code.slice(
      code.indexOf(STOCK_DECREMENT_MARKER) + STOCK_DECREMENT_MARKER.length
    )
    const firstFn = afterMarker.match(/function\s+(\w+)/)
    expect(firstFn).not.toBeNull()
    expect(firstFn![1]).toBe('customHandler')
  })
})

describe('rewriteLowStockCustomHandlers — orchestrator integration', () => {
  const fixtureUidl = (handlerCode: string) =>
    ({
      settings: {
        ecommerce: {
          stockManagement: true,
          stockManagementConfig: { allowBackorders: false, lowStockThreshold: 5 },
        },
      },
      workflows: {
        workflows: {
          'place-order-1': {
            nodes: [{ id: 'n1', type: 'general-custom-js', config: { code: handlerCode } }],
          },
        },
        customNodes: {},
      },
    } as unknown as Parameters<typeof rewriteLowStockCustomHandlers>[0])

  it('rewrites the AI orderNumber generator on first run', () => {
    const uidl = fixtureUidl(AI_VERBATIM)
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.orderNumberGeneratorRewrites).toBe(1)
    const wf = uidl.workflows!.workflows as Record<
      string,
      { nodes: Array<{ config: { code: string } }> }
    >
    expect(wf['place-order-1'].nodes[0].config.code).toContain(STOCK_DECREMENT_MARKER)
  })

  it('is idempotent — running twice does not rewrite again', () => {
    const uidl = fixtureUidl(AI_VERBATIM)
    rewriteLowStockCustomHandlers(uidl)
    const summary2 = rewriteLowStockCustomHandlers(uidl)
    expect(summary2.orderNumberGeneratorRewrites).toBe(0)
  })

  it('rewrites even when stockManagement is off (the orderNumber bug exists regardless)', () => {
    const uidl = fixtureUidl(AI_VERBATIM)
    // Force stockManagement off
    const settings = (uidl as unknown as { settings: { ecommerce: { stockManagement: boolean } } })
      .settings.ecommerce
    settings.stockManagement = false
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.orderNumberGeneratorRewrites).toBe(1)
  })
})
