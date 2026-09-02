import { parse } from '@babel/parser'
import {
  PRODUCT_DISCOUNT_SORT_FIELD,
  buildProductDiscountPercentageSql,
  buildProductEffectivePriceSql,
  generateSortFallbackFieldHelper,
  generateSortFieldSqlHelper,
  generateSortTiebreakSql,
  supportsProductPriceSort,
} from '../src/product-price-sort'
import { generatePostgreSQLFetcher } from '../src/fetchers/postgresql'
import { generateTeleportFetcher } from '../src/fetchers/teleport'
import { generateDataSourceFetcher } from '../src/data-source-fetchers'

/**
 * Ordering a products list by what customers actually pay.
 *
 * The sort happens in SQL, before any row reaches JavaScript, and the list is
 * paginated — so re-sorting the fetched page would only reorder 20 of N
 * products. The database therefore has to compute the discounted price itself.
 *
 * These tests cannot execute the SQL (no Postgres here), so they pin the two
 * things that are checkable: the emitted route still parses, and the expression
 * says what the discount rule says.
 */

const PG_CONFIG = { connectionString: 'postgres://user:pw@host:5432/db' }

describe('generateSortFieldSqlHelper', () => {
  it('rewrites price only for the products table', () => {
    expect(supportsProductPriceSort('teleport_products')).toBe(true)
    expect(supportsProductPriceSort('teleport_orders')).toBe(false)

    expect(generateSortFieldSqlHelper('teleport_products')).toContain('if (field === "price")')
    // Every other table gets the identity, so a fetcher can embed it
    // unconditionally and no unrelated sort can change.
    const other = generateSortFieldSqlHelper('teleport_orders')
    expect(other).not.toContain('if (field ===')
    expect(other).toContain('return field')
  })

  it('emits the SQL as a double-quoted literal, carrying no template syntax', () => {
    // The helper is interpolated into a fetcher's template literal. A backtick
    // or a `${` inside it would close or interpolate that template — which is
    // exactly how this first went wrong.
    const helper = generateSortFieldSqlHelper('teleport_products')
    expect(helper).not.toContain('`')
    expect(helper).not.toContain('${')
  })

  it('is a syntactically valid JS function', () => {
    expect(() =>
      parse(generateSortFieldSqlHelper('teleport_products'), { sourceType: 'script' })
    ).not.toThrow()
  })
})

describe('the effective-price expression', () => {
  const sql = buildProductEffectivePriceSql()

  it('falls back to the list price when nothing is live', () => {
    expect(sql.startsWith('COALESCE((')).toBe(true)
    expect(sql.trimEnd().endsWith('), "price"::numeric)')).toBe(true)
  })

  it('applies the same rule as the discount module', () => {
    // Percentage off the list price, capped at 100; fixed subtracted; floored
    // at zero and rounded to the cent — `computeDiscountedPrice`'s contract.
    expect(sql).toContain(`"price"::numeric * (1 - LEAST(entry.amount, 100) / 100)`)
    expect(sql).toContain(`"price"::numeric - entry.amount`)
    expect(sql).toContain('ROUND(GREATEST(0,')
    expect(sql).toContain(', 2)')
  })

  it('takes the FIRST live entry in array order, like resolveActiveDiscount', () => {
    expect(sql).toContain('WITH ORDINALITY')
    expect(sql).toContain('ORDER BY entry.ord')
    expect(sql).toContain('LIMIT 1')
  })

  it('honours the half-open window', () => {
    // `[startsAt, endsAt)` — inclusive start, exclusive end, so back-to-back
    // discounts hand over with no overlap.
    expect(sql).toContain('entry.starts_at <=')
    expect(sql).toContain('entry.ends_at >')
  })

  it('ignores entries the parser would drop', () => {
    expect(sql).toContain('entry.amount > 0')
    expect(sql).toContain(`entry.kind IN ('percentage', 'fixed')`)
  })

  it('never casts anything that could raise', () => {
    // It runs inside ORDER BY for the whole table: one unparseable row would
    // empty the products page.
    // JSON is cast only when the text already looks like an array…
    expect(sql).toContain(`btrim("discounts") NOT LIKE '[%'`)
    expect(sql).toContain(`'[]'::jsonb`)
    // …the value only when it is a bare decimal…
    expect(sql).toContain(`~ '^[0-9]+(\\.[0-9]+)?$'`)
    // …and the window bounds are compared as TEXT, never cast to a timestamp.
    // `toISOString()` is fixed-width UTC, so it sorts lexicographically in the
    // same order it sorts chronologically.
    expect(sql).not.toContain('::timestamp')
    expect(sql).toContain(`to_char(now() AT TIME ZONE 'UTC'`)
  })
})

