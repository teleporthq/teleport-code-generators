/**
 * Filtering a products list on things that are not a plain column.
 *
 * The storefront's product filters ask questions the `teleport_products` row
 * cannot answer with a single column comparison: "what does it cost right now"
 * (`price` net of a live markdown), "how many stars" (an aggregate over the
 * reviews table), "is it on sale", and "does it come in size XL" (a value
 * inside the `variant_options` JSON). Like the discount-aware sort in
 * `product-price-sort.ts`, these have to be answered by the DATABASE — the list
 * is paginated, so filtering the fetched page would only filter 20 of N rows.
 *
 * The editor emits such a filter as an ordinary condition whose `source` is
 * one of the VIRTUAL field names below. Every SQL builder that can receive a
 * products filter rewrites them into the expressions here:
 *
 *   - this file → the generated store's `teleport_products` API route
 *     (`fetchers/teleport.ts`, `fetchers/postgresql.ts`);
 *   - `database-provider-worker/src/lib/product-filter-fields.ts` → the editor
 *     canvas. ⛔ A byte-for-byte mirror of the SQL below; both repos pin the
 *     strings with a test, because a clause the canvas cannot build is an HTTP
 *     500 the canvas draws as an EMPTY grid.
 *
 * ## The expressions cannot raise
 *
 * Same discipline as the sort: the JSON column is cast only when its text
 * already looks like an array, the axis key is validated against a slug pattern
 * before it is bound, and an unknown key filters to no rows instead of erroring
 * — a filter that the database rejects would empty the whole products page.
 */

import {
  PRODUCTS_TABLE_NAME,
  PRODUCT_PRICE_SORT_FIELD,
  buildProductEffectivePriceSql,
  supportsProductPriceSort,
} from './product-price-sort'

/** The reviews table the star-rating aggregate reads. Exists once reviews were enabled. */
export const PRODUCT_REVIEWS_TABLE_NAME = 'teleport_product_reviews'

/** Virtual field: the product's star bucket — `ROUND(AVG(approved rating))`, 1..5, NULL when unreviewed. */
export const PRODUCT_RATING_FILTER_FIELD = 'rating'

/** Virtual field: `'true'` while a markdown is live, else `'false'`. */
export const PRODUCT_ON_SALE_FILTER_FIELD = 'on_sale'

/**
 * Virtual field family: `variant_options.<axisKey>` — the product offers the
 * axis (e.g. `size`) in one of the given values (e.g. `xl`).
 */
export const PRODUCT_VARIANT_AXIS_FILTER_PREFIX = 'variant_options.'

/**
 * What an axis key may look like. Keys are produced by the editor's slug
 * helper (`deriveOptionKey`), so this is what every real key matches; anything
 * else is refused before it can reach the database.
 */
export const PRODUCT_VARIANT_AXIS_KEY_PATTERN = '^[a-z0-9][a-z0-9_-]{0,63}$'

/** Generic multi-value operand: the column equals ANY of the destination values. */
export const IN_OPERAND = 'in'

/**
 * `ROUND(AVG(rating))` over the product's APPROVED reviews. Only approved rows
 * count — moderation is the merchant's veto — and the outer row is the
 * unaliased `teleport_products` the fetchers select from.
 */
export const buildProductRatingBucketSql = (): string =>
  `(SELECT ROUND(AVG(r.rating)) FROM ${PRODUCT_REVIEWS_TABLE_NAME} r WHERE r.product_id = ${PRODUCTS_TABLE_NAME}.id AND r.status = 'approved' AND r.rating IS NOT NULL)`

/** `'true'` when the price paid today is below the list price, i.e. a markdown is live. */
export const buildProductOnSaleSql = (): string =>
  `(CASE WHEN ${buildProductEffectivePriceSql()} < "price"::numeric THEN 'true' ELSE 'false' END)`

/**
 * Only text that already looks like a JSON array is cast; NULL, empty or a
 * hand-edited scalar reads as "no variant axes".
 */
export const SAFE_VARIANT_OPTIONS_JSONB = `CASE
        WHEN "variant_options" IS NULL OR btrim("variant_options") NOT LIKE '[%' THEN '[]'::jsonb
        ELSE "variant_options"::jsonb
      END`

/**
 * True when the product declares the axis bound to `keyParam` with at least one
 * of the values bound to `valuesParam` (a `text[]`). Both are PARAMETERS, never
 * interpolated text.
 */
export const buildProductVariantAxisExistsSql = (keyParam: string, valuesParam: string): string =>
  `EXISTS (SELECT 1 FROM jsonb_array_elements(${SAFE_VARIANT_OPTIONS_JSONB}) AS ax, jsonb_array_elements(CASE WHEN jsonb_typeof(ax->'values') = 'array' THEN ax->'values' ELSE '[]'::jsonb END) AS v WHERE ax->>'key' = ${keyParam} AND v->>'value' = ANY(${valuesParam}::text[]))`

