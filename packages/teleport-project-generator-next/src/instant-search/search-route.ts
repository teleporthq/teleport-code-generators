import { toJsLiteral } from '../pwa/source-literals'
import { VISITOR_READ_SOURCE } from '../plugins/visitor-read-source'
import { DbSearchSection } from './sections'
import { InstantSearchConfig, SEARCH_SECTION_LABELS } from './settings'

/**
 * `pages/api/plugins/search.js`: the search the Search component's runtime
 * calls. The site's pages are found in the words index the editor wrote at
 * export (`utils/search-pages-index.json`, imported here and folded once per
 * instance: a search is one scan of it, no database); every other section is
 * read through the table's generated fetcher (`utils/data-sources/`), which
 * applies the visitor row policy — only active products, only published posts
 * — and the search term across the section's columns. A section that fails is
 * left out, never the answer. The answer is the rows found, in the sections'
 * order. Asked for one section (`?section=products`) it searches that one
 * alone: the modal asks for every section at once, each with its own loading
 * state.
 */

export const SEARCH_ROUTE = '/api/plugins/search'
/** The pages' words, beside the other utilities; read by the route alone, never sent to a browser. */
export const PAGES_INDEX_FILE = { path: ['utils'], name: 'search-pages-index' }
/** The most results one section may answer with, whatever the caller asks. */
const MAX_RESULTS_PER_SECTION = 20

export interface SearchRouteSection extends DbSearchSection {
  /** The fetcher module's import path from the route. */
  fetcherImport: string
}

const fetcherName = (index: number) => `fetcher${index}`

