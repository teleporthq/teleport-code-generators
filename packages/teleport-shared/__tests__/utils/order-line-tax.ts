import {
  generateOrderLineTaxHelperCode,
  generateStorefrontTaxHelperCode,
} from '../../src/utils/storefront-tax'

/**
 * What one order line cost the buyer — the ES5 copy the generated API routes
 * run (the merchant's order-notification email).
 *
 * ⚠️ The fixture table below is SHARED with teleport-gui's
 * `features/e-commerce/utils/__tests__/order-line-pricing-parity.spec.ts`, which
 * runs it over the storefront's baked script and the editor's TypeScript. Edit
 * the table in both files or in neither.
 */

// ── SHARED PARITY TABLE ─────────────────────────────────────────────────────
// Byte-identical in teleport-gui `order-line-pricing-parity.spec.ts` and
// teleport-code-generators `teleport-shared/__tests__/utils/order-line-tax.ts`.
// `breakdown` is `teleport_orders.tax_breakdown` as the drivers hand it back
// (JSON text, or an object where the driver decodes JSON columns); the stored
// rate and flag are `teleport_order_items.tax_rate` / `tax_included` read
// through `to_jsonb(...) ->>` (text) or a typed fetch (number / boolean / 't').
interface OrderLineTaxFixture {
  name: string
  storefrontTaxRate: number
  breakdown: unknown
  productId: string
  variantId: string
  storedRate: unknown
  storedIncluded: unknown
  amount: number
  expected: { rate: number; included: boolean; decimals: number; gross: number }
}

const ROMANIAN_BREAKDOWN = JSON.stringify({
  taxRate: 20,
  taxIncluded: false,
  taxDecimals: 2,
  shippingTax: 0,
  lines: [
    { productId: 'p1', variantId: '', taxRate: 20, taxIncluded: false },
    { productId: 'p2', variantId: 'v-blue', taxRate: 9, taxIncluded: true },
    { productId: 'p3', variantId: '', taxRate: -5, taxIncluded: false },
  ],
})

const YEN_BREAKDOWN = JSON.stringify({
  taxRate: 10,
  taxIncluded: false,
  taxDecimals: 0,
  shippingTax: 0,
  lines: [{ productId: 'p1', variantId: '', taxRate: 10, taxIncluded: false }],
})

const ORDER_LINE_TAX_FIXTURES: OrderLineTaxFixture[] = [
  {
    name: 'no breakdown, no record: the store default is added',
    storefrontTaxRate: 19,
    breakdown: null,
    productId: 'p1',
    variantId: '',
    storedRate: null,
    storedIncluded: null,
    amount: 19.99,
    expected: { rate: 19, included: false, decimals: 2, gross: 23.79 },
  },
  {
    name: 'no breakdown, no record, untaxed store: the amount is untouched, unrounded',
    storefrontTaxRate: 0,
    breakdown: null,
    productId: 'p1',
    variantId: '',
    storedRate: null,
    storedIncluded: null,
    amount: 19.999,
    expected: { rate: 0, included: false, decimals: 2, gross: 19.999 },
  },
  {
    name: 'a breakdown line matched by product: its added rate',
    storefrontTaxRate: 0,
    breakdown: ROMANIAN_BREAKDOWN,
    productId: 'p1',
    variantId: '',
    storedRate: null,
    storedIncluded: null,
    amount: 100,
    expected: { rate: 20, included: false, decimals: 2, gross: 120 },
  },
  {
    name: 'a breakdown line matched by product + variant: an included rate adds nothing',
    storefrontTaxRate: 19,
    breakdown: ROMANIAN_BREAKDOWN,
    productId: 'p2',
    variantId: 'v-blue',
    storedRate: null,
    storedIncluded: null,
    amount: 47,
    expected: { rate: 9, included: true, decimals: 2, gross: 47 },
  },
  {
    name: 'a product the breakdown has no line for: the order standard rate',
    storefrontTaxRate: 0,
    breakdown: ROMANIAN_BREAKDOWN,
    productId: 'p9',
    variantId: '',
    storedRate: null,
    storedIncluded: null,
    amount: 50,
    expected: { rate: 20, included: false, decimals: 2, gross: 60 },
  },
  {
    name: 'a variant the breakdown has no line for falls to the order rate, not the product line',
    storefrontTaxRate: 0,
    breakdown: ROMANIAN_BREAKDOWN,
    productId: 'p2',
    variantId: 'v-red',
    storedRate: null,
    storedIncluded: null,
    amount: 50,
    expected: { rate: 20, included: false, decimals: 2, gross: 60 },
  },
  {
    name: 'a negative rate on a line reads as none',
    storefrontTaxRate: 0,
    breakdown: ROMANIAN_BREAKDOWN,
    productId: 'p3',
    variantId: '',
    storedRate: null,
    storedIncluded: null,
    amount: 50,
    expected: { rate: 0, included: false, decimals: 2, gross: 50 },
  },
  {
    name: 'a zero-decimal currency rounds the gross to whole units',
    storefrontTaxRate: 0,
    breakdown: YEN_BREAKDOWN,
    productId: 'p1',
    variantId: '',
    storedRate: null,
    storedIncluded: null,
    amount: 999,
    expected: { rate: 10, included: false, decimals: 0, gross: 1099 },
  },
  {
    name: 'a breakdown the driver already decoded works like the text',
    storefrontTaxRate: 0,
    breakdown: JSON.parse(ROMANIAN_BREAKDOWN),
    productId: 'p1',
    variantId: '',
    storedRate: null,
    storedIncluded: null,
    amount: 100,
    expected: { rate: 20, included: false, decimals: 2, gross: 120 },
  },
  {
    name: 'a malformed breakdown falls back to the store default',
    storefrontTaxRate: 19,
    breakdown: '{not json',
    productId: 'p1',
    variantId: '',
    storedRate: null,
    storedIncluded: null,
    amount: 100,
    expected: { rate: 19, included: false, decimals: 2, gross: 119 },
  },
  {
    name: 'a recorded rate wins over the breakdown and the store default',
    storefrontTaxRate: 19,
    breakdown: ROMANIAN_BREAKDOWN,
    productId: 'p1',
    variantId: '',
    storedRate: '5.500',
    storedIncluded: 'false',
    amount: 100,
    expected: { rate: 5.5, included: false, decimals: 2, gross: 105.5 },
  },
  {
    name: "a recorded included flag as the driver spells it ('t') adds nothing",
    storefrontTaxRate: 19,
    breakdown: null,
    productId: 'p1',
    variantId: '',
    storedRate: 19,
    storedIncluded: 't',
    amount: 100,
    expected: { rate: 19, included: true, decimals: 2, gross: 100 },
  },
  {
    name: 'a recorded included flag as JSON text',
    storefrontTaxRate: 0,
    breakdown: null,
    productId: 'p1',
    variantId: '',
    storedRate: '20',
    storedIncluded: 'true',
    amount: 100,
    expected: { rate: 20, included: true, decimals: 2, gross: 100 },
  },
  {
    name: 'a recorded rate of 0 is a record, not a missing one',
    storefrontTaxRate: 19,
    breakdown: null,
    productId: 'p1',
    variantId: '',
    storedRate: '0.000',
    storedIncluded: 'false',
    amount: 19.999,
    expected: { rate: 0, included: false, decimals: 2, gross: 19.999 },
  },
  {
    name: 'an empty recorded rate (NULL through ->>) derives from the breakdown',
    storefrontTaxRate: 0,
    breakdown: ROMANIAN_BREAKDOWN,
    productId: 'p1',
    variantId: '',
    storedRate: '',
    storedIncluded: '',
    amount: 100,
    expected: { rate: 20, included: false, decimals: 2, gross: 120 },
  },
  {
    name: 'a recorded rate keeps the decimals of a zero-decimal order',
    storefrontTaxRate: 0,
    breakdown: YEN_BREAKDOWN,
    productId: 'p1',
    variantId: '',
    storedRate: 10,
    storedIncluded: false,
    amount: 999,
    expected: { rate: 10, included: false, decimals: 0, gross: 1099 },
  },
  {
    name: 'a nonsensical recorded rate is ignored like a missing one',
    storefrontTaxRate: 19,
    breakdown: null,
    productId: 'p1',
    variantId: '',
    storedRate: 'abc',
    storedIncluded: 'false',
    amount: 100,
    expected: { rate: 19, included: false, decimals: 2, gross: 119 },
  },
]
// ── END SHARED PARITY TABLE ─────────────────────────────────────────────────

