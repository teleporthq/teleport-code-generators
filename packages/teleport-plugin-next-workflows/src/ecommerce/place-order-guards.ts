// Export-time guards for the place-order workflow's money statements.
//
// The editor bakes the checkout's SQL into `data-raw-query` nodes
// (apps/gui/.../builders/ecommerce/order-redemption-helper.ts). Two of those
// statements decide what a buyer gets for what they paid, and both are
// re-baked here from the store's CURRENT settings on every export, the way
// the stock chain is (see ./parameterized-stock-chain.ts):
//
// 1. THE SETTLE WRITE ("Mark Order As Settled") confirms an order that no
//    payment provider collects: cash on delivery, a total discounted to zero,
//    or an order a gift card paid in full. Which branch runs is decided in the
//    browser, and every server segment is a route of its own, so a crafted
//    request can call this one for any order it just placed. On a store that
//    does not take cash on delivery, the statement now confirms only an order
//    with nothing left to collect, decided from the order row and the card's
//    ledger. Any other order stays `pending`, which is what an unpaid order is.
//    On a store that takes cash on delivery but prices delivery by shipping
//    zone, cash on delivery is each zone's choice (`teleport_shipping_zones.
//    cod_enabled`, edited live in the admin): an order DELIVERED to a zone
//    that does not take it is confirmed only with nothing left to collect.
//    The zone is the one the order records (`shipping_zone_name`, written
//    from the server's own quote for its address), read against the zone
//    rows at the moment of settling.
//
// 2. THE REDEMPTION STATEMENT ("Redeem Voucher And Gift Card") runs right
//    after the order row is written. It locks what it spends, decides `ok`
//    before writing anything, and a `false` verdict cancels the order on the
//    server (the gate after it runs on the server too). With stock managed and
//    backorders off, it now also reserves the order's stock in that same
//    statement: the product and variant rows are locked (`FOR UPDATE`), any
//    line the stock cannot cover makes `ok` false, and the decrement is
//    conditional on `ok`. Of two orders racing for the last unit, the second
//    waits for the first, sees what it left and is refused. Nothing is written
//    for a refused order. The units are the ones the server priced
//    (`cart-price-order`'s `stockDeltas`), never anything the browser sends.
//    The later "Decrement Product Stock After Order" step is then re-baked to
//    take nothing (see `buildParameterizedStockDecrementQuery`).
//
// Each statement is recognised by its shape. A statement that has drifted from
// it is left alone. If the stock cannot be reserved safely (no server pricing
// step, a decrement this module cannot neutralise), the checkout keeps the
// decrement it had, and a warning says so.

import {
  isParameterizedDecrementChainRewritable,
  isParameterizedStockDecrementQuery,
} from './parameterized-stock-chain'
import { classifyStockWriteSite } from './stock-decrement'

// ────────────────────────────────────────────────────────────────────
// The settle write
// ────────────────────────────────────────────────────────────────────

const SETTLE_RETURNING = 'RETURNING o.id, o.payment_status, o.payment_method'

/** Confirms only an order with nothing left to collect: the row's total, less what its own redemption debited. */
export const SETTLE_NOTHING_DUE_GUARD =
  '  AND o.total_amount IS NOT NULL AND o.total_amount - (SELECT debited FROM tender) <= 0'

