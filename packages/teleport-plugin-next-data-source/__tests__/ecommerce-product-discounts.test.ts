import { generateEcommerceProductTransformationCode } from '../src/transformations/ecommerce-product'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'

/**
 * Per-product discounts in the GENERATED storefront transform — the third
 * mirror of the rule that also lives in teleport-gui as
 * `features/e-commerce/utils/product-discounts.ts` (editor/canvas) and
 * `.../builders/ecommerce/product-discount-script.ts` (the baked add-to-cart
 * script). The GUI's `product-discount-parity.spec.ts` pins those two together;
 * this file is what keeps THIS copy honest.
 *
 * The two invariants under test: a discount comes off the NET price BEFORE tax,
 * and the stored `price` never moves — every write path re-reads the raw row.
 */

const evalBuildProduct = (
  storefrontTaxRate = 0
): ((record: unknown) => Record<string, unknown>) => {
  const code =
    generateSharedTransformationCode() +
    '\n' +
    generateEcommerceProductTransformationCode({ storefrontTaxRate })
  const fn = new Function(code + '\nreturn buildEcommerceProduct;')
  return fn() as (record: unknown) => Record<string, unknown>
}

const FLAT_PRODUCT = { id: 'p1', name: 'P', slug: 'p', price: '100.00', currency: 'USD' }

const discountsColumn = (
  over: Partial<{
    type: string
    value: number
    startsAt: string | null
    endsAt: string | null
  }> = {}
): string =>
  JSON.stringify([
    { id: 'd1', type: 'percentage', value: 10, startsAt: null, endsAt: null, ...over },
  ])

describe('ecommerce product transform — per-product discounts', () => {
  it('leaves `price` alone and marks the DISPLAY price down', () => {
    const product = evalBuildProduct()({ ...FLAT_PRODUCT, discounts: discountsColumn() })
    expect(product.price).toBe(100)
    expect(product.displayPrice).toBe('90.00')
    expect(product.hasDiscount).toBe('true')
    expect(product.originalDisplayPrice).toBe('100.00')
  })

  it('takes the discount off the NET price, then adds tax on top of that', () => {
    const product = evalBuildProduct(19)({ ...FLAT_PRODUCT, discounts: discountsColumn() })
    // 100 → 90 net → 90 * 1.19 = 107.10 gross. Taxing first would give 119 − 10%.
    expect(product.displayPrice).toBe('107.10')
    expect(product.originalDisplayPrice).toBe('119.00')
  })

  it('emits the badge copy for both discount types', () => {
    const percentage = evalBuildProduct()({ ...FLAT_PRODUCT, discounts: discountsColumn() })
    expect(percentage.discountLabel).toBe('10% off')

    const fixed = evalBuildProduct()({
      ...FLAT_PRODUCT,
      discounts: discountsColumn({ type: 'fixed', value: 15 }),
    })
    expect(fixed.discountLabel).toBe('$15 off')
    expect(fixed.displayPrice).toBe('85.00')
  })

  it('puts the currency symbol where the currency wants it', () => {
    const product = evalBuildProduct()({
      ...FLAT_PRODUCT,
      currency: 'SEK',
      discounts: discountsColumn({ type: 'fixed', value: 20 }),
    })
    expect(String(product.discountLabel).endsWith(' off')).toBe(true)
    expect(String(product.discountLabel)).toContain('20')
  })

  it('reports no discount — and no struck price — when nothing is scheduled', () => {
    const product = evalBuildProduct()(FLAT_PRODUCT)
    expect(product.hasDiscount).toBe('false')
    expect(product.discountLabel).toBe('')
    expect(product.originalDisplayPrice).toBe('')
    expect(product.displayPrice).toBe('100.00')
  })

  it('honours the half-open window: live at the start instant, over at the end', () => {
    const now = Date.now()
    const live = evalBuildProduct()({
      ...FLAT_PRODUCT,
      discounts: JSON.stringify([
        {
          id: 'd1',
          type: 'percentage',
          value: 10,
          startsAt: new Date(now - 1000).toISOString(),
          endsAt: new Date(now + 60000).toISOString(),
        },
      ]),
    })
    expect(live.hasDiscount).toBe('true')

    const expired = evalBuildProduct()({
      ...FLAT_PRODUCT,
      discounts: JSON.stringify([
        {
          id: 'd1',
          type: 'percentage',
          value: 10,
          startsAt: new Date(now - 60000).toISOString(),
          endsAt: new Date(now - 1000).toISOString(),
        },
      ]),
    })
    expect(expired.hasDiscount).toBe('false')
    expect(expired.displayPrice).toBe('100.00')

    const scheduled = evalBuildProduct()({
      ...FLAT_PRODUCT,
      discounts: JSON.stringify([
        { id: 'd1', type: 'percentage', value: 10, startsAt: new Date(now + 60000).toISOString() },
      ]),
    })
    expect(scheduled.hasDiscount).toBe('false')
  })

  it('never goes below zero, and never renders a negative price', () => {
    const product = evalBuildProduct()({
      ...FLAT_PRODUCT,
      discounts: discountsColumn({ type: 'fixed', value: 500 }),
    })
    expect(product.displayPrice).toBe('0.00')
  })

  it('falls back to the list price when the column is unusable', () => {
    const cases = ['{not json', JSON.stringify({ type: 'percentage' }), '', null]
    cases.forEach((discounts) => {
      const product = evalBuildProduct()({ ...FLAT_PRODUCT, discounts })
      expect(product.hasDiscount).toBe('false')
      expect(product.displayPrice).toBe('100.00')
    })
  })

  it('discounts each variant from its OWN price, carrying the pre-discount twin', () => {
    const record = {
      ...FLAT_PRODUCT,
      discounts: discountsColumn({ value: 50 }),
      variant_options: JSON.stringify([
        {
          key: 'size',
          name: 'Size',
          type: 'text',
          values: [
            { value: 's', label: 'S' },
            { value: 'l', label: 'L' },
          ],
        },
      ]),
    }
    const build = new Function(
      generateSharedTransformationCode() +
        '\n' +
        generateEcommerceProductTransformationCode({ storefrontTaxRate: 0 }) +
        '\nreturn buildEcommerceProduct;'
    )() as (row: unknown, variants: unknown) => Record<string, unknown>

    const product = build(record, {
      variantsByProductId: {
        // An overriding combination, and one that INHERITS the product price.
        p1: [
          { id: 'v-s', options: { size: 's' }, price: '40.00', quantity: 5 },
          { id: 'v-l', options: { size: 'l' }, price: null, quantity: 5 },
        ],
      },
    })

    const variantsDisplay = JSON.parse(String(product.variantsDisplayJson)) as Array<{
      id: string
      price: number
      originalPrice: number | null
    }>
    const small = variantsDisplay.find((entry) => entry.id === 'v-s')
    const large = variantsDisplay.find((entry) => entry.id === 'v-l')

    expect(small?.price).toBe(20)
    expect(small?.originalPrice).toBe(40)
    // The inheriting combination is discounted from the PRODUCT price, not left
    // at the undiscounted base.
    expect(large?.price).toBe(50)
    expect(large?.originalPrice).toBe(100)

    // The net twins stay untouched — every write path re-reads them.
    const variantsJson = JSON.parse(String(product.variantsJson)) as Array<{ price: number | null }>
    expect(variantsJson.map((entry) => entry.price)).toEqual([40, null])
  })
})
