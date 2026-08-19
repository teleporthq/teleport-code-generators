/**
 * Reading Next.js dynamic route templates.
 *
 * A details page's route is a TEMPLATE, not a URL: `/event-details/[id]`. Two
 * different consumers have to understand that, and both got it wrong in
 * different ways — the SEO head plugin emitted the template verbatim into
 * `<link rel="canonical">`, `og:url` and the sitemap, and the navlink resolver
 * handed out the bare prefix (`/event-details`) as if it were a real route.
 * Both produce a URL that 404s.
 *
 * Lives in teleport-shared because the two callers sit in packages that do not
 * (and should not) depend on each other.
 *
 * Pure; never throws.
 */

/**
 * A Next.js dynamic path segment — `/[id]`, `/[slug]` — occupying a WHOLE
 * segment.
 *
 * Anchored on BOTH sides so a stray bracket is never mistaken for a route
 * param: on the left it must open a segment (start of string or `/`), and on
 * the right it must close one. "Closes a segment" is deliberately wider than
 * `/` or end-of-string, because a URL is not always the whole string — the same
 * template appears inside a serialized JSON-LD document, where the path ends at
 * the closing quote. Anything that cannot itself be part of a path segment ends
 * it.
 *
 * The name must be a plain JS identifier, which excludes Next's catch-all forms
 * (`[...slug]`, `[[...slug]]`): their value is an ARRAY and cannot be
 * interpolated into a URL by simple substitution.
 */
const DYNAMIC_PATH_SEGMENT_SOURCE = '(^|\\/)\\[([A-Za-z_$][A-Za-z0-9_$]*)\\](?=$|[\\/"\'\\s,)}])'

/** `${name}` — the template-literal spelling some upstream writers emit. */
const TEMPLATE_EXPRESSION_SOURCE = '\\$\\{([^}]+)\\}'

/**
 * True when `path` contains at least one Next.js dynamic segment (`/[id]`).
 *
 * The string form of `isDynamicRoute`, for callers that hold a URL or a
 * `navLink` rather than a component's `outputOptions`.
 */
export const pathHasDynamicSegment = (path: string): boolean =>
  new RegExp(DYNAMIC_PATH_SEGMENT_SOURCE).test(path || '')

/**
 * Split a URL or path into the literal text around its parameters, plus the
 * parameter names in order — so a caller can rebuild it as a template literal.
 *
 * Recognises BOTH spellings a canonical/`navLink` value can arrive in:
 *   - `${id}` — the template-literal form;
 *   - `[id]`  — the Next.js route form, which is what a details page's
 *     `navLink` actually carries (`/event-details/[id]`).
 *
 * Only the `${...}` form was understood before, so every details page shipped
 * its canonical URL, `og:url` and sitemap entry containing the literal text
 * `[id]` — a URL that 404s for every crawler and every shared link.
 *
 * `staticParts` always has exactly `paramNames.length + 1` entries, so
 * `staticParts[i]` precedes `paramNames[i]`. With no parameters the result is
 * `{ staticParts: [str], paramNames: [] }`, which callers use to keep emitting
 * a plain string attribute.
 */
/**
 * A WHOLE segment that Next.js reads as a route parameter.
 *
 * Wider than `DYNAMIC_PATH_SEGMENT_SOURCE` on purpose: this one also has to
 * recognise the catch-all forms (`[...slug]`, `[[...slug]]`), because the
 * question it answers is "may I edit this segment's text?" and the answer for
 * every bracketed segment is no.
 */
const ROUTE_PARAM_SEGMENT_RE = /^\[{1,2}(?:\.\.\.)?[^[\]/]+\]{1,2}$/

/**
 * Make a route unique by suffixing it, WITHOUT touching its parameters.
 *
 * Two pages that claim the same URL cannot both keep it, so one is renamed.
 * The rename used to be a bare string append, which is correct for a static
 * route (`/products-list` → `/products-list1`) and silently fatal for a
 * dynamic one: `/admin/product-reviews/update/[id]` became
 * `/admin/product-reviews/update/[id]1`, and a segment is a route parameter
 * only when the brackets span the WHOLE of it. Next therefore read `[id]1` as
 * literal text, and the page — which still called `getStaticPaths` — failed
 * the production build outright:
 *
 *   Error: getStaticPaths can only be used with dynamic pages, not
 *   '/admin/product-reviews/update/[id]1'.
 *
 * That shipped: a store with both a platform `teleport_product_reviews` table
 * and an author-created `product_reviews` one generated two admin edit pages,
 * both carrying `navLink: '/admin/product-reviews/update/[id]'`, and every
 * publish of that project died in Vercel.
 *
 * So the suffix goes on the last segment that is REAL TEXT. The parameter
 * survives, the URL stays distinct, and the page still resolves its row.
 * When every segment is a parameter (`/[id]`) there is no text to extend, so a
 * static segment is inserted ahead of the tail instead — renaming `[id]` would
 * break the `params.id` the page reads. Paths with no segment to speak of
 * (`/`, `**`) keep the historical append.
 */
export const appendRouteDisambiguator = (path: string, suffix: number): string => {
  if (!suffix) return path
  const segments = (path || '').split('/')

  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index]
    if (segment.length === 0 || ROUTE_PARAM_SEGMENT_RE.test(segment)) continue
    segments[index] = `${segment}${suffix}`
    return segments.join('/')
  }

  const firstParam = segments.findIndex((segment) => ROUTE_PARAM_SEGMENT_RE.test(segment))
  if (firstParam === -1) return `${path}${suffix}`
  segments.splice(firstParam, 0, `page${suffix}`)
  return segments.join('/')
}

export const parseDynamicPathSegments = (
  str: string
): { staticParts: string[]; paramNames: string[] } => {
  const regex = new RegExp(`${TEMPLATE_EXPRESSION_SOURCE}|${DYNAMIC_PATH_SEGMENT_SOURCE}`, 'g')
  const staticParts: string[] = []
  const paramNames: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null = regex.exec(str)

  while (match !== null) {
    const isBracketForm = match[3] !== undefined
    // For `/[id]` the matched text starts with the separator, which belongs to
    // the static text BEFORE the parameter — not to the parameter itself.
    const separator = isBracketForm ? match[2] : ''
    staticParts.push(str.slice(lastIndex, match.index) + separator)
    paramNames.push(isBracketForm ? match[3] : match[1])
    lastIndex = regex.lastIndex
    match = regex.exec(str)
  }
  staticParts.push(str.slice(lastIndex))

  return { staticParts, paramNames }
}
