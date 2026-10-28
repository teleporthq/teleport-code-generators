import { ProjectUIDL, UIDLPluginSettingValue } from '@teleporthq/teleport-types'

/**
 * The Instant search plugin's settings as the editor stores them
 * (`features/plugins/registry/definitions/instant-search.ts` there) and the
 * pages index the editor computed at export. Every value is checked: the
 * published site bakes them into its search runtime and its search route.
 * The search modal itself is the project's own component, drawn like a popup.
 */

const INSTANT_SEARCH_PLUGIN_KEY = 'instantSearch'

export const SEARCH_SECTION_KEYS = [
  'pages',
  'products',
  'posts',
  'articles',
  'bookingItems',
] as const
export type SearchSectionKey = (typeof SEARCH_SECTION_KEYS)[number]

export const SEARCH_SECTION_LABELS: Record<SearchSectionKey, string> = {
  pages: 'Pages',
  products: 'Products',
  posts: 'Blog posts',
  articles: 'Help articles',
  bookingItems: 'Bookable items',
}

export interface InstantSearchSettings {
  hotkeys: boolean
  placeholder: string
  sections: SearchSectionKey[]
  resultsPerSection: number
  minCharacters: number
  /** Quiet time after the last keystroke before the site searches. The editor's field caps this at 1000. */
  debounceMs: number
}

export interface SearchPageIndexEntry {
  title: string
  route: string
  /** The page's words, in order, as the editor read them at export; the search finds a term anywhere in them. */
  text: string
  /** The page's SEO description: what a result says when the term is not in the page's words. */
  description?: string
}

export interface InstantSearchConfig {
  settings: InstantSearchSettings
  /** The site's own pages, as the editor indexed them at export. */
  pages: SearchPageIndexEntry[]
}

const DEFAULTS: InstantSearchSettings = {
  hotkeys: true,
  placeholder: 'Search…',
  sections: [...SEARCH_SECTION_KEYS],
  resultsPerSection: 5,
  minCharacters: 2,
  debounceMs: 300,
}

const MAX_INDEXED_PAGES = 500
/** The editor cuts a page's words here too (`page-search-text.ts` there); an older export carried a 240-character `excerpt`. */
const MAX_PAGE_TEXT_CHARS = 12_000
/** A search engine shows about this much of a description; the result shows no more. */
const MAX_DESCRIPTION_CHARS = 320

type Stored = Record<string, UIDLPluginSettingValue | undefined>

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

const integer = (value: unknown, fallback: number, min: number, max: number): number => {
  const rounded = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(max, Math.max(min, rounded))
}

const isSectionKey = (value: unknown): value is SearchSectionKey =>
  typeof value === 'string' && (SEARCH_SECTION_KEYS as readonly string[]).includes(value)

const pageEntry = (value: unknown): SearchPageIndexEntry | null => {
  if (!value || typeof value !== 'object') {
    return null
  }
  const { title, route, text, excerpt, description } = value as Record<string, unknown>
  if (
    typeof title !== 'string' ||
    !title.trim() ||
    typeof route !== 'string' ||
    !route.startsWith('/')
  ) {
    return null
  }
  const words = typeof text === 'string' ? text : typeof excerpt === 'string' ? excerpt : ''
  const summary =
    typeof description === 'string' ? description.trim().slice(0, MAX_DESCRIPTION_CHARS) : ''
  return {
    title: title.trim(),
    route,
    text: words.slice(0, MAX_PAGE_TEXT_CHARS),
    ...(summary ? { description: summary } : {}),
  }
}

/** The plugin's configuration when the project has it on; null otherwise. */
export const resolveInstantSearchConfig = (uidl: ProjectUIDL): InstantSearchConfig | null => {
  const record = uidl.plugins?.[INSTANT_SEARCH_PLUGIN_KEY]
  if (
    !record ||
    typeof record !== 'object' ||
    !record.settings ||
    typeof record.settings !== 'object'
  ) {
    return null
  }
  const stored = record.settings as Stored
  const placeholder = typeof stored.placeholder === 'string' ? stored.placeholder.trim() : ''
  const sections = Array.isArray(stored.sections)
    ? SEARCH_SECTION_KEYS.filter((key) => (stored.sections as unknown[]).includes(key))
    : DEFAULTS.sections
  const rawPages = (record.data as Record<string, unknown> | undefined)?.pages
  const pages = Array.isArray(rawPages)
    ? rawPages
        .map(pageEntry)
        .filter((entry): entry is SearchPageIndexEntry => entry !== null)
        .slice(0, MAX_INDEXED_PAGES)
    : []
  return {
    settings: {
      hotkeys: bool(stored.hotkeys, DEFAULTS.hotkeys),
      placeholder: placeholder || DEFAULTS.placeholder,
      sections: sections.filter(isSectionKey),
      resultsPerSection: integer(stored.resultsPerSection, DEFAULTS.resultsPerSection, 1, 10),
      minCharacters: integer(stored.minCharacters, DEFAULTS.minCharacters, 1, 3),
      debounceMs: integer(stored.debounceMs, DEFAULTS.debounceMs, 0, 1000),
    },
    pages,
  }
}
