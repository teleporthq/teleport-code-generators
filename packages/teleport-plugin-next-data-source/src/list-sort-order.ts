import { PRODUCTS_TABLE_NAME } from './product-price-sort'

/**
 * How a generated list route orders the rows a visitor's sort leaves tied or
 * empty, in the SQL fetchers that serve the platform's listing pages
 * (`teleport.ts`, `postgresql.ts`).
 */

/**
 * The platform tables whose listing pages offer visitors a sort — the
 * products page, the blog listing, the booking page — each with an `id` from
 * its first migration.
 */
const LISTING_TABLES_WITH_ID: ReadonlySet<string> = new Set([
  PRODUCTS_TABLE_NAME,
  'teleport_blog_posts',
  'teleport_booking_items',
])

/**
 * Whether a table is one of those listing tables, so its rows are told apart
 * by `id` even when the project saved no columns for it (see `row-order.ts`).
 */
export const isListingTableWithId = (tableName: string): boolean =>
  LISTING_TABLES_WITH_ID.has(tableName)

/**
 * Appended to every sorted column: a row without a value comes after the
 * rows with one, whichever the direction. PostgreSQL puts NULLs FIRST in a
 * descending order, so "longest read first" opened on the posts without a
 * reading time. Only on the ORDER BY a fetcher tries first — its plain-column
 * fallback leaves it out, for a database that rejects the clause.
 */
export const SORT_NULLS_LAST_SQL = ' NULLS LAST'