export const buildSearchRouteSource = (
  config: InstantSearchConfig,
  sections: SearchRouteSection[],
  /** The words index module's import path from the route; null when the pages are not searched. */
  indexImport: string | null
): string => {
  const imports = sections
    .map(
      (section, index) => `import ${fetcherName(index)} from ${toJsLiteral(section.fetcherImport)}`
    )
    .concat(indexImport ? [`import PAGES_INDEX from ${toJsLiteral(indexImport)}`] : [])
    .join('\n')
  const sectionLiterals = sections
    .map(
      (section, index) =>
        `  {
    key: ${toJsLiteral(section.key)},
    label: ${toJsLiteral(section.label)},
    fetch: (params) => readAsVisitor(${fetcherName(index)}, params),
    searchColumns: ${toJsLiteral(section.searchColumns)},
    titleColumns: ${toJsLiteral(section.titleColumns)},
    descriptionColumns: ${toJsLiteral(section.descriptionColumns)},
    imageColumns: ${toJsLiteral(section.imageColumns)},
    activeColumn: ${toJsLiteral(section.activeColumn)},
    route: ${toJsLiteral(section.route)},
  }`
    )
    .join(',\n')
  return `${imports}

${VISITOR_READ_SOURCE}

// The pages' words, folded once: a search is a scan of them.
const PAGES = ${indexImport ? 'Array.isArray(PAGES_INDEX.pages) ? PAGES_INDEX.pages : []' : '[]'}
const FOLDED_PAGES = PAGES.map((page) => ({ title: fold(page.title), text: fold(page.text) }))
const PAGES_LABEL = ${toJsLiteral(SEARCH_SECTION_LABELS.pages)}
const SECTIONS = [
${sectionLiterals}
]
const MIN_CHARACTERS = ${config.settings.minCharacters}
const DEFAULT_LIMIT = ${config.settings.resultsPerSection}
const MAX_LIMIT = ${MAX_RESULTS_PER_SECTION}
const SNIPPET_CHARS = 120

// Letters only, lower-case, accents dropped: "Café" matches "cafe".
function fold(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
}

// A column's words as plain text: a rich-text description loses its tags.
function plain(value) {
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return ''
  return /<[a-z][^>]*>/i.test(value) ? value.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim() : value
}

function firstText(row, columns) {
  for (let i = 0; i < columns.length; i++) {
    const value = plain(row[columns[i]]).trim()
    if (value) return value
  }
  return ''
}

function snippet(text, term) {
  const plain = String(text || '').replace(/\\s+/g, ' ').trim()
  if (plain.length <= SNIPPET_CHARS) return plain
  const at = fold(plain).indexOf(term)
  const start = at < 0 ? 0 : Math.max(0, at - Math.floor(SNIPPET_CHARS / 3))
  const piece = plain.slice(start, start + SNIPPET_CHARS).trim()
  return (start > 0 ? '…' : '') + piece + (start + SNIPPET_CHARS < plain.length ? '…' : '')
}

// The term anywhere in a page's words finds the page; a title match ranks first.
function searchPages(term, limit) {
  const scored = []
  for (let i = 0; i < PAGES.length; i++) {
    const page = PAGES[i]
    const titleAt = FOLDED_PAGES[i].title.indexOf(term)
    const textAt = FOLDED_PAGES[i].text.indexOf(term)
    if (titleAt < 0 && textAt < 0) continue
    const score = (titleAt === 0 ? 3 : titleAt > 0 ? 2 : 0) + (textAt >= 0 ? 1 : 0)
    // Found by its name, the page says its own description; found in its words, the words around the term.
    const description = titleAt >= 0 && page.description ? page.description : snippet(page.text, textAt >= 0 ? term : '')
    scored.push({ score, item: { title: page.title, description, url: page.route, image: null } })
  }
  scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
  return scored.slice(0, limit).map((entry) => entry.item)
}


// A row's page: the custom page its product_page names when the store has it, else the section's.
function rowUrl(section, row) {
  const key = typeof row.product_page === 'string' ? row.product_page.trim() : ''
  const page = key && section.route.byPage && section.route.byPage[key] ? section.route.byPage[key] : section.route
  const value = row[page.column]
  if (value === undefined || value === null || value === '') return null
  return page.staticBase + '/' + encodeURIComponent(String(value))
}

function rowIsActive(section, row) {
  return !section.activeColumn || row[section.activeColumn] !== false
}

async function searchSection(section, term, limit) {
  const rows = await section.fetch({
    query: term,
    queryColumns: JSON.stringify(section.searchColumns),
    limit: String(Math.min(MAX_LIMIT * 2, limit * 2)),
  })
  // In the table's order, as the editor's simulator shows them.
  const items = []
  const list = Array.isArray(rows) ? rows : []
  for (let i = 0; i < list.length && items.length < limit; i++) {
    const row = list[i]
    if (!row || typeof row !== 'object' || !rowIsActive(section, row)) continue
    const url = rowUrl(section, row)
    const title = firstText(row, section.titleColumns)
    if (!url || !title) continue
    const image = firstText(row, section.imageColumns)
    items.push({
      title,
      description: snippet(firstText(row, section.descriptionColumns), term),
      url,
      image: image || null,
    })
  }
  return items
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }
  const query = String(Array.isArray(req.query.q) ? req.query.q[0] : req.query.q || '').trim().slice(0, 200)
  const requested = parseInt(String(req.query.limit || ''), 10)
  const limit = Math.min(MAX_LIMIT, Math.max(1, isNaN(requested) ? DEFAULT_LIMIT : requested))
  // One section, or every section.
  const only = String(Array.isArray(req.query.section) ? req.query.section[0] : req.query.section || '')
  const term = fold(query)
  if (term.length < MIN_CHARACTERS) {
    return res.status(200).json({ success: true, query, items: [] })
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300')
  const results = {}
  if (PAGES.length > 0 && (!only || only === 'pages')) {
    const items = searchPages(term, limit)
    if (items.length) results.pages = { key: 'pages', label: PAGES_LABEL, items }
  }
  await Promise.all(
    SECTIONS.filter((section) => !only || section.key === only).map(async (section) => {
      try {
        const items = await searchSection(section, query, limit)
        if (items.length) results[section.key] = { key: section.key, label: section.label, items }
      } catch (error) {
        // A section that cannot be read is left out: the others still answer.
        console.warn('[instant-search] ' + section.key + ' could not be searched:', error && error.message)
      }
    })
  )
  const items = ['pages'].concat(SECTIONS.map((section) => section.key))
    .map((key) => results[key])
    .filter(Boolean)
    .reduce((rows, section) => rows.concat(section.items), [])
  return res.status(200).json({ success: true, query, items })
}
`
}
