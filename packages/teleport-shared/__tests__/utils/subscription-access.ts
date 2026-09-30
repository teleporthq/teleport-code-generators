import {
  SUBSCRIPTION_ENTITLED_STATUSES,
  SUBSCRIPTION_ENTITLEMENT_SQL,
  normalizeSubscriptionProductIds,
} from '../../src/utils/subscription-access'

describe('subscription access', () => {
  it('entitles a trial, an active period and the retry window of a failed charge — nothing else', () => {
    expect(SUBSCRIPTION_ENTITLED_STATUSES).toEqual(['trialing', 'active', 'past_due'])
    for (const status of ['pending', 'paused', 'cancelled', 'expired']) {
      expect(SUBSCRIPTION_ENTITLED_STATUSES).not.toContain(status)
    }
  })

  it('is one parameterised statement: user, statuses, products (empty = any)', () => {
    expect(SUBSCRIPTION_ENTITLEMENT_SQL).toBe(
      'SELECT 1 FROM teleport_subscriptions s WHERE s.user_id::text = $1 AND s.status = ANY($2::text[]) ' +
        'AND (cardinality($3::text[]) = 0 OR s.product_id::text = ANY($3::text[])) ' +
        "AND ((to_jsonb(s) ->> 'access_until') IS NULL " +
        "OR (to_jsonb(s) ->> 'access_until')::timestamp > NOW()) LIMIT 1"
    )
    expect(SUBSCRIPTION_ENTITLEMENT_SQL).not.toMatch(/\$[4-9]/)
  })

  it('ends a store-billed row at its access date, read so an older table without the column still answers', () => {
    // `to_jsonb` of a row without the column has no key: NULL, never a limit.
    expect(SUBSCRIPTION_ENTITLEMENT_SQL).not.toMatch(/\baccess_until\s*[<>=]/)
    expect(SUBSCRIPTION_ENTITLEMENT_SQL).toContain("(to_jsonb(s) ->> 'access_until') IS NULL")
  })

  it('normalises ids from an array or a comma list', () => {
    expect(normalizeSubscriptionProductIds(['a', ' b ', 'a', '', null])).toEqual(['a', 'b'])
    expect(normalizeSubscriptionProductIds('a, b,,a')).toEqual(['a', 'b'])
    expect(normalizeSubscriptionProductIds(undefined)).toEqual([])
    expect(normalizeSubscriptionProductIds(42)).toEqual([])
  })
})
