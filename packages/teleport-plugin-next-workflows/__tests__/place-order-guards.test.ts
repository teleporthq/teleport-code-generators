import { ProjectUIDL } from '@teleporthq/teleport-types'
import { rewriteLowStockCustomHandlers } from '../src/ecommerce-customhandler-rewriter'
import {
  SETTLE_NOTHING_DUE_GUARD,
  SETTLE_ZONE_COD_GUARD,
  guardSettleOrderStatement,
  looksLikeOrderRedemptionStatement,
  looksLikeSettleOrderStatement,
  looksLikeSettleUnpaidOrderStatement,
  reserveStockInRedemptionStatement,
  restoreReservationsInSettleUnpaidStatement,
  STOCK_RESERVATION_KEY,
  STOCK_RESERVATION_RESTORE_LINES,
  STOCK_RESERVATION_RESTORE_LINES_BY_ORDER,
  STALLED_RESERVATION_RELEASE,
  VOUCHER_ITEM_PRODUCT_IDS_KEY,
  buildStalledReservationReleaseQuery,
  buildStalledReservationReleaseQueries,
  buildStalledReservationCandidatesQuery,
  hasReservationRecordSql,
  lockSettleUnpaidRestoresInIdOrder,
} from '../src/ecommerce/place-order-guards'
import { isParameterizedStockDecrementQuery } from '../src/ecommerce/parameterized-stock-chain'
import { classifyStockWriteSite } from '../src/ecommerce/stock-decrement'
import {
  GUI_ORDER_REDEMPTION_QUERY,
  GUI_SETTLE_ORDER_QUERY,
  GUI_SETTLE_UNPAID_ORDER_QUERY,
  GUI_STOCK_DECREMENT_QUERY,
} from './_helpers/gui-place-order-statements'

// The place-order workflow's money statements are re-baked at export from the
// store's CURRENT settings, the way the stock chain is:
//
// - the settle write ("Mark Order As Settled") confirms an order nobody pays
//   online. On a store that does not take cash on delivery it confirms only an
//   order with nothing left to collect (a gift card paid it, or it totals 0):
//   skipping the browser's branch and calling that route can no longer turn a
//   prepaid order into an unpaid "cash on delivery" one.
// - with stock managed and no backorders, the redemption statement (right
//   after the order row, refusing and cancelling the order when anything it
//   spends is gone) reserves the order's stock with a locked, conditional
//   decrement: the second of two orders for the last unit is refused, and the
//   later decrement step takes nothing again.

const PRICE_ID = 'price-node'
const REDEEM_ID = 'redeem-node'
const SETTLE_ID = 'settle-node'
const DELTAS_ID = 'deltas-node'
const DECREMENT_ID = 'decrement-node'

const ctx = (nodeId: string, ...path: string[]) => ({
  path: [nodeId, ...path],
  type: 'workflowContext',
  nodeId,
})

const DELTAS_CODE = `function customHandler(previousContext, params) {
  var variantIds = [];
  var variantQtys = [];
  return { ids: [], qtys: [], affected: ids, variantIds: variantIds, variantQtys: variantQtys, variantAffected: variantIds };
}`

const redemptionParams = () => Array.from({ length: 9 }, (_v, i) => ctx('assemble', 'p' + i))

const placeOrderNodes = () => [
  { id: PRICE_ID, type: 'cart-price-order', config: {} },
  {
    id: REDEEM_ID,
    type: 'data-raw-query',
    config: { query: GUI_ORDER_REDEMPTION_QUERY, params: redemptionParams() },
  },
  {
    id: SETTLE_ID,
    type: 'data-raw-query',
    config: {
      query: GUI_SETTLE_ORDER_QUERY,
      params: [ctx('create', 'id'), ctx('number', 'result')],
    },
  },
  { id: DELTAS_ID, type: 'general-custom-js', config: { code: DELTAS_CODE } },
  {
    id: DECREMENT_ID,
    type: 'data-raw-query',
    config: {
      query: GUI_STOCK_DECREMENT_QUERY,
      params: [ctx(DELTAS_ID, 'ids'), ctx(DELTAS_ID, 'qtys')],
    },
  },
]