/**
 * The complete `productFilterClause(field, operand, value, pushParam)` helper a
 * SQL fetcher embeds in its generated route.
 *
 * Returns a finished WHERE clause for a virtual (or rewritten) products field,
 * or `null` for anything else so the fetcher's ordinary branches run. `pushParam`
 * binds a value and answers its `$n` placeholder. By the time it is called an
 * `in` filter has been normalised to `=` with an ARRAY value (see
 * `normalizeInOperand` in `utils.ts`), which reads as "any of". A virtual field
 * never answers `null` once matched — an operand it cannot express filters to
 * no rows rather than falling into a branch that would name a column the table
 * does not have.
 *
 * Emitted through `JSON.stringify` and string concatenation only — no backtick
 * and no `${` may appear in the output, which is interpolated into a fetcher's
 * template literal. On a table that is not the products table the helper still
 * exists and always answers `null`, so a fetcher can embed it unconditionally.
 */
export const generateProductFilterClauseHelper = (tableName: string): string => {
  if (!supportsProductPriceSort(tableName)) {
    return [
      '// Virtual products-table filter fields. This table has none, so every',
      "// condition takes the fetcher's ordinary branches.",
      'function productFilterClause() {',
      '  return null',
      '}',
    ].join('\n')
  }

  const lines = [
    "// Rewrites the products table's virtual filter fields - the price paid",
    '// today, the star-rating bucket, the on-sale flag and a variant axis - into',
    '// SQL. Answers null for a plain column so the ordinary branches run. An',
    '// "in" filter arrives here already normalised to "=" with an ARRAY value.',
    'function productFilterClause(field, operand, value, pushParam) {',
    "  var scalarOps = ['=', '!=', '>', '<', '>=', '<=']",
    "  var equalityOps = ['=', '!=']",
    '  var compare = function (expression, allowedOps, virtual) {',
    '    if (Array.isArray(value)) {',
    "      if (operand === '=') {",
    "        return expression + '::text = ANY(' + pushParam(value.map(String)) + '::text[])'",
    '      }',
    "      if (operand === '!=') {",
    "        return expression + '::text <> ALL(' + pushParam(value.map(String)) + '::text[])'",
    '      }',
    "      return virtual ? 'FALSE' : null",
    '    }',
    "    if (allowedOps.indexOf(operand) === -1) return virtual ? 'FALSE' : null",
    "    return expression + ' ' + operand + ' ' + pushParam(value)",
    '  }',
    `  if (field === ${JSON.stringify(PRODUCT_PRICE_SORT_FIELD)}) {`,
    `    return compare(${JSON.stringify(
      '(' + buildProductEffectivePriceSql() + ')'
    )}, scalarOps, false)`,
    '  }',
    `  if (field === ${JSON.stringify(PRODUCT_RATING_FILTER_FIELD)}) {`,
    `    return compare(${JSON.stringify(buildProductRatingBucketSql())}, scalarOps, true)`,
    '  }',
    `  if (field === ${JSON.stringify(PRODUCT_ON_SALE_FILTER_FIELD)}) {`,
    `    return compare(${JSON.stringify(buildProductOnSaleSql())}, equalityOps, true)`,
    '  }',
    `  if (field.indexOf(${JSON.stringify(PRODUCT_VARIANT_AXIS_FILTER_PREFIX)}) === 0) {`,
    `    var axisKey = field.slice(${PRODUCT_VARIANT_AXIS_FILTER_PREFIX.length})`,
    `    if (!new RegExp(${JSON.stringify(PRODUCT_VARIANT_AXIS_KEY_PATTERN)}).test(axisKey)) {`,
    '      // Not a key the editor could have written: no rows, never an error.',
    "      return 'FALSE'",
    '    }',
    "    if (operand !== '=') return 'FALSE'",
    '    var values = (Array.isArray(value) ? value : [value]).map(String)',
    '    var keyParam = pushParam(axisKey)',
    '    var valuesParam = pushParam(values)',
    `    return ${JSON.stringify(buildProductVariantAxisExistsSql('__KEY__', '__VALUES__'))}`,
    // Function replacements: a "$1" inside a replacement STRING is a special
    // pattern, so the placeholders are swapped by callback.
    "      .replace('__KEY__', function () { return keyParam })",
    "      .replace('__VALUES__', function () { return valuesParam })",
    '  }',
    '  return null',
    '}',
  ]
  return lines.join('\n')
}