export const looksLikeSettleOrderStatement = (query: unknown): query is string =>
  typeof query === 'string' &&
  /^\s*WITH\s+tender\s+AS\s*\(/i.test(query) &&
  /\bUPDATE\s+teleport_orders\s+o\s+SET\s+status\s*=\s*'confirmed'/i.test(query) &&
  query.indexOf("ELSE 'cash_on_delivery' END") !== -1 &&
  /\bAND\s+o\.status\s*=\s*'pending'/i.test(query) &&
  query.trim().endsWith(SETTLE_RETURNING)

/**
 * Confirms an order with money still due only when it is not delivered to an
 * active shipping zone that refuses cash on delivery. Every column is read
 * through `to_jsonb`, the way the zone rule reads them (`cod_enabled` and
 * `is_active` default to true).
 */
export const SETTLE_ZONE_COD_GUARD = [
  '  AND (o.total_amount IS NOT NULL AND o.total_amount - (SELECT debited FROM tender) <= 0',
  "    OR NOT (COALESCE(to_jsonb(o) ->> 'fulfillment_method', '') = 'delivery'",
  '      AND EXISTS (SELECT 1 FROM teleport_shipping_zones z',
  "        WHERE z.name = (to_jsonb(o) ->> 'shipping_zone_name')",
  "          AND LOWER(COALESCE(to_jsonb(z) ->> 'is_active', 'true')) NOT IN ('false', 'f', '0', 'no')",
  "          AND LOWER(COALESCE(to_jsonb(z) ->> 'cod_enabled', 'true')) IN ('false', 'f', '0', 'no'))))",
].join('\n')

export interface SettleGuardSettings {
  /** The store takes cash on delivery at all. */
  cashOnDelivery: boolean
  /** Delivery is priced by shipping zone, each zone deciding cash on delivery. */
  codByShippingZone: boolean
}

/** The settle write for the store's cash-on-delivery rules; unchanged when they allow every order. */
export const guardSettleOrderStatement = (query: string, settings: SettleGuardSettings): string => {
  const guard = !settings.cashOnDelivery
    ? SETTLE_NOTHING_DUE_GUARD
    : settings.codByShippingZone
    ? SETTLE_ZONE_COD_GUARD
    : ''
  if (
    !guard ||
    !looksLikeSettleOrderStatement(query) ||
    query.indexOf(SETTLE_NOTHING_DUE_GUARD) !== -1 ||
    query.indexOf(SETTLE_ZONE_COD_GUARD) !== -1
  ) {
    return query
  }
  const at = query.lastIndexOf(SETTLE_RETURNING)
  return query.slice(0, at).replace(/\s*$/, '') + '\n' + guard + '\n' + query.slice(at)
}

// ────────────────────────────────────────────────────────────────────
// The redemption statement
// ────────────────────────────────────────────────────────────────────

const REDEMPTION_OK_LINE = 'ok AS (SELECT voucher_ok AND gift_card_ok AS ok FROM verdict),'
const RESERVED_OK_LINE =
  'ok AS (SELECT voucher_ok AND gift_card_ok AND stock_ok AS ok FROM verdict),'
const VERDICT_START = '\nverdict AS ('
const VERDICT_END = ')) AS gift_card_ok\n),'
const LAST_COLUMN = '(SELECT COUNT(*) FROM ledger) AS gift_card_debited'

/** The redemption statement takes 9 parameters; the reservation appends $10..$13. */
const REDEMPTION_PARAM_COUNT = 9

// $10/$11 product ids and units (variantless lines), $12/$13 variant ids and
// units. Locked first, so a concurrent order is waited out and its result read,
// and in id order (as the release and the late-payment retake lock them), so
// two statements needing the same rows never wait on each other in a cycle.
const STOCK_LOCKS = [
  'stock_lines AS (',
  "  SELECT 'product'::text AS kind, d.id, d.qty FROM unnest($10::text[], $11::int[]) AS d(id, qty)",
  '  UNION ALL',
  "  SELECT 'variant'::text AS kind, d.id, d.qty FROM unnest($12::text[], $13::int[]) AS d(id, qty)",
  '),',
  'locked_products AS (',
  '  SELECT p.id::text AS id, p.quantity',
  '  FROM teleport_products p',
  '  WHERE p.quantity IS NOT NULL AND p.id::text = ANY($10::text[])',
  '  ORDER BY p.id',
  '  FOR UPDATE',
  '),',
  'locked_variants AS (',
  '  SELECT v.id::text AS id, v.quantity',
  '  FROM teleport_product_variants v',
  '  WHERE v.quantity IS NOT NULL AND v.id::text = ANY($12::text[])',
  '  ORDER BY v.id',
  '  FOR UPDATE',
  '),',
  'stock_short AS (',
  "  SELECT lp.id FROM locked_products lp JOIN stock_lines s ON s.kind = 'product' AND s.id = lp.id WHERE lp.quantity < s.qty",
  '  UNION ALL',
  "  SELECT lv.id FROM locked_variants lv JOIN stock_lines s ON s.kind = 'variant' AND s.id = lv.id WHERE lv.quantity < s.qty",
  '),',
].join('\n')

// Missing or mismatched arrays refuse the order: a NULL unit count would turn
// a tracked quantity into NULL ("unlimited").
const STOCK_OK_COLUMN = [
  '    ($10::text[] IS NOT NULL AND $11::int[] IS NOT NULL AND $12::text[] IS NOT NULL AND $13::int[] IS NOT NULL',
  '      AND cardinality($10::text[]) = cardinality($11::int[])',
  '      AND cardinality($12::text[]) = cardinality($13::int[])',
  '      AND NOT EXISTS (SELECT 1 FROM stock_lines WHERE qty IS NULL OR qty < 1)',
  '      AND NOT EXISTS (SELECT 1 FROM stock_short)) AS stock_ok',
].join('\n')

// Written only when everything the order spends could be spent.
const STOCK_RESERVATIONS = [
  'reserved_products AS (',
  '  UPDATE teleport_products AS p SET quantity = p.quantity - d.qty, updated_at = NOW()',
  '  FROM unnest($10::text[], $11::int[]) AS d(id, qty)',
  '  WHERE (SELECT ok FROM ok) AND p.quantity IS NOT NULL AND p.id::text = d.id AND p.quantity >= d.qty',
  '  RETURNING p.id',
  '),',
  'reserved_variants AS (',
  '  UPDATE teleport_product_variants AS v SET quantity = v.quantity - d.qty, updated_at = NOW()',
  '  FROM unnest($12::text[], $13::int[]) AS d(id, qty)',
  '  WHERE (SELECT ok FROM ok) AND v.quantity IS NOT NULL AND v.id::text = d.id AND v.quantity >= d.qty',
  '  RETURNING v.id',
  '),',
].join('\n')

// What this statement actually took (tracked rows only), for the record below.
const STOCK_RESERVED_LINES = [
  'stock_reserved_lines AS (',
  "  SELECT s.kind, s.id, s.qty FROM stock_lines s JOIN reserved_products rp ON s.kind = 'product' AND rp.id::text = s.id",
  '  UNION ALL',
  "  SELECT s.kind, s.id, s.qty FROM stock_lines s JOIN reserved_variants rv ON s.kind = 'variant' AND rv.id::text = s.id",
  '),',
].join('\n')

// The editor's gift-card write onto the order row, word for word. A statement
// may update a row once, so the reservation record joins it in one UPDATE.
const ORDER_UPDATE_CTE = [
  'order_update AS (',
  '  UPDATE teleport_orders o',
  '  SET gift_card_amount = $9::numeric, gift_card_id = debit.id, gift_card_last4 = debit.last4, updated_at = NOW()',
  '  FROM debit',
  '  WHERE o.id = ($2::text)::uuid',
  '  RETURNING o.id',
  ')',
].join('\n')

/**
 * The order row's one update: the gift-card tender as before, and the units
 * this statement reserved, recorded in the order's `metadata` (TEXT JSON) as
 * `stockReservation: [{ kind, id, qty }]`. An order stopped before its items
 * are written still says what it holds, and the cancel / expiry paths restore
 * from it when the order has no items (`STOCK_RESERVATION_RESTORE_LINES`).
 * Beside it, the products the voucher was redeemed against
 * (`voucherItemProductIds`, the redemption's `item_product_ids`): a cancel
 * deletes the redemption row, and a late payment that confirms the order
 * writes it again with them.
 */
export const STOCK_RESERVATION_KEY = 'stockReservation'
export const VOUCHER_ITEM_PRODUCT_IDS_KEY = 'voucherItemProductIds'
const RESERVING_ORDER_UPDATE_CTE = [
  'order_update AS (',
  '  UPDATE teleport_orders o',
  '  SET gift_card_amount = CASE WHEN d.id IS NULL THEN o.gift_card_amount ELSE $9::numeric END,',
  '    gift_card_id = CASE WHEN d.id IS NULL THEN o.gift_card_id ELSE d.id END,',
  '    gift_card_last4 = CASE WHEN d.id IS NULL THEN o.gift_card_last4 ELSE d.last4 END,',
  '    metadata = CASE WHEN EXISTS (SELECT 1 FROM stock_reserved_lines)',
  "      THEN ((CASE WHEN o.metadata ~ '^\\s*\\{' THEN o.metadata::jsonb ELSE '{}'::jsonb END)",
  `        || jsonb_build_object('${STOCK_RESERVATION_KEY}', (SELECT jsonb_agg(jsonb_build_object('kind', r.kind, 'id', r.id, 'qty', r.qty)) FROM stock_reserved_lines r),`,
  `          '${VOUCHER_ITEM_PRODUCT_IDS_KEY}', NULLIF($7::text, '')))::text`,
  '      ELSE o.metadata END,',
  '    updated_at = NOW()',
  '  FROM (SELECT 1 AS one) AS base LEFT JOIN debit d ON true',
  '  WHERE o.id = ($2::text)::uuid AND (d.id IS NOT NULL OR EXISTS (SELECT 1 FROM stock_reserved_lines))',
  '  RETURNING o.id',
  ')',
].join('\n')

const STOCK_RESERVED_COLUMN =
  '(SELECT COUNT(*) FROM reserved_products) + (SELECT COUNT(*) FROM reserved_variants) AS stock_reserved'

// Whether the stock could be had, apart from the voucher and the card: a
// refusal that is the stock's says so (the verdict can tell the buyer).
const STOCK_OK_RESULT_COLUMN = '(SELECT stock_ok FROM verdict) AS stock_ok'

const occursOnce = (text: string, part: string): boolean => {
  const at = text.indexOf(part)
  return at !== -1 && text.indexOf(part, at + 1) === -1
}

export const looksLikeOrderRedemptionStatement = (query: unknown): query is string =>
  typeof query === 'string' &&
  /^\s*WITH\s+locked_voucher\s+AS\s*\(/.test(query) &&
  query.indexOf('\nlocked_card AS (') !== -1 &&
  occursOnce(query, VERDICT_START) &&
  (occursOnce(query, REDEMPTION_OK_LINE) || occursOnce(query, RESERVED_OK_LINE)) &&
  occursOnce(query, LAST_COLUMN)

/** The redemption statement that also reserves the order's stock; unchanged when it drifted or already does. */
export const reserveStockInRedemptionStatement = (query: string): string => {
  if (!looksLikeOrderRedemptionStatement(query) || query.indexOf(RESERVED_OK_LINE) !== -1) {
    return query
  }
  if (
    !occursOnce(query, VERDICT_END) ||
    !occursOnce(query, ORDER_UPDATE_CTE) ||
    !query.trim().endsWith(LAST_COLUMN)
  ) {
    return query
  }
  return query
    .replace(VERDICT_START, '\n' + STOCK_LOCKS + VERDICT_START)
    .replace(VERDICT_END, ')) AS gift_card_ok,\n' + STOCK_OK_COLUMN + '\n),')
    .replace(
      REDEMPTION_OK_LINE,
      RESERVED_OK_LINE + '\n' + STOCK_RESERVATIONS + '\n' + STOCK_RESERVED_LINES
    )
    .replace(ORDER_UPDATE_CTE, () => RESERVING_ORDER_UPDATE_CTE)
    .replace(
      LAST_COLUMN,
      () => LAST_COLUMN + ',\n  ' + STOCK_RESERVED_COLUMN + ',\n  ' + STOCK_OK_RESULT_COLUMN
    )
}

// ────────────────────────────────────────────────────────────────────
// Restoring a reservation an order holds without items
// ────────────────────────────────────────────────────────────────────

// The units a cancelled unpaid order puts back, as the editor's "Settle
// Unpaid Order" statement reads them: its order items. Word for word.
const SETTLE_UNPAID_LINES_CTE = [
  'lines AS (',
  "  SELECT oi.product_id::text AS product_id, NULLIF(COALESCE(oi.variant_id::text, ''), '') AS variant_id, oi.quantity",
  '  FROM teleport_order_items oi JOIN released r ON oi.order_id = r.id',
  '  WHERE oi.quantity > 0',
  '),',
].join('\n')

/**
 * The same lines, plus, for a released order with NO items, the units its
 * reservation record says it holds: an order stopped between the reservation
 * and its items gives its stock back when it is cancelled. A malformed record
 * reads as none. `parseOnly` names the orders whose metadata may be parsed at
 * all (the statement's own), so the planner can never cast another row's.
 */
const reservationRestoreLines = (withOrderId: boolean, parseOnly: string): string =>
  [
    'lines AS (',
    "  SELECT oi.product_id::text AS product_id, NULLIF(COALESCE(oi.variant_id::text, ''), '') AS variant_id, oi.quantity" +
      (withOrderId ? ', oi.order_id' : ''),
    '  FROM teleport_order_items oi JOIN released r ON oi.order_id = r.id',
    '  WHERE oi.quantity > 0',
    '  UNION ALL',
    "  SELECT CASE WHEN x.kind = 'product' THEN x.id END, CASE WHEN x.kind = 'variant' THEN x.id END, x.qty" +
      (withOrderId ? ', ro.id' : ''),
    '  FROM teleport_orders ro JOIN released r ON ro.id = r.id',
    // Nested CASE: the JSON is parsed only once it looks like an object.
    `  CROSS JOIN LATERAL jsonb_to_recordset(CASE WHEN ${parseOnly} AND ro.metadata ~ '^\\s*\\{'`,
    `    THEN (CASE WHEN jsonb_typeof(ro.metadata::jsonb -> '${STOCK_RESERVATION_KEY}') = 'array'`,
    `      THEN ro.metadata::jsonb -> '${STOCK_RESERVATION_KEY}' ELSE '[]'::jsonb END)`,
    "    ELSE '[]'::jsonb END) AS x(kind text, id text, qty int)",
    '  WHERE x.qty > 0 AND NOT EXISTS (SELECT 1 FROM teleport_order_items oi WHERE oi.order_id = ro.id)',
    '),',
  ].join('\n')

/** For "Settle Unpaid Order", whose `$1` is the one order it settles. */
export const STOCK_RESERVATION_RESTORE_LINES = reservationRestoreLines(
  false,
  'ro.id::text = $1::text'
)

/**
 * The same lines, each naming its order (the release logs one line per order),
 * for the release, whose `$1` lists the orders whose metadata the checkout read.
 */
export const STOCK_RESERVATION_RESTORE_LINES_BY_ORDER = reservationRestoreLines(
  true,
  'ro.id::text = ANY($1::text[])'
)

/**
 * Whether an order's TEXT `metadata` holds the reservation record, read as
 * JSON (a buyer-typed billing value of the same text is not the record). The
 * text test runs first, so only a row that may hold the key is parsed.
 */
export const hasReservationRecordSql = (column: string): string =>
  `(CASE WHEN COALESCE(${column}, '') LIKE '%"${STOCK_RESERVATION_KEY}"%' AND ${column} ~ '^\\s*\\{'` +
  ` THEN jsonb_typeof(${column}::jsonb -> '${STOCK_RESERVATION_KEY}') = 'array' ELSE false END)`

export const looksLikeSettleUnpaidOrderStatement = (query: unknown): query is string =>
  typeof query === 'string' &&
  /^\s*WITH\s+target\s+AS\s*\(/.test(query) &&
  query.indexOf('\nreleased AS (') !== -1 &&
  query.indexOf('\nproduct_restore AS (') !== -1 &&
  (occursOnce(query, SETTLE_UNPAID_LINES_CTE) || occursOnce(query, STOCK_RESERVATION_RESTORE_LINES))

/** The "Settle Unpaid Order" statement that also restores a reservation without items. */
export const restoreReservationsInSettleUnpaidStatement = (query: string): string =>
  looksLikeSettleUnpaidOrderStatement(query) && occursOnce(query, SETTLE_UNPAID_LINES_CTE)
    ? query.replace(SETTLE_UNPAID_LINES_CTE, () => STOCK_RESERVATION_RESTORE_LINES)
    : query

// The editor's "Settle Unpaid Order" stock writes, word for word: they lock
// the rows in scan order.
const SETTLE_UNPAID_RESTORES = [
  'product_restore AS (',
  '  UPDATE teleport_products p SET quantity = p.quantity + d.qty, updated_at = NOW()',
  '  FROM (SELECT product_id AS id, SUM(quantity)::int AS qty FROM lines',
  '        WHERE variant_id IS NULL AND product_id IS NOT NULL GROUP BY product_id) d',
  '  WHERE p.quantity IS NOT NULL AND p.id::text = d.id',
  '  RETURNING p.id',
  '),',
  'variant_restore AS (',
  '  UPDATE teleport_product_variants v SET quantity = v.quantity + d.qty, updated_at = NOW()',
  '  FROM (SELECT variant_id AS id, SUM(quantity)::int AS qty FROM lines',
  '        WHERE variant_id IS NOT NULL GROUP BY variant_id) d',
  '  WHERE v.quantity IS NOT NULL AND v.id::text = d.id',
  '  RETURNING v.id',
  ')',
].join('\n')

// The same writes from rows locked first, products then variants, each in id
// order: the order the reservation, the release and the late-payment retake
// take them in (the order row is locked first by all of them, and the
// voucher and gift card this statement does not touch).
const SETTLE_UNPAID_SORTED_RESTORES = [
  'product_need AS (',
  '  SELECT product_id AS id, SUM(quantity)::int AS qty FROM lines',
  '  WHERE variant_id IS NULL AND product_id IS NOT NULL GROUP BY product_id',
  '),',
  'variant_need AS (',
  '  SELECT variant_id AS id, SUM(quantity)::int AS qty FROM lines',
  '  WHERE variant_id IS NOT NULL GROUP BY variant_id',
  '),',
  'product_locks AS (',
  '  SELECT p.id, n.qty FROM teleport_products p JOIN product_need n ON p.id::text = n.id',
  '  WHERE p.quantity IS NOT NULL',
  '  ORDER BY p.id FOR UPDATE OF p',
  '),',
  'variant_locks AS (',
  '  SELECT v.id, n.qty FROM teleport_product_variants v JOIN variant_need n ON v.id::text = n.id',
  '  WHERE v.quantity IS NOT NULL AND (SELECT COUNT(*) FROM product_locks) >= 0',
  '  ORDER BY v.id FOR UPDATE OF v',
  '),',
  'product_restore AS (',
  '  UPDATE teleport_products p SET quantity = p.quantity + l.qty, updated_at = NOW()',
  '  FROM product_locks l WHERE p.id = l.id',
  '  RETURNING p.id',
  '),',
  'variant_restore AS (',
  '  UPDATE teleport_product_variants v SET quantity = v.quantity + l.qty, updated_at = NOW()',
  '  FROM variant_locks l WHERE v.id = l.id',
  '  RETURNING v.id',
  ')',
].join('\n')

/** The "Settle Unpaid Order" statement restoring from rows locked in id order; unchanged when drifted or done. */
export const lockSettleUnpaidRestoresInIdOrder = (query: string): string =>
  looksLikeSettleUnpaidOrderStatement(query) && occursOnce(query, SETTLE_UNPAID_RESTORES)
    ? query.replace(SETTLE_UNPAID_RESTORES, () => SETTLE_UNPAID_SORTED_RESTORES)
    : query

// ────────────────────────────────────────────────────────────────────
// Releasing reservations whose checkout never reached a payment page
// ────────────────────────────────────────────────────────────────────

/**
 * How long a reserving order may wait for a payment page, how many one pass
 * releases, and how long after its last write (the checkout stamps the order
 * right before it asks the provider for a page) it is left alone, so a page
 * whose record is still on its way is never released under the buyer.
 */
export const STALLED_RESERVATION_RELEASE = {
  holdMinutes: 30,
  batchSize: 10,
  quietMinutes: 2,
  /** How many candidates the checkout reads per pass, so unreadable rows never fill a batch. */
  candidateLimit: 50,
} as const

// Which orders a pass may release, apart from the reservation record itself:
// pending and unpaid, no payment session (no attempt reference, no payment
// reference) on a table that can record one, not a store-billed renewal,
// placed `holdMinutes` ago and written to in none of the last `quietMinutes`.
const stalledOrderConditions = (holdMinutes: number): string[] => [
  "  WHERE LOWER(COALESCE(o.status, '')) = 'pending'",
  "    AND LOWER(COALESCE(o.payment_status, '')) IN ('', 'unpaid', 'pending')",
  "    AND COALESCE(o.payment_intent_id, '') = ''",
  "    AND COALESCE(to_jsonb(o) ->> 'payment_attempt_ref', '') = ''",
  // A store whose table predates the column records no checkout, so an
  // order there may have one open: it is never released here.
  "    AND (to_jsonb(o) -> 'payment_attempt_ref') IS NOT NULL",
  "    AND COALESCE(to_jsonb(o) ->> 'provider_invoice_id', '') NOT LIKE 'store:%'",
  `    AND o.created_at < NOW() - make_interval(mins => ${Math.max(1, Math.floor(holdMinutes))})`,
  `    AND (o.updated_at IS NULL OR o.updated_at < NOW() - make_interval(mins => ${STALLED_RESERVATION_RELEASE.quietMinutes}))`,
  "    AND o.created_at > NOW() - INTERVAL '30 days'",
]

/**
 * The orders a pass may release, with their metadata as text, oldest first,
 * nothing parsed and nothing locked. The checkout parses each one's metadata
 * itself (a malformed row would otherwise fail the whole release on Postgres
 * versions without a safe JSON test) and releases only the readable ones.
 */
export const buildStalledReservationCandidatesQuery = (
  holdMinutes: number = STALLED_RESERVATION_RELEASE.holdMinutes
): string =>
  [
    'SELECT o.id::text AS id, o.metadata',
    '  FROM teleport_orders o',
    ...stalledOrderConditions(holdMinutes),
    `    AND COALESCE(o.metadata, '') LIKE '%"${STOCK_RESERVATION_KEY}"%'`,
    '  ORDER BY o.created_at ASC',
    `  LIMIT ${STALLED_RESERVATION_RELEASE.candidateLimit}`,
  ].join('\n')

/**
 * The activity-log line each released order gets: `entity` with the record
 * columns, `plain` for a ledger older than them, `none` for a store with no
 * ledger at all. The checkout tries them in that order.
 */
export type StalledReleaseLog = 'entity' | 'plain' | 'none'

// One system "order-cancelled" line per released order, keyed as the shared
// writer keys an order's cancellation (`order-cancelled:<order id>`, the key
// "Settle Unpaid Order" writes too): its units were put back when any tracked
// row took them, which the editor reads before it restocks or accepts a late
// payment for the order.
const releasedLogLines = (log: StalledReleaseLog): string[] => {
  if (log === 'none') {
    return []
  }
  const columns =
    log === 'entity'
      ? 'event_type, dedupe_key, order_id, entity_type, entity_id, payload, actor_type, status'
      : 'event_type, dedupe_key, order_id, payload, actor_type, status'
  const entity = log === 'entity' ? " 'order', r.id::text," : ''
  return [
    ',',
    'logged AS (',
    `  INSERT INTO teleport_events (${columns})`,
    `  SELECT 'order-cancelled', 'order-cancelled:' || r.id::text, r.id,${entity}`,
    "    json_build_object('reason', 'expired',",
    "      'restocked', CASE WHEN EXISTS (SELECT 1 FROM lines l JOIN product_locks pl ON l.variant_id IS NULL AND pl.id::text = l.product_id WHERE l.order_id = r.id)",
    '        OR EXISTS (SELECT 1 FROM lines l JOIN variant_locks vl ON vl.id::text = l.variant_id WHERE l.order_id = r.id)',
    "        THEN 'true' ELSE 'false' END,",
    "      'unitCount', (SELECT COALESCE(SUM(l.quantity), 0) FROM lines l WHERE l.order_id = r.id)::text)::text,",
    "    'system', 'recorded'",
    '  FROM released r',
    '  ON CONFLICT (dedupe_key) DO NOTHING',
    '  RETURNING id',
    ')',
  ]
}

/**
 * Cancels the `pending` orders that reserved stock (they carry the record)
 * but never opened a payment session (no attempt reference, no payment
 * reference) `holdMinutes` after they were placed, and gives back, in the
 * same statement and per order, what each one held: its stock (from its items,
 * or from the record when it has none), its voucher redemption and its
 * gift-card tender, and writes each one's cancellation line (`log`). A
 * store-billed renewal is left to the billing run, a store whose order table
 * cannot record a checkout is left alone, and so is an order written in the
 * last `quietMinutes` (its payment page may be opening). Rows another
 * transaction holds are skipped, so a checkout in flight, or another pass, is
 * never waited on. A checkout recorded for the order first keeps it pending,
 * and one opened after the release is never recorded, so it is closed and
 * never shown. An order cancelled here that is paid after all has its stock
 * taken again by "Process Payment Webhook" when it is still there, and is
 * otherwise recorded as a late payment for the merchant.
 *
 * Locks, after the orders: vouchers, gift cards, products, variants, each in
 * id order — the order the checkout's reservation takes them in — so the two
 * never deadlock.
 *
 * The provider's own events and the scheduled "Release Abandoned Checkouts"
 * run settle orders that DID open a payment page; nothing triggers for one
 * that did not, so the checkout runs this pass itself (`cart-price-order`).
 */
export const buildStalledReservationReleaseQuery = (
  holdMinutes: number = STALLED_RESERVATION_RELEASE.holdMinutes,
  batchSize: number = STALLED_RESERVATION_RELEASE.batchSize,
  log: StalledReleaseLog = 'entity'
): string =>
  [
    'WITH stale AS (',
    '  SELECT o.id',
    '  FROM teleport_orders o',
    ...stalledOrderConditions(holdMinutes),
    // `$1`: the orders whose metadata the checkout read as JSON. Only theirs
    // is parsed here, whatever order the planner evaluates the rest in.
    '    AND o.id::text = ANY($1::text[])',
    `    AND (CASE WHEN o.id::text = ANY($1::text[]) THEN ${hasReservationRecordSql(
      'o.metadata'
    )} ELSE false END)`,
    '  ORDER BY o.created_at ASC',
    `  LIMIT ${Math.max(1, Math.floor(batchSize))}`,
    '  FOR UPDATE SKIP LOCKED',
    '),',
    'released AS (',
    '  UPDATE teleport_orders o',
    "  SET status = 'cancelled', payment_status = 'failed', updated_at = NOW()",
    '  FROM stale s',
    '  WHERE o.id = s.id',
    "  RETURNING o.id, COALESCE(NULLIF(to_jsonb(o) ->> 'order_number', ''), o.id::text) AS order_ref,",
    "    to_jsonb(o) ->> 'gift_card_id' AS gift_card_id,",
    "    COALESCE((to_jsonb(o) ->> 'gift_card_amount')::numeric, 0) AS gift_card_amount,",
    "    UPPER(COALESCE(o.currency, '')) AS currency",
    '),',
    STOCK_RESERVATION_RESTORE_LINES_BY_ORDER,
    'product_need AS (',
    '  SELECT product_id AS id, SUM(quantity)::int AS qty FROM lines',
    '  WHERE variant_id IS NULL AND product_id IS NOT NULL GROUP BY product_id',
    '),',
    'variant_need AS (',
    '  SELECT variant_id AS id, SUM(quantity)::int AS qty FROM lines',
    '  WHERE variant_id IS NOT NULL GROUP BY variant_id',
    '),',
    'voucher_dropped AS (',
    '  DELETE FROM teleport_voucher_redemptions vr USING released r WHERE vr.order_id = r.id',
    '  RETURNING vr.voucher_id',
    '),',
    'held_vouchers AS (',
    '  SELECT v.id FROM teleport_vouchers v',
    '  WHERE v.id IN (SELECT voucher_id FROM voucher_dropped)',
    '  ORDER BY v.id FOR UPDATE',
    '),',
    'card AS (',
    '  SELECT g.id, g.balance, r.gift_card_amount AS amount, r.id AS order_id, r.order_ref',
    '  FROM teleport_gift_cards g JOIN released r ON g.id::text = r.gift_card_id',
    "  WHERE r.gift_card_amount > 0 AND g.status = 'active'",
    '    AND (g.expires_at IS NULL OR g.expires_at > NOW())',
    "    AND (r.currency = '' OR UPPER(g.currency) = r.currency)",
    '    AND (SELECT COUNT(*) FROM held_vouchers) >= 0',
    '  ORDER BY g.id FOR UPDATE OF g',
    '),',
    'product_locks AS (',
    '  SELECT p.id, n.qty FROM teleport_products p JOIN product_need n ON p.id::text = n.id',
    '  WHERE p.quantity IS NOT NULL AND (SELECT COUNT(*) FROM card) >= 0',
    '  ORDER BY p.id FOR UPDATE OF p',
    '),',
    'variant_locks AS (',
    '  SELECT v.id, n.qty FROM teleport_product_variants v JOIN variant_need n ON v.id::text = n.id',
    '  WHERE v.quantity IS NOT NULL AND (SELECT COUNT(*) FROM product_locks) >= 0',
    '  ORDER BY v.id FOR UPDATE OF v',
    '),',
    'product_restore AS (',
    '  UPDATE teleport_products p SET quantity = p.quantity + l.qty, updated_at = NOW()',
    '  FROM product_locks l WHERE p.id = l.id',
    '  RETURNING p.id',
    '),',
    'variant_restore AS (',
    '  UPDATE teleport_product_variants v SET quantity = v.quantity + l.qty, updated_at = NOW()',
    '  FROM variant_locks l WHERE v.id = l.id',
    '  RETURNING v.id',
    '),',
    'voucher_restored AS (',
    '  UPDATE teleport_vouchers v',
    '  SET usage_count = GREATEST(COALESCE(v.usage_count, 0) - d.n, 0), updated_at = NOW()',
    '  FROM (SELECT voucher_id, COUNT(*)::int AS n FROM voucher_dropped GROUP BY voucher_id) d',
    '  JOIN held_vouchers h ON h.id = d.voucher_id',
    '  WHERE v.id = d.voucher_id',
    '  RETURNING v.id',
    '),',
    'card_ledger AS (',
    '  INSERT INTO teleport_gift_card_transactions',
    '    (gift_card_id, order_id, type, amount, balance_after, dedupe_key, note)',
    "  SELECT card.id, card.order_id, 'release', card.amount, card.balance + card.amount,",
    "    'release:' || card.order_id::text, 'Released from unpaid order ' || card.order_ref",
    '  FROM card',
    '  ON CONFLICT (dedupe_key) DO NOTHING',
    '  RETURNING gift_card_id, amount',
    '),',
    'card_credited AS (',
    '  UPDATE teleport_gift_cards g SET balance = g.balance + c.amount, updated_at = NOW()',
    '  FROM (SELECT gift_card_id, SUM(amount) AS amount FROM card_ledger GROUP BY gift_card_id) c',
    '  WHERE g.id = c.gift_card_id',
    '  RETURNING g.id',
    ')' + releasedLogLines(log).join('\n'),
    'SELECT',
    '  (SELECT COUNT(*) FROM released) AS released,',
    '  (SELECT COALESCE(SUM(quantity), 0) FROM lines) AS units,',
    '  (SELECT COUNT(*) FROM product_restore) + (SELECT COUNT(*) FROM variant_restore) AS restocked_rows,',
    '  (SELECT COUNT(*) FROM voucher_dropped) AS vouchers_released,',
    '  (SELECT COUNT(*) FROM card_credited) AS gift_cards_released' +
      // The data API wakes the automations only for a pass that logged a line.
      (log === 'none' ? '' : ',\n  (SELECT COUNT(*) FROM logged) AS claimed'),
  ].join('\n')

/** The forms the checkout tries, in order: a ledger with the record columns, an older one, none. */
export const buildStalledReservationReleaseQueries = (): string[] =>
  (['entity', 'plain', 'none'] as StalledReleaseLog[]).map((log) =>
    buildStalledReservationReleaseQuery(
      STALLED_RESERVATION_RELEASE.holdMinutes,
      STALLED_RESERVATION_RELEASE.batchSize,
      log
    )
  )

// ────────────────────────────────────────────────────────────────────
// Applying both to a workflow
// ────────────────────────────────────────────────────────────────────

export interface PlaceOrderGuardSummary {
  settleGuards: number
  stockReservations: number
  skippedReservations: number
  reservationRestores: number
  restoreLockOrders: number
}

interface LooseNode {
  id?: string
  type?: string
  config?: { query?: string; params?: unknown; code?: string }
}

const stockDeltaParam = (priceNodeId: string, key: string) => ({
  path: [priceNodeId, 'stockDeltas', key],
  type: 'workflowContext',
  nodeId: priceNodeId,
})

/**
 * The stock can be reserved with the order only when the order's units are
 * known on the server and the workflow's own decrement can be stopped from
 * taking them a second time: every order decrement in it is the parameterised
 * chain step (re-baked by `rewriteParameterizedStockChainInNodes`).
 */
const canReserveStock = (nodes: LooseNode[]): boolean => {
  if (!isParameterizedDecrementChainRewritable(nodes)) {
    return false
  }
  return nodes.every((node) => {
    if (!node || (node.type !== 'data-raw-query' && node.type !== 'general-custom-js')) {
      return true
    }
    if (node.type === 'data-raw-query' && looksLikeOrderRedemptionStatement(node.config?.query)) {
      return true
    }
    const { category } = classifyStockWriteSite('Place Order', node as any)
    if (category !== 'order-decrement') {
      return true
    }
    return node.type === 'data-raw-query' && isParameterizedStockDecrementQuery(node.config?.query)
  })
}

/**
 * Re-bakes the settle write and the redemption statement of one workflow (or
 * custom node) in place. Returns whether the redemption statement now
 * reserves the order's stock, which the stock chain rewrite needs to know.
 */
export const guardPlaceOrderStatementsInNodes = (
  nodes: unknown,
  ownerName: string,
  options: { cashOnDelivery: boolean; codByShippingZone: boolean; reserveStock: boolean },
  summary: PlaceOrderGuardSummary
): { stockReserved: boolean } => {
  if (!Array.isArray(nodes)) {
    return { stockReserved: false }
  }
  const list = nodes as LooseNode[]
  const priceNode = list.find(
    (node) => node && node.type === 'cart-price-order' && typeof node.id === 'string' && node.id
  )
  let stockReserved = false
  for (const node of list) {
    if (!node || node.type !== 'data-raw-query' || !node.config) {
      continue
    }
    const query = node.config.query
    if (looksLikeSettleOrderStatement(query)) {
      const guarded = guardSettleOrderStatement(query, options)
      if (guarded !== query) {
        node.config.query = guarded
        summary.settleGuards++
      }
      continue
    }
    if (looksLikeSettleUnpaidOrderStatement(query)) {
      const restoring = options.reserveStock
        ? restoreReservationsInSettleUnpaidStatement(query)
        : query
      if (restoring !== query) {
        summary.reservationRestores++
      }
      // Whatever the stock settings: its rows are locked in the order every
      // other stock statement takes them in.
      const sorted = lockSettleUnpaidRestoresInIdOrder(restoring)
      if (sorted !== restoring) {
        summary.restoreLockOrders++
      }
      node.config.query = sorted
      continue
    }
    if (!options.reserveStock || !looksLikeOrderRedemptionStatement(query)) {
      continue
    }
    const params = node.config.params
    const reserved = reserveStockInRedemptionStatement(query)
    if (
      !priceNode ||
      !Array.isArray(params) ||
      params.length !== REDEMPTION_PARAM_COUNT ||
      reserved === query ||
      !canReserveStock(list)
    ) {
      summary.skippedReservations++
      // eslint-disable-next-line no-console
      console.warn(
        '[teleport] place-order guards: "' +
          ownerName +
          '" keeps its stock decrement after the order (its stock cannot be reserved with the order: ' +
          'no server pricing step, or a redemption or decrement step that has drifted).'
      )
      continue
    }
    node.config.query = reserved
    node.config.params = [
      ...params,
      stockDeltaParam(priceNode.id as string, 'productIds'),
      stockDeltaParam(priceNode.id as string, 'productQtys'),
      stockDeltaParam(priceNode.id as string, 'variantIds'),
      stockDeltaParam(priceNode.id as string, 'variantQtys'),
    ]
    summary.stockReservations++
    stockReserved = true
  }
  return { stockReserved }
}