type LooseNode = { id: string; type: string; config: Record<string, any> }

const buildUIDL = (
  nodes: LooseNode[],
  settings: {
    cashOnDelivery?: boolean
    stockManagement?: boolean
    allowBackorders?: boolean
    zones?: boolean
  }
): ProjectUIDL =>
  ({
    name: 'store',
    ecommerceSettings: {
      cashOnDelivery: settings.cashOnDelivery === true,
      ...(settings.zones
        ? { regionalPricing: { enabled: true, currency: 'EUR', countryCodes: {} } }
        : {}),
      stockManagement: settings.stockManagement !== false,
      stockManagementConfig: {
        allowBackorders: settings.allowBackorders === true,
        lowStockThreshold: 5,
        lowStockAlerts: false,
      },
    },
    workflows: {
      workflows: {
        'place-order': { id: 'place-order', name: 'Place Order', nodes, edges: [] },
      },
      customNodes: {},
    },
  } as unknown as ProjectUIDL)

const byId = (nodes: LooseNode[], id: string) => nodes.find((n) => n.id === id) as LooseNode

describe('place-order guards — recognising the editor statements', () => {
  it('recognises the settle write and the redemption statement the editor bakes, and nothing else', () => {
    expect(looksLikeSettleOrderStatement(GUI_SETTLE_ORDER_QUERY)).toBe(true)
    expect(looksLikeOrderRedemptionStatement(GUI_ORDER_REDEMPTION_QUERY)).toBe(true)
    expect(looksLikeSettleOrderStatement(GUI_ORDER_REDEMPTION_QUERY)).toBe(false)
    expect(looksLikeOrderRedemptionStatement(GUI_SETTLE_ORDER_QUERY)).toBe(false)
    expect(looksLikeOrderRedemptionStatement(GUI_STOCK_DECREMENT_QUERY)).toBe(false)
  })
})

describe('place-order guards — the settle write', () => {
  it('on a store without cash on delivery, confirms only an order with nothing left to collect', () => {
    const nodes = placeOrderNodes() as LooseNode[]
    rewriteLowStockCustomHandlers(buildUIDL(nodes, { cashOnDelivery: false }))
    const query = byId(nodes, SETTLE_ID).config.query as string
    expect(query).toContain(SETTLE_NOTHING_DUE_GUARD)
    // The guard sits in the WHERE, before RETURNING, next to the pending check.
    expect(query.indexOf(SETTLE_NOTHING_DUE_GUARD)).toBeGreaterThan(
      query.indexOf("AND o.status = 'pending'")
    )
    expect(query.trim().endsWith('RETURNING o.id, o.payment_status, o.payment_method')).toBe(true)
    // Idempotent, and still recognisable.
    expect(
      guardSettleOrderStatement(query, { cashOnDelivery: false, codByShippingZone: false })
    ).toBe(query)
    expect(looksLikeSettleOrderStatement(query)).toBe(true)
  })

  it('on a store that prices delivery by zone, refuses a cash order delivered to a zone that does not take it', () => {
    const nodes = placeOrderNodes() as LooseNode[]
    rewriteLowStockCustomHandlers(buildUIDL(nodes, { cashOnDelivery: true, zones: true }))
    const query = byId(nodes, SETTLE_ID).config.query as string
    expect(query).toContain(SETTLE_ZONE_COD_GUARD)
    expect(query).not.toContain(SETTLE_NOTHING_DUE_GUARD)
    expect(query).toContain("to_jsonb(o) ->> 'shipping_zone_name'")
    expect(query).toContain("to_jsonb(z) ->> 'cod_enabled'")
    expect(query.trim().endsWith('RETURNING o.id, o.payment_status, o.payment_method')).toBe(true)
    expect(
      guardSettleOrderStatement(query, { cashOnDelivery: true, codByShippingZone: true })
    ).toBe(query)
    // Without cash on delivery at all, nothing due is the only way to settle.
    const prepaid = placeOrderNodes() as LooseNode[]
    rewriteLowStockCustomHandlers(buildUIDL(prepaid, { cashOnDelivery: false, zones: true }))
    expect(byId(prepaid, SETTLE_ID).config.query).toContain(SETTLE_NOTHING_DUE_GUARD)
    expect(byId(prepaid, SETTLE_ID).config.query).not.toContain(SETTLE_ZONE_COD_GUARD)
  })

  it('leaves the settle write exactly as baked on a store that takes cash on delivery', () => {
    const nodes = placeOrderNodes() as LooseNode[]
    rewriteLowStockCustomHandlers(buildUIDL(nodes, { cashOnDelivery: true }))
    expect(byId(nodes, SETTLE_ID).config.query).toBe(GUI_SETTLE_ORDER_QUERY)
  })
})

