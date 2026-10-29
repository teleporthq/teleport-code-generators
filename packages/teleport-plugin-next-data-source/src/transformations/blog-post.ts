import type { UIDLEcommerceCategory } from '@teleporthq/teleport-types'
import { ContentTables, RichTextContentCodegen } from '@teleporthq/teleport-shared'
import { generateCategoryTaxonomyCode } from './category-taxonomy'
import { generateAdjacentPostsCode } from './blog-adjacent-posts'
import { generateBlogCommentsCode } from './blog-comments'
import { generateHeadingAnchorsCode } from './heading-anchors'
import { generateCodeCopyButtonsCode } from './code-copy'

/** What the blog-post transform bakes in at export time beyond the row itself. */
export interface BlogPostTransformOptions {
  /**
   * The preset's tables (the Blog's by default): the posts table the related
   * and adjacent posts are read from, the comments table a post page counts.
   */
  tables?: ContentTables.ContentTables
  /** Category taxonomy — lives only in the UIDL, there is no DB table for it. */
  categories?: UIDLEcommerceCategory[]
  /** Content headings get ids and `#` links — see `heading-anchors.ts`. */
  headingAnchors?: boolean
  /**
   * The post pages carry a Contents list: the content's headings get their ids
   * (the `#` links only with `headingAnchors`) and a post page's post its
   * `sections` — see `blogContentsSectionsOf`.
   */
  contents?: boolean
  /** Manual Order: Previous / Next walk the post's category as arranged — see `blog-adjacent-posts.ts`. */
  arranged?: boolean
  /**
   * Every site language's code, the main one included: what `slugByLocale`
   * reads the `<lang>_slug` columns for (the head's hreflang links).
   */
  locales?: string[]
}

/** How much of a body stands in for a missing meta description. */
const META_DESCRIPTION_LENGTH = 155
/** An edit this long after publishing is worth an "Updated on" line. */
const UPDATED_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Generates JavaScript code for blog post data transformation.
 * Transforms raw snake_case database records into the camelCase shape
 * that UIDL components expect.
 */
