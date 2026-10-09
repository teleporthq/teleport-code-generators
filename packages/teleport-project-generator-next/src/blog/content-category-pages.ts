import { ContentTables } from '@teleporthq/teleport-shared'
import type { UIDLContentCategoryPages } from '@teleporthq/teleport-types'
import { ARRANGED_ORDER_RUNTIME } from './arranged-order-runtime'

/** How many of a category's published posts a category page lists, newest first (then arranged, in Manual Order). */
export const CATEGORY_PAGE_POST_LIMIT = 500

export interface ContentCategoryPagesPreset {
  key: ContentTables.ContentPresetKey
  settings: UIDLContentCategoryPages
  /** The `utils/data-sources/` module that reads the preset's posts table. */
  fetcherModule: string
  /** Manual Order: the pages list the posts the way the author arranged them (`arrangeCategoryPosts`). */
  arranged?: boolean
}

/** The baked tree a preset's category pages read, by the name `blog-context.js` exports it under. */
export const TREE_EXPORTS: Record<ContentTables.ContentPresetKey, string> = {
  blog: 'BLOG_CATEGORY_TREE',
  help: 'HELP_CATEGORY_TREE',
}

/** The name the preset's posts fetcher is imported under: `blogPosts`, `helpPosts`. */
export const categoryPagesFetcherImportName = (key: ContentTables.ContentPresetKey): string =>
  `${key}Posts`