describe('place-order guards — stock reserved with the order', () => {
  it('reserves stock in the redemption statement and stops the later decrement from taking it again', () => {
    const nodes = placeOrderNodes() as LooseNode[]
    rewriteLowStockCustomHandlers(buildUIDL(nodes, { allowBackorders: false }))

    const redeem = byId(nodes, REDEEM_ID)
    expect(redeem.config.query).toBe(reserveStockInRedemptionStatement(GUI_ORDER_REDEMPTION_QUERY))
    expect(redeem.config.query).toContain('ok AS (SELECT voucher_ok AND gift_card_ok AND stock_ok')
    expect(redeem.config.query).toContain('FOR UPDATE')
    expect(redeem.config.query).toContain('AS stock_reserved')
    // $10..$13: the units the server priced, never anything the browser sends.
    expect(redeem.config.params).toHaveLength(13)
    expect(redeem.config.params.slice(9)).toEqual([
      ctx(PRICE_ID, 'stockDeltas', 'productIds'),
      ctx(PRICE_ID, 'stockDeltas', 'productQtys'),
      ctx(PRICE_ID, 'stockDeltas', 'variantIds'),
      ctx(PRICE_ID, 'stockDeltas', 'variantQtys'),
    ])
    expect(redeem.config.params.slice(0, 9)).toEqual(redemptionParams())

    const decrement = byId(nodes, DECREMENT_ID)
    expect(isParameterizedStockDecrementQuery(decrement.config.query)).toBe(true)
    expect(decrement.config.query).toMatch(/AND false/)
    expect(decrement.config.query.match(/AND false/g)).toHaveLength(2)

    // Both are the order decrement to the stock-write auditor.
    expect(classifyStockWriteSite('Place Order', redeem).category).toBe('order-decrement')
    expect(classifyStockWriteSite('Place Order', decrement).category).toBe('order-decrement')
  })

  it('is idempotent and recognises its own output', () => {
    const once = reserveStockInRedemptionStatement(GUI_ORDER_REDEMPTION_QUERY)
    expect(looksLikeOrderRedemptionStatement(once)).toBe(true)
    expect(reserveStockInRedemptionStatement(once)).toBe(once)
  })

  it('refuses the order when the reservation inputs are missing (fail closed)', () => {
    const query = reserveStockInRedemptionStatement(GUI_ORDER_REDEMPTION_QUERY)
    expect(query).toContain('$10::text[] IS NOT NULL')
    expect(query).toContain('cardinality($10::text[]) = cardinality($11::int[])')
  })

  it('leaves both statements as baked with backorders allowed, or without stock management', () => {
    for (const settings of [{ allowBackorders: true }, { stockManagement: false }]) {
      const nodes = placeOrderNodes() as LooseNode[]
      rewriteLowStockCustomHandlers(buildUIDL(nodes, settings))
      expect(byId(nodes, REDEEM_ID).config.query).toBe(GUI_ORDER_REDEMPTION_QUERY)
      expect(byId(nodes, REDEEM_ID).config.params).toHaveLength(9)
      expect(byId(nodes, DECREMENT_ID).config.query).not.toMatch(/AND false/)
    }
  })

  it('keeps the later decrement when the checkout has no server pricing step to reserve from', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const nodes = (placeOrderNodes() as LooseNode[]).filter((n) => n.id !== PRICE_ID)
      rewriteLowStockCustomHandlers(buildUIDL(nodes, { allowBackorders: false }))
      expect(byId(nodes, REDEEM_ID).config.query).toBe(GUI_ORDER_REDEMPTION_QUERY)
      expect(byId(nodes, DECREMENT_ID).config.query).not.toMatch(/AND false/)
      expect(byId(nodes, DECREMENT_ID).config.query).toMatch(/p\.quantity >= d\.qty/)
    } finally {
      warn.mockRestore()
    }
  })
})

