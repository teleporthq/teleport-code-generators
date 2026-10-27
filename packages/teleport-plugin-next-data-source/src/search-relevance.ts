/**
 * How a list's search box narrows and orders the rows of a generated route.
 *
 * Every typed word must appear in one of the searched columns, so "create
 * form" finds "How to create a form". The matches are then ordered by where
 * the words are: a row ranks by the first searched column, in the order the
 * list searches them, that holds every word (a title match before a summary
 * match before a body match), and a row whose words are spread over several
 * columns comes after all of those. The list's own sort orders the rows
 * within each of those groups.
 */

/** `searchWords(query)`: the typed words, lowercased, each once. */
export const generateSearchWordsCode = (): string => `const searchWords = (query) => {
  const words = []
  String(query == null ? '' : query).toLowerCase().split(/\\s+/).forEach((word) => {
    if (word && words.indexOf(word) === -1) words.push(word)
  })
  return words
}`

/**
 * `buildSearchSql(query, columns, firstIndex)` for the SQL routes:
 * `{ where, params, rank, rankParams, nextIndex }`, or null when there is
 * nothing to search. `matchSql` is the dialect's case-insensitive substring
 * test, `(column, placeholder) => sql`. With `firstIndex` the placeholders are
 * numbered (`$n`) and each word's pattern is bound once, the rank reusing it;
 * without it they are positional (`?`), every occurrence binds its own copy,
 * and `rankParams` go after the parameters of the whole WHERE, as the ORDER BY
 * comes after it. `rank` is '' with fewer than two columns.
 *
 * Uses `escapeLikePattern` and `sanitizeSearchIdentifier`
 * (`generateSearchEscapeHelpersCode`).
 */
export const generateSearchSqlHelpersCode = (
  matchSql: string
): string => `${generateSearchWordsCode()}
const searchMatchSql = ${matchSql}
const buildSearchSql = (query, columns, firstIndex) => {
  const words = searchWords(query)
  const searched = []
  ;(Array.isArray(columns) ? columns : []).forEach((column) => {
    const name = sanitizeSearchIdentifier(column)
    if (searched.indexOf(name) === -1) searched.push(name)
  })
  if (words.length === 0 || searched.length === 0) return null
  const patterns = words.map((word) => '%' + escapeLikePattern(word) + '%')
  const numbered = typeof firstIndex === 'number'
  const params = numbered ? patterns.slice() : []
  const rankParams = []
  const placeholder = (wordIndex, bound) => {
    if (numbered) return '$' + (firstIndex + wordIndex)
    bound.push(patterns[wordIndex])
    return '?'
  }
  const where = '(' + patterns.map((pattern, wordIndex) =>
    '(' + searched.map((column) => searchMatchSql(column, placeholder(wordIndex, params))).join(' OR ') + ')'
  ).join(' AND ') + ')'
  const rank = searched.length < 2 ? '' : 'CASE ' + searched.map((column, position) =>
    'WHEN ' + patterns.map((pattern, wordIndex) => searchMatchSql(column, placeholder(wordIndex, rankParams))).join(' AND ') + ' THEN ' + position
  ).join(' ') + ' ELSE ' + searched.length + ' END'
  return { where, params, rank, rankParams, nextIndex: numbered ? firstIndex + patterns.length : firstIndex }
}`

/**
 * `rankBySearch(rows, query, columns, valueOf)` for the routes that search
 * rows in memory: the same order as the SQL routes' rank, applied after the
 * list's sort (a stable sort keeps it within each group) and before the page
 * is cut.
 */
export const generateSearchRankHelperCode = (): string => `${generateSearchWordsCode()}
const rankBySearch = (rows, query, columns, valueOf) => {
  const words = searchWords(query)
  if (!Array.isArray(columns) || columns.length < 2 || words.length === 0) return rows
  const tierOf = (row) => {
    for (let position = 0; position < columns.length; position++) {
      const value = valueOf(row, columns[position])
      const text = value === null || value === undefined ? '' : String(value).toLowerCase()
      if (words.every((word) => text.includes(word))) return position
    }
    return columns.length
  }
  return rows
    .map((row, index) => ({ row, index, tier: tierOf(row) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((entry) => entry.row)
}`

/** Each dialect's case-insensitive substring match, for `generateSearchSqlHelpersCode`. */
export const PG_SEARCH_MATCH_SQL = `(column, placeholder) => '"' + column + '"::text ILIKE ' + placeholder + " ESCAPE '|'"`

export const MYSQL_SEARCH_MATCH_SQL = `(column, placeholder) => 'LOWER(CAST(' + mysql.escapeId(column) + ' AS CHAR)) LIKE LOWER(' + placeholder + ") ESCAPE '|'"`

export const MARIADB_SEARCH_MATCH_SQL = `(column, placeholder) => 'LOWER(CAST(\`' + column + '\` AS CHAR)) LIKE LOWER(' + placeholder + ") ESCAPE '|'"`

export const SQLITE_SEARCH_MATCH_SQL = `(column, placeholder) => 'LOWER(CAST("' + column + '" AS TEXT)) LIKE LOWER(' + placeholder + ") ESCAPE '|'"`
