import {
  FileType,
  ProjectPluginStructure,
  UIDLBlogSettings,
  UIDLContentSiteIndex,
} from '@teleporthq/teleport-types'
import { ContentTables } from '@teleporthq/teleport-shared'
import { ensureDataSourceUtilityModule } from '../data-source-utility-plugin'
import { extractBaseUrl } from '../internationalization/project'
import { ARRANGED_ORDER_RUNTIME } from './arranged-order-runtime'
import { TREE_EXPORTS, categoryPagesFetcherImportName } from './content-category-pages'

/** How many posts one read takes. */
export const SITE_INDEX_PAGE_SIZE = 500

/** The most addresses one sitemap file may hold (sitemaps.org), and the most posts a preset lists. */
export const SITE_INDEX_MAX_ENTRIES = 50000

/** The generated module at the project root the live index routes read through. */
const SITE_INDEX_MODULE = 'content-site-index'

export interface ContentSiteIndexPreset {
  key: ContentTables.ContentPresetKey
  settings: UIDLContentSiteIndex
  /** The `utils/data-sources/` module that reads the preset's posts table. */
  fetcherModule: string
  /** Manual Order: each category's posts are listed by the places the author gave them. */
  arranged: boolean
}

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

/*
 * The module's runtime, written once. No backtick may appear in it (the code
 * span and fence character is spelled \x60), and it interpolates nothing.
 */