// The statement's own logic, read off its CTEs (codegen has no Postgres to run
// it against; the concurrent run against a real one is the live proof
// `scratchpad/security/task4/live/proof.js`, listed in the Task 4 report).
const ctesOf = (query: string): Record<string, string> => {
  const parts: Record<string, string> = {}
  const re = /(?:^|\n)(?:WITH )?(\w+) AS \(/g
  const starts: Array<{ name: string; at: number }> = []
  let match = re.exec(query)
  while (match) {
    starts.push({ name: match[1], at: match.index })
    match = re.exec(query)
  }
  starts.forEach((start, i) => {
    parts[start.name] = query.slice(start.at, i + 1 < starts.length ? starts[i + 1].at : undefined)
  })
  return parts
}

describe('place-order guards — what the reserving statement does', () => {
  const query = reserveStockInRedemptionStatement(GUI_ORDER_REDEMPTION_QUERY)
  const ctes = ctesOf(query)

  it('decides from LOCKED stock rows, and a short line makes the whole order not ok', () => {
    // In id order, as the release and the late-payment retake lock them.
    expect(ctes.locked_products).toMatch(/ORDER BY p\.id\n  FOR UPDATE/)
    expect(ctes.locked_variants).toMatch(/ORDER BY v\.id\n  FOR UPDATE/)
    expect(ctes.stock_short).toMatch(/lp\.quantity < s\.qty/)
    expect(ctes.stock_short).toMatch(/lv\.quantity < s\.qty/)
    expect(ctes.verdict).toMatch(/NOT EXISTS \(SELECT 1 FROM stock_short\)\) AS stock_ok/)
    expect(ctes.ok).toMatch(/voucher_ok AND gift_card_ok AND stock_ok AS ok/)
  })

  it('decrements only when ok and only rows that still cover the line', () => {
    for (const name of ['reserved_products', 'reserved_variants']) {
      expect(ctes[name]).toMatch(/WHERE \(SELECT ok FROM ok\)/)
      expect(ctes[name]).toMatch(/quantity >= d\.qty/)
      expect(ctes[name]).toMatch(/quantity IS NOT NULL/)
    }
    // Every other write is conditional on the same verdict, so a refused order
    // (a 0-row reservation, a spent voucher or card) writes nothing at all.
    expect(ctes.bump).toMatch(/WHERE \(SELECT ok FROM ok\)/)
    expect(ctes.debit).toMatch(/WHERE \(SELECT ok FROM ok\)/)
    expect(ctes.redemption).toMatch(/FROM bump/)
    expect(ctes.ledger).toMatch(/FROM debit/)
    expect(ctes.order_update).toMatch(
      /d\.id IS NOT NULL OR EXISTS \(SELECT 1 FROM stock_reserved_lines\)/
    )
    expect(ctes.stock_reserved_lines).toMatch(/JOIN reserved_products/)
  })

  it('answers ok and stock_ok, which the server-run gate after it refuses on', () => {
    expect(query).toMatch(/\(SELECT ok FROM ok\) AS ok/)
    expect(query).toMatch(/\(SELECT stock_ok FROM verdict\) AS stock_ok/)
  })

  it('records the units it reserved on the order, in the one update of the order row', () => {
    expect(query.match(/UPDATE teleport_orders/g)).toHaveLength(1)
    expect(ctes.order_update).toContain(`jsonb_build_object('${STOCK_RESERVATION_KEY}'`)
    // And the products its voucher was redeemed against, for a late payment's re-count.
    expect(ctes.order_update).toContain(`'${VOUCHER_ITEM_PRODUCT_IDS_KEY}', NULLIF($7::text, '')`)
    expect(ctes.order_update).toContain("o.metadata ~ '^\\s*\\{'")
    // The gift card tender is still written exactly when the card was debited.
    expect(ctes.order_update).toMatch(
      /gift_card_amount = CASE WHEN d\.id IS NULL THEN o\.gift_card_amount ELSE \$9::numeric END/
    )
    expect(ctes.order_update).toMatch(/LEFT JOIN debit d ON true/)
  })
})