const toBasePath = (path: string): string => {
  const trimmed = (path || '').trim().replace(/\/+$/, '')
  if (!trimmed) {
    return ''
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/**
 * The generated `content-category-pages.js` module at the project root: for
 * every preset with category pages, the two functions its page's
 * `getStaticProps` / `getStaticPaths` import (names from
 * `contentCategoryPageResolverName` / `contentCategoryPathsListerName`).
 *
 * The resolver finds the category at a slug in the baked taxonomy (localized
 * to the request's locale, like the hooks do client-side), then reads its
 * published posts through the preset's own generated fetcher — server-side,
 * so the list is in the pre-rendered HTML and crawlers index the category
 * with its posts. The page fetches nothing on the client. The listing's filter
 * is NOT reused on purpose: a filter bound to a route param is dropped from the
 * server-side first-page fetch, which would pre-render every category page
 * with the unfiltered list.
 *
 * A post that redirects elsewhere is left out, as it is from the feed; the
 * published-only condition keeps drafts out at the source, as every visitor
 * read does.
 *
 * `{ data: null }` for a slug no category has: the page answers 404 (the
 * static-props plugin turns an empty result into `notFound`).
 */
export const generateContentCategoryPagesSource = (
  presets: ContentCategoryPagesPreset[]
): string => {
  const treeImports = presets.map((preset) => TREE_EXPORTS[preset.key])
  const fetcherImports = presets.map(
    (preset) =>
      `import ${categoryPagesFetcherImportName(preset.key)} from './utils/data-sources/${
        preset.fetcherModule
      }'`
  )
  const presetEntries = presets.map((preset) => {
    const config = {
      postPath: toBasePath(preset.settings.postPath),
      postUrlField: preset.settings.postUrlField,
      postUrlKey: toCamelCase(preset.settings.postUrlField),
      categoryPath: toBasePath(preset.settings.categoryPath),
      arranged: preset.arranged === true,
    }
    return `  ${preset.key}: { tree: ${
      TREE_EXPORTS[preset.key]
    }, posts: ${categoryPagesFetcherImportName(preset.key)}, config: ${JSON.stringify(config)} },`
  })
  const exportedFunctions = presets.map((preset) =>
    [
      `export async function ${ContentTables.contentCategoryPageResolverName(
        preset.key
      )}(params) {`,
      `  return resolveCategoryPage(PRESETS.${preset.key}, params)`,
      `}`,
      ``,
      `export async function ${ContentTables.contentCategoryPathsListerName(preset.key)}() {`,
      `  return listCategoryPaths(PRESETS.${preset.key})`,
      `}`,
    ].join('\n')
  )

  return `import { ${treeImports.join(', ')}, localizeCategoryTree } from '@/blog-context'
${fetcherImports.join('\n')}

// The category pages' server-side reads. Generated from the content settings in the editor.
var PRESETS = {
${presetEntries.join('\n')}
}
var POST_LIMIT = ${CATEGORY_PAGE_POST_LIMIT}
var CATEGORY_COLUMN = 'category_filter_ids'
var PUBLISHED_ONLY = { type: 'condition', source: 'status', destination: 'published', operand: '=' }

// A post field under its transformed name, else its column name.
function field(post, key, column) {
  var value = post[key]
  return value === undefined || value === null || value === '' ? post[column] : value
}

function redirectsElsewhere(post) {
  var target = field(post, 'redirectUrl', 'redirect_url')
  return typeof target === 'string' && target.trim() !== ''
}

// Every category of the tree with the path of ancestors above it, top to bottom.
function flattenTree(nodes, trail, out) {
  ;(nodes || []).forEach(function (node) {
    var path = trail.concat([node])
    out.push({ node: node, path: path })
    flattenTree(node.children, path, out)
  })
  return out
}

function categoryHref(config, category) {
  return config.categoryPath + '/' + encodeURIComponent(category.slug)
}

function postHref(config, post) {
  var key = field(post, config.postUrlKey, config.postUrlField)
  key = key === undefined || key === null ? '' : String(key).trim()
  return key ? config.postPath + '/' + encodeURIComponent(key) : null
}

// A category as a link: what the breadcrumbs and the subcategory cards show.
function categorySummary(config, category) {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description || '',
    icon: category.icon || null,
    imageUrl: category.imageUrl || null,
    href: categoryHref(config, category),
    childCount: (category.children || []).length,
  }
}

${ARRANGED_ORDER_RUNTIME}

async function resolveCategoryPage(preset, params) {
  var slug = params && params.slug !== undefined && params.slug !== null ? String(params.slug) : ''
  var locale = params && params.locale ? params.locale : null
  var tree = localizeCategoryTree(preset.tree, locale)
  var found = flattenTree(tree, [], []).filter(function (entry) {
    return entry.node.slug === slug
  })[0]
  if (!slug || !found) {
    return { data: null }
  }
  var category = found.node
  var rows = await preset.posts.fetchData({
    limit: POST_LIMIT,
    sortBy: 'created_at',
    sortOrder: 'desc',
    filters: JSON.stringify([
      PUBLISHED_ONLY,
      { type: 'condition', source: CATEGORY_COLUMN, destination: category.id, operand: 'array_overlap' },
    ]),
    locale: locale || undefined,
  })
  var posts = []
  ;(Array.isArray(rows) ? rows : []).forEach(function (post) {
    if (!post || typeof post !== 'object' || redirectsElsewhere(post)) return
    var href = postHref(preset.config, post)
    if (href) posts.push(Object.assign({}, post, { href: href }))
  })
  if (preset.config.arranged) posts = arrangeCategoryPosts(posts, category)
  var summary = categorySummary(preset.config, category)
  return {
    data: Object.assign(summary, {
      breadcrumbs: found.path.slice(0, -1).map(function (ancestor) {
        return categorySummary(preset.config, ancestor)
      }),
      // Top category down to this one: what the sidebar layout highlights and opens.
      pathIds: found.path.map(function (node) {
        return node.id
      }),
      children: (category.children || []).map(function (child) {
        return categorySummary(preset.config, child)
      }),
      posts: posts,
      postCount: posts.length,
    }),
  }
}

async function listCategoryPaths(preset) {
  return {
    data: flattenTree(preset.tree, [], []).map(function (entry) {
      return { slug: entry.node.slug }
    }),
  }
}

${exportedFunctions.join('\n\n')}
`
}

/** `author_name` → `authorName`: the key the post transform exposes a column under. */
const toCamelCase = (column: string): string =>
  column.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase())
