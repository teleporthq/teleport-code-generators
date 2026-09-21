/**
 * Filtering and sorting a translatable column in the visitor's language.
 *
 * A translatable column of a platform table exists once per language:
 * `slug` holds the main language and `es_slug` the Spanish copy (see
 * `ContentLocalization`). The row transform resolves what a page DISPLAYS —
 * a Spanish listing shows `es_name` and links to `es_slug` — but the SQL a
 * fetch runs still names the base column, so without this file:
 *
 *   - the details page a Spanish card links to (`/es/products/<es_slug>`)
 *     looks the row up with `slug = $1` and answers 404;
 *   - "sort by name" on the Spanish listing orders the Spanish names by
 *     their ENGLISH counterparts.
 *
 * The teleport fetcher (`fetchers/teleport.ts`) therefore embeds the helper
 * emitted here:
 *
 *   - equality on a translatable column matches the value in ANY language:
 *     `("slug" = $1 OR "es_slug" = $1)`. Deliberately every language, not the
 *     request's: the language switcher keeps the URL and changes the locale,
 *     so `/products/<es_slug>` (English page, Spanish slug) has to resolve as
 *     well as `/es/products/<slug>`. Only `=` (and the `in` it is normalised
 *     to) — a translatable column is never compared with `<`, and `!=` on one
 *     has no sensible cross-language reading;
 *   - ordering by a translatable column orders by the REQUEST's language,
 *     falling back to the base column exactly like the transform does:
 *     `COALESCE(NULLIF("es_name", ''), "name")`.
 *
 * Which columns take part is decided at GENERATION time from the table's
 * schema and the project's languages — never by prefix-sniffing column names,
 * which would mistake `og_title` for a translation. A copy the schema does not
 * list (a language added before a column became translatable) is simply not
 * referenced, so the SQL can only ever name columns that exist.
 */

import type { ContentLocalization } from './content-localization'

/**
 * Base column → `{ locale: copy column }`, for every translatable column of a
 * table that has at least one per-language copy in the schema.
 */
export type LocalizedColumnMap = Record<string, Record<string, string>>

/** The only identifiers the generated SQL is allowed to quote — same rule as the search columns. */
const SQL_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** The column holding `column` in `locale` — the editor's `getI18nColumnName`. */
const localizedColumnName = (locale: string, column: string): string => `${locale}_${column}`

/**
 * Pairs every column with the per-language copies the schema actually holds.
 * Empty (no families) when the project has one language or the table has no
 * translated column — the emitted helper is then inert.
 */
export const collectLocalizedColumns = (
  columnNames: string[],
  localization: ContentLocalization | undefined
): LocalizedColumnMap => {
  const families: LocalizedColumnMap = {}
  if (!localization || localization.secondaryLocales.length === 0) {
    return families
  }
  const present = new Set(columnNames.filter((name) => SQL_IDENTIFIER_PATTERN.test(name)))
  present.forEach((column) => {
    localization.secondaryLocales.forEach((locale) => {
      const copy = localizedColumnName(locale, column)
      if (!present.has(copy)) {
        return
      }
      if (!families[column]) {
        families[column] = {}
      }
      families[column][locale] = copy
    })
  })
  return families
}

/**
 * The `localizedEqualityClause` / `localizedSortFieldSql` helpers a fetcher
 * embeds, with the column map baked in.
 *
 * Emitted as plain source with no backtick and no `${`, because the fetcher
 * interpolates it into a template literal. Every identifier it quotes comes
 * from the baked map, so a request can only ever name a column the schema had.
 */
export const generateLocalizedColumnsHelper = (families: LocalizedColumnMap): string => {
  const lines = [
    '// Per-language copies of the translatable columns, base column -> locale -> copy.',
    '// Baked from the table schema and the project languages at generation time.',
    `var LOCALIZED_COLUMNS = ${JSON.stringify(families)}`,
    '',
    'function quoteLocalizedColumn(column) {',
    "  return '\"' + column + '\"'",
    '}',
    '',
    '// Equality on a translatable column matches the value in ANY language, so a',
    '// localized slug resolves whichever locale the URL is under. Answers null',
    '// for every other column and operand, leaving them to the ordinary branches.',
    'function localizedEqualityClause(field, operand, value, pushParam) {',
    '  var copies = LOCALIZED_COLUMNS[field]',
    "  if (!copies || operand !== '=' || value === null || value === undefined) return null",
    '  // An empty set means "no filter", as it does in the ordinary array branch.',
    '  if (Array.isArray(value) && value.length === 0) return null',
    '  var columns = [field]',
    '  for (var locale in copies) {',
    '    if (Object.prototype.hasOwnProperty.call(copies, locale)) columns.push(copies[locale])',
    '  }',
    '  var param = Array.isArray(value) ? pushParam(value.map(String)) : pushParam(value)',
    '  var clauses = []',
    '  for (var i = 0; i < columns.length; i++) {',
    '    clauses.push(',
    '      Array.isArray(value)',
    "        ? quoteLocalizedColumn(columns[i]) + '::text = ANY(' + param + '::text[])'",
    "        : quoteLocalizedColumn(columns[i]) + ' = ' + param",
    '    )',
    '  }',
    "  return '(' + clauses.join(' OR ') + ')'",
    '}',
    '',
    "// ORDER BY a translatable column in the request's language, falling back to",
    '// the base column for a row with no translation — the same resolution the',
    '// row transform applies to what is displayed. Null when the field or the',
    '// locale has no copy, so the ordinary sort runs.',
    'function localizedSortFieldSql(field, locale) {',
    '  var copies = LOCALIZED_COLUMNS[field]',
    "  var copy = copies && typeof locale === 'string' ? copies[locale] : null",
    '  if (!copy) return null',
    "  return 'COALESCE(NULLIF(' + quoteLocalizedColumn(copy) + \", ''), \" + quoteLocalizedColumn(field) + ')'",
    '}',
  ]
  return lines.join('\n')
}