const SITE_INDEX_RUNTIME = String.raw`var NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™',
}
var BACKTICK = '\x60'
var CATEGORY_SEPARATOR = ' › '

// A post field under its transformed name, else its column name.
function field(post, key, column) {
  var value = post[key]
  return value === undefined || value === null || value === '' ? post[column] : value
}

function presetOf(key) {
  for (var i = 0; i < PRESETS.length; i++) {
    if (PRESETS[i].key === key) return PRESETS[i]
  }
  return null
}

// Milliseconds for any timestamp a fetcher hands back. A bare SQL timestamp
// is UTC: every write stores toISOString().
function timeOf(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number') return isFinite(value) ? value : null
  var text = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)) {
    text = text.replace(' ', 'T') + 'Z'
  }
  var time = Date.parse(text)
  return isNaN(time) ? null : time
}

function isoTime(time) {
  if (time === null || time === undefined) return null
  var date = new Date(time)
  return isNaN(date.getTime()) ? null : date.toISOString()
}

// When the post last changed: its last update, else its publication, else its creation.
function modifiedTime(post) {
  return (
    timeOf(field(post, 'updatedAt', 'updated_at')) ||
    timeOf(field(post, 'publishedAt', 'published_at')) ||
    timeOf(field(post, 'createdAt', 'created_at'))
  )
}

function postUrl(base, config, post) {
  var key = field(post, config.postUrlKey, config.postUrlField)
  key = key === undefined || key === null ? '' : String(key).trim()
  return key ? base + config.postPath + '/' + encodeURIComponent(key) : null
}

// A published post search engines may list: not kept out of them (noindex)
// and not sent to another address (a redirect).
function isListed(post) {
  if (!post || typeof post !== 'object') return false
  if (post.status && post.status !== 'published') return false
  var noIndex = field(post, 'noIndex', 'no_index')
  if (noIndex === true || noIndex === 'true' || noIndex === 't' || noIndex === 1) return false
  var target = field(post, 'redirectUrl', 'redirect_url')
  return !(typeof target === 'string' && target.trim() !== '')
}

// Every listed post of a preset in one language, newest first, a page at a time.
async function readPosts(preset, locale) {
  var posts = []
  var seen = {}
  for (var offset = 0; offset < MAX_ENTRIES; offset += PAGE_SIZE) {
    var rows = await preset.posts.fetchData({
      limit: PAGE_SIZE,
      offset: offset,
      sorts: NEWEST_FIRST,
      filters: PUBLISHED_ONLY,
      locale: locale || undefined,
    })
    rows = Array.isArray(rows) ? rows : []
    for (var i = 0; i < rows.length; i++) {
      var post = rows[i]
      if (!isListed(post)) continue
      if (post.id !== undefined && post.id !== null) {
        if (seen[String(post.id)]) continue
        seen[String(post.id)] = true
      }
      posts.push(post)
    }
    if (rows.length < PAGE_SIZE) break
  }
  return posts
}

// The canonical origin; the request's own host only when the pages carry none.
function siteOrigin(req) {
  if (SITE_URL) return SITE_URL
  var host = String((req && req.headers && req.headers.host) || '')
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return ''
  var forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  var local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
  return (forwarded === 'http' || forwarded === 'https' ? forwarded : local ? 'http' : 'https') + '://' + host
}

function localePrefix(locale, defaultLocale) {
  return locale && defaultLocale && locale !== defaultLocale ? '/' + locale : ''
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
  return String(text).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, function (match, entity) {
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

// Rich text as the words a reader sees, on one line.
function plainText(value) {
  if (typeof value !== 'string') return ''
  var withoutCode = value.replace(/<script[^>]*>[\s\S]*?<\/script>|<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
  return decodeEntities(withoutCode.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

// What an llms.txt entry says about a post: its description, else its
// excerpt, cut at a word within DESCRIPTION_LENGTH characters.
function summaryOf(post) {
  var text = plainText(field(post, 'metaDescription', 'meta_description')) || plainText(post.excerpt)
  if (text.length <= DESCRIPTION_LENGTH) return text
  return text.substring(0, DESCRIPTION_LENGTH).replace(/\s+\S*$/, '') + '...'
}

function linkText(value) {
  return plainText(value).replace(/[\[\]]/g, '\\$&')
}

// The preset's posts by category, in the tree's order, depth first: each
// category with the posts filed first under it — in Manual Order by the places
// the author gave them, as its category page lists them — after the posts no
// category of the tree holds, which open the list under no heading.
function groupByCategory(preset, posts, locale) {
  var categories = []
  var walk = function (nodes, trail) {
    ;(nodes || []).forEach(function (node) {
      if (!node || node.id === undefined || node.id === null) return
      var path = trail.concat([String(node.name || '')])
      categories.push({ id: String(node.id), heading: path.join(CATEGORY_SEPARATOR) })
      walk(node.children, path)
    })
  }
  walk(localizeCategoryTree(preset.tree, locale), [])
  var groupsById = {}
  categories.forEach(function (category) {
    groupsById[category.id] = groupsById[category.id] || { heading: category.heading, posts: [] }
  })
  var loose = []
  posts.forEach(function (post) {
    var ids = (Array.isArray(post.categories) ? post.categories : [])
      .map(function (entry) {
        return entry && entry.id !== undefined && entry.id !== null ? String(entry.id) : null
      })
      .filter(function (id) {
        return id !== null && !!groupsById[id]
      })
    if (ids.length) groupsById[ids[0]].posts.push(post)
    else loose.push(post)
  })
  var groups = loose.length ? [{ heading: null, posts: loose }] : []
  var placed = {}
  categories.forEach(function (category) {
    var group = groupsById[category.id]
    if (placed[category.id] || !group.posts.length) return
    placed[category.id] = true
    groups.push({
      heading: group.heading,
      posts: preset.config.arranged
        ? arrangeCategoryPosts(group.posts, { id: category.id, children: [] })
        : group.posts,
    })
  })
  return groups
}

// --- the stored post body as Markdown, without a DOM ---------------------

var VOID_ELEMENTS = {
  area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1,
  link: 1, meta: 1, source: 1, track: 1, wbr: 1,
}
var BLOCK_ELEMENTS = {
  address: 1, article: 1, aside: 1, audio: 1, blockquote: 1, details: 1, dd: 1, div: 1,
  dl: 1, dt: 1, figcaption: 1, figure: 1, footer: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1,
  h6: 1, header: 1, hr: 1, iframe: 1, li: 1, main: 1, nav: 1, ol: 1, p: 1, pre: 1,
  section: 1, summary: 1, table: 1, tbody: 1, td: 1, tfoot: 1, th: 1, thead: 1, tr: 1,
  ul: 1, video: 1,
}
var EMBED_URL_ATTRIBUTE = 'data-tq-embed-url'
var EMBED_CAPTION_ATTRIBUTE = 'data-tq-embed-caption'

// An HTML fragment as { tag, attrs, children } and { text } nodes.
function parseHtml(html) {
  var root = { tag: '#root', attrs: {}, children: [] }
  var stack = [root]
  var source = String(html || '').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
  var tagPattern = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
  var last = 0
  var match
  while ((match = tagPattern.exec(source))) {
    var top = stack[stack.length - 1]
    if (match.index > last) top.children.push({ text: source.slice(last, match.index) })
    last = tagPattern.lastIndex
    if (!match[2]) continue
    var tag = match[2].toLowerCase()
    if (match[1]) {
      for (var depth = stack.length - 1; depth > 0; depth--) {
        if (stack[depth].tag === tag) {
          stack.length = depth
          break
        }
      }
      continue
    }
    var attrs = {}
    var rawAttributes = match[3] || ''
    var attributePattern = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g
    var attribute
    while ((attribute = attributePattern.exec(rawAttributes))) {
      var value =
        attribute[2] !== undefined ? attribute[2] : attribute[3] !== undefined ? attribute[3] : attribute[4]
      attrs[attribute[1].toLowerCase()] = decodeEntities(value === undefined ? '' : value)
    }
    var node = { tag: tag, attrs: attrs, children: [] }
    top.children.push(node)
    if (!VOID_ELEMENTS[tag] && !/\/\s*$/.test(rawAttributes)) stack.push(node)
  }
  if (last < source.length) stack[stack.length - 1].children.push({ text: source.slice(last) })
  return root
}

function absoluteUrl(value, pageUrl) {
  var href = String(value || '').trim()
  if (!href) return ''
  try {
    return new URL(href, pageUrl).toString()
  } catch (e) {
    return href
  }
}

function textOf(node) {
  if (node.text !== undefined) return decodeEntities(node.text)
  if (node.tag === 'br') return '\n'
  return node.children.map(textOf).join('')
}

function fenceFor(text, shortest) {
  var longest = shortest - 1
  ;(text.match(/\x60+/g) || []).forEach(function (run) {
    if (run.length > longest) longest = run.length
  })
  return new Array(longest + 2).join(BACKTICK)
}

function codeSpan(code) {
  var fence = fenceFor(code, 1)
  var pad = code.charAt(0) === BACKTICK || code.charAt(code.length - 1) === BACKTICK ? ' ' : ''
  return fence + pad + code + pad + fence
}

function wrapMark(content, marker) {
  if (!content.trim()) return content
  var lead = content.match(/^\s*/)[0]
  var trail = content.match(/\s*$/)[0]
  return lead + marker + content.trim() + marker + trail
}

function imageMarkdown(node, pageUrl) {
  var src = String(node.attrs.src || '').trim()
  if (!src || /^data:/i.test(src)) return ''
  return '![' + String(node.attrs.alt || '').replace(/[\[\]]/g, '') + '](' + absoluteUrl(src, pageUrl) + ')'
}

function embedMarkdown(node, pageUrl) {
  var url = absoluteUrl(node.attrs[EMBED_URL_ATTRIBUTE], pageUrl)
  if (!url) return ''
  var caption = String(node.attrs[EMBED_CAPTION_ATTRIBUTE] || '').trim()
  return '[' + (caption || url) + '](' + url + ')'
}

function inlineMarkdown(nodes, pageUrl) {
  var out = ''
  nodes.forEach(function (node) {
    if (node.text !== undefined) {
      out += decodeEntities(node.text).replace(/\s+/g, ' ')
      return
    }
    if (node.attrs[EMBED_URL_ATTRIBUTE]) {
      out += embedMarkdown(node, pageUrl)
      return
    }
    var inner = function () {
      return inlineMarkdown(node.children, pageUrl)
    }
    switch (node.tag) {
      case 'strong':
      case 'b':
        out += wrapMark(inner(), '**')
        break
      case 'em':
      case 'i':
        out += wrapMark(inner(), '*')
        break
      case 's':
      case 'strike':
      case 'del':
        out += wrapMark(inner(), '~~')
        break
      case 'code':
        out += codeSpan(textOf(node))
        break
      case 'br':
        out += '\n'
        break
      case 'a': {
        var text = inner().trim()
        var href = absoluteUrl(node.attrs.href, pageUrl)
        out += href && !/^javascript:/i.test(href) ? '[' + (text || href) + '](' + href + ')' : text
        break
      }
      case 'img':
        out += imageMarkdown(node, pageUrl)
        break
      default:
        out += inner()
    }
  })
  return out
}

// One block's lines, trimmed and without runs of spaces a line break left.
function tidyLines(text) {
  return text
    .split('\n')
    .map(function (line) {
      return line.replace(/\s+$/, '').replace(/^ +/, '')
    })
    .join('\n')
    .trim()
}

function blocksMarkdown(nodes, pageUrl) {
  var blocks = []
  var inline = []
  var flush = function () {
    var text = tidyLines(inlineMarkdown(inline, pageUrl))
    if (text) blocks.push(text)
    inline = []
  }
  nodes.forEach(function (node) {
    if (node.text !== undefined || (!BLOCK_ELEMENTS[node.tag] && !node.attrs[EMBED_URL_ATTRIBUTE])) {
      inline.push(node)
      return
    }
    flush()
    var block = blockMarkdown(node, pageUrl)
    if (block) blocks.push(block)
  })
  flush()
  return blocks
}

function quoteMarkdown(text) {
  return text
    ? text
        .split('\n')
        .map(function (line) {
          return line ? '> ' + line : '>'
        })
        .join('\n')
    : ''
}

function listMarkdown(list, pageUrl) {
  var ordered = list.tag === 'ol'
  var start = parseInt(list.attrs.start, 10)
  var number = isNaN(start) ? 1 : start
  var lines = []
  list.children.forEach(function (item) {
    if (item.tag !== 'li') return
    var marker = ordered ? number++ + '. ' : '- '
    var indent = new Array(marker.length + 1).join(' ')
    var itemLines = blocksMarkdown(item.children, pageUrl).join('\n').split('\n')
    lines.push(marker + itemLines[0])
    for (var i = 1; i < itemLines.length; i++) {
      lines.push(itemLines[i] ? indent + itemLines[i] : '')
    }
  })
  return lines.join('\n')
}

function codeBlockMarkdown(pre) {
  var code = pre.children.filter(function (child) {
    return child.tag === 'code'
  })[0]
  var text = textOf(code || pre).replace(/\n$/, '')
  var language = ((code && code.attrs['class']) || '').match(/language-(\S+)/)
  var fence = fenceFor(text, 3)
  return fence + (language ? language[1] : '') + '\n' + text + '\n' + fence
}

function tableMarkdown(table, pageUrl) {
  var rows = []
  var collect = function (node) {
    node.children.forEach(function (child) {
      if (child.tag === 'tr') rows.push(child)
      else if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') collect(child)
    })
  }
  collect(table)
  var matrix = rows.map(function (row) {
    return row.children
      .filter(function (cell) {
        return cell.tag === 'td' || cell.tag === 'th'
      })
      .map(function (cell) {
        return blocksMarkdown(cell.children, pageUrl).join(' ').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|')
      })
  })
  var width = 0
  matrix.forEach(function (cells) {
    if (cells.length > width) width = cells.length
  })
  if (!width) return ''
  var line = function (cells) {
    var padded = cells.slice()
    while (padded.length < width) padded.push('')
    return '| ' + padded.join(' | ') + ' |'
  }
  var rule = []
  for (var i = 0; i < width; i++) rule.push('---')
  return [line(matrix[0]), line(rule)].concat(matrix.slice(1).map(line)).join('\n')
}

function mediaMarkdown(node, pageUrl) {
  var src = node.attrs.src || ''
  node.children.forEach(function (child) {
    if (!src && child.tag === 'source') src = child.attrs.src || ''
  })
  var url = absoluteUrl(src, pageUrl)
  if (!url || /^data:/i.test(url)) return ''
  return '[' + (String(node.attrs.title || '').trim() || url) + '](' + url + ')'
}

function blockMarkdown(node, pageUrl) {
  if (node.attrs[EMBED_URL_ATTRIBUTE]) return embedMarkdown(node, pageUrl)
  var tag = node.tag
  if (/^h[1-6]$/.test(tag)) {
    // The article's title is the one top-level heading of its entry.
    var level = Math.max(2, Number(tag.charAt(1)))
    var heading = inlineMarkdown(node.children, pageUrl).replace(/\s+/g, ' ').trim()
    return heading ? new Array(level + 1).join('#') + ' ' + heading : ''
  }
  switch (tag) {
    case 'p':
      return tidyLines(inlineMarkdown(node.children, pageUrl))
    case 'ul':
    case 'ol':
      return listMarkdown(node, pageUrl)
    case 'blockquote':
    case 'aside':
      return quoteMarkdown(blocksMarkdown(node.children, pageUrl).join('\n\n'))
    case 'pre':
      return codeBlockMarkdown(node)
    case 'table':
      return tableMarkdown(node, pageUrl)
    case 'hr':
      return '---'
    case 'iframe':
    case 'video':
    case 'audio':
      return mediaMarkdown(node, pageUrl)
    default:
      return blocksMarkdown(node.children, pageUrl).join('\n\n')
  }
}

function htmlToMarkdown(html, pageUrl) {
  return blocksMarkdown(parseHtml(html).children, pageUrl).join('\n\n')
}

// One post of llms-full.txt: its title, address, category and last change,
// its description, then its body.
function articleMarkdown(post, url, categoryPath) {
  var lines = ['# ' + plainText(post.title), '', 'Source: ' + url]
  if (categoryPath) lines.push('Category: ' + categoryPath)
  var updated = isoTime(modifiedTime(post))
  if (updated) lines.push('Last updated: ' + updated.slice(0, 10))
  var description = plainText(field(post, 'metaDescription', 'meta_description')) || plainText(post.excerpt)
  if (description) lines.push('', '> ' + description)
  var body = htmlToMarkdown(post.content, url)
  if (body) lines.push('', body)
  return lines.join('\n')
}

// --- the responses ---------------------------------------------------------

function send(res, type, body) {
  res.statusCode = 200
  res.setHeader('Content-Type', type)
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600')
  res.end(body)
  return { props: {} }
}

// A database that cannot be read answers 503 with Retry-After: an empty list
// would tell readers every post was gone.
function unavailable(res, what, error) {
  console.error('[' + what + '] The posts could not be read: ' + (error && error.message ? error.message : String(error)))
  res.statusCode = 503
  res.setHeader('Retry-After', '300')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end('This file is unavailable right now. Try again in a few minutes.')
  return { props: {} }
}

// A preset's sitemap: every listed post with the date it last changed, and,
// on a site in several languages, each language's address of it with the
// others as alternates — the editor's static sitemap writes its pages so.
export async function serveContentSitemap(key, context) {
  var res = context.res
  var preset = presetOf(key)
  var main = context.defaultLocale || null
  var locales = [main].concat(
    (Array.isArray(context.locales) ? context.locales : []).filter(function (locale) {
      return locale && locale !== main
    })
  )
  var lists
  try {
    lists = preset
      ? await Promise.all(
          locales.map(function (locale) {
            return readPosts(preset, locale)
          })
        )
      : [[]]
  } catch (error) {
    return unavailable(res, 'sitemap', error)
  }
  var origin = siteOrigin(context.req)
  var multilingual = locales.length > 1
  var addresses = {}
  if (multilingual) {
    lists.forEach(function (posts, index) {
      posts.forEach(function (post) {
        var url = postUrl(origin + localePrefix(locales[index], main), preset.config, post)
        if (!url || post.id === undefined || post.id === null) return
        addresses[String(post.id)] = addresses[String(post.id)] || {}
        addresses[String(post.id)][index] = url
      })
    })
  }
  var entries = []
  lists[0].forEach(function (post) {
    var url = postUrl(origin, preset.config, post)
    if (!url) return
    var lastmod = isoTime(modifiedTime(post))
    var urls = multilingual && post.id !== undefined && post.id !== null ? addresses[String(post.id)] : null
    if (!urls) {
      entries.push({ url: url, lastmod: lastmod, alternates: null })
      return
    }
    var alternates = []
    locales.forEach(function (locale, index) {
      if (urls[index]) alternates.push({ lang: locale, url: urls[index] })
    })
    alternates.push({ lang: 'x-default', url: url })
    locales.forEach(function (locale, index) {
      if (urls[index]) entries.push({ url: urls[index], lastmod: lastmod, alternates: alternates })
    })
  })
  var lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' +
      (multilingual ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : '') +
      '>',
  ]
  entries.slice(0, MAX_ENTRIES).forEach(function (entry) {
    lines.push('  <url>')
    lines.push('    <loc>' + xmlText(entry.url) + '</loc>')
    if (entry.lastmod) lines.push('    <lastmod>' + entry.lastmod + '</lastmod>')
    ;(entry.alternates || []).forEach(function (alternate) {
      lines.push(
        '    <xhtml:link rel="alternate" hreflang="' + xmlText(alternate.lang) + '" href="' + xmlText(alternate.url) + '" />'
      )
    })
    lines.push('  </url>')
  })
  lines.push('</urlset>')
  return send(res, 'application/xml; charset=utf-8', lines.join('\n'))
}

async function readEveryPreset(locale) {
  return Promise.all(
    PRESETS.map(function (preset) {
      return readPosts(preset, locale)
    })
  )
}

// /llms.txt: the site's pages as the editor listed them at publish, then one
// section per preset with its posts by category.
export async function serveLlmsTxt(pages, context) {
  var res = context.res
  var locale = context.locale || null
  var lists
  try {
    lists = await readEveryPreset(locale)
  } catch (error) {
    return unavailable(res, 'llms.txt', error)
  }
  var base = siteOrigin(context.req) + localePrefix(locale, context.defaultLocale)
  var parts = [String(pages || '').trim()]
  PRESETS.forEach(function (preset, index) {
    var lines = []
    groupByCategory(preset, lists[index], locale).forEach(function (group) {
      var entries = []
      group.posts.forEach(function (post) {
        var url = postUrl(base, preset.config, post)
        if (!url) return
        var summary = summaryOf(post)
        entries.push('- [' + linkText(post.title) + '](' + url + ')' + (summary ? ': ' + summary : ''))
      })
      if (!entries.length) return
      if (group.heading) lines.push('### ' + group.heading, '')
      lines.push(entries.join('\n'), '')
    })
    if (lines.length) parts.push(['## ' + preset.config.title, ''].concat(lines).join('\n').trim())
  })
  return send(res, 'text/plain; charset=utf-8', parts.filter(Boolean).join('\n\n') + '\n')
}

// /llms-full.txt: every listed post of the presets in full, as Markdown, in
// the order /llms.txt lists them.
export async function serveLlmsFullTxt(context) {
  var res = context.res
  var locale = context.locale || null
  var lists
  try {
    lists = await readEveryPreset(locale)
  } catch (error) {
    return unavailable(res, 'llms-full.txt', error)
  }
  var base = siteOrigin(context.req) + localePrefix(locale, context.defaultLocale)
  var articles = []
  PRESETS.forEach(function (preset, index) {
    groupByCategory(preset, lists[index], locale).forEach(function (group) {
      group.posts.forEach(function (post) {
        var url = postUrl(base, preset.config, post)
        if (url) articles.push(articleMarkdown(post, url, group.heading))
      })
    })
  })
  return send(res, 'text/plain; charset=utf-8', articles.join('\n\n') + '\n')
}`

