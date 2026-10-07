/**
 * The content presets — the Blog, and every feature built like it — and the
 * tables each one keeps. The ONE list the editor and the generators read: the
 * editor's `ContentPreset` is built on these entries, the generated site's
 * read routes, view models and feeds recognise a content table through
 * `contentTableRole`. A preset added here and nowhere else is caught by the
 * editor's wiring test; a table named anywhere else is a copy that drifts.
 */

export type ContentPresetKey = 'blog'

export type ContentTableRole = 'posts' | 'comments'

export interface ContentTables {
  key: ContentPresetKey
  /** The rows the preset publishes: one per post / article. */
  posts: string
  /** Reader comments under a post, when the preset takes them. */
  comments: string | null
}

export const CONTENT_TABLES: ReadonlyArray<ContentTables> = [
  { key: 'blog', posts: 'teleport_blog_posts', comments: 'teleport_blog_comments' },
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
