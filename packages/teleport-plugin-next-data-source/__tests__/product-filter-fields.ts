import { parse } from '@babel/parser'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  PRODUCT_ON_SALE_FILTER_FIELD,
  PRODUCT_RATING_FILTER_FIELD,
  PRODUCT_VARIANT_AXIS_FILTER_PREFIX,
  PRODUCT_VARIANT_AXIS_KEY_PATTERN,
  buildProductOnSaleSql,
  buildProductRatingBucketSql,
  buildProductVariantAxisExistsSql,
  generateProductFilterClauseHelper,
} from '../src/product-filter-fields'
import { buildProductEffectivePriceSql } from '../src/product-price-sort'
import { generateTeleportFetcher } from '../src/fetchers/teleport'
import { generatePostgreSQLFetcher } from '../src/fetchers/postgresql'
import { generateMySQLFetcher } from '../src/fetchers/mysql'
import { generateDataSourceFetcher } from '../src/data-source-fetchers'
import { generateFilterTreeHelpersCode } from '../src/utils'

/**
 * The storefront's product filters on things that are not a column: the price
 * paid today, the star bucket, the on-sale flag and a variant axis. They are
 * answered in SQL — the list is paginated — so the emitted helper is pinned
 * here the same way the discount-aware sort is.
 */

const PG_CONFIG = { connectionString: 'postgres://user:pw@host:5432/db' }

/** Runs the emitted helper as real JS and returns the clause + bound params. */
function runHelper(
  tableName: string,
  field: string,
  operand: string,
  value: unknown
): { clause: string | null; params: unknown[] } {
  const params: unknown[] = []
  let index = 1
  const pushParam = (param: unknown) => {
    params.push(param)
    return '$' + index++
  }
  // tslint:disable-next-line:function-constructor
  const factory = new Function(
    `${generateProductFilterClauseHelper(tableName)}\nreturn productFilterClause`
  )
  const clause = factory()(field, operand, value, pushParam)
  return { clause, params }
}

/** Runs the emitted `normalizeInOperand` as real JS. */
function runNormalize(operand: string, value: unknown): unknown {
  // tslint:disable-next-line:function-constructor
  const factory = new Function(`${generateFilterTreeHelpersCode()}\nreturn normalizeInOperand`)
  return factory()(operand, value)
}

describe('generateProductFilterClauseHelper', () => {
  it('is the identity for every table but the products table', () => {
    const helper = generateProductFilterClauseHelper('teleport_orders')
    expect(helper).toContain('return null')
    expect(helper).not.toContain('jsonb_array_elements')
    expect(runHelper('teleport_orders', 'rating', '=', '4').clause).toBeNull()
  })

  it('emits the SQL as double-quoted literals, carrying no template syntax', () => {
    const helper = generateProductFilterClauseHelper('teleport_products')
    expect(helper).not.toContain('`')
    expect(helper).not.toContain('${')
    expect(() => parse(helper, { sourceType: 'script' })).not.toThrow()
  })

  it('leaves a plain column to the ordinary branches', () => {
    expect(runHelper('teleport_products', 'brand', '=', 'Acme').clause).toBeNull()
    expect(runHelper('teleport_products', 'brand', '=', ['Acme', 'Globex']).clause).toBeNull()
  })

  it('filters price on what customers pay today, like the price sort', () => {
    const { clause, params } = runHelper('teleport_products', 'price', '<=', '50')
    expect(clause).toBe(`(${buildProductEffectivePriceSql()}) <= $1`)
    expect(params).toEqual(['50'])
  })

  it('answers a star bucket over approved reviews only', () => {
    const sql = buildProductRatingBucketSql()
    expect(sql).toContain("r.status = 'approved'")
    expect(sql).toContain('ROUND(AVG(r.rating))')
    expect(sql).toContain('r.product_id = teleport_products.id')

    const { clause, params } = runHelper('teleport_products', PRODUCT_RATING_FILTER_FIELD, '=', [
      '4',
      '5',
    ])
    expect(clause).toBe(`${sql}::text = ANY($1::text[])`)
    expect(params).toEqual([['4', '5']])
  })

  it('reads the on-sale flag off the effective price', () => {
    const sql = buildProductOnSaleSql()
    expect(sql).toContain(`< "price"::numeric THEN 'true' ELSE 'false'`)
    const { clause, params } = runHelper(
      'teleport_products',
      PRODUCT_ON_SALE_FILTER_FIELD,
      '=',
      'true'
    )
    expect(clause).toBe(`${sql} = $1`)
    expect(params).toEqual(['true'])
  })

  it('binds the axis key and the values, never interpolating them', () => {
    const { clause, params } = runHelper(
      'teleport_products',
      `${PRODUCT_VARIANT_AXIS_FILTER_PREFIX}size`,
      '=',
      ['xl', 'l']
    )
    expect(clause).toBe(buildProductVariantAxisExistsSql('$1', '$2'))
    expect(clause).toContain("ax->>'key' = $1")
    expect(clause).toContain("v->>'value' = ANY($2::text[])")
    expect(params).toEqual(['size', ['xl', 'l']])
  })

  it('casts the JSON column only when it already looks like an array', () => {
    const sql = buildProductVariantAxisExistsSql('$1', '$2')
    expect(sql).toContain(`btrim("variant_options") NOT LIKE '[%'`)
    expect(sql).toContain(`jsonb_typeof(ax->'values') = 'array'`)
  })

  it('refuses an axis key the editor could never have written', () => {
    expect(new RegExp(PRODUCT_VARIANT_AXIS_KEY_PATTERN).test('size')).toBe(true)
    expect(new RegExp(PRODUCT_VARIANT_AXIS_KEY_PATTERN).test('shoe-size_2')).toBe(true)
    expect(new RegExp(PRODUCT_VARIANT_AXIS_KEY_PATTERN).test(`x' OR 1=1 --`)).toBe(false)
    const { clause, params } = runHelper(
      'teleport_products',
      `${PRODUCT_VARIANT_AXIS_FILTER_PREFIX}x' OR 1=1 --`,
      '=',
      ['a']
    )
    expect(clause).toBe('FALSE')
    expect(params).toEqual([])
  })

  it('never lets a virtual field fall into a column branch', () => {
    // A `>` on the on-sale flag has no meaning; the fallthrough would emit
    // `on_sale > $1` and fail the whole query.
    expect(runHelper('teleport_products', PRODUCT_ON_SALE_FILTER_FIELD, '>', 'x').clause).toBe(
      'FALSE'
    )
    expect(
      runHelper('teleport_products', `${PRODUCT_VARIANT_AXIS_FILTER_PREFIX}size`, '>', ['xl'])
        .clause
    ).toBe('FALSE')
  })
})