/**
 * The generated `content-site-index.js` at the project root: what the live
 * index routes serve, read through each preset's own generated fetcher —
 *
 * - `serveContentSitemap(key, context)`: the preset's sitemap
 *   (`ContentTables.contentSitemapPath`), every published post a search engine
 *   may list with the date it last changed (`<lastmod>`: updated, else
 *   published, else created), each language's address on a site in several;
 * - `serveLlmsTxt(pages, context)`: the editor's page list, then a section per
 *   preset with its posts by category (tree order; Manual Order by place);
 * - `serveLlmsFullTxt(context)`: those posts in full, as Markdown converted
 *   from the stored body without a DOM.
 *
 * Posts are read a page at a time, newest first with the id as tiebreak so no
 * post repeats or drops between pages; drafts are kept out at the source and
 * again on the rows, with the posts that are noindexed or redirect elsewhere —
 * the editor's sitemap leaves those out too. A database that cannot be read
 * answers 503 with `Retry-After`, as the RSS feed does.
 */
export const generateContentSiteIndexSource = (
  presets: ContentSiteIndexPreset[],
  siteUrl: string | null
): string => {
  const imports = presets.length
    ? [
        `import { ${presets
          .map((preset) => TREE_EXPORTS[preset.key])
          .join(', ')}, localizeCategoryTree } from '@/blog-context'`,
        ...presets.map(
          (preset) =>
            `import ${categoryPagesFetcherImportName(preset.key)} from './utils/data-sources/${
              preset.fetcherModule
            }'`
        ),
      ]
    : []
  const presetEntries = presets.map((preset) => {
    const config = {
      title: preset.settings.title,
      postPath: toBasePath(preset.settings.postPath),
      postUrlField: preset.settings.postUrlField,
      postUrlKey: toCamelCase(preset.settings.postUrlField),
      arranged: preset.arranged,
    }
    return `  { key: '${preset.key}', posts: ${categoryPagesFetcherImportName(preset.key)}, tree: ${
      TREE_EXPORTS[preset.key]
    }, config: ${JSON.stringify(config)} },`
  })

  return `${imports.join('\n')}${
    imports.length ? '\n\n' : ''
  }// The site's live index: each content preset's sitemap and the llms files.
// Generated from the content settings in the editor.
var PRESETS = [
${presetEntries.join('\n')}
]
var SITE_URL = ${JSON.stringify(siteUrl || '')}
var PAGE_SIZE = ${SITE_INDEX_PAGE_SIZE}
var MAX_ENTRIES = ${SITE_INDEX_MAX_ENTRIES}
var DESCRIPTION_LENGTH = 200
var PUBLISHED_ONLY = JSON.stringify([
  { type: 'condition', source: 'status', destination: 'published', operand: '=' },
])
var NEWEST_FIRST = JSON.stringify([
  { field: 'created_at', order: 'desc' },
  { field: 'id', order: 'asc' },
])
${presets.length ? '' : 'var localizeCategoryTree = function (tree) { return tree }\n'}
${ARRANGED_ORDER_RUNTIME}

${SITE_INDEX_RUNTIME}
`
}

