/* tslint:disable:function-constructor */
import { generateEcommerceProductTransformationCode } from '../src/transformations/ecommerce-product'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'

/**
 * What a product card says about a subscription and a download: the period a
 * recurring price is followed by (`billingPeriod`, "/ month") and the
 * `isDigital` gate of the "Instant download" pill. Both are STRINGS the
 * builders bind and gate on, and both exist in two copies — this generated
 * transform and the editor's canvas transform.
 *
 * ⚠️ `PERIOD_FIXTURES` IS SHARED. It is byte-identical to the table in
 * teleport-gui's `features/e-commerce/utils/__tests__/recurring-summary-parity.spec.ts`,
 * which runs it against `formatBillingPeriod`. Two specs, one table.
 */

const buildProduct = (): ((record: unknown, options?: unknown) => Record<string, unknown>) => {
  const code =
    generateSharedTransformationCode() + '\n' + generateEcommerceProductTransformationCode({})
  return new Function(code + '\nreturn buildEcommerceProduct;')() as (
    record: unknown,
    options?: unknown
  ) => Record<string, unknown>
}

/** SHARED PARITY TABLE — keep byte-identical with the GUI spec. */
const PERIOD_FIXTURES: Array<{ interval: unknown; count: unknown; period: string }> = [
  { interval: 'month', count: 1, period: 'month' },
  { interval: 'month', count: 3, period: '3 months' },
  { interval: 'year', count: 1, period: 'year' },
  { interval: 'week', count: 2, period: '2 weeks' },
  { interval: ' DAY ', count: '7', period: '7 days' },
  { interval: 'fortnight', count: 0, period: 'month' },
  { interval: null, count: null, period: 'month' },
]

const BASE = { id: 'p1', name: 'P', slug: 'p', price: '10.00', currency: 'USD' }

describe('ecommerce product transform — subscriptions and digital delivery', () => {
  const build = buildProduct()

  it.each(PERIOD_FIXTURES)(
    'follows a recurring price billed every $interval × $count with "$period"',
    ({ interval, count, period }) => {
      const product = build({
        ...BASE,
        payment_type: 'recurring',
        recurring_interval: interval,
        recurring_interval_count: count,
      })
      expect(product.billingPeriod).toBe(period)
    }
  )

  it('follows a one-time price with nothing, whatever the interval columns hold', () => {
    expect(build({ ...BASE, recurring_interval: 'month' }).billingPeriod).toBe('')
    expect(
      build({ ...BASE, payment_type: 'one_time', recurring_interval: 'year' }).billingPeriod
    ).toBe('')
  })

  it('reads the digital flag as every backend spells it, and NULL as physical', () => {
    for (const raw of [true, 't', 'true', 1, '1', 'YES']) {
      expect(build({ ...BASE, is_digital: raw }).isDigital).toBe('true')
    }
    for (const raw of [false, 'f', 'false', 0, '0', null, undefined, '']) {
      expect(build({ ...BASE, is_digital: raw }).isDigital).toBe('false')
    }
  })
})

/**
 * SHARED PARITY TABLE — keep byte-identical with the GUI's
 * `packages/renderer/src/utils/__tests__/ecommerce-products-purchase-details.test.ts`,
 * which runs it against the canvas transform.
 */
const BILLING_SUMMARY_FIXTURES: Array<{
  interval: unknown
  count: unknown
  trialDays: unknown
  summary: string
}> = [
  { interval: 'month', count: 1, trialDays: null, summary: 'Billed every month' },
  {
    interval: 'month',
    count: 3,
    trialDays: 14,
    summary: 'Billed every 3 months · 14-day free trial',
  },
  { interval: 'year', count: 1, trialDays: '30', summary: 'Billed every year · 30-day free trial' },
  {
    interval: 'week',
    count: '2',
    trialDays: 1,
    summary: 'Billed every 2 weeks · 1-day free trial',
  },
  { interval: ' DAY ', count: '7', trialDays: 0, summary: 'Billed every 7 days' },
  { interval: null, count: null, trialDays: '', summary: 'Billed every month' },
]

describe('ecommerce product transform — the billing summary of a subscription', () => {
  const build = buildProduct()

  it.each(BILLING_SUMMARY_FIXTURES)(
    'describes $interval × $count with a $trialDays-day trial as "$summary"',
    ({ interval, count, trialDays, summary }) => {
      const product = build({
        ...BASE,
        payment_type: 'recurring',
        recurring_interval: interval,
        recurring_interval_count: count,
        trial_days: trialDays,
      })
      expect(product.billingSummary).toBe(summary)
    }
  )

  it('describes a one-time product with nothing, whatever its trial column holds', () => {
    expect(build({ ...BASE, trial_days: 14 }).billingSummary).toBe('')
  })
})