describe('the generated Postgres route', () => {
  const productsRoute = generatePostgreSQLFetcher(PG_CONFIG, 'teleport_products')

  it('parses as valid JavaScript', () => {
    expect(() => parse(productsRoute, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('orders through the mapper rather than the raw field', () => {
    expect(productsRoute).toContain('sortFieldSql(sort.field)')
    expect(productsRoute).toContain('if (field === "price")')
  })

  it('keeps a plain-column ORDER BY to fall back to', () => {
    // If a database ever rejects the sub-select, the page must degrade to the
    // previous ordering rather than serve nothing.
    expect(productsRoute).toContain('const usedDiscountAwareSort = orderBySql !== plainOrderBySql')
    expect(productsRoute).toContain('if (!usedDiscountAwareSort) throw sortError')
    expect(productsRoute).toContain('baseSql + plainOrderBySql + sqlTail')
  })

  it('leaves every other table ordering exactly as it was', () => {
    const ordersRoute = generatePostgreSQLFetcher(PG_CONFIG, 'teleport_orders')
    expect(ordersRoute).toContain('sortFieldSql(sort.field)')
    expect(ordersRoute).not.toContain('if (field ===')
    expect(ordersRoute).not.toContain('jsonb_array_elements')
  })

  it('still parses for a non-products table', () => {
    expect(() =>
      parse(generatePostgreSQLFetcher(PG_CONFIG, 'teleport_orders'), { sourceType: 'module' })
    ).not.toThrow()
  })
})

describe('the discount ordering', () => {
  const sql = buildProductDiscountPercentageSql()

  it('sorts on the real `discounts` column, never a virtual field name', () => {
    // The same field reaches sixteen other fetchers and the editor's data API,
    // none of which know about the rewrite. A name that is not a column becomes
    // `ORDER BY discount` and fails the entire query; the real column can only
    // ever be ordered by uselessly.
    expect(PRODUCT_DISCOUNT_SORT_FIELD).toBe('discounts')
    expect(generateSortFieldSqlHelper('teleport_products')).toContain('if (field === "discounts")')
  })

  it('measures the markdown as a percentage of the list price', () => {
    // Comparable across a mixed catalogue: $20 off a $2000 sofa is a worse deal
    // than $5 off a $10 mug, and an absolute saving would rank them backwards.
    expect(sql).toContain('* 100')
    expect(sql).toContain('/ "price"::numeric')
    expect(sql).toContain(buildProductEffectivePriceSql())
  })

  it('cannot divide by zero, and treats a priceless row as undiscounted', () => {
    // `NULL > 0` is NULL, which is not true — so a NULL price takes the ELSE.
    expect(sql).toContain('WHEN "price"::numeric > 0')
    expect(sql).toContain('ELSE 0')
  })

  it('rounds, so ties are stable rather than floating-point noise', () => {
    expect(sql).toContain('ROUND(')
    expect(sql).toContain(', 4)')
  })
})

describe('degrading safely', () => {
  it('falls back to a column that is certain to exist', () => {
    const helper = generateSortFallbackFieldHelper('teleport_products')
    // Never back to `discounts` itself: it is the JSON column, and a store
    // provisioned before discounts shipped does not have it at all — retrying
    // with it would fail exactly like the expression did.
    expect(helper).toContain('if (field === "price" || field === "discounts")')
    expect(helper).toContain('return "price"')
  })

  it('leaves other tables and other fields alone', () => {
    const helper = generateSortFallbackFieldHelper('teleport_orders')
    expect(helper).not.toContain('if (field ===')
    expect(helper).toContain('return field')
  })

  it('is valid JS for both tables', () => {
    expect(() =>
      parse(generateSortFallbackFieldHelper('teleport_products'), { sourceType: 'script' })
    ).not.toThrow()
    expect(() =>
      parse(generateSortFallbackFieldHelper('teleport_orders'), { sourceType: 'script' })
    ).not.toThrow()
  })
})

describe('stable pagination', () => {
  it('breaks ties on the products table so pages cannot repeat or skip rows', () => {
    // "Sort by discount" ties every undiscounted product at zero. Equal rows
    // with no defined order can appear on two pages, or on none.
    expect(generateSortTiebreakSql('teleport_products')).toBe(', "id" ASC')
  })

  it('adds nothing to a table it does not own', () => {
    expect(generateSortTiebreakSql('teleport_orders')).toBe('')
  })

  it('is applied to both the real and the fallback ORDER BY', () => {
    const route = generatePostgreSQLFetcher(PG_CONFIG, 'teleport_products')
    const orderByLines = route
      .split('\n')
      .filter((line) => line.includes('ORDER BY') && line.includes('join'))
    expect(orderByLines).toHaveLength(2)
    orderByLines.forEach((line) => expect(line).toContain('"id" ASC'))
  })
})

/**
 * The half of this that was missed the first time.
 *
 * A generated storefront's products table is TELEPORT-hosted, so its route is
 * built by `generateTeleportFetcher` — not by `generatePostgreSQLFetcher`,
 * which every test above exercises. The rewrite went into the Postgres fetcher
 * alone, so a real store still ordered by the undiscounted list price while the
 * whole suite passed.
 *
 * These tests go through `generateFetcher`, the function the project generator
 * actually calls, so what is asserted is the route a store really ships.
 */
describe('the fetcher a generated storefront actually gets', () => {
  const teleportProducts = generateDataSourceFetcher(
    { type: 'teleport', config: { host: 'db', database: 'store' } },
    'teleport_products'
  )

  it('is discount-aware for a teleport-hosted products table', () => {
    expect(teleportProducts).toContain('sortFieldSql(sort.field)')
    expect(teleportProducts).toContain('if (field === "price")')
    expect(teleportProducts).toContain('if (field === "discounts")')
    expect(teleportProducts).toContain('jsonb_array_elements')
  })

  it('keeps the plain-column fallback and the tiebreaker', () => {
    expect(teleportProducts).toContain(
      'const usedDiscountAwareSort = orderBySql !== plainOrderBySql'
    )
    expect(teleportProducts).toContain('if (!usedDiscountAwareSort) throw sortError')
    expect(teleportProducts).toContain('baseSql + plainOrderBySql + sqlTail')
    expect(teleportProducts).toContain('"id" ASC')
  })

  it('parses as valid JavaScript', () => {
    expect(() => parse(teleportProducts, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('leaves a teleport-hosted table that is not products alone', () => {
    const orders = generateDataSourceFetcher(
      { type: 'teleport', config: { host: 'db', database: 'store' } },
      'teleport_orders'
    )
    expect(orders).not.toContain('if (field ===')
    expect(orders).not.toContain('jsonb_array_elements')
    expect(() => parse(orders, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('is discount-aware for a self-hosted Postgres products table too', () => {
    const pg = generateDataSourceFetcher(
      { type: 'postgresql', config: PG_CONFIG },
      'teleport_products'
    )
    expect(pg).toContain('if (field === "price")')
  })

  /**
   * The guard that makes the miss above impossible to repeat: every SQL data
   * source that can serve a products table must route its sorts through
   * `sortFieldSql`. A new Postgres-compatible fetcher, or a rewrite of an
   * existing one, fails here rather than silently shipping the list price.
   */
  it.each([
    ['teleport', { host: 'db', database: 'store' }],
    ['postgresql', PG_CONFIG],
    ['cockroachdb', PG_CONFIG],
  ])('routes %s sorts through the mapper', (type, config) => {
    const route = generateDataSourceFetcher(
      { type, config } as unknown as Parameters<typeof generateDataSourceFetcher>[0],
      'teleport_products'
    )
    expect(route).toContain('sortFieldSql(sort.field)')
    expect(route).not.toMatch(/return `\$\{sort\.field\} \$\{order\}`/)
  })
})

describe('the teleport fetcher, directly', () => {
  it('emits the helpers exactly once, so the route has no duplicate declaration', () => {
    const route = generateTeleportFetcher({ host: 'db' }, 'teleport_products')
    expect(route.split('function sortFieldSql(')).toHaveLength(2)
    expect(route.split('function sortFallbackField(')).toHaveLength(2)
  })

  it('does not add an ORDER BY to the count query', () => {
    // The count route shares this file; a tiebreaker or a sub-select there
    // would be wasted work at best and a syntax error at worst.
    const route = generateTeleportFetcher({ host: 'db' }, 'teleport_products')
    const countBody = route.slice(route.indexOf('async function getCount'))
    expect(countBody).not.toContain('ORDER BY ${')
    expect(countBody).not.toContain('sortFieldSql(')
  })
})