describe('place-order guards — giving back a reservation without items', () => {
  it('the "Settle Unpaid Order" statement restores from the record when the order has no items', () => {
    expect(looksLikeSettleUnpaidOrderStatement(GUI_SETTLE_UNPAID_ORDER_QUERY)).toBe(true)
    const restoring = restoreReservationsInSettleUnpaidStatement(GUI_SETTLE_UNPAID_ORDER_QUERY)
    expect(restoring).toContain(STOCK_RESERVATION_RESTORE_LINES)
    expect(restoring).toMatch(
      /NOT EXISTS \(SELECT 1 FROM teleport_order_items oi WHERE oi\.order_id = ro\.id\)/
    )
    expect(restoreReservationsInSettleUnpaidStatement(restoring)).toBe(restoring)
    expect(looksLikeSettleUnpaidOrderStatement(restoring)).toBe(true)
  })

  it('is re-baked in the custom node with stock managed and no backorders, and only then', () => {
    const uidlWith = (allowBackorders: boolean) =>
      ({
        name: 'store',
        ecommerceSettings: {
          cashOnDelivery: true,
          stockManagement: true,
          stockManagementConfig: { allowBackorders, lowStockThreshold: 5, lowStockAlerts: false },
        },
        workflows: {
          workflows: {},
          customNodes: {
            settle: {
              id: 'settle',
              name: 'Settle Unpaid Order',
              nodes: [
                {
                  id: 'release',
                  type: 'data-raw-query',
                  config: { query: GUI_SETTLE_UNPAID_ORDER_QUERY, params: [] },
                },
              ],
              edges: [],
            },
          },
        },
      } as unknown as ProjectUIDL)
    const reserving = uidlWith(false)
    rewriteLowStockCustomHandlers(reserving)
    const reservingNode = (reserving.workflows as any).customNodes.settle.nodes[0]
    expect(reservingNode.config.query).toContain(STOCK_RESERVATION_RESTORE_LINES)
    // Its stock writes lock in id order whatever the settings, with backorders too.
    expect(reservingNode.config.query).toBe(
      lockSettleUnpaidRestoresInIdOrder(
        restoreReservationsInSettleUnpaidStatement(GUI_SETTLE_UNPAID_ORDER_QUERY)
      )
    )
    const backorders = uidlWith(true)
    rewriteLowStockCustomHandlers(backorders)
    expect((backorders.workflows as any).customNodes.settle.nodes[0].config.query).toBe(
      lockSettleUnpaidRestoresInIdOrder(GUI_SETTLE_UNPAID_ORDER_QUERY)
    )
  })

  it('restores from rows locked in id order, products then variants, as every stock statement does', () => {
    const sorted = lockSettleUnpaidRestoresInIdOrder(GUI_SETTLE_UNPAID_ORDER_QUERY)
    expect(sorted).not.toBe(GUI_SETTLE_UNPAID_ORDER_QUERY)
    const ctes = ctesOf(sorted)
    expect(ctes.product_locks).toMatch(/ORDER BY p\.id FOR UPDATE OF p/)
    expect(ctes.variant_locks).toMatch(/\(SELECT COUNT\(\*\) FROM product_locks\) >= 0/)
    expect(ctes.variant_locks).toMatch(/ORDER BY v\.id FOR UPDATE OF v/)
    expect(ctes.product_restore).toMatch(/FROM product_locks l WHERE p\.id = l\.id/)
    expect(ctes.variant_restore).toMatch(/FROM variant_locks l WHERE v\.id = l\.id/)
    // Still recognised, and idempotent.
    expect(looksLikeSettleUnpaidOrderStatement(sorted)).toBe(true)
    expect(lockSettleUnpaidRestoresInIdOrder(sorted)).toBe(sorted)
    // The record's metadata is parsed only for the order the statement settles.
    expect(STOCK_RESERVATION_RESTORE_LINES).toContain(
      "jsonb_to_recordset(CASE WHEN ro.id::text = $1::text AND ro.metadata ~ '^\\s*\\{'"
    )
  })
})

