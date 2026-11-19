import { toJsLiteral } from '../pwa/source-literals'
import { ForumConfig } from './settings'

export const FORUM_SITEMAP_PATH = '/sitemap-forum.xml'
export const FORUM_LLMS_PATH = '/llms-forum.txt'

/**
 * The forum's search-engine side, as JavaScript the data module carries:
 *
 * - `topicNoIndex(topic, community)`: a pending or removed topic, one in a
 *   private community or one not yet approved in a restricted one is kept out
 *   of search engines (plan 8.3);
 * - `topicJsonLd(topic, community, replies, url)`: `DiscussionForumPosting`,
 *   and `QAPage` when the community takes questions and an answer is accepted.
 *
 * The page writes the JSON-LD into its head (see `page-rewrite.ts`).
 */
export const FORUM_SEO_RUNTIME = `// --- search engines --------------------------------------------------------
function topicNoIndex(topic, community) {
  if (!topic || topic.status !== 'published') return true;
  if (!community || community.status !== 'active') return true;
  return community.visibility === 'private';
}

function personOf(row) {
  return row && row.author_name ? { '@type': 'Person', name: row.author_name } : undefined;
}

function postingOf(row, url) {
  return {
    '@type': 'Comment',
    text: row.body_text || '',
    url: url,
    author: personOf(row),
    datePublished: row.created_at || undefined,
    upvoteCount: typeof row.upvotes === 'number' ? row.upvotes : undefined,
  };
}

function topicJsonLd(topic, community, replies, url) {
  var answers = (replies || []).filter(function (reply) { return reply.is_accepted; });
  var isQuestion = community && community.kind === 'questions' && answers.length > 0;
  var posting = {
    '@type': 'DiscussionForumPosting',
    '@id': url,
    url: url,
    headline: topic.title,
    text: topic.body_text || '',
    author: personOf(topic),
    datePublished: topic.created_at || undefined,
    dateModified: topic.edited_at || topic.updated_at || undefined,
    interactionStatistic: [
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: topic.reply_count || 0 },
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: topic.upvotes || 0 },
    ],
    comment: (replies || []).slice(0, 20).map(function (reply) { return postingOf(reply, url + '#reply-' + reply.id); }),
  };
  if (!isQuestion) {
    posting['@context'] = 'https://schema.org';
    return posting;
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'QAPage',
    mainEntity: {
      '@type': 'Question',
      name: topic.title,
      text: topic.body_text || '',
      author: personOf(topic),
      dateCreated: topic.created_at || undefined,
      answerCount: topic.reply_count || 0,
      upvoteCount: topic.upvotes || 0,
      acceptedAnswer: Object.assign(postingOf(answers[0], url + '#reply-' + answers[0].id), { '@type': 'Answer' }),
    },
  };
}
`

const SINGLE_LANGUAGE_ENTRIES_SOURCE = `  var base = origin(context.req)
  var lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
  var entry = function (path, at) {
    lines.push('  <url>')
    lines.push('    <loc>' + xmlText(base + path) + '</loc>')
    if (at) lines.push('    <lastmod>' + xmlText(at) + '</lastmod>')
    lines.push('  </url>')
  }
`

/**
 * A site in several languages: each page once per language (the default
 * unprefixed, the others under `/<locale>`), each naming every language's
 * address and the default one as `x-default` — as the editor's static
 * sitemap and the content presets' live one write theirs.
 */
const MULTILINGUAL_ENTRIES_SOURCE = `  var base = origin(context.req)
  var main = context.defaultLocale || null
  var locales = [main].concat((Array.isArray(context.locales) ? context.locales : []).filter(function (locale) {
    return locale && locale !== main
  }))
  var lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">']
  var entry = function (path, at) {
    var addresses = locales.map(function (locale) {
      return { lang: locale, url: base + (locale && locale !== main ? '/' + locale : '') + path }
    })
    var alternates = addresses.length > 1 ? addresses.concat([{ lang: 'x-default', url: base + path }]) : []
    addresses.forEach(function (address) {
      lines.push('  <url>')
      lines.push('    <loc>' + xmlText(address.url) + '</loc>')
      if (at) lines.push('    <lastmod>' + xmlText(at) + '</lastmod>')
      alternates.forEach(function (alternate) {
        lines.push('    <xhtml:link rel="alternate" hreflang="' + xmlText(alternate.lang) + '" href="' + xmlText(alternate.url) + '" />')
      })
      lines.push('  </url>')
    })
  }
`

/** Source only a forum with communities gets: one without them names, links and lists none. */
const withCommunities = (config: ForumConfig, source: string): string =>
  config.settings.structure === 'communities' ? source : ''

const communityBaseSource = (config: ForumConfig): string =>
  withCommunities(
    config,
    `var COMMUNITY_BASE = ${toJsLiteral(config.routes.community?.staticBase ?? '/forum/c')}\n`
  )

