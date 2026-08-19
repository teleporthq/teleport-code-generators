import { generateBlogPostTransformationCode } from '../src/transformations/blog-post'
import { generateEcommerceProductTransformationCode } from '../src/transformations/ecommerce-product'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'
import { getTransformWrapperCode } from '../src/transformations'

// `relatedProducts` / `relatedPosts` are what the details-page rail maps over,
// and the whole section is gated on that array being non-empty — so a transform
// that omits the field does not render a broken rail, it renders NOTHING, on a
// page that looks otherwise complete. That is exactly how the first shipped
// version failed: the canvas drew the rail, the exported site silently dropped
// it, and the deployed page went straight from the product to its reviews.
//
// These evaluate the EMITTED code, the same way the runtime does.

const evalTransform = <T>(code: string, exportName: string): T => {
  const bundle = generateSharedTransformationCode() + '\n' + code
  return new Function(bundle + `\nreturn ${exportName};`)() as T
}

type Build = (record: unknown, options?: Record<string, unknown>) => Record<string, unknown>

const buildEcommerceProduct = evalTransform<Build>(
  generateEcommerceProductTransformationCode(),
  'buildEcommerceProduct'
)
const buildBlogPost = evalTransform<Build>(generateBlogPostTransformationCode(), 'buildBlogPost')

const product = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Product ${id}`,
  slug: `product-${id}`,
  status: 'active',
  price: 10,
  currency: 'USD',
  ...overrides,
})

const post = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Post ${id}`,
  slug: `post-${id}`,
  status: 'published',
  ...overrides,
})

const mapOf = (rows: Array<Record<string, unknown>>) =>
  rows.reduce<Record<string, unknown>>((acc, row) => {
    acc[String(row.id)] = row
    return acc
  }, {})

describe('ecommerce product transform — related products', () => {
  it('always emits both fields, so a binding never dereferences undefined', () => {
    const built = buildEcommerceProduct(product('a'))
    expect(built.relatedProductIds).toEqual([])
    expect(built.relatedProducts).toEqual([])
  })

  it('reads the raw column even with no map to resolve against', () => {
    const built = buildEcommerceProduct(product('a', { related_product_ids: '["b","c"]' }))
    expect(built.relatedProductIds).toEqual(['b', 'c'])
    // A listing fetch resolves nothing — see the wrapper test below.
    expect(built.relatedProducts).toEqual([])
  })

  it('resolves to transformed products, in the merchant`s order', () => {
    const built = buildEcommerceProduct(product('a', { related_product_ids: '["c","b"]' }), {
      relatedProductsById: mapOf([product('b'), product('c')]),
    })

    const related = built.relatedProducts as Array<Record<string, unknown>>
    expect(related.map((entry) => entry.id)).toEqual(['c', 'b'])
    // Transformed, not raw: the card binds camelCase fields.
    expect(related[0]).toHaveProperty('mainImage')
    expect(related[0].name).toBe('Product c')
  })

  it('drops related products that are not active', () => {
    const built = buildEcommerceProduct(product('a', { related_product_ids: '["b","c","d"]' }), {
      relatedProductsById: mapOf([
        product('b', { status: 'draft' }),
        product('c', { status: 'archived' }),
        product('d'),
      ]),
    })

    expect((built.relatedProducts as Array<Record<string, unknown>>).map((e) => e.id)).toEqual([
      'd',
    ])
  })

  it('skips ids whose row was deleted', () => {
    const built = buildEcommerceProduct(product('a', { related_product_ids: '["gone","b"]' }), {
      relatedProductsById: mapOf([product('b')]),
    })

    expect((built.relatedProducts as Array<Record<string, unknown>>).map((e) => e.id)).toEqual([
      'b',
    ])
  })

  // ⛔ Two products referencing each other is the NORMAL case — they are each
  // other's accessories. Threading the map into the nested build would recurse
  // until the stack ran out.
  it('does not resolve a related product`s own related products', () => {
    const built = buildEcommerceProduct(product('a', { related_product_ids: '["b"]' }), {
      relatedProductsById: mapOf([product('b', { related_product_ids: '["a"]' })]),
    })

    const related = built.relatedProducts as Array<Record<string, unknown>>
    expect(related).toHaveLength(1)
    expect(related[0].relatedProductIds).toEqual(['a'])
    expect(related[0].relatedProducts).toEqual([])
  })

  it('drops a self-reference', () => {
    const built = buildEcommerceProduct(product('a', { related_product_ids: '["a","b"]' }), {
      relatedProductsById: mapOf([product('a'), product('b')]),
    })

    expect((built.relatedProducts as Array<Record<string, unknown>>).map((e) => e.id)).toEqual([
      'b',
    ])
  })

  it('carries the current language into the nested build', () => {
    const built = buildEcommerceProduct(product('a', { related_product_ids: '["b"]' }), {
      currentLanguage: 'fr',
      mainLanguage: 'en',
      relatedProductsById: mapOf([product('b', { fr_name: 'Produit B' })]),
    })

    expect((built.relatedProducts as Array<Record<string, unknown>>)[0].name).toBe('Produit B')
  })

  it('tolerates a hand-edited comma-separated cell, deduping and trimming', () => {
    const built = buildEcommerceProduct(product('a', { related_product_ids: ' b , b ,, c ' }))
    expect(built.relatedProductIds).toEqual(['b', 'c'])
  })
})