interface OrderLineTaxApi {
  orderLineTaxOf: (
    breakdown: unknown,
    productId: unknown,
    variantId: unknown,
    storedRate: unknown,
    storedIncluded: unknown
  ) => { rate: number; included: boolean; decimals: number }
  grossAmountAt: (amount: unknown, tax: unknown) => number
  paidAmountAt: (paid: unknown, net: unknown, tax: unknown) => number
}

const loadApi = (storefrontTaxRate: number): OrderLineTaxApi =>
  new Function(
    generateStorefrontTaxHelperCode(storefrontTaxRate) +
      generateOrderLineTaxHelperCode() +
      '\nreturn { orderLineTaxOf: orderLineTaxOf, grossAmountAt: grossAmountAt, paidAmountAt: paidAmountAt };'
  )() as OrderLineTaxApi

describe('order line tax — generated-route copy against the shared parity table', () => {
  for (const fixture of ORDER_LINE_TAX_FIXTURES) {
    it(fixture.name, () => {
      const api = loadApi(fixture.storefrontTaxRate)
      const tax = api.orderLineTaxOf(
        fixture.breakdown,
        fixture.productId,
        fixture.variantId,
        fixture.storedRate,
        fixture.storedIncluded
      )
      expect(tax).toEqual({
        rate: fixture.expected.rate,
        included: fixture.expected.included,
        decimals: fixture.expected.decimals,
      })
      expect(api.grossAmountAt(fixture.amount, tax)).toBe(fixture.expected.gross)
    })
  }
})

describe('order line tax — the recorded paid price', () => {
  const api = loadApi(19)
  const tax = api.orderLineTaxOf(null, 'p1', '', null, null)

  it('is read verbatim when the line carries one, however the driver spells it', () => {
    expect(api.paidAmountAt('120.00', 100, tax)).toBe(120)
    expect(api.paidAmountAt(120, 100, tax)).toBe(120)
    // A recorded 0 is a free line, not a missing record.
    expect(api.paidAmountAt('0.00', 100, tax)).toBe(0)
  })

  it('is derived at the line tax when the record is absent', () => {
    expect(api.paidAmountAt(null, 100, tax)).toBe(119)
    expect(api.paidAmountAt('', 100, tax)).toBe(119)
    expect(api.paidAmountAt(undefined, 19.99, tax)).toBe(23.79)
  })
})