export const generateBlogPostTransformationCode = (
  options: BlogPostTransformOptions = {}
): string => {
  const tables = options.tables ?? ContentTables.contentTablesByKey('blog')
  return `
// ============================================================
// Blog Post Transformation
// ============================================================
${generateCategoryTaxonomyCode('BLOG_CATEGORIES_BY_ID', options.categories)}
${generateBlogCommentsCode(tables.comments ?? `${tables.posts}_comments`)}
${generateAdjacentPostsCode(tables.posts, options.arranged === true)}
${generateHeadingAnchorsCode()}
${generateCodeCopyButtonsCode()}
${RichTextContentCodegen.generateLegacyRichTextNormalizerCode()}
var BLOG_HEADING_ANCHORS = ${options.headingAnchors === true}
var BLOG_CONTENTS = ${options.contents === true}
var BLOG_PICTURE_STAND_IN = ${tables.pictureStandIn !== false}
var BLOG_LOCALES = ${JSON.stringify(options.locales ?? [])}
var BLOG_META_DESCRIPTION_LENGTH = ${META_DESCRIPTION_LENGTH}
var BLOG_UPDATED_AFTER_MS = ${UPDATED_AFTER_MS}

// The words a reader sees, for a count or a summary.
function blogPlainText(html) {
  // A block's end is a word break; an inline tag (<em>, <a>) is not.
  var text = String(html || '')
    .replace(/<\\/(p|li|h[1-6]|div|details|summary|section|blockquote|tr|td|th)>|<br\\s*\\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
  return decodeHtmlEntities(text).replace(/\\s+/g, ' ').trim()
}

// The opening of the body as a meta description: cut at a word, never mid-word.
function blogSummaryOf(text) {
  if (!text) return null
  if (text.length <= BLOG_META_DESCRIPTION_LENGTH) return text
  var cut = text.slice(0, BLOG_META_DESCRIPTION_LENGTH)
  var space = cut.lastIndexOf(' ')
  return (space > 0 ? cut.slice(0, space) : cut).trim()
}

// A body's own H1 becomes an H2: the page's title is the one H1 a post page has.
function blogDemoteH1(html) {
  if (typeof html !== 'string' || !/<h1[\\s>]/i.test(html)) return html
  return html.replace(/<(\\/?)h1(\\s[^>]*)?>/gi, function(match, closing, attrs) {
    return '<' + closing + 'h2' + (attrs || '') + '>'
  })
}

// The FAQ pairs of a body, text only: each <details> of a .tq-faq section with
// a question in its <summary> and the rest as the answer. What the page's
// FAQPage structured data lists.
function blogFaqOf(html) {
  var pairs = []
  if (typeof html !== 'string' || html.indexOf('tq-faq') === -1) return pairs
  var sections = html.match(/<section[^>]*class="[^"]*\\btq-faq\\b[^"]*"[^>]*>[\\s\\S]*?<\\/section>/gi) || []
  for (var s = 0; s < sections.length; s++) {
    var details = sections[s].match(/<details[\\s>][\\s\\S]*?<\\/details>/gi) || []
    for (var d = 0; d < details.length; d++) {
      var summary = details[d].match(/<summary[^>]*>([\\s\\S]*?)<\\/summary>/i)
      var question = summary ? blogPlainText(summary[1]) : ''
      var answer = blogPlainText(details[d].replace(/<summary[^>]*>[\\s\\S]*?<\\/summary>/i, ' ').replace(/<\\/?details[^>]*>/gi, ' '))
      if (question && answer) pairs.push({ question: question, answer: answer })
    }
  }
  return pairs
}

// The post's slug per site language, for the head's hreflang links: the
// translated column where it holds one, the main slug for the main language.
function blogSlugByLocale(record, mainLang) {
  var out = {}
  for (var l = 0; l < BLOG_LOCALES.length; l++) {
    var locale = BLOG_LOCALES[l]
    // The base column holds the main language; a translation its own copy.
    var value = locale === mainLang ? record.slug : record[locale + '_slug']
    if (typeof value === 'string' && value.trim()) out[locale] = value.trim()
  }
  return out
}

// A post's reading time from its body, for one that stores none: its words at
// about 200 a minute, at least one — what the editor's post form computes. A
// card or post page otherwise printed "min read" with no number before it.
// MUST mirror readingTimeOf in teleport-gui packages/renderer/src/utils/blog-posts.ts.
function blogReadingTimeOf(html) {
  var text = String(html || '').replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim()
  return text ? Math.max(1, Math.ceil(text.split(' ').length / 200)) : null
}

function buildBlogPost(record, options) {
  if (!record || typeof record !== 'object') return record
  options = options || {}
  var currentLang = options.currentLanguage || null
  var mainLang = options.mainLanguage || null
  var assetMap = options.assetMap || {}

  var id = record.id !== undefined && record.id !== null ? record.id : null

  // i18n-resolved text fields
  var title = resolveI18nField(record, 'title', 'title', currentLang, mainLang) || ''
  var slug = resolveI18nField(record, 'slug', 'slug', currentLang, mainLang) || ''
  // A body stored before the rich-text contract (the studio's flat list lines,
  // the admin panel's no-break spaces) reads as stored HTML from here on.
  var content = blogDemoteH1(normalizeLegacyRichTextHtml(
    resolveI18nField(record, 'content', 'content', currentLang, mainLang) || ''
  ))
  // Counted before the heading anchors add their marks.
  var bodyText = blogPlainText(content)
  var wordCount = bodyText ? bodyText.split(' ').length : 0
  var bodyReadingTime = blogReadingTimeOf(content)
  var faq = blogFaqOf(content)
  // The Contents list links to the headings, so they get their ids for it too
  // — the # links only with the heading anchors on. Its sections ride on a
  // post page's own fetch only (options.details): a listing draws no list, and
  // every card of it would otherwise carry one.
  var contentsHeadings = BLOG_CONTENTS && options.details === true ? [] : null
  if (BLOG_HEADING_ANCHORS || BLOG_CONTENTS) {
    content = addHeadingAnchors(content, { links: BLOG_HEADING_ANCHORS, sections: contentsHeadings })
  }
  // After the word count: the button's label is not a word of the post.
  content = addCodeCopyButtons(content)
  var excerpt = resolveI18nField(record, 'excerpt', 'excerpt', currentLang, mainLang) || ''
  var category = resolveI18nField(record, 'category', 'category', currentLang, mainLang) || null

  // Assigned category ids -> resolved {id,name,slug} objects for the post-details
  // BREADCRUMBS (and anything else mapping over them). The taxonomy itself is not
  // in the DB (categories are authored in the GUI and live only in
  // blogSettings.categories); resolved against BLOG_CATEGORIES_BY_ID, baked in at
  // export time. Unknown/stale ids are silently dropped. \`category\` above stays
  // the denormalized PRIMARY name.
  var categories = resolveAssignedCategories(
    record.category_ids,
    BLOG_CATEGORIES_BY_ID,
    currentLang,
    mainLang,
    category
  )
  // Never empty on the page: a post with no meta title is titled by its title,
  // one with no meta description described by its excerpt, else by its opening.
  var metaTitle = resolveI18nField(record, 'meta_title', 'metaTitle', currentLang, mainLang) || title || null
  var metaDescription =
    resolveI18nField(record, 'meta_description', 'metaDescription', currentLang, mainLang) ||
    blogPlainText(resolveI18nField(record, 'excerpt', 'excerpt', currentLang, mainLang)) ||
    blogSummaryOf(bodyText)
  var featuredImageAlt = resolveI18nField(record, 'featured_image_alt', 'featuredImageAlt', currentLang, mainLang) || null
  var authorBio = resolveI18nField(record, 'author_bio', 'authorBio', currentLang, mainLang) || null

  // Status
  var status = record.status || 'draft'

  // Asset fields - resolve IDs to URLs
  var rawFeaturedImage = pickFirst(record.featured_image_url, record.featuredImageUrl)
  var TELEPORT_DEFAULT_FEATURED_IMG = 'https://play.teleporthq.io/static/svg/default-img.svg'
  var featuredImageUrl = resolveAssetUrl(rawFeaturedImage, assetMap)
  if (
    !featuredImageUrl ||
    rawFeaturedImage === TELEPORT_DEFAULT_FEATURED_IMG ||
    featuredImageUrl === TELEPORT_DEFAULT_FEATURED_IMG
  ) {
    // No picture of its own: the grey "No image" stand-in, or none at all for a
    // preset whose posts are text (ContentTables.pictureStandIn) — its card and
    // post page show the picture only when there is one.
    featuredImageUrl = BLOG_PICTURE_STAND_IN
      ? 'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240"><rect fill="#e5e7eb" width="400" height="240"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#9ca3af" font-family="system-ui,sans-serif" font-size="13">No image</text></svg>'
        )
      : null
  }

  // The picture the head shares and the structured data names: the post's own,
  // never the stand-in.
  var socialImageUrl = featuredImageUrl && featuredImageUrl.indexOf('data:') !== 0 ? featuredImageUrl : null

  var rawAuthorAvatar = pickFirst(record.author_avatar_url, record.authorAvatarUrl)
  var authorAvatarUrl = resolveAssetUrl(rawAuthorAvatar, assetMap)

  // Simple pass-through fields
  var authorName = pickFirst(record.author_name, record.authorName)
  var authorInitials = blogAuthorInitials(authorName)
  // The author's email never leaves the server: a visitor's API read hides it
  // (browser-row-policy.ts), and the page data a post or listing page ships
  // is built here, so it is not part of the post a page sees either.
  var readingTimeMinutes = safeNumber(pickFirst(record.reading_time_minutes, record.readingTimeMinutes), null)
  if (!(readingTimeMinutes > 0)) readingTimeMinutes = bodyReadingTime

  // Tags - i18n-resolved then parsed as JSON array
  var rawTags = resolveI18nField(record, 'tags', 'tags', currentLang, mainLang)
  var tags = parseJsonArray(rawTags)
  var tagsText = tags.length > 0 ? tags.join(', ') : null
  var primaryCategory = categories.length > 0 ? categories[0] : null

  // Gallery images - parse JSON array then resolve each asset URL
  var rawGalleryImages = pickFirst(record.gallery_images, record.galleryImages)
  var parsedGalleryImages = parseJsonArray(rawGalleryImages)
  var galleryImages = resolveAssetUrls(parsedGalleryImages, assetMap)

  // Computed: allImages = [featuredImageUrl, ...galleryImages] (skip null featured)
  var allImages = []
  if (featuredImageUrl) allImages.push(featuredImageUrl)
  allImages = allImages.concat(galleryImages)

  // Boolean fields
  var isFeatured = coerceBoolean(pickFirst(record.is_featured, record.isFeatured), false)
  var allowComments = record.allow_comments !== undefined
    ? coerceBoolean(record.allow_comments, true)
    : record.allowComments !== undefined
      ? coerceBoolean(record.allowComments, true)
      : true

  // Per-post SEO overrides. The transform is the single normalization point —
  // rows can also be written by the raw admin CRUD form, so whitespace and
  // unknown redirect types are neutralized here. Absent columns (a table
  // provisioned before the feature) read as undefined and normalize to null.
  // robotsContent is null — never '' or false — for unset rows, so the
  // page-level fallback (the \`??\` in the generated Head) can take over.
  var noIndex = coerceBoolean(pickFirst(record.no_index, record.noIndex), false)
  var canonicalUrl = normalizeSeoUrlField(pickFirst(record.canonical_url, record.canonicalUrl))
  var redirectUrl = normalizeSeoUrlField(pickFirst(record.redirect_url, record.redirectUrl))
  var rawRedirectType = pickFirst(record.redirect_type, record.redirectType)
  var redirectType =
    redirectUrl && (rawRedirectType === '301' || rawRedirectType === '302')
      ? rawRedirectType
      : null
  var robotsContent = noIndex ? 'noindex' : null

  // The author's related-post picks. \`relatedPosts\` carries the TRANSFORMED
  // rows, not ids, so the details page's related-posts rail can map over it and
  // draw an article card per entry; \`relatedPostIds\` keeps the raw selection.
  // The rows arrive from ONE batched query (getRelatedPostsMap) that
  // transformRecords runs, keyed by id in options.relatedPostsById.
  //
  // MUST mirror buildRelatedBlogPosts in packages/renderer/src/utils/blog-posts.ts
  // (the canvas-preview SSOT): the author's order, UNPUBLISHED posts dropped,
  // self dropped, and the nested build deliberately WITHOUT the map — two posts
  // pointing at each other is ordinary and would otherwise recurse forever.
  var relatedPostIds = parseRelatedIds(record.related_post_ids)
  var relatedPostsById = options.relatedPostsById
  var relatedPosts = []
  // The nested builds of the related and adjacent posts get NO maps: each is a
  // card, not a page, and two posts that point at each other would recurse.
  var relatedNestedOptions = {
    assetMap: assetMap,
    currentLanguage: currentLang,
    mainLanguage: mainLang,
    card: true,
  }
  if (relatedPostsById && relatedPostIds.length > 0) {
    for (var rp = 0; rp < relatedPostIds.length; rp++) {
      var relatedId = relatedPostIds[rp]
      if (id != null && relatedId === String(id)) continue
      var relatedRecord = relatedPostsById[relatedId]
      if (!relatedRecord) continue
      // A draft must not reach the storefront through another post's rail.
      // Missing status reads as 'draft', the same default as above.
      if ((relatedRecord.status || 'draft') !== 'published') continue
      relatedPosts.push(buildBlogPost(relatedRecord, relatedNestedOptions))
    }
  }

  // The previous (older) and next (newer) published post, as 0-or-1-item
  // lists: the post navigation maps over them like the related rail does, so an
  // end of the blog simply renders no card on that side.
  var adjacent = options.adjacentPostsById && id != null ? options.adjacentPostsById[String(id)] : null
  var previousPosts = adjacent && adjacent.previous ? [buildBlogPost(adjacent.previous, relatedNestedOptions)] : []
  var nextPosts = adjacent && adjacent.next ? [buildBlogPost(adjacent.next, relatedNestedOptions)] : []

  // The approved comments — the newest top-level ones, each with its replies —
  // present only on a details fetch; see blog-comments.ts.
  var commentsEntry = options.commentsByPostId && id != null ? options.commentsByPostId[String(id)] : null
  var comments = commentsEntry ? buildBlogComments(commentsEntry.rows) : []
  var commentsCount = commentsEntry ? commentsEntry.count : 0

  // Timestamps
  var rawPublishedAt = pickFirst(record.published_at, record.publishedAt)
  var publishedAt = rawPublishedAt != null ? normalizeTimestamp(rawPublishedAt) : null

  var rawCreatedAt = pickFirst(record.created_at, record.createdAt, record.created)
  var createdAt = normalizeTimestamp(rawCreatedAt)

  var rawUpdatedAt = pickFirst(record.updated_at, record.updatedAt, record.updated)
  var updatedAt = rawUpdatedAt != null ? normalizeTimestamp(rawUpdatedAt) : createdAt

  // Computed: created = Unix seconds from createdAt milliseconds
  var created = Math.floor(createdAt / 1000)
  var publishedAtIso = publishedAt != null && status === 'published' ? new Date(publishedAt).toISOString() : null
  var updatedAtIso = updatedAt != null ? new Date(updatedAt).toISOString() : null
  // An edit a day or more after publishing is worth telling the reader: the
  // date of it, else null — what the page's "Updated on" line shows and gates on.
  var updatedAfterPublishIso =
    publishedAt != null && updatedAt != null && updatedAt - publishedAt > BLOG_UPDATED_AFTER_MS
      ? updatedAtIso
      : null

  return {
    id: id,
    title: title,
    slug: slug,
    // A card of another post carries no body: no card shows one, and six
    // related cards' bodies were most of an article page's data. MUST mirror
    // \`card\` in packages/renderer/src/utils/blog-posts.ts (teleport-gui).
    content: options.card === true ? '' : content,
    excerpt: excerpt,
    status: status,
    category: category,
    categories: categories,
    tags: tags,
    relatedPostIds: relatedPostIds,
    relatedPosts: relatedPosts,
    featuredImageUrl: featuredImageUrl,
    featuredImageAlt: featuredImageAlt,
    galleryImages: galleryImages,
    allImages: allImages,
    authorName: authorName,
    author_name: authorName,
    authorAvatarUrl: authorAvatarUrl,
    authorBio: authorBio,
    authorInitials: authorInitials,
    metaTitle: metaTitle,
    metaDescription: metaDescription,
    readingTimeMinutes: readingTimeMinutes,
    wordCount: wordCount,
    tagsText: tagsText,
    categoryName: primaryCategory ? primaryCategory.name : category,
    categorySlug: primaryCategory ? primaryCategory.slug : null,
    socialImageUrl: socialImageUrl,
    slugByLocale: blogSlugByLocale(record, mainLang),
    faq: faq,
    // The post's sections, what its page's Contents list links to — see
    // blogContentsSectionsOf; empty off a post page or under three sections.
    sections: contentsHeadings ? blogContentsSectionsOf(contentsHeadings) : [],
    isFeatured: isFeatured,
    allowComments: allowComments,
    comments: comments,
    commentsCount: commentsCount,
    previousPosts: previousPosts,
    nextPosts: nextPosts,
    noIndex: noIndex,
    canonicalUrl: canonicalUrl,
    redirectUrl: redirectUrl,
    redirectType: redirectType,
    robotsContent: robotsContent,
    publishedAt: publishedAt,
    createdAt: createdAt,
    updatedAt: updatedAt,
    publishedAtIso: publishedAtIso,
    updatedAtIso: updatedAtIso,
    updatedAfterPublishIso: updatedAfterPublishIso,
    created: created,
    // The post's place among its primary category's posts (Manual Order), or
    // null: what the category pages order by.
    sortOrder: safeNumber(pickFirst(record.sort_order, record.sortOrder), null),
  }
}

function transformBlogPosts(records, options) {
  if (!Array.isArray(records)) return []
  return records.map(function(record) { return buildBlogPost(record, options) })
}

// Batched fetch of the post rows a set of posts reference as "related", keyed by
// id. Best-effort in the same way as the product side: a table provisioned
// before the column yields no ids (the read is of an absent property, not of a
// column — the SQL never names it), the map stays empty, and the rail stays
// hidden behind its is_not_empty gate.
async function getRelatedPostsMap(getClientFn, records) {
  var map = {}
  if (!Array.isArray(records) || records.length === 0) return map

  var wantedIds = []
  for (var i = 0; i < records.length; i++) {
    var ids = parseRelatedIds(records[i] && records[i].related_post_ids)
    for (var j = 0; j < ids.length; j++) {
      if (wantedIds.indexOf(ids[j]) === -1) wantedIds.push(ids[j])
    }
  }
  if (wantedIds.length === 0) return map

  var client
  try {
    client = getClientFn()
    await client.connect()
    var result = await client.query('SELECT * FROM ${tables.posts} WHERE id = ANY($1)', [
      wantedIds,
    ])
    if (result && result.rows) {
      for (var r = 0; r < result.rows.length; r++) {
        var row = result.rows[r]
        if (row && row.id != null) map[String(row.id)] = row
      }
    }
  } catch (e) {
    // Leaves relatedPosts empty rather than failing the page.
  } finally {
    if (client) {
      try { await client.end() } catch (e) { /* ignore */ }
    }
  }
  return map
}
`
}
