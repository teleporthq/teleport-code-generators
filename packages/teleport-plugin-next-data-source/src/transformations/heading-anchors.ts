/**
 * The class of the `#` link added to a post's content headings.
 *
 * ⛔ PAIRED with `BLOG_HEADING_ANCHOR_CLASS` in teleport-gui
 * `features/blog/constants/blog-heading-anchors.ts`, whose stylesheet (shipped
 * on the post page) is what keeps the link out of sight until the heading is
 * hovered or focused.
 */
export const BLOG_HEADING_ANCHOR_CLASS = 'tq-heading-anchor'

/**
 * Generates `addHeadingAnchors(html)`: every `<h2>`–`<h6>` of a post's content
 * gets an `id` (kept when it already has one, otherwise a slug of its text,
 * unique within the post) and a trailing `#` link to itself, so a section can
 * be linked to (`/blog/post#setup`) and the link works on the very first load —
 * the ids are in the server-rendered HTML.
 *
 * The link repeats the heading a screen reader already announces, so it is
 * hidden from assistive technology and left out of the tab order; the heading
 * stays the landmark.
 *
 * Idempotent: a heading that already carries the link is left alone. `h1` is
 * the post title's level and is never touched.
 */
export const generateHeadingAnchorsCode = (): string => `
var BLOG_HEADING_ANCHOR_CLASS = '${BLOG_HEADING_ANCHOR_CLASS}'
var BLOG_HEADING_ID_PATTERN = /\\sid\\s*=\\s*("([^"]*)"|'([^']*)')/i

function escapeHeadingAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function blogHeadingSlug(text, used) {
  var base = String(text || '')
    .normalize('NFKD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  if (!base) base = 'section'
  var slug = base
  var suffix = 2
  while (used[slug]) {
    slug = base + '-' + suffix
    suffix++
  }
  used[slug] = true
  return slug
}

function addHeadingAnchors(html) {
  if (typeof html !== 'string' || !/<h[2-6][\\s>]/i.test(html)) return html
  // Every id the content already uses is taken, so a generated one never
  // duplicates it.
  var used = {}
  var existingIds = new RegExp(BLOG_HEADING_ID_PATTERN.source, 'gi')
  var existing
  while ((existing = existingIds.exec(html)) !== null) {
    used[decodeHtmlEntities(existing[2] || existing[3] || '')] = true
  }

  return html.replace(/<h([2-6])(\\s[^>]*)?>([\\s\\S]*?)<\\/h\\1>/gi, function(match, level, rawAttrs, inner) {
    if (inner.indexOf(BLOG_HEADING_ANCHOR_CLASS) !== -1) return match
    var text = stripHtmlTags(inner)
    if (!text) return match
    var attrs = rawAttrs || ''
    var idMatch = attrs.match(BLOG_HEADING_ID_PATTERN)
    var id = idMatch ? decodeHtmlEntities(idMatch[2] || idMatch[3] || '') : ''
    if (!id) {
      id = blogHeadingSlug(text, used)
      attrs = ' id="' + escapeHeadingAttribute(id) + '"' + attrs
    }
    return (
      '<h' + level + attrs + '>' + inner +
      '<a class="' + BLOG_HEADING_ANCHOR_CLASS + '" href="#' + escapeHeadingAttribute(id) +
      '" aria-hidden="true" tabindex="-1">#</a>' +
      '</h' + level + '>'
    )
  })
}
`
