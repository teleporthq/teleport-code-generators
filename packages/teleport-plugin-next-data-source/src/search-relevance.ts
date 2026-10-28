/**
 * How a list's search box narrows and orders the rows of a generated route.
 *
 * The typed text is split into terms at white space, letter case aside, and
 * the punctuation around a term is dropped ("form?" looks for "form",
 * "\"create" for "create"). Every term must appear in one of the searched
 * columns, so "create form" finds "How to create a form".
 *
 * Where the stored text is read the same way as the typed text (the
 * TeleportHQ database and other Postgres sources, and the routes that search
 * rows in memory), punctuation inside a term counts as a space on both sides
 * ("e-commerce" finds "E-Commerce", "what's" finds "what’s"), and HTML tags
 * and entities count as spaces too, so a word that is only in a rich-text
 * body's markup ("strong", "href", "amp") never matches.
 *
 * The matches are ordered column by column, in the order the list searches
 * them: by how much of the typed text the first column (a title) holds, then
 * the second (a summary), and so on. A term counts 3 as a whole word, 2 at
 * the start of a word ("form" in "forms") and 1 inside one ("form" in
 * "platform"). The list's own sort orders the rows that score alike.
 */

/**
 * Characters a search reads as a space: punctuation, and line breaks and
 * tabs, so a word at the end of a line is still a whole word.
 */
export const SEARCH_PUNCTUATION =
  '\t\n\v\f\r!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~\u00a0\u00a1\u00ab\u00b7\u00bb\u00bf' +
  '\u2010\u2011\u2012\u2013\u2014\u2015\u2018\u2019\u201a\u201b\u201c\u201d\u201e\u2022\u2026\u2039\u203a'

