import { generateEcommerceProductTransformationCode } from '../src/transformations/ecommerce-product'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'
import { REVIEWS_PER_PRODUCT, getTransformWrapperCode } from '../src/transformations'

/**
 * The individual reviews a product page puts into its JSON-LD.
 *
 * Two separate claims are tested, because they fail in different ways:
 *
 *  1. **The transform exposes them.** A missing `reviews` field is invisible —
 *     the JSON-LD's `reviewList` leaf simply drops the property and the page
 *     ships with stars but no snippets, looking entirely healthy.
 *  2. **They are only fetched for a SINGLE product.** A listing of 24 products
 *     would otherwise run a review query and inline 120 rows into a page that
 *     emits no Product markup to put them in. The `records.length === 1`
 *     heuristic is the same one the related-items lookup already uses.
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

const REVIEWS = [
  { author: 'Sam', rating: 5, body: 'Perfect', datePublished: '2026-01-02T00:00:00.000Z' },
]

describe('product transform — reviews', () => {
  it('passes the fetched reviews through untouched', () => {
    const product = buildProduct()(PRODUCT, { reviewsByProductId: { p1: REVIEWS } })
    expect(product.reviews).toEqual(REVIEWS)
  })

  // A listing, an older baked transform, a store with reviews disabled: all
  // three arrive here as "no map", and all three have to mean an empty list
  // rather than an undefined the JSON-LD leaf would have to guard again.
  it('is an empty array when nothing was fetched', () => {
    expect(buildProduct()(PRODUCT, {}).reviews).toEqual([])
    expect(buildProduct()(PRODUCT, { reviewsByProductId: {} }).reviews).toEqual([])
  })

  it('never borrows another product reviews', () => {
    const product = buildProduct()(PRODUCT, { reviewsByProductId: { other: REVIEWS } })
    expect(product.reviews).toEqual([])
  })
})

describe('transform wrapper — when reviews are fetched', () => {
  const wrapper = getTransformWrapperCode('teleport_products')

  it('fetches them only for a single-record request', () => {
    expect(wrapper).toContain('getProductReviewsMap')
    // The same guard the related-items lookup uses.
    expect(wrapper).toMatch(/records\.length === 1[\s\S]*getProductReviewsMap/)
  })

  it('caps how many it inlines', () => {
    expect(wrapper).toContain(
      `getProductReviewsMap(getClientFn, __variantPids, ${REVIEWS_PER_PRODUCT})`
    )
  })

  it('hands them to the transform', () => {
    expect(wrapper).toContain('reviewsByProductId: reviewsByProductId')
  })

  it('is not emitted for a blog listing', () => {
    expect(getTransformWrapperCode('teleport_blog_posts')).not.toContain('getProductReviewsMap')
  })
})

describe('the reviews query', () => {
  const source = generateEcommerceProductTransformationCode({})

  // 'approved' is a fixed literal and must stay one: a pending review is one the
  // merchant has not agreed to publish, and a rejected one is a review they
  // actively removed. Neither belongs in the shop's structured data.
  it('reads approved reviews only', () => {
    expect(source).toContain("status = 'approved'")
  })

  // Google requires `author.name` on a review snippet; an anonymous row would
  // produce a Review object it rejects.
  it('skips rows with no reviewer name and no rating', () => {
    expect(source).toContain('rating IS NOT NULL')
    expect(source).toContain('reviewer_name IS NOT NULL')
    expect(source).toContain("btrim(reviewer_name) <> ''")
  })

  it('returns the newest first', () => {
    expect(source).toContain('ORDER BY created_at DESC')
  })
})

/**
 * The emitted fetcher, RUN against a fake client.
 *
 * The row → review mapping is the part the JSON-LD depends on key-for-key, and
 * it is the part no source-text assertion can prove: a renamed field produces a
 * `Review` object missing a required property, and the page still builds.
 */
describe('getProductReviewsMap', () => {
  const loadFetcher = (
    rows: Array<Record<string, unknown>>
  ): ((
    getClientFn: () => unknown,
    productIds: unknown,
    perProduct?: number
  ) => Promise<Record<string, unknown[]>>) => {
    const code =
      generateSharedTransformationCode() + '\n' + generateEcommerceProductTransformationCode({})
    const fn = new Function(code + '\nreturn getProductReviewsMap;')() as (
      getClientFn: () => unknown,
      productIds: unknown,
      perProduct?: number
    ) => Promise<Record<string, unknown[]>>
    const client = {
      connect: async () => undefined,
      query: async () => ({ rows }),
      end: async () => undefined,
    }
    return (_getClientFn, productIds, perProduct) => fn(() => client, productIds, perProduct)
  }

  it('shapes a row into exactly what the JSON-LD leaf reads', async () => {
    const fetch = loadFetcher([
      {
        product_id: 'p1',
        reviewer_name: '  Sam  ',
        rating: '5',
        content: 'Perfect',
        created_at: '2026-01-02T00:00:00.000Z',
      },
    ])
    const map = await fetch(() => undefined, ['p1'])
    expect(map.p1).toEqual([
      {
        author: 'Sam',
        rating: 5,
        body: 'Perfect',
        datePublished: '2026-01-02T00:00:00.000Z',
      },
    ])
  })

  it('caps each product at the requested number', async () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({
      product_id: 'p1',
      reviewer_name: 'R' + index,
      rating: 4,
      content: 'x',
      created_at: '2026-01-02T00:00:00.000Z',
    }))
    const map = await loadFetcher(rows)(() => undefined, ['p1'], 3)
    expect(map.p1).toHaveLength(3)
  })

  it('tolerates a null review body and a null date', async () => {
    const map = await loadFetcher([
      { product_id: 'p1', reviewer_name: 'Sam', rating: 4, content: null, created_at: null },
    ])(() => undefined, ['p1'])
    expect(map.p1[0]).toMatchObject({ body: '', datePublished: null })
  })

  it('returns an empty map for no ids', async () => {
    expect(await loadFetcher([])(() => undefined, [])).toEqual({})
    expect(await loadFetcher([])(() => undefined, null)).toEqual({})
  })

  // The reviews table may not exist at all — reviews are an opt-in feature.
  it('returns an empty map when the query throws', async () => {
    const code =
      generateSharedTransformationCode() + '\n' + generateEcommerceProductTransformationCode({})
    const fn = new Function(code + '\nreturn getProductReviewsMap;')() as (
      getClientFn: () => unknown,
      productIds: unknown
    ) => Promise<Record<string, unknown[]>>
    const map = await fn(
      () => ({
        connect: async () => undefined,
        query: async () => {
          throw new Error('relation does not exist')
        },
        end: async () => undefined,
      }),
      ['p1']
    )
    expect(map).toEqual({})
  })
})