const routePage = (route: string, call: string, component: string, preamble = ''): string =>
  `import { ${call.split('(')[0]} } from '../${SITE_INDEX_MODULE}'
${preamble}
// ${route}, read on request. Generated from the content settings in the editor.
export async function getServerSideProps(context) {
  return ${call}
}

export default function ${component}() {
  return null
}
`

/** `pages/sitemap-<key>.xml.js`. */
export const generateContentSitemapPageSource = (key: ContentTables.ContentPresetKey): string =>
  routePage(
    ContentTables.contentSitemapPath(key),
    `serveContentSitemap('${key}', context)`,
    'ContentSitemap'
  )

/** `pages/llms.txt.js`, the editor's page list baked in. */
export const generateLlmsTxtPageSource = (pages: string): string =>
  routePage(
    ContentTables.LLMS_TXT_PATH,
    'serveLlmsTxt(PAGES, context)',
    'LlmsTxt',
    `\n// The site's pages, as the editor listed them at publish.\nvar PAGES = ${JSON.stringify(
      pages
    )}\n`
  )

/** `pages/llms-full.txt.js`. */
export const generateLlmsFullTxtPageSource = (): string =>
  routePage(ContentTables.LLMS_FULL_TXT_PATH, 'serveLlmsFullTxt(context)', 'LlmsFullTxt')

