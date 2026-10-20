import { isListingTableWithId } from './list-sort-order'

interface ColumnLike {
  name?: unknown
  isPrimaryKey?: unknown
}

/**
 * The column that tells a table's rows apart, read from the table the project
 * saved: its primary key, else a column named `id`. The platform listing
 * tables (products, blog posts, booking items) have `id` from their first
 * migration. Null when neither is known — then nothing is added,
 * rather than a column that may not exist.
 */
export const rowIdentityColumn = (
  config: Record<string, unknown>,
  tableName: string
): string | null => {
  const selectedTables = (config as { selectedTables?: Record<string, { columns?: unknown }> })
    .selectedTables
  const saved = selectedTables?.[tableName]?.columns
  const columns = (Array.isArray(saved) ? (saved as ColumnLike[]) : []).filter(
    (column) => typeof column?.name === 'string'
  )
  const key =
    columns.find((column) => column.isPrimaryKey === true)?.name ??
    columns.find((column) => column.name === 'id')?.name
  if (typeof key === 'string') {
    return key
  }
  return isListingTableWithId(tableName) ? 'id' : null
}

/**
 * The `rowOrderTiebreak(fields, direction)` helper a SQL fetcher embeds: what
 * ends an ORDER BY so that it orders every row.
 *
 * Rows that share every requested key have no order of their own, and the
 * database deals them out differently for each page — "sort by discount" ties
 * every undiscounted product at zero, and an import dates hundreds of articles
 * alike — so a paginated list repeated some rows and never showed others.
 * The tie follows the last key's direction, as the editor's canvas does.
 */
export const generateRowOrderTiebreakHelper = (identityColumn: string | null): string => {
  if (!identityColumn) {
    return "const rowOrderTiebreak = () => ''"
  }
  const quoted = `"${identityColumn.replace(/"/g, '""')}"`
  return [
    'const rowOrderTiebreak = (fields, direction) =>',
    `  fields.includes(${JSON.stringify(identityColumn)}) ? '' : ${JSON.stringify(
      `, ${quoted} `
    )} + direction`,
  ].join('\n')
}
