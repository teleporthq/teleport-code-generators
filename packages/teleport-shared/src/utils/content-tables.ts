/**
 * The content presets — the Blog, and every feature built like it — and the
 * tables each one keeps. The ONE list the editor and the generators read: the
 * editor's `ContentPreset` is built on these entries, the generated site's
 * read routes, view models and feeds recognise a content table through
 * `contentTableRole`. A preset added here and nowhere else is caught by the
 * editor's wiring test; a table named anywhere else is a copy that drifts.
 */

export type ContentPresetKey = 'blog' | 'help'

export type ContentTableRole = 'posts' | 'comments'

export interface ContentTables {
  key: ContentPresetKey
  /** The rows the preset publishes: one per post / article. */
  posts: string
  /** Reader comments under a post, when the preset takes them. */
  comments: string | null
  /**
   * Whether a post without a picture is shown with the grey "No image" stand-in.
   * Off for a preset whose posts are text: its cards and post page close up
   * instead of drawing an empty grey box on every article.
   */
  pictureStandIn: boolean
}

export const CONTENT_TABLES: ReadonlyArray<ContentTables> = [
  {
    key: 'blog',
    posts: 'teleport_blog_posts',
    comments: 'teleport_blog_comments',
    pictureStandIn: true,
  },
  // The Help Center: articles at /help/<slug>, no reader comments, and a text
  // article shows no picture at all rather than a stand-in.
  { key: 'help', posts: 'teleport_help_articles', comments: null, pictureStandIn: false },
]

export const CONTENT_POSTS_TABLES: ReadonlyArray<string> = CONTENT_TABLES.map(
  (tables) => tables.posts
)

export const CONTENT_COMMENTS_TABLES: ReadonlyArray<string> = CONTENT_TABLES.map(
  (tables) => tables.comments
).filter((table): table is string => table !== null)

export const contentTablesByKey = (key: ContentPresetKey): ContentTables => {
  const tables = CONTENT_TABLES.find((entry) => entry.key === key)
  if (!tables) {
    throw new Error(`No content preset is registered under "${key}"`)
  }
  return tables
}

/** Which preset a table belongs to and what it holds there; null for any other table. */
export const contentTableRole = (
  tableName: string
): { key: ContentPresetKey; role: ContentTableRole } | null => {
  for (const tables of CONTENT_TABLES) {
    if (tableName === tables.posts) {
      return { key: tables.key, role: 'posts' }
    }
    if (tableName === tables.comments) {
      return { key: tables.key, role: 'comments' }
    }
  }
  return null
}

export const isContentPostsTable = (tableName: string): boolean =>
  contentTableRole(tableName)?.role === 'posts'

export interface VisitorRowPolicy {
  /** SQL every browser read of the table is narrowed with. */
  predicate: string
  /** Keys never served to a browser, wherever they sit in a row (raw and transformed names). */
  hiddenColumns: ReadonlyArray<string>
}

/**
 * What a visitor is served of a posts table: ONLY `published` rows — drafts,
 * scheduled and archived posts are the author's (the editor's post statuses in
 * `blog-post-status.ts`) — and never the author's email address.
 */
export const CONTENT_POSTS_VISITOR_ROW_POLICY: VisitorRowPolicy = {
  predicate: "status = 'published'",
  hiddenColumns: ['author_email', 'authorEmail'],
}

/**
 * What a browser is served of the tables whose unpublished rows sit beside the
 * public ones. Read by both route families of a generated site — the per-table
 * read routes (teleport-plugin-next-data-source) and the workflow data API
 * (teleport-plugin-next-workflows) — so no reader can disagree about what a
 * visitor sees.
 */
export const VISITOR_ROW_POLICIES: Readonly<Record<string, VisitorRowPolicy>> = {
  ...Object.fromEntries(
    CONTENT_POSTS_TABLES.map((table) => [table, CONTENT_POSTS_VISITOR_ROW_POLICY])
  ),
  // The storefront sells `active` products; a draft or inactive one is the
  // merchant's, spelled in any case the admin form stored it in.
  teleport_products: {
    predicate: "LOWER(TRIM(status)) = 'active'",
    hiddenColumns: [],
  },
}

/* ------------------------------------------------------------------------ */
/* Category pages                                                            */
/* ------------------------------------------------------------------------ */

/**
 * The generated module a preset's category page reads from — one function
 * resolves the category at a slug with its published posts for
 * `getStaticProps`, the other lists every category's slug for
 * `getStaticPaths`. The editor names them on the page's UIDL (an external
 * resource with a local dependency), the Next generator emits them; both read
 * the names from here, so neither can misspell the other.
 */
export const CONTENT_CATEGORY_PAGES_MODULE = '@/content-category-pages'

const presetPascalCase = (key: ContentPresetKey): string =>
  key.charAt(0).toUpperCase() + key.slice(1)

/** `resolveHelpCategoryPage`: `{ data: category | null }` for a slug. */
export const contentCategoryPageResolverName = (key: ContentPresetKey): string =>
  `resolve${presetPascalCase(key)}CategoryPage`

/** `listHelpCategoryPaths`: `{ data: [{ slug }] }`, every category of the tree. */
export const contentCategoryPathsListerName = (key: ContentPresetKey): string =>
  `list${presetPascalCase(key)}CategoryPaths`

/* ------------------------------------------------------------------------ */
/* The live site index                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Where the generated site serves a preset's live sitemap: its published posts,
 * read from the table on request, so a post published after the last publish
 * is listed too. The editor's own `sitemap.xml` names it from its sitemap
 * index; both sides read the address from here.
 */
export const contentSitemapPath = (key: ContentPresetKey): string => `/sitemap-${key}.xml`

/** The site's list for language models: its pages, then each preset's posts by category. */
export const LLMS_TXT_PATH = '/llms.txt'

/** Every published post of the presets, in full, as Markdown. */
export const LLMS_FULL_TXT_PATH = '/llms-full.txt'
