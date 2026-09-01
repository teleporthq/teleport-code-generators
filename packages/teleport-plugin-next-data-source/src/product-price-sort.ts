/**
 * Ordering a products list by the price customers actually pay.
 *
 * A per-product discount is a SCHEDULED VIEW of the price: `teleport_products.
 * price` holds the list price and never moves, while `teleport_products.
 * discounts` holds a JSON array of markdowns with `[startsAt, endsAt)` windows.
 * Every display surface resolves that at read time.
 *
 * Sorting is the one surface that cannot, because it happens in SQL before the
 * rows ever reach JavaScript — and the list is paginated, so re-sorting the
 * fetched page would only reorder 20 of N products. The ordering therefore has
 * to be computed by the database, which is what this expression does: an inline
 * scalar sub-select over the JSON column, evaluated per query against `now()`.
 *
 * Deliberately NOT a stored column. A materialised "effective price" is correct
 * only until a schedule boundary passes with nobody writing that row, and
 * keeping it fresh needs a job no generated store has.
 *
 * ## The expression cannot raise
 *
 * It runs inside `ORDER BY` for the whole products table, so one unparseable
 * row would fail the entire query and empty the page. Every cast is therefore
 * guarded:
 *
 * - the JSON cast only happens for text that already looks like an array;
 * - `value` is cast only when it matches a bare decimal;
 * - the window bounds are compared as TEXT, never cast to a timestamp. The
 *   editor writes them with `toISOString()`, whose fixed-width UTC format
 *   (`YYYY-MM-DDTHH:MM:SS.sssZ`) sorts lexicographically in the same order it
 *   sorts chronologically.
 *
 * The caller adds a second net: a query using this expression falls back to a
 * plain column sort if the database rejects it, so an unforeseen shape degrades
 * to the previous ordering rather than to a broken page.
 */

/** The e-commerce products table — the only table this ordering applies to. */
export const PRODUCTS_TABLE_NAME = 'teleport_products'

/** The sort field the storefront's "Price (low to high / high to low)" emits. */
export const PRODUCT_PRICE_SORT_FIELD = 'price'

/**
 * The sort field the storefront's "Discount (low to high / high to low)" emits.
 *
 * Deliberately the name of a REAL column rather than a virtual one like
 * `discount`. The same field travels to sixteen different fetchers and to the
 * editor's own data API, none of which know about this rewrite — and a name
 * that is not a column becomes `ORDER BY discount` and fails the whole query.
 * Using the column the markdowns are stored in means the worst any unaware
 * backend can do is order by the raw JSON: arbitrary, but never an error.
 */
export const PRODUCT_DISCOUNT_SORT_FIELD = 'discounts'

/**
 * The column a rewritten sort falls back to when the expression cannot run —
 * guaranteed to exist on the products table, which `discounts` itself is not on
 * a store provisioned before discounts shipped.
 */
export const PRODUCT_SORT_FALLBACK_COLUMN = 'price'

/**
 * `now()` as the same fixed-width UTC string the editor stores its bounds in,
 * so the window comparison is pure text and can never raise on a bad date.
 */
