/**
 * Which subscription rows entitle a buyer to a subscriber-only page.
 *
 * `teleport_subscriptions.status` moves through `pending` (the first order is
 * placed, the provider has not confirmed the mandate), `trialing`, `active`,
 * `past_due` (a renewal charge failed and the provider retries), `paused`,
 * `cancelled` and `expired`. A buyer keeps their content while the provider is
 * still honouring the mandate — through a trial, an active period and the
 * retry window of a failed charge. `pending` never confirmed, `paused` stopped
 * collecting, and the two closed statuses are over. A row with
 * `cancel_at_period_end` stays entitled: its status only turns `cancelled`
 * once the provider ends it at the period end.
 *
 * The GUI keeps the same list as `ENTITLED_SUBSCRIPTION_STATUS_VALUES`
 * (`features/e-commerce/constants/subscriptions.ts`), pinned by a parity spec.
 */
export const SUBSCRIPTION_ENTITLED_STATUSES: ReadonlyArray<string> = [
  'trialing',
  'active',
  'past_due',
]

export const SUBSCRIPTIONS_TABLE = 'teleport_subscriptions'

/**
 * The one parameterised statement every entitlement check runs:
 *  $1 — the session user id (compared as text: auth ids are strings, the
 *       column is a uuid),
 *  $2 — the entitled statuses,
 *  $3 — the product ids the page names; an EMPTY array means any product.
 *
 * A subscription the STORE bills (a provider that cannot charge a saved
 * payment method) carries `access_until`: the end of the paid period plus the
 * grace for the next payment. Past it the row stops entitling on its own, so
 * access ends on time even when the scheduled billing run is late or off.
 * Read through `to_jsonb` so a store whose table predates the column still
 * answers (a missing key reads NULL, which never limits).
 */
export const SUBSCRIPTION_ENTITLEMENT_SQL =
  `SELECT 1 FROM ${SUBSCRIPTIONS_TABLE} s ` +
  'WHERE s.user_id::text = $1 AND s.status = ANY($2::text[]) ' +
  'AND (cardinality($3::text[]) = 0 OR s.product_id::text = ANY($3::text[])) ' +
  "AND ((to_jsonb(s) ->> 'access_until') IS NULL " +
  "OR (to_jsonb(s) ->> 'access_until')::timestamp > NOW()) LIMIT 1"

/** Trimmed, de-duplicated, non-empty ids — whatever shape the caller had them in. */
export const normalizeSubscriptionProductIds = (value: unknown): string[] => {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const entry of raw) {
    const id = String(entry ?? '').trim()
    if (id && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}
