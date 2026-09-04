/**
 * Generates JavaScript code for blog post data transformation.
 * Transforms raw snake_case database records into the camelCase shape
 * that UIDL components expect.
 */
export const generateBlogPostTransformationCode = (): string => {
  return `
// ============================================================
// Blog Post Transformation
// ============================================================

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
  var content = resolveI18nField(record, 'content', 'content', currentLang, mainLang) || ''
  var excerpt = resolveI18nField(record, 'excerpt', 'excerpt', currentLang, mainLang) || ''
  var category = resolveI18nField(record, 'category', 'category', currentLang, mainLang) || null
  var metaTitle = resolveI18nField(record, 'meta_title', 'metaTitle', currentLang, mainLang) || null
  var metaDescription = resolveI18nField(record, 'meta_description', 'metaDescription', currentLang, mainLang) || null
  var featuredImageAlt = resolveI18nField(record, 'featured_image_alt', 'featuredImageAlt', currentLang, mainLang) || null

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
    featuredImageUrl =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240"><rect fill="#e5e7eb" width="400" height="240"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#9ca3af" font-family="system-ui,sans-serif" font-size="13">No image</text></svg>'
      )
  }

  var rawAuthorAvatar = pickFirst(record.author_avatar_url, record.authorAvatarUrl)
  var authorAvatarUrl = resolveAssetUrl(rawAuthorAvatar, assetMap)

  // Simple pass-through fields
  var authorName = pickFirst(record.author_name, record.authorName)
  var authorEmail = pickFirst(record.author_email, record.authorEmail)
  var readingTimeMinutes = safeNumber(pickFirst(record.reading_time_minutes, record.readingTimeMinutes), null)

  // Tags - i18n-resolved then parsed as JSON array
  var rawTags = resolveI18nField(record, 'tags', 'tags', currentLang, mainLang)
  var tags = parseJsonArray(rawTags)

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
  if (relatedPostsById && relatedPostIds.length > 0) {
    var relatedNestedOptions = {
      assetMap: assetMap,
      currentLanguage: currentLang,
      mainLanguage: mainLang,
    }
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

  // Timestamps
  var rawPublishedAt = pickFirst(record.published_at, record.publishedAt)
  var publishedAt = rawPublishedAt != null ? normalizeTimestamp(rawPublishedAt) : null

  var rawCreatedAt = pickFirst(record.created_at, record.createdAt, record.created)
  var createdAt = normalizeTimestamp(rawCreatedAt)

  var rawUpdatedAt = pickFirst(record.updated_at, record.updatedAt, record.updated)
  var updatedAt = rawUpdatedAt != null ? normalizeTimestamp(rawUpdatedAt) : createdAt

  // Computed: created = Unix seconds from createdAt milliseconds
  var created = Math.floor(createdAt / 1000)

  return {
    id: id,
    title: title,
    slug: slug,
    content: content,
    excerpt: excerpt,
    status: status,
    category: category,
    tags: tags,
    relatedPostIds: relatedPostIds,
    relatedPosts: relatedPosts,
    featuredImageUrl: featuredImageUrl,
    featuredImageAlt: featuredImageAlt,
    galleryImages: galleryImages,
    allImages: allImages,
    authorName: authorName,
    authorEmail: authorEmail,
    author_name: authorName,
    author_email: authorEmail,
    authorAvatarUrl: authorAvatarUrl,
    metaTitle: metaTitle,
    metaDescription: metaDescription,
    readingTimeMinutes: readingTimeMinutes,
    isFeatured: isFeatured,
    allowComments: allowComments,
    noIndex: noIndex,
    canonicalUrl: canonicalUrl,
    redirectUrl: redirectUrl,
    redirectType: redirectType,
    robotsContent: robotsContent,
    publishedAt: publishedAt,
    createdAt: createdAt,
    updatedAt: updatedAt,
    created: created,
  }
}

function transformBlogPosts(records, options) {
  if (!Array.isArray(records)) return []
  return records.map(function(record) { return buildBlogPost(record, options) })
}

// Trims a per-post SEO URL cell; blank/non-string values (including columns
// that don't exist yet on tables provisioned before the feature) become null.
function normalizeSeoUrlField(value) {
  if (typeof value !== 'string') return null
  var trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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
    var result = await client.query('SELECT * FROM teleport_blog_posts WHERE id = ANY($1)', [
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
