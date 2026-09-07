/**
 * Generates JavaScript code for the `teleport_pages` row transformation — the
 * rows the Custom Pages feature stores from its admin panel.
 *
 * The raw row is kept whole (every column, snake_case) and the SEO fields are
 * normalised beside it under camelCase names, the same way the blog post
 * transform exposes its per-post overrides. That is what lets the page's
 * `<Head>` bind `metaTitle` / `robotsContent` / `canonicalUrl` / the Open Graph
 * fields with plain `??` fallbacks, and lets getStaticProps answer the row's
 * own redirect — without a single table-specific branch in the head or the
 * static-props generators.
 *
 * `metaTitle` falls back to `title`: the column is nullable so an author who
 * never filled it in still gets a real `<title>`, and `ogTitle`/`ogDescription`
 * fall back to the meta pair for the same reason.
 */
export const generateCustomPageTransformationCode = (): string => {
  return `
// ============================================================
// Custom Page Transformation
// ============================================================

function buildCustomPage(record, options) {
  if (!record || typeof record !== 'object') return record
  options = options || {}
  var assetMap = options.assetMap || {}

  // Every stored column travels through untouched — the blocks column above
  // all, which the page's array mapper parses — and the normalised SEO fields
  // are added beside them.
  var out = {}
  for (var key in record) {
    if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key]
  }

  var title = typeof record.title === 'string' ? record.title : ''
  var metaTitle = normalizeSeoTextField(pickFirst(record.meta_title, record.metaTitle)) || title || null
  var metaDescription = normalizeSeoTextField(pickFirst(record.meta_description, record.metaDescription))

  var noIndex = coerceBoolean(pickFirst(record.no_index, record.noIndex), false)
  var canonicalUrl = normalizeSeoUrlField(pickFirst(record.canonical_url, record.canonicalUrl))
  var redirectUrl = normalizeSeoUrlField(pickFirst(record.redirect_url, record.redirectUrl))
  var rawRedirectType = pickFirst(record.redirect_type, record.redirectType)
  var redirectType =
    redirectUrl && (rawRedirectType === '301' || rawRedirectType === '302')
      ? rawRedirectType
      : null
  // null — never '' or false — for unset rows, so the page-level fallback (the
  // \`??\` in the generated Head) can take over.
  var robotsContent = noIndex ? 'noindex' : null

  var ogTitle = normalizeSeoTextField(pickFirst(record.og_title, record.ogTitle)) || metaTitle
  var ogDescription =
    normalizeSeoTextField(pickFirst(record.og_description, record.ogDescription)) || metaDescription
  var rawOgImage = normalizeSeoUrlField(pickFirst(record.og_image, record.ogImage))
  var ogImage = rawOgImage ? resolveAssetUrl(rawOgImage, assetMap) || rawOgImage : null

  out.metaTitle = metaTitle
  out.metaDescription = metaDescription
  out.noIndex = noIndex
  out.canonicalUrl = canonicalUrl
  out.redirectUrl = redirectUrl
  out.redirectType = redirectType
  out.robotsContent = robotsContent
  out.ogTitle = ogTitle
  out.ogDescription = ogDescription
  out.ogImage = ogImage
  return out
}

function transformCustomPages(records, options) {
  if (!Array.isArray(records)) return []
  return records.map(function(record) { return buildCustomPage(record, options) })
}

// Trims a free-text SEO cell; blank/non-string values become null.
function normalizeSeoTextField(value) {
  if (typeof value !== 'string') return null
  var trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
`
}
