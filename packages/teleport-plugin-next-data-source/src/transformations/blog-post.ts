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
`
}