/** A JavaScript string literal that survives being pasted into any generated file. */
const jsString = (value: string): string =>
  JSON.stringify(value).replace(
    /[\u007f-\uffff`$]/g,
    (char) => '\\u' + ('0000' + char.charCodeAt(0).toString(16)).slice(-4)
  )

/**
 * One Postgres regular expression, as a string literal, for everything a
 * normalised search reads as a space: a tag, an entity, or one of
 * SEARCH_PUNCTUATION. The bracket expression puts `]` first and `-` last,
 * escapes the backslash, and puts `[` before `-` so it never opens a class.
 * One pass: `translate()` is several times slower over long multibyte text.
 */
const PG_SPACES_REGEX_SQL = `'${(
  '<[^>]*>|&[a-z0-9#]+;|[]' +
  SEARCH_PUNCTUATION.split('')
    .filter((char) => !']-\\['.includes(char))
    .join('') +
  '\\\\[-]'
).replace(/'/g, "''")}'`

/**
 * `searchTerms(query)`: the typed terms, lowercased, each once. `normalised`
 * also reads the punctuation inside a term as a space, for the routes whose
 * stored text is read the same way; otherwise only the punctuation around a
 * term is dropped, so "e-commerce" still finds the raw text "e-commerce".
 */
export const generateSearchTermsCode = (
  normalised: boolean
): string => `const SEARCH_PUNCTUATION = ${jsString(SEARCH_PUNCTUATION)}
const searchPunctuationToSpaces = (text) => {
  let out = ''
  for (const char of text) out += SEARCH_PUNCTUATION.indexOf(char) === -1 ? char : ' '
  return out
}
const searchTerms = (query) => {
  const terms = []
  String(query == null ? '' : query).toLowerCase().split(/\\s+/).forEach((token) => {
    const spaced = searchPunctuationToSpaces(token)
${
  normalised
    ? `    const term = spaced.trim().replace(/\\s+/g, ' ')`
    : `    const start = spaced.length - spaced.trimStart().length
    const term = token.slice(start, start + spaced.trim().length)`
}
    if (term && terms.indexOf(term) === -1) terms.push(term)
  })
  return terms
}`

/**
 * How one SQL dialect reads a column for a search. `textSql` is the source
 * of `(column) => sql`, the column's text as the search reads it: lower case,
 * with a space at each end so a whole word and a word start can be told
 * apart. `likeSql` is the source of `(text, placeholder, before, after) =>
 * sql`, testing `text LIKE before + term + after` with the term bound to the
 * placeholder. `normalised` dialects also read tags, entities and punctuation
 * in the stored text as spaces; `lateral` ones work each column's text out
 * once per row, in a LATERAL subquery the route joins after its table.
 */
export interface SearchSqlDialect {
  textSql: string
  likeSql: string
  normalised: boolean
  lateral: boolean
}

const PG_LIKE_SQL = `(text, placeholder, before, after) => text + " LIKE ('" + before + "' || " + placeholder + "::text || '" + after + "') ESCAPE '|'"`

export const PG_SEARCH_SQL: SearchSqlDialect = {
  textSql: `(column) => "(' ' || regexp_replace(lower(\\"" + column + "\\"::text), " + SEARCH_SPACES_REGEX_SQL + ", ' ', 'g') || ' ')"`,
  likeSql: PG_LIKE_SQL,
  normalised: true,
  lateral: true,
}

export const REDSHIFT_SEARCH_SQL: SearchSqlDialect = {
  textSql: `(column) => "(' ' || lower(\\"" + column + "\\"::text) || ' ')"`,
  likeSql: PG_LIKE_SQL,
  normalised: false,
  lateral: false,
}

const CONCAT_LIKE_SQL = `(text, placeholder, before, after) => text + " LIKE CONCAT('" + before + "', " + placeholder + ", '" + after + "') ESCAPE '|'"`

export const MYSQL_SEARCH_SQL: SearchSqlDialect = {
  textSql: `(column) => "CONCAT(' ', LOWER(CAST(" + mysql.escapeId(column) + " AS CHAR)), ' ')"`,
  likeSql: CONCAT_LIKE_SQL,
  normalised: false,
  lateral: false,
}

export const MARIADB_SEARCH_SQL: SearchSqlDialect = {
  textSql: `(column) => "CONCAT(' ', LOWER(CAST(\\\`" + column + "\\\` AS CHAR)), ' ')"`,
  likeSql: CONCAT_LIKE_SQL,
  normalised: false,
  lateral: false,
}

export const SQLITE_SEARCH_SQL: SearchSqlDialect = {
  textSql: `(column) => "(' ' || LOWER(CAST(\\"" + column + "\\" AS TEXT)) || ' ')"`,
  likeSql: `(text, placeholder, before, after) => text + " LIKE ('" + before + "' || " + placeholder + " || '" + after + "') ESCAPE '|'"`,
  normalised: false,
  lateral: false,
}

/**
 * `buildSearchSql(query, columns, firstIndex)` for the SQL routes:
 * `{ where, params, from, rank, rankParams, nextIndex }`, or null when there
 * is nothing to search. `from` is the LATERAL join a `lateral` dialect's
 * route appends after its table (selecting `table.*`, so the worked-out
 * texts never reach a row), '' otherwise. `rank` is the ORDER BY keys, one
 * per searched column, best first.
 *
 * With `firstIndex` the placeholders are numbered (`$n`) and each term is
 * bound once, the rank reusing it; without it they are positional (`?`),
 * every occurrence binds its own copy, and `rankParams` go after the
 * parameters of the whole WHERE, as the ORDER BY comes after it.
 *
 * Uses `escapeLikePattern` and `sanitizeSearchIdentifier`
 * (`generateSearchEscapeHelpersCode`).
 */
export const generateSearchSqlHelpersCode = (
  dialect: SearchSqlDialect
): string => `${generateSearchTermsCode(dialect.normalised)}
${
  dialect.normalised ? `const SEARCH_SPACES_REGEX_SQL = ${jsString(PG_SPACES_REGEX_SQL)}\n` : ''
}const searchTextSql = ${dialect.textSql}
const searchLikeSql = ${dialect.likeSql}
const buildSearchSql = (query, columns, firstIndex) => {
  const terms = searchTerms(query)
  const searched = []
  ;(Array.isArray(columns) ? columns : []).forEach((column) => {
    const name = sanitizeSearchIdentifier(column)
    if (searched.indexOf(name) === -1) searched.push(name)
  })
  if (terms.length === 0 || searched.length === 0) return null
  const patterns = terms.map((term) => escapeLikePattern(term))
  const numbered = typeof firstIndex === 'number'
  const params = numbered ? patterns.slice() : []
  const rankParams = []
  const placeholder = (termIndex, bound) => {
    if (numbered) return '$' + (firstIndex + termIndex)
    bound.push(patterns[termIndex])
    return '?'
  }
  const texts = searched.map((column, position) => ${
    dialect.lateral ? `'"__tq_search"."__tq_search_' + position + '"'` : 'searchTextSql(column)'
  })
  const from = ${
    dialect.lateral
      ? `' CROSS JOIN LATERAL (SELECT ' + searched.map((column, position) => searchTextSql(column) + ' AS "__tq_search_' + position + '"').join(', ') + ' OFFSET 0) AS "__tq_search"'`
      : `''`
  }
  const where = '(' + patterns.map((pattern, termIndex) =>
    '(' + texts.map((text) => searchLikeSql(text, placeholder(termIndex, params), '%', '%')).join(' OR ') + ')'
  ).join(' AND ') + ')'
  const rank = texts.map((text) => '(' + patterns.map((pattern, termIndex) =>
    'CASE WHEN ' + searchLikeSql(text, placeholder(termIndex, rankParams), '% ', ' %') + ' THEN 3' +
    ' WHEN ' + searchLikeSql(text, placeholder(termIndex, rankParams), '% ', '%') + ' THEN 2' +
    ' WHEN ' + searchLikeSql(text, placeholder(termIndex, rankParams), '%', '%') + ' THEN 1 ELSE 0 END'
  ).join(' + ') + ') DESC').join(', ')
  return { where, params, from, rank, rankParams, nextIndex: numbered ? firstIndex + patterns.length : firstIndex }
}`

/**
 * For the routes that search rows in memory: `matchesSearch(row, query,
 * columns, valueOf)`, true when every term is in one of the columns, and
 * `rankBySearch(rows, query, columns, valueOf)`, the same order as the SQL
 * routes' rank, applied after the list's sort (a stable sort keeps it among
 * rows that score alike) and before the page is cut. Stored text is read
 * the normalised way: tags, entities and punctuation as spaces.
 */
export const generateSearchRankHelperCode = (): string => `${generateSearchTermsCode(true)}
const searchText = (value) => {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return ' ' + searchPunctuationToSpaces(text.toLowerCase().replace(/<[^>]*>|&[a-z0-9#]+;/g, ' ')) + ' '
}
const searchScore = (text, terms) => terms.reduce((score, term) =>
  score + (text.indexOf(' ' + term + ' ') !== -1 ? 3 : text.indexOf(' ' + term) !== -1 ? 2 : text.indexOf(term) !== -1 ? 1 : 0), 0)
const matchesSearch = (row, query, columns, valueOf) => {
  const terms = searchTerms(query)
  if (terms.length === 0) return true
  const texts = (Array.isArray(columns) ? columns : []).map((column) => searchText(valueOf(row, column)))
  return terms.every((term) => texts.some((text) => text.indexOf(term) !== -1))
}
const rankBySearch = (rows, query, columns, valueOf) => {
  const terms = searchTerms(query)
  if (!Array.isArray(columns) || columns.length === 0 || terms.length === 0) return rows
  return rows
    .map((row, index) => ({ row, index, scores: columns.map((column) => searchScore(searchText(valueOf(row, column)), terms)) }))
    .sort((a, b) => {
      for (let position = 0; position < a.scores.length; position++) {
        if (a.scores[position] !== b.scores[position]) return b.scores[position] - a.scores[position]
      }
      return a.index - b.index
    })
    .map((entry) => entry.row)
}`
