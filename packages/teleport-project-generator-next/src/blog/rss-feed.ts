import {
  FileType,
  ProjectPluginStructure,
  ProjectUIDL,
  UIDLBlogRssFeed,
} from '@teleporthq/teleport-types'
import { ensureDataSourceUtilityModule } from '../data-source-utility-plugin'
import { extractBaseUrl } from '../internationalization/project'
import { injectSiblingIntoApp } from '../app-sibling-injection'

/**
 * Where the published site serves the blog's RSS feed — and, for every
 * language but the main one, at `/<locale>/rss.xml`.
 *
 * ⛔ PAIRED with `BLOG_RSS_PATH` in the GUI's
 * `features/blog/constants/blog-rss.ts`, which shows the owner this address.
 */
export const BLOG_RSS_ROUTE = '/rss.xml'

/** How many posts the feed lists: the newest ones. */
export const BLOG_RSS_FEED_SIZE = 20

const BLOG_POSTS_TABLE = 'teleport_blog_posts'
const FEED_LINK_COMPONENT = 'BlogFeedLink'
const FEED_LINK_FILE = 'blog-feed-link'

interface BlogRssPageParams {
  feed: UIDLBlogRssFeed
  /** The `utils/data-sources/` module that reads the posts table. */
  fetcherModule: string
  /** The site's canonical origin, `null` when the pages carry none. */
  siteUrl: string | null
  title: string
  description: string
}