/**
 * Emits the live index for every preset whose settings carry `siteIndex` and
 * whose posts table has a fetcher: its sitemap route, and — when the project
 * carries `llms`, which the editor sets only where it writes no static file at
 * those addresses (a page and a `public/` file at one path fail `next build`)
 * — `/llms.txt` (with `llms.index`) and `/llms-full.txt`.
 */
export const addContentSiteIndex = (
  structure: ProjectPluginStructure,
  candidates: Array<[ContentTables.ContentPresetKey, UIDLBlogSettings | undefined]>
): void => {
  const { uidl, files } = structure
  const presets: ContentSiteIndexPreset[] = []
  for (const [key, settings] of candidates) {
    const siteIndex = settings?.siteIndex
    const dataSource = siteIndex ? uidl.dataSources?.[siteIndex.dataSourceId] : undefined
    if (!siteIndex || !dataSource) {
      continue
    }
    const fetcherModule = ensureDataSourceUtilityModule(structure, {
      dataSourceId: siteIndex.dataSourceId,
      dataSourceType: dataSource.type,
      tableName: ContentTables.contentTablesByKey(key).posts,
    })
    if (fetcherModule) {
      presets.push({
        key,
        settings: siteIndex,
        fetcherModule,
        arranged: settings?.order === 'manual',
      })
    }
  }

  const llms = uidl.llms
  const servesLlmsTxt = typeof llms?.index === 'string'
  const servesLlmsFullTxt = !!llms && presets.length > 0
  if (presets.length === 0 && !servesLlmsTxt) {
    return
  }

  files.set(SITE_INDEX_MODULE, {
    path: [],
    files: [
      {
        name: SITE_INDEX_MODULE,
        fileType: FileType.JS,
        content: generateContentSiteIndexSource(
          presets,
          extractBaseUrl(uidl.root.stateDefinitions?.route?.values || [])
        ),
      },
    ],
  })
  for (const preset of presets) {
    files.set(`content-sitemap-${preset.key}`, {
      path: ['pages'],
      files: [
        {
          name: ContentTables.contentSitemapPath(preset.key).slice(1),
          fileType: FileType.JS,
          content: generateContentSitemapPageSource(preset.key),
        },
      ],
    })
  }
  if (servesLlmsTxt) {
    files.set('llms-txt', {
      path: ['pages'],
      files: [
        {
          name: ContentTables.LLMS_TXT_PATH.slice(1),
          fileType: FileType.JS,
          content: generateLlmsTxtPageSource(llms.index),
        },
      ],
    })
  }
  if (servesLlmsFullTxt) {
    files.set('llms-full-txt', {
      path: ['pages'],
      files: [
        {
          name: ContentTables.LLMS_FULL_TXT_PATH.slice(1),
          fileType: FileType.JS,
          content: generateLlmsFullTxtPageSource(),
        },
      ],
    })
  }
}