const NOW_AS_ISO_TEXT = `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

/**
 * Only text that already looks like a JSON array is cast; anything else — NULL,
 * empty, or a hand-edited scalar — reads as "no discounts".
 */
const SAFE_DISCOUNTS_JSONB = `CASE
        WHEN "discounts" IS NULL OR btrim("discounts") NOT LIKE '[%' THEN '[]'::jsonb
        ELSE "discounts"::jsonb
      END`

/**
 * The price a product sells for right now, for use in an `ORDER BY` over
 * `teleport_products`. Falls back to the list price when no markdown is live.
 *
 * Mirrors `resolveActiveDiscount` + `computeDiscountedPrice`: the FIRST live
 * entry in array order wins (hence `WITH ORDINALITY` and `ORDER BY ord`),
 * unknown types and non-positive values are ignored, a percentage is capped at
 * 100, and the result is floored at zero and rounded to the cent.
 */
export const buildProductEffectivePriceSql = (): string =>
  `COALESCE((
    SELECT ROUND(GREATEST(0,
      CASE
        WHEN entry.kind = 'percentage'
          THEN "price"::numeric * (1 - LEAST(entry.amount, 100) / 100)
        ELSE "price"::numeric - entry.amount
      END
    ), 2)
    FROM (
      SELECT
        d.value->>'type' AS kind,
        CASE
          WHEN d.value->>'value' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (d.value->>'value')::numeric
          ELSE 0
        END AS amount,
        d.value->>'startsAt' AS starts_at,
        d.value->>'endsAt' AS ends_at,
        d.ord AS ord
      FROM jsonb_array_elements(${SAFE_DISCOUNTS_JSONB}) WITH ORDINALITY AS d(value, ord)
    ) AS entry
    WHERE entry.amount > 0
      AND entry.kind IN ('percentage', 'fixed')
      AND (entry.starts_at IS NULL OR entry.starts_at <= ${NOW_AS_ISO_TEXT})
      AND (entry.ends_at IS NULL OR entry.ends_at > ${NOW_AS_ISO_TEXT})
    ORDER BY entry.ord
    LIMIT 1
  ), "price"::numeric)`

/**
 * How much a product is marked down RIGHT NOW, as a percentage of its list
 * price — the metric "sort by discount" means.
 *
 * A percentage rather than an absolute saving, because it is the only figure
 * comparable across a mixed catalogue: $20 off a $2000 sofa is a worse deal
 * than $5 off a $10 mug, and sorting by the absolute amount would rank them the
 * other way round.
 *
 * Zero when nothing is live, so undiscounted products collect at one end
 * instead of scattering. `price > 0` is the divide-by-zero guard AND the NULL
 * guard — `NULL > 0` is NULL, which is not true, so a priceless row takes the
 * ELSE branch.
 */
export const buildProductDiscountPercentageSql = (): string =>
  `CASE
    WHEN "price"::numeric > 0
      THEN ROUND(((("price"::numeric - ${buildProductEffectivePriceSql()}) / "price"::numeric) * 100), 4)
    ELSE 0
  END`

/** Whether a generated fetcher for `tableName` should order prices by the markdown. */
export const supportsProductPriceSort = (tableName: string): boolean =>
  tableName === PRODUCTS_TABLE_NAME

/**
 * The complete `sortFieldSql` helper a SQL fetcher embeds in its generated
 * route.
 *
 * Returned as one ready-made string, and the SQL is emitted through
 * `JSON.stringify` — a double-quoted JS literal carries no backticks and no
 * `${`, so it can be interpolated into a fetcher's template literal without any
 * nested-escaping hazard. (Emitting it inline is how this first went wrong: a
 * backtick inside an explanatory comment closed the enclosing template.)
 *
 * On a table that is not the products table the helper still exists but is the
 * identity, so a fetcher can embed it unconditionally.
 */
export const generateSortFieldSqlHelper = (tableName: string): string => {
  const branches = supportsProductPriceSort(tableName)
    ? [
        `  if (field === ${JSON.stringify(PRODUCT_PRICE_SORT_FIELD)}) {`,
        `    return ${JSON.stringify(buildProductEffectivePriceSql())}`,
        `  }`,
        `  if (field === ${JSON.stringify(PRODUCT_DISCOUNT_SORT_FIELD)}) {`,
        `    return ${JSON.stringify(buildProductDiscountPercentageSql())}`,
        `  }`,
      ].join('\n') + '\n'
    : ''

  return [
    '// Maps a requested sort field to the SQL that orders by it. Only the',
    "// products table's price and discounts are rewritten - into the price",
    '// customers actually pay today, and into how far each product is marked',
    '// down. Every other field is passed through, so this can never change an',
    '// unrelated sort.',
    'function sortFieldSql(field) {',
    branches + '  return field',
    '}',
  ].join('\n')
}

/**
 * The plain-column ORDER BY used when the rewritten expression cannot run.
 *
 * Both rewritten fields fall back to `price`, never to themselves: `discounts`
 * is the JSON column, and ordering a page by raw JSON is meaningless — while a
 * store provisioned before discounts shipped has no such column at all, so
 * retrying with it would fail exactly like the expression did.
 */
export const generateSortFallbackFieldHelper = (tableName: string): string => {
  const branches = supportsProductPriceSort(tableName)
    ? `  if (field === ${JSON.stringify(PRODUCT_PRICE_SORT_FIELD)} || field === ${JSON.stringify(
        PRODUCT_DISCOUNT_SORT_FIELD
      )}) {\n    return ${JSON.stringify(PRODUCT_SORT_FALLBACK_COLUMN)}\n  }\n`
    : ''

  return ['function sortFallbackField(field) {', branches + '  return field', '}'].join('\n')
}

/**
 * A deterministic tiebreaker appended to every products ORDER BY.
 *
 * Without one, a paginated sort with ties — and "sort by discount" ties every
 * undiscounted product at zero — has no defined order between equal rows, so
 * the same product can appear on two pages or on none. `id` is on the products
 * table from its first migration.
 */
export const generateSortTiebreakSql = (tableName: string): string =>
  supportsProductPriceSort(tableName) ? ', "id" ASC' : ''