describe('place-order guards — releasing reservations that never reached a payment page', () => {
  const query = buildStalledReservationReleaseQuery()
  const ctes = ctesOf(query)

  it('picks only pending, unpaid orders holding a reservation and no payment session, past the hold', () => {
    expect(STALLED_RESERVATION_RELEASE).toEqual({
      holdMinutes: 30,
      batchSize: 10,
      quietMinutes: 2,
      candidateLimit: 50,
    })
    expect(ctes.stale).toMatch(/LOWER\(COALESCE\(o\.status, ''\)\) = 'pending'/)
    expect(ctes.stale).toMatch(/payment_status, ''\)\) IN \('', 'unpaid', 'pending'\)/)
    expect(ctes.stale).toMatch(/COALESCE\(o\.payment_intent_id, ''\) = ''/)
    expect(ctes.stale).toMatch(/'payment_attempt_ref', ''\) = ''/)
    // A table that cannot record a checkout cannot say none is open: never released.
    expect(ctes.stale).toContain("AND (to_jsonb(o) -> 'payment_attempt_ref') IS NOT NULL")
    expect(ctes.stale).toMatch(/NOT LIKE 'store:%'/)
    // Only the orders whose metadata the checkout read as JSON ($1), and only
    // theirs parsed, whatever order the planner evaluates the rest in.
    expect(ctes.stale).toContain('AND o.id::text = ANY($1::text[])')
    expect(ctes.stale).toContain(
      `AND (CASE WHEN o.id::text = ANY($1::text[]) THEN ${hasReservationRecordSql(
        'o.metadata'
      )} ELSE false END)`
    )
    expect(STOCK_RESERVATION_RESTORE_LINES_BY_ORDER).toContain(
      'jsonb_to_recordset(CASE WHEN ro.id::text = ANY($1::text[]) AND ro.metadata'
    )
    expect(hasReservationRecordSql('o.metadata')).toContain(
      `THEN jsonb_typeof(o.metadata::jsonb -> '${STOCK_RESERVATION_KEY}') = 'array' ELSE false END`
    )
    expect(ctes.stale).toMatch(/o\.created_at < NOW\(\) - make_interval\(mins => 30\)/)
    // Not while a payment page may be opening: the checkout stamps the order first.
    expect(ctes.stale).toContain(
      'AND (o.updated_at IS NULL OR o.updated_at < NOW() - make_interval(mins => 2))'
    )
    // A bounded batch, never waiting on a checkout in flight or another pass.
    expect(ctes.stale).toMatch(/LIMIT 10\n  FOR UPDATE SKIP LOCKED/)
  })

  it('cancels each one and gives back, in the same statement, its stock, voucher and gift-card tender', () => {
    expect(ctes.released).toMatch(/SET status = 'cancelled', payment_status = 'failed'/)
    expect(ctes.released).toMatch(/FROM stale s/)
    expect(query).toContain(STOCK_RESERVATION_RESTORE_LINES_BY_ORDER)
    expect(ctes.product_restore).toMatch(/quantity = p\.quantity \+ l\.qty/)
    expect(ctes.product_restore).toMatch(/FROM product_locks l WHERE p\.id = l\.id/)
    expect(ctes.variant_restore).toMatch(/quantity = v\.quantity \+ l\.qty/)
    expect(ctes.variant_restore).toMatch(/FROM variant_locks l WHERE v\.id = l\.id/)
    expect(ctes.voucher_dropped).toMatch(
      /DELETE FROM teleport_voucher_redemptions vr USING released r/
    )
    expect(ctes.voucher_restored).toMatch(
      /usage_count = GREATEST\(COALESCE\(v\.usage_count, 0\) - d\.n, 0\)/
    )
    expect(ctes.card).toMatch(/JOIN released r ON g\.id::text = r\.gift_card_id/)
    expect(ctes.card_ledger).toMatch(/ON CONFLICT \(dedupe_key\) DO NOTHING/)
    expect(ctes.card_ledger).toContain("'release:' || card.order_id::text")
    expect(ctes.card_credited).toMatch(
      /SUM\(amount\) AS amount FROM card_ledger GROUP BY gift_card_id/
    )
    expect(query.trim()).toMatch(
      /AS gift_cards_released,\n {2}\(SELECT COUNT\(\*\) FROM logged\) AS claimed$/
    )
  })

  it('lists the candidates first, unlocked and unparsed, by the same conditions', () => {
    const candidates = buildStalledReservationCandidatesQuery()
    expect(candidates).toMatch(/^SELECT o\.id::text AS id, o\.metadata\n {2}FROM teleport_orders o/)
    expect(candidates).not.toContain('::jsonb')
    expect(candidates).not.toContain('FOR UPDATE')
    expect(candidates).toContain(`LIKE '%"${STOCK_RESERVATION_KEY}"%'`)
    expect(candidates).toMatch(/LIMIT 50$/)
    for (const condition of [
      "LOWER(COALESCE(o.status, '')) = 'pending'",
      "AND (to_jsonb(o) -> 'payment_attempt_ref') IS NOT NULL",
      'make_interval(mins => 30)',
      'make_interval(mins => 2)',
    ]) {
      expect(candidates).toContain(condition)
      expect(ctes.stale).toContain(condition)
    }
  })

  it('locks, after the orders, vouchers, gift cards, products and variants, each in id order', () => {
    expect(ctes.held_vouchers).toMatch(/ORDER BY v\.id FOR UPDATE/)
    expect(ctes.voucher_restored).toMatch(/JOIN held_vouchers h ON h\.id = d\.voucher_id/)
    expect(ctes.card).toMatch(/AND \(SELECT COUNT\(\*\) FROM held_vouchers\) >= 0/)
    expect(ctes.card).toMatch(/ORDER BY g\.id FOR UPDATE OF g/)
    expect(ctes.product_locks).toMatch(/\(SELECT COUNT\(\*\) FROM card\) >= 0/)
    expect(ctes.product_locks).toMatch(/ORDER BY p\.id FOR UPDATE OF p/)
    expect(ctes.variant_locks).toMatch(/\(SELECT COUNT\(\*\) FROM product_locks\) >= 0/)
    expect(ctes.variant_locks).toMatch(/ORDER BY v\.id FOR UPDATE OF v/)
  })

  it("logs each released order's cancellation as the shared writer keys it, on any ledger", () => {
    expect(ctes.logged).toContain(
      'INSERT INTO teleport_events (event_type, dedupe_key, order_id, entity_type, entity_id, payload, actor_type, status)'
    )
    expect(ctes.logged).toContain(
      "SELECT 'order-cancelled', 'order-cancelled:' || r.id::text, r.id, 'order', r.id::text,"
    )
    expect(ctes.logged).toMatch(/'restocked', CASE WHEN EXISTS/)
    expect(ctes.logged).toMatch(
      /'unitCount', \(SELECT COALESCE\(SUM\(l\.quantity\), 0\) FROM lines l WHERE l\.order_id = r\.id\)/
    )
    expect(ctes.logged).toMatch(/FROM released r\n {2}ON CONFLICT \(dedupe_key\) DO NOTHING/)
    const [entity, plain, none] = buildStalledReservationReleaseQueries()
    expect(entity).toBe(query)
    expect(ctesOf(plain).logged).toContain(
      'INSERT INTO teleport_events (event_type, dedupe_key, order_id, payload, actor_type, status)'
    )
    expect(none).not.toContain('teleport_events')
    expect(none.trim()).toMatch(/AS gift_cards_released$/)
  })
})
