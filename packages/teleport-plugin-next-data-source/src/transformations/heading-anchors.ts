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
 * The fewest sections a post's Contents list is drawn for: a shorter post is
 * taken in at a glance.
 *
 * ⛔ PAIRED with `CONTENTS_MIN_SECTIONS` in teleport-gui
 * `packages/renderer/src/utils/blog-posts.ts`, the canvas's copy.
 */
export const CONTENTS_MIN_SECTIONS = 3

/**
 * Generates `addHeadingAnchors(html, options)`: every `<h2>`–`<h6>` of a post's
 * content gets an `id` (kept when it already has one, otherwise a slug of its
 * text, unique within the post) and a trailing `#` link to itself, so a section
 * can be linked to (`/blog/post#setup`) and the link works on the very first
 * load — the ids are in the server-rendered HTML.
 *
 * `options.links: false` gives the headings their ids without the `#` links —
 * what a post page's Contents list needs when the heading anchors are off.
 * `options.sections`, an array, collects every heading as `{ level, id, text }`
 * in reading order, and `blogContentsSectionsOf` turns those into the list.
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
var BLOG_HEADING_ANCHOR_LINK_PATTERN = /<a\\s[^>]*class="${BLOG_HEADING_ANCHOR_CLASS}"[^>]*>[\\s\\S]*?<\\/a>/gi
var BLOG_CONTENTS_MIN_SECTIONS = ${CONTENTS_MIN_SECTIONS}

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

function addHeadingAnchors(html, options) {
  options = options || {}
  var withLinks = options.links !== false
  var sections = Array.isArray(options.sections) ? options.sections : null
  if (typeof html !== 'string' || !/<h[2-6][\\s>]/i.test(html)) return html
  // Every id the content already uses is taken, so a generated one never
  // duplicates it. No prototype: a heading titled "Constructor" is free to be
  // #constructor.
  var used = Object.create(null)
  var existingIds = new RegExp(BLOG_HEADING_ID_PATTERN.source, 'gi')
  var existing
  while ((existing = existingIds.exec(html)) !== null) {
    used[decodeHtmlEntities(existing[2] || existing[3] || '')] = true
  }

  return html.replace(/<h([2-6])(\\s[^>]*)?>([\\s\\S]*?)<\\/h\\1>/gi, function(match, level, rawAttrs, inner) {
    var attrs = rawAttrs || ''
    var idMatch = attrs.match(BLOG_HEADING_ID_PATTERN)
    var id = idMatch ? decodeHtmlEntities(idMatch[2] || idMatch[3] || '') : ''
    if (inner.indexOf(BLOG_HEADING_ANCHOR_CLASS) !== -1) {
      if (sections && id) {
        var anchoredText = stripHtmlTags(inner.replace(BLOG_HEADING_ANCHOR_LINK_PATTERN, ''))
        if (anchoredText) sections.push({ level: Number(level), id: id, text: anchoredText })
      }
      return match
    }
    var text = stripHtmlTags(inner)
    if (!text) return match
    if (!id) {
      id = blogHeadingSlug(text, used)
      attrs = ' id="' + escapeHeadingAttribute(id) + '"' + attrs
    }
    if (sections) sections.push({ level: Number(level), id: id, text: text })
    return (
      '<h' + level + attrs + '>' + inner +
      (withLinks
        ? '<a class="' + BLOG_HEADING_ANCHOR_CLASS + '" href="#' + escapeHeadingAttribute(id) +
          '" aria-hidden="true" tabindex="-1">#</a>'
        : '') +
      '</h' + level + '>'
    )
  })
}

// A post page's Contents list: the post's sections, i.e. its headings of the
// topmost level it uses, each with the address that jumps to it; none for a
// post of fewer than BLOG_CONTENTS_MIN_SECTIONS sections.
// MUST mirror contentsSectionsOf in teleport-gui packages/renderer/src/utils/blog-posts.ts.
function blogContentsSectionsOf(headings) {
  if (!Array.isArray(headings) || headings.length === 0) return []
  var top = 6
  for (var i = 0; i < headings.length; i++) {
    if (headings[i].level < top) top = headings[i].level
  }
  var sections = []
  for (var j = 0; j < headings.length; j++) {
    if (headings[j].level !== top) continue
    sections.push({ id: headings[j].id, title: headings[j].text, href: '#' + headings[j].id })
  }
  return sections.length >= BLOG_CONTENTS_MIN_SECTIONS ? sections : []
}
`