/**
 * `pages/sitemap-forum.xml.js` and `pages/llms-forum.txt.js`: every public
 * topic and every active community that is not private, read on request
 * through the data module (`listPublicIndex`), as the content presets' live
 * sitemap does (`blog/content-site-index.ts`). The forum's entries are kept
 * in files of their own because the editor's `/llms.txt` page lists the
 * presets' posts and is written by the blog plugin alone. A forum without
 * communities lists its topics only.
 */
export const buildForumSitemapPageSource = (
  config: ForumConfig,
  options: { multilingual?: boolean } = {}
): string => {
  const topicBase = config.routes.topic?.staticBase ?? '/forum/t'
  const communityEntries = withCommunities(
    config,
    `  index.communities.forEach(function (row) { entry(COMMUNITY_BASE + '/' + encodeURIComponent(row.slug), row.updated_at) })\n`
  )
  return `import { listPublicIndex } from '../utils/forum-page-data'

var TOPIC_BASE = ${toJsLiteral(topicBase)}
${communityBaseSource(config)}
function xmlText(value) {
  return String(value == null ? '' : value)
    .replace(/[^\\x09\\x0a\\x0d\\x20-\\uD7FF\\uE000-\\uFFFD]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function origin(req) {
  var host = String((req && req.headers && req.headers.host) || '')
  if (!/^[a-z0-9.-]+(:\\d+)?$/i.test(host)) return ''
  var proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  var local = /^(localhost|127\\.0\\.0\\.1)(:\\d+)?$/.test(host)
  return (proto === 'http' || proto === 'https' ? proto : local ? 'http' : 'https') + '://' + host
}

// ${FORUM_SITEMAP_PATH}, read on request. Generated from the Forum plugin.
export async function getServerSideProps(context) {
  var res = context.res
  var index
  try {
    index = await listPublicIndex()
  } catch (error) {
    console.error('[forum] the sitemap could not be read: ' + (error && error.message ? error.message : String(error)))
    res.statusCode = 503
    res.setHeader('Retry-After', '300')
    res.setHeader('Cache-Control', 'no-store')
    res.end('This file is unavailable right now. Try again in a few minutes.')
    return { props: {} }
  }
${
  options.multilingual ? MULTILINGUAL_ENTRIES_SOURCE : SINGLE_LANGUAGE_ENTRIES_SOURCE
}${communityEntries}  index.topics.forEach(function (row) { entry(TOPIC_BASE + '/' + encodeURIComponent(row.slug), row.updated_at) })
  lines.push('</urlset>')
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/xml; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600')
  res.end(lines.join('\\n'))
  return { props: {} }
}

export default function ForumSitemap() {
  return null
}
`
}

export const buildForumLlmsPageSource = (config: ForumConfig): string => {
  const topicBase = config.routes.topic?.staticBase ?? '/forum/t'
  const communityWords = withCommunities(config, 'communities and ')
  const communityHeading = withCommunities(config, `, '', '## Communities', ''`)
  const communityLinks = withCommunities(
    config,
    `  index.communities.forEach(function (row) {
    lines.push('- [' + linkText(row.name) + '](' + base + COMMUNITY_BASE + '/' + encodeURIComponent(row.slug) + ')' + (row.description ? ': ' + linkText(row.description).slice(0, 200) : ''))
  })
`
  )
  return `import { listPublicIndex } from '../utils/forum-page-data'

var TOPIC_BASE = ${toJsLiteral(topicBase)}
${communityBaseSource(config)}
function linkText(value) {
  return String(value == null ? '' : value).replace(/\\s+/g, ' ').replace(/[\\[\\]]/g, '\\\\$&').trim()
}

// ${FORUM_LLMS_PATH}: the forum's ${communityWords}public topics, for language models.
export async function getServerSideProps(context) {
  var res = context.res
  var index
  try {
    index = await listPublicIndex()
  } catch (error) {
    res.statusCode = 503
    res.setHeader('Retry-After', '300')
    res.setHeader('Cache-Control', 'no-store')
    res.end('This file is unavailable right now. Try again in a few minutes.')
    return { props: {} }
  }
  var host = String((context.req && context.req.headers && context.req.headers.host) || '')
  var base = /^[a-z0-9.-]+(:\\d+)?$/i.test(host) ? 'https://' + host : ''
  var lines = ['# Forum'${communityHeading}]
${communityLinks}  lines.push('', '## Topics', '')
  index.topics.forEach(function (row) {
    lines.push('- [' + linkText(row.title) + '](' + base + TOPIC_BASE + '/' + encodeURIComponent(row.slug) + ')' + (row.excerpt ? ': ' + linkText(row.excerpt) : ''))
  })
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600')
  res.end(lines.join('\\n') + '\\n')
  return { props: {} }
}

export default function ForumLlms() {
  return null
}
`
}