/** `/blog/` → `/blog`, `/` → `` — a path the generated code appends segments to. */
const toBasePath = (path: string): string => {
  const trimmed = (path || '').trim().replace(/\/+$/, '')
  if (!trimmed) {
    return ''
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/** `author_name` → `authorName`: the key the post transform exposes a column under. */
const toCamelCase = (column: string): string =>
  column.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase())

/**
 * `pages/rss.xml.js`: an RSS 2.0 document of the newest published posts,
 * written by `getServerSideProps` itself (the page renders nothing).
 *
 * The rows come from the blog's own generated fetcher, so every database the
 * blog can live in works, and a multi-language site answers `/es/rss.xml` with
 * the Spanish copy of each post. Fields are read under their transformed name
 * first and their column name second: only some fetchers transform the rows.
 *
 * More posts are read than listed, so the ones without an address of their
 * own (no slug, or a redirect elsewhere) can be left out, and a draft started
 * long ago but published today — ordered by `created_at` among the old ones —
 * still makes the cut once the feed orders by publication date.
 *
 * A database that cannot be read answers 503 with `Retry-After`: an empty
 * feed would tell readers every post was gone.
 */
export const generateBlogRssPageSource = (params: BlogRssPageParams): string => {
  const feed = {
    siteUrl: params.siteUrl || '',
    title: params.title,
    description: params.description || params.title,
    listingPath: toBasePath(params.feed.listingPath),
    postPath: toBasePath(params.feed.postPath),
    postUrlField: params.feed.postUrlField,
    postUrlKey: toCamelCase(params.feed.postUrlField),
  }

  return `import blogPosts from '../utils/data-sources/${params.fetcherModule}'

// The blog's RSS feed. Generated from the blog's settings in the editor.
var FEED = ${JSON.stringify(feed)}
var FEED_ROUTE = '${BLOG_RSS_ROUTE}'
var FEED_SIZE = ${BLOG_RSS_FEED_SIZE}
var FEED_CANDIDATES = ${BLOG_RSS_FEED_SIZE * 2}
var SUMMARY_LENGTH = 300
var PUBLISHED_ONLY = JSON.stringify([
  { type: 'condition', source: 'status', destination: 'published', operand: '=' },
])
var NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  copy: '©', reg: '®', trade: '™',
}

// A post field under its transformed name, else its column name.
function field(post, key, column) {
  var value = post[key]
  return value === undefined || value === null || value === '' ? post[column] : value
}

// Text as XML character data: the characters XML cannot carry at all dropped
// (control characters, unpaired surrogates), the five markup ones escaped.
function xmlText(value) {
  var text = String(value === undefined || value === null ? '' : value)
  var out = ''
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      var low = text.charCodeAt(i + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        out += text.charAt(i) + text.charAt(i + 1)
        i++
      }
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) continue
    if (code === 0xfffe || code === 0xffff) continue
    out += text.charAt(i)
  }
  return out
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, function (match, entity) {
    var name = entity.toLowerCase()
    if (name.charAt(0) !== '#') {
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : match
    }
    var code = name.charAt(1) === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
      ? String.fromCodePoint(code)
      : ''
  })
}

// Rich text as the words a reader sees.
function plainText(value) {
  if (typeof value !== 'string') return ''
  var withoutCode = value.replace(/<(script|style)[^>]*>[\\s\\S]*?<\\/\\1>/gi, ' ')
  return decodeEntities(withoutCode.replace(/<[^>]*>/g, ' ')).replace(/\\s+/g, ' ').trim()
}

function summaryOf(post) {
  var text =
    plainText(post.excerpt) ||
    plainText(field(post, 'metaDescription', 'meta_description')) ||
    plainText(post.content)
  var characters = Array.from(text)
  return characters.length > SUMMARY_LENGTH
    ? characters.slice(0, SUMMARY_LENGTH - 1).join('').trim() + '…'
    : text
}

// Milliseconds for any timestamp a fetcher hands back. A bare SQL timestamp
// is UTC: every write stores toISOString().
function timeOf(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number') return isFinite(value) ? value : null
  var text = String(value).trim()
  if (/^\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?$/.test(text)) {
    text = text.replace(' ', 'T') + 'Z'
  }
  var time = Date.parse(text)
  return isNaN(time) ? null : time
}

function rfc822(time) {
  var date = new Date(time)
  return isNaN(date.getTime()) ? null : date.toUTCString()
}

function publishedTime(post) {
  return (
    timeOf(field(post, 'publishedAt', 'published_at')) ||
    timeOf(field(post, 'createdAt', 'created_at'))
  )
}

function listOf(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    var parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed
  } catch (e) {
    // A comma-separated list.
  }
  return value.split(',')
}

// The post's categories, then its tags — each name once.
function topicsOf(post) {
  var categories = Array.isArray(post.categories) ? post.categories : []
  if (categories.length === 0 && post.category) categories = [post.category]
  var names = []
  categories.concat(listOf(post.tags)).forEach(function (entry) {
    var name = entry && typeof entry === 'object' ? entry.name : entry
    name = typeof name === 'string' ? name.trim() : ''
    if (name && names.indexOf(name) === -1) names.push(name)
  })
  return names
}

function postLink(post, base) {
  var key = field(post, FEED.postUrlKey, FEED.postUrlField)
  key = key === undefined || key === null ? '' : String(key).trim()
  return key ? base + FEED.postPath + '/' + encodeURIComponent(key) : null
}

function redirectsElsewhere(post) {
  var target = field(post, 'redirectUrl', 'redirect_url')
  return typeof target === 'string' && target.trim() !== ''
}

// The canonical origin; the request's own host only when the pages carry none.
function siteOrigin(req) {
  if (FEED.siteUrl) return FEED.siteUrl
  var host = String((req && req.headers && req.headers.host) || '')
  if (!/^[a-z0-9.-]+(:\\d+)?$/i.test(host)) return ''
  var forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  var local = /^(localhost|127\\.0\\.0\\.1)(:\\d+)?$/.test(host)
  return (forwarded === 'http' || forwarded === 'https' ? forwarded : local ? 'http' : 'https') + '://' + host
}

function buildFeed(posts, base, locale) {
  var items = []
  posts.forEach(function (post) {
    if (!post || typeof post !== 'object' || redirectsElsewhere(post)) return
    var link = postLink(post, base)
    if (link) items.push({ post: post, link: link, time: publishedTime(post) })
  })
  items.sort(function (a, b) {
    return (b.time || 0) - (a.time || 0)
  })
  items = items.slice(0, FEED_SIZE)

  var lastBuild = items.length > 0 && items[0].time ? rfc822(items[0].time) : null
  var lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '<channel>',
    '<title>' + xmlText(FEED.title) + '</title>',
    '<link>' + xmlText((base + FEED.listingPath) || '/') + '</link>',
    '<description>' + xmlText(FEED.description) + '</description>',
    '<atom:link href="' + xmlText(base + FEED_ROUTE) + '" rel="self" type="application/rss+xml"/>',
  ]
  if (locale) lines.push('<language>' + xmlText(locale) + '</language>')
  if (lastBuild) lines.push('<lastBuildDate>' + lastBuild + '</lastBuildDate>')

  items.forEach(function (item) {
    var post = item.post
    var published = item.time ? rfc822(item.time) : null
    var author = field(post, 'authorName', 'author_name')
    var summary = summaryOf(post)
    lines.push('<item>')
    lines.push('<title>' + xmlText(post.title) + '</title>')
    lines.push('<link>' + xmlText(item.link) + '</link>')
    lines.push('<guid isPermaLink="true">' + xmlText(item.link) + '</guid>')
    if (published) lines.push('<pubDate>' + published + '</pubDate>')
    if (typeof author === 'string' && author.trim()) {
      lines.push('<dc:creator>' + xmlText(author.trim()) + '</dc:creator>')
    }
    topicsOf(post).forEach(function (name) {
      lines.push('<category>' + xmlText(name) + '</category>')
    })
    if (summary) lines.push('<description>' + xmlText(summary) + '</description>')
    lines.push('</item>')
  })

  lines.push('</channel>', '</rss>')
  return lines.join('\\n')
}

export async function getServerSideProps(context) {
  var res = context.res
  var locale = context.locale || null
  var prefix = locale && context.defaultLocale && locale !== context.defaultLocale ? '/' + locale : ''

  var posts
  try {
    posts = await blogPosts.fetchData({
      limit: FEED_CANDIDATES,
      sortBy: 'created_at',
      sortOrder: 'desc',
      filters: PUBLISHED_ONLY,
      locale: locale || undefined,
    })
  } catch (error) {
    console.error('[rss] The posts could not be read: ' + (error && error.message ? error.message : String(error)))
    res.statusCode = 503
    res.setHeader('Retry-After', '300')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('The feed is unavailable right now. Try again in a few minutes.')
    return { props: {} }
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600')
  res.end(buildFeed(Array.isArray(posts) ? posts : [], siteOrigin(context.req) + prefix, locale))
  return { props: {} }
}

export default function BlogRssFeed() {
  return null
}
`
}

/**
 * The `<link rel="alternate">` every page carries, so browsers and feed
 * readers find the feed — the one in the language the page is in.
 */
export const generateBlogFeedLinkSource = (title: string): string => `import Head from 'next/head'
import { useRouter } from 'next/router'

export default function ${FEED_LINK_COMPONENT}() {
  const router = useRouter()
  const locale = router && router.locale
  const prefix = locale && router.defaultLocale && locale !== router.defaultLocale ? '/' + locale : ''
  return (
    <Head>
      <link
        key="blog-rss-feed"
        rel="alternate"
        type="application/rss+xml"
        title={${JSON.stringify(title)}}
        href={prefix + '${BLOG_RSS_ROUTE}'}
      />
    </Head>
  )
}
`

/** The home page's meta description — what the site says it is. */
const siteDescription = (uidl: ProjectUIDL): string => {
  const route = uidl.root.stateDefinitions?.route
  const home = route?.values?.find((value) => value.value === route.defaultValue)
  const content = home?.seo?.metaTags?.find((metaTag) => metaTag.name === 'description')?.content
  if (typeof content === 'string') {
    return content.trim()
  }
  return content?.type === 'static' && typeof content.content === 'string'
    ? content.content.trim()
    : ''
}

/**
 * Emits the feed route and announces it from every page. Nothing is emitted
 * when the posts table has no fetcher to read it through.
 */
export const addBlogRssFeed = (structure: ProjectPluginStructure, feed: UIDLBlogRssFeed): void => {
  const { uidl, files } = structure
  const dataSource = uidl.dataSources?.[feed.dataSourceId]
  if (!dataSource) {
    return
  }

  const fetcherModule = ensureDataSourceUtilityModule(structure, {
    dataSourceId: feed.dataSourceId,
    dataSourceType: dataSource.type,
    tableName: BLOG_POSTS_TABLE,
  })
  if (!fetcherModule) {
    return
  }

  const title = uidl.globals?.settings?.title || uidl.name || 'Blog'
  files.set('blog-rss-feed', {
    path: ['pages'],
    files: [
      {
        name: BLOG_RSS_ROUTE.slice(1),
        fileType: FileType.JS,
        content: generateBlogRssPageSource({
          feed,
          fetcherModule,
          siteUrl: extractBaseUrl(uidl.root.stateDefinitions?.route?.values || []),
          title,
          description: siteDescription(uidl),
        }),
      },
    ],
  })

  files.set(FEED_LINK_FILE, {
    path: ['components'],
    files: [
      {
        name: FEED_LINK_FILE,
        fileType: FileType.JS,
        content: generateBlogFeedLinkSource(title),
      },
    ],
  })
  injectSiblingIntoApp(structure, {
    componentName: FEED_LINK_COMPONENT,
    importStatement: `import ${FEED_LINK_COMPONENT} from '../components/${FEED_LINK_FILE}';\n`,
  })
}
