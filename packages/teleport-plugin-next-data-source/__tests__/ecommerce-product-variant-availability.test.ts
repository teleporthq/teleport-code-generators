import { generateEcommerceProductTransformationCode } from '../src/transformations/ecommerce-product'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'
import { getTransformWrapperCode } from '../src/transformations'

/**
 * A product whose variant combinations are ALL out of stock — or whose axes have
 * no combinations behind them at all — must reach the storefront saying so, in
 * two ways the picker and the buy button read directly:
 *
 *   - every value carries `isDead: 'true'`, so the picker strikes them through;
 *   - `hasPurchasableVariant: 'false'`, so the Add to Cart button is replaced by
 *     the "select an available option" notice instead of adding a cart line with
 *     no variant at all (`data-default-variant-id` is empty in that state).
 *
 * The hinge is knowing the difference between "we looked and there are none" and
 * "we could not look": `options.variantsByProductId` is NULL for the latter, and
 * a null must stay permissive — a missing table or a failed query must never
 * make a whole catalogue unbuyable.
 */

const evalBuildProduct = (): ((r: unknown, o?: unknown) => Record<string, unknown>) => {
  const code =
    generateSharedTransformationCode() + '\n' + generateEcommerceProductTransformationCode()
  return new Function(code + '\nreturn buildEcommerceProduct;')() as (
    r: unknown,
    o?: unknown
  ) => Record<string, unknown>
}

type Axis = { key: string; values: Array<Record<string, unknown>> }

const buildEcommerceProduct = evalBuildProduct()

const SIZE_AXIS = JSON.stringify([
  {
    key: 'size',
    name: 'Size',
    type: 'text',
    values: [
      { value: 'xs', label: 'XS' },
      { value: 's', label: 'S' },
    ],
  },
])

const variantProduct = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Tee',
  slug: 'tee',
  price: 20,
  currency: 'USD',
  variant_options: SIZE_AXIS,
  ...overrides,
})

const values = (product: Record<string, unknown>): Array<Record<string, unknown>> =>
  (product.variantOptions as Axis[])[0].values

describe('ecommerce product transform — variant availability', () => {
  it('combinations UNKNOWN (no map at all): nothing dead, still purchasable', () => {
    const product = buildEcommerceProduct(variantProduct())
    expect(values(product).every((v) => v.isDead === 'false')).toBe(true)
    expect(product.hasPurchasableVariant).toBe('true')
  })

  it('combinations UNKNOWN (the lookup failed → null map): unchanged', () => {
    const product = buildEcommerceProduct(variantProduct(), { variantsByProductId: null })
    expect(values(product).every((v) => v.isDead === 'false')).toBe(true)
    expect(product.hasPurchasableVariant).toBe('true')
  })

  it('looked up and there are NO combinations: every value dead, not purchasable', () => {
    const product = buildEcommerceProduct(variantProduct(), { variantsByProductId: {} })
    expect(values(product).every((v) => v.isDead === 'true')).toBe(true)
    expect(product.hasPurchasableVariant).toBe('false')
    expect(product.defaultVariantId).toBe('')
  })

  it('every combination sold out: every value dead, not purchasable', () => {
    const product = buildEcommerceProduct(variantProduct(), {
      variantsByProductId: {
        p1: [
          { id: 'v-xs', options: { size: 'xs' }, quantity: 0 },
          { id: 'v-s', options: { size: 's' }, quantity: 0 },
        ],
      },
    })
    expect(values(product).every((v) => v.isDead === 'true')).toBe(true)
    expect(product.hasPurchasableVariant).toBe('false')
    expect(product.defaultVariantId).toBe('')
  })

  it('one combination in stock: only the sold-out value is dead, and it is purchasable', () => {
    const product = buildEcommerceProduct(variantProduct(), {
      variantsByProductId: {
        p1: [
          { id: 'v-xs', options: { size: 'xs' }, quantity: 0 },
          { id: 'v-s', options: { size: 's' }, quantity: 4 },
        ],
      },
    })
    expect(values(product)[0].isDead).toBe('true')
    expect(values(product)[1].isDead).toBe('false')
    expect(values(product)[1].isDefault).toBe('true')
    expect(product.hasPurchasableVariant).toBe('true')
    expect(product.defaultVariantId).toBe('v-s')
  })

  it('unlimited stock (null quantity) counts as in stock', () => {
    const product = buildEcommerceProduct(variantProduct(), {
      variantsByProductId: { p1: [{ id: 'v-xs', options: { size: 'xs' }, quantity: null }] },
    })
    expect(product.hasPurchasableVariant).toBe('true')
    expect(values(product)[0].isDead).toBe('false')
    // The value with no combination behind it is still dead.
    expect(values(product)[1].isDead).toBe('true')
  })

  it('a FLAT product is always purchasable — outOfStock governs its stock', () => {
    const flat = buildEcommerceProduct(
      { id: 'f', name: 'Mug', slug: 'mug', price: 9, currency: 'USD', quantity: 0 },
      { variantsByProductId: {} }
    )
    expect(flat.hasPurchasableVariant).toBe('true')
    expect(flat.outOfStock).toBe('true')
  })

  it('always emits hasPurchasableVariant as a STRING (never boolean/undefined)', () => {
    for (const options of [undefined, { variantsByProductId: null }, { variantsByProductId: {} }]) {
      const product = buildEcommerceProduct(variantProduct(), options)
      expect(typeof product.hasPurchasableVariant).toBe('string')
      expect(['true', 'false']).toContain(product.hasPurchasableVariant)
    }
  })

  it('a related product inherits the same known/unknown answer as its parent', () => {
    const built = buildEcommerceProduct(variantProduct({ related_product_ids: '["p2"]' }), {
      // Unknown for everybody — the nested build must NOT read this as "none".
      variantsByProductId: null,
      relatedProductsById: { p2: variantProduct({ id: 'p2', slug: 'p2' }) },
    })
    const related = (built.relatedProducts as Array<Record<string, unknown>>)[0]
    expect(related.hasPurchasableVariant).toBe('true')
  })
})

