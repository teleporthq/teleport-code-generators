import { generateEcommerceProductTransformationCode } from '../src/transformations/ecommerce-product'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'

/**
 * The aggregate star rating a product card and the product page draw.
 *
 * The one rule that matters more than the arithmetic: a product nobody has
 * reviewed, and a product whose rating lookup FAILED, must render identically —
 * as no stars at all. "0.0 out of 5" on an unreviewed product is the single
 * worst thing a storefront can say about it by accident, and it is exactly what
 * a well-meaning `|| 0` produces.
 *
 * PARITY: the same fixture table runs against the editor/canvas copy in
 * teleport-gui's `features/e-commerce/utils/__tests__/product-rating-parity.spec.ts`.
 * Keep the two tables identical — that is what proves the canvas and the
 * deployed store agree.
 */

const buildProduct = (): ((record: unknown, options?: unknown) => Record<string, unknown>) => {
  const code =
    generateSharedTransformationCode() + '\n' + generateEcommerceProductTransformationCode({})
  return new Function(code + '\nreturn buildEcommerceProduct;')() as (
    record: unknown,
    options?: unknown
  ) => Record<string, unknown>
}

const PRODUCT = { id: 'p1', name: 'P', slug: 'p', price: '10.00', currency: 'USD' }

const withRating = (average: number | null, count: number) =>
  buildProduct()(PRODUCT, { ratingsByProductId: { p1: { average, count } } })

/**
 * SHARED PARITY TABLE — keep byte-identical with the GUI spec.
 * [average, count, expected label, expected star states]
 */
export const RATING_FIXTURES: Array<{
  average: number
  count: number
  label: string
  stars: string[]
}> = [
  { average: 5, count: 3, label: '5.0', stars: ['full', 'full', 'full', 'full', 'full'] },
  { average: 4.5, count: 128, label: '4.5', stars: ['full', 'full', 'full', 'full', 'half'] },
  { average: 4.26, count: 9, label: '4.3', stars: ['full', 'full', 'full', 'full', 'half'] },
  { average: 4.24, count: 9, label: '4.2', stars: ['full', 'full', 'full', 'full', 'empty'] },
  { average: 3.75, count: 4, label: '3.8', stars: ['full', 'full', 'full', 'full', 'empty'] },
  { average: 3.5, count: 4, label: '3.5', stars: ['full', 'full', 'full', 'half', 'empty'] },
  { average: 2.7, count: 11, label: '2.7', stars: ['full', 'full', 'half', 'empty', 'empty'] },
  { average: 1, count: 1, label: '1.0', stars: ['full', 'empty', 'empty', 'empty', 'empty'] },
  { average: 0.4, count: 2, label: '0.4', stars: ['half', 'empty', 'empty', 'empty', 'empty'] },
]

const starsOf = (product: Record<string, unknown>): string[] => [
  product.ratingStar1 as string,
  product.ratingStar2 as string,
  product.ratingStar3 as string,
  product.ratingStar4 as string,
  product.ratingStar5 as string,
]

describe('ecommerce product transform — aggregate rating', () => {
  it.each(RATING_FIXTURES)(
    'renders $average over $count reviews as "$label"',
    ({ average, count, label, stars }) => {
      const product = withRating(average, count)
      expect(product.ratingAverageLabel).toBe(label)
      expect(product.ratingCountLabel).toBe(String(count))
      expect(product.hasRatings).toBe('true')
      expect(starsOf(product)).toEqual(stars)
    }
  )

  it('shows NOTHING for a product with no reviews — not zero stars', () => {
    const product = buildProduct()(PRODUCT, { ratingsByProductId: {} })
    expect(product.hasRatings).toBe('false')
    expect(product.ratingAverageLabel).toBe('')
    expect(product.ratingCountLabel).toBe('')
    expect(product.ratingAverage).toBe(0)
    expect(product.ratingCount).toBe(0)
    expect(starsOf(product)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty'])
  })

  // A failed lookup leaves the map empty, which is deliberately the SAME answer
  // as "no reviews" — there is exactly one safe rendering for both.
  it('shows nothing when the ratings map is absent entirely', () => {
    const product = buildProduct()(PRODUCT, {})
    expect(product.hasRatings).toBe('false')
    expect(starsOf(product)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty'])
  })

  it('shows nothing when a count arrives with no usable average', () => {
    // Every approved row had a NULL rating: AVG() is NULL, COUNT() is not.
    expect(withRating(null, 4).hasRatings).toBe('false')
  })

  it('shows nothing for a zero count even if an average somehow came back', () => {
    expect(withRating(4.5, 0).hasRatings).toBe('false')
  })

  // `rating` is a plain integer column: the admin panel, a CSV import or a
  // hand-written UPDATE can all put a 7 in it. An unclamped average would ask
  // for a sixth star slot that does not exist.
  it('clamps an out-of-range average to five stars', () => {
    const product = withRating(7.4, 2)
    expect(product.ratingAverage).toBe(5)
    expect(product.ratingAverageLabel).toBe('5.0')
    expect(starsOf(product)).toEqual(['full', 'full', 'full', 'full', 'full'])
  })

  it('treats a negative average as no rating at all', () => {
    expect(withRating(-3, 2).hasRatings).toBe('false')
  })

  it('emits the count as a whole number even when the driver returns a string', () => {
    const product = buildProduct()(PRODUCT, {
      ratingsByProductId: { p1: { average: '4.5', count: '12' } },
    })
    expect(product.ratingCount).toBe(12)
    expect(product.ratingCountLabel).toBe('12')
    expect(product.ratingAverageLabel).toBe('4.5')
  })

  // The details page draws its related products as real cards, each with its
  // own star row. They are covered by the same batched query, so they must get
  // the same enrichment rather than transforming as unrated.
  it('passes the ratings map down to related products', () => {
    const product = buildProduct()(
      { ...PRODUCT, related_product_ids: JSON.stringify(['p2']) },
      {
        ratingsByProductId: { p1: { average: 5, count: 1 }, p2: { average: 3, count: 8 } },
        relatedProductsById: {
          p2: { id: 'p2', name: 'Other', slug: 'other', price: '5.00', status: 'active' },
        },
      }
    )
    const related = product.relatedProducts as Array<Record<string, unknown>>
    expect(related).toHaveLength(1)
    expect(related[0].hasRatings).toBe('true')
    expect(related[0].ratingAverageLabel).toBe('3.0')
  })

  it('keeps the label and the stars consistent for every fixture', () => {
    // The label is rounded to one decimal and the stars to the nearest half OF
    // THAT LABEL, so the stars can never contradict the number beside them.
    for (const fixture of RATING_FIXTURES) {
      const product = withRating(fixture.average, fixture.count)
      const filled = starsOf(product).reduce(
        (total, star) => total + (star === 'full' ? 1 : star === 'half' ? 0.5 : 0),
        0
      )
      expect(Math.abs(filled - Number(product.ratingAverageLabel))).toBeLessThanOrEqual(0.25)
    }
  })
})