describe('normalizeInOperand', () => {
  it('turns "in" into "=" over an array, so every fetcher answers IN (...)', () => {
    expect(runNormalize('in', 'a, b,,c')).toEqual({ operand: '=', value: ['a', 'b', 'c'] })
    expect(runNormalize('in', ['a', 'b,c', 4])).toEqual({ operand: '=', value: ['a', 'b', 'c', 4] })
  })

  it('reads an empty set as "no filter"', () => {
    expect(runNormalize('in', '')).toBeNull()
    expect(runNormalize('in', [])).toBeNull()
    expect(runNormalize('in', ' , ')).toBeNull()
  })

  it('passes every other operand through untouched', () => {
    expect(runNormalize('=', 'a,b')).toEqual({ operand: '=', value: 'a,b' })
    expect(runNormalize('array_overlap', 'a,b')).toEqual({ operand: 'array_overlap', value: 'a,b' })
  })
})

describe('the generated routes', () => {
  it('answer the virtual fields before any raw-field branch, in the fetcher a store uses', () => {
    // Through the type dispatch, not one fetcher's export: `teleport_products`
    // is a Teleport-hosted table, and the discount sort once shipped into the
    // wrong fetcher with every test green.
    const route = generateDataSourceFetcher({ type: 'teleport', config: {} }, 'teleport_products')
    expect(route).toContain('function productFilterClause(field, operand, value, pushParam)')
    const conditionAt = route.indexOf('const buildCondition = (condition) =>')
    const hookAt = route.indexOf('const productClause = productFilterClause(', conditionAt)
    const arrayBranchAt = route.indexOf('if (Array.isArray(value))', conditionAt)
    expect(conditionAt).toBeGreaterThan(-1)
    expect(hookAt).toBeGreaterThan(conditionAt)
    expect(arrayBranchAt).toBeGreaterThan(hookAt)
    expect(route).toContain('normalizeInOperand(condition.operand, condition.destination)')
    expect(() => parse(route, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('embed the helper in the Postgres route too, and parse', () => {
    const route = generatePostgreSQLFetcher(PG_CONFIG, 'teleport_products')
    expect(route).toContain('const productClause = productFilterClause(')
    expect(() => parse(route, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('give every other SQL fetcher the "in" normalisation, and nothing else', () => {
    const route = generateMySQLFetcher({ host: 'h' }, 'orders')
    expect(route).toContain('normalizeInOperand(condition.operand, condition.destination)')
    expect(route).not.toContain('productFilterClause')
    expect(() => parse(route, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('keep a non-products Teleport table on the ordinary branches', () => {
    const route = generateTeleportFetcher({}, 'teleport_orders')
    expect(route).toContain('function productFilterClause() {')
    expect(route).not.toContain('jsonb_array_elements(CASE')
    expect(() => parse(route, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })
})

describe('the SQL mirrored into database-provider-worker', () => {
  // `database-provider-worker/src/lib/__tests__/product-filter-sql.fixture.json`
  // is a copy of this file. Both repos pin their builders to it, so the canvas
  // and the generated store can never disagree about what a filter means.
  const fixture = JSON.parse(
    readFileSync(join(__dirname, 'product-filter-sql.fixture.json'), 'utf8')
  ) as Record<string, string>

  it('matches the shared fixture byte for byte', () => {
    expect(buildProductEffectivePriceSql()).toBe(fixture.effectivePrice)
    expect(buildProductRatingBucketSql()).toBe(fixture.ratingBucket)
    expect(buildProductOnSaleSql()).toBe(fixture.onSale)
    expect(buildProductVariantAxisExistsSql('__KEY__', '__VALUES__')).toBe(
      fixture.variantAxisExists
    )
    expect(PRODUCT_VARIANT_AXIS_KEY_PATTERN).toBe(fixture.axisKeyPattern)
  })
})