/**
 * Runs the EMITTED `transformRecords` against a stub pg client, which is the only
 * way to prove the wrapper's control flow — the order of the two lookups, and
 * which ids reach the combinations query — rather than its text.
 */
describe('transform wrapper — executed end to end', () => {
  interface StubQuery {
    sql: string
    params: unknown[]
  }

  const runWrapper = async (
    records: Array<Record<string, unknown>>,
    rows: {
      related?: Array<Record<string, unknown>>
      variants?: Array<Record<string, unknown>>
      failVariantsQuery?: boolean
    }
  ): Promise<{ out: Array<Record<string, unknown>>; queries: StubQuery[] }> => {
    const bundle =
      generateSharedTransformationCode() +
      '\n' +
      generateEcommerceProductTransformationCode() +
      '\n' +
      getTransformWrapperCode('teleport_products')
    const transformRecords = new Function(bundle + '\nreturn transformRecords;')() as (
      r: unknown,
      getClient: unknown,
      q: unknown
    ) => Promise<Array<Record<string, unknown>>>

    const queries: StubQuery[] = []
    const query = async (
      sql: string,
      params: unknown[] = []
    ): Promise<{ rows: Array<Record<string, unknown>> }> => {
      queries.push({ sql, params })
      if (sql.includes('teleport_assets')) {
        return { rows: [] }
      }
      if (sql.includes('teleport_product_variants')) {
        if (rows.failVariantsQuery) {
          throw new Error('relation "teleport_product_variants" does not exist')
        }
        return { rows: rows.variants || [] }
      }
      if (sql.includes('teleport_products')) {
        return { rows: rows.related || [] }
      }
      return { rows: [] }
    }
    const getClientFn = () => ({
      connect: async (): Promise<void> => undefined,
      end: async (): Promise<void> => undefined,
      query,
    })

    const out = await transformRecords(records, getClientFn, {})
    return { out, queries }
  }

  const variantQueryOf = (queries: StubQuery[]): StubQuery | undefined =>
    queries.find((q) => q.sql.includes('teleport_product_variants'))

  it("asks for the RELATED products' combinations in the same batched query", async () => {
    const { out, queries } = await runWrapper([variantProduct({ related_product_ids: '["p2"]' })], {
      related: [variantProduct({ id: 'p2', slug: 'p2' })],
      variants: [
        { id: 'v-p1', product_id: 'p1', options: { size: 's' }, quantity: 5 },
        { id: 'v-p2', product_id: 'p2', options: { size: 'xs' }, quantity: 2 },
      ],
    })
    // Both the page's own product AND the related one.
    expect(variantQueryOf(queries)?.params[0]).toEqual(['p1', 'p2'])

    const related = (out[0].relatedProducts as Array<Record<string, unknown>>)[0]
    expect(related.hasPurchasableVariant).toBe('true')
    expect(related.defaultVariantId).toBe('v-p2')
  })

  it('a FAILED combinations query leaves every product permissive, not unbuyable', async () => {
    const { out, queries } = await runWrapper([variantProduct()], { failVariantsQuery: true })
    expect(variantQueryOf(queries)).toBeTruthy()
    expect(out[0].hasPurchasableVariant).toBe('true')
    expect(values(out[0]).every((v) => v.isDead === 'false')).toBe(true)
  })

  it('a query that RAN and returned nothing marks the product unbuyable', async () => {
    const { out } = await runWrapper([variantProduct()], { variants: [] })
    expect(out[0].hasPurchasableVariant).toBe('false')
    expect(values(out[0]).every((v) => v.isDead === 'true')).toBe(true)
  })
})

describe('transform wrapper — the batched combinations query', () => {
  const wrapper = getTransformWrapperCode('teleport_products')

  it('starts the map at NULL so a failed lookup reads as unknown, not as none', () => {
    expect(wrapper).toContain('var variantsByProductId = null')
  })

  it('resolves related items BEFORE variants, and asks for their combinations too', () => {
    // The details page draws each related product as a real card with its own
    // picker; fetching only the page's own ids left every one of them looking
    // like a product with no combinations.
    expect(wrapper.indexOf('relatedProductsById = await')).toBeGreaterThan(-1)
    expect(wrapper.indexOf('relatedProductsById = await')).toBeLessThan(
      wrapper.indexOf('getVariantsMap(')
    )
    expect(wrapper).toContain('__variantPids.push(__rrow.id)')
  })

  it('leaves the blog wrapper without any variant enrichment', () => {
    const blog = getTransformWrapperCode('teleport_blog_posts')
    expect(blog).not.toContain('getVariantsMap')
    expect(blog).toContain('relatedPostsById')
  })
})