describe('blog post transform — related posts', () => {
  it('always emits both fields', () => {
    const built = buildBlogPost(post('a'))
    expect(built.relatedPostIds).toEqual([])
    expect(built.relatedPosts).toEqual([])
  })

  it('resolves to transformed posts, in the author`s order', () => {
    const built = buildBlogPost(post('a', { related_post_ids: '["c","b"]' }), {
      relatedPostsById: mapOf([post('b'), post('c')]),
    })

    const related = built.relatedPosts as Array<Record<string, unknown>>
    expect(related.map((entry) => entry.id)).toEqual(['c', 'b'])
    expect(related[0].title).toBe('Post c')
  })

  /** ⛔ A draft must not reach the storefront through another post's rail. */
  it('drops related posts that are not published', () => {
    const built = buildBlogPost(post('a', { related_post_ids: '["b","c"]' }), {
      relatedPostsById: mapOf([post('b', { status: 'draft' }), post('c')]),
    })

    expect((built.relatedPosts as Array<Record<string, unknown>>).map((e) => e.id)).toEqual(['c'])
  })

  it('drops a self-reference and does not recurse', () => {
    const built = buildBlogPost(post('a', { related_post_ids: '["a","b"]' }), {
      relatedPostsById: mapOf([post('a'), post('b', { related_post_ids: '["a"]' })]),
    })

    const related = built.relatedPosts as Array<Record<string, unknown>>
    expect(related.map((entry) => entry.id)).toEqual(['b'])
    expect(related[0].relatedPosts).toEqual([])
  })
})

describe('the transform wrapper', () => {
  /**
   * ⛔ A listing fetch must NOT resolve related items: it would run an extra
   * query and inline up to four fully-transformed entities per card into
   * __NEXT_DATA__ that nothing on that page draws. Single record = the details
   * page, which is the only surface with a rail.
   */
  it('only resolves related items for a single-record fetch', () => {
    for (const table of ['teleport_products', 'teleport_blog_posts']) {
      expect(getTransformWrapperCode(table)).toContain('records.length === 1')
    }
  })

  it('passes the resolved map into the transform options', () => {
    expect(getTransformWrapperCode('teleport_products')).toContain(
      'relatedProductsById: relatedProductsById'
    )
    expect(getTransformWrapperCode('teleport_blog_posts')).toContain(
      'relatedPostsById: relatedPostsById'
    )
  })

  it('leaves a custom table alone', () => {
    expect(getTransformWrapperCode('wholesale_products')).toBe('')
  })
})
