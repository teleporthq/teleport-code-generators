/**
 * How many posts each direction is read, so a neighbour that only REDIRECTS
 * elsewhere can be stepped over without a second query.
 */
const ADJACENT_POST_CANDIDATES = 5

/**
 * Generates the code that finds a post's neighbours for its "previous / next"
 * navigation: the published posts right before and after it in the order the
 * blog listing shows them (`created_at`, then `id`, newest first). "Previous"
 * is the older one.
 *
 * Only a post DETAILS fetch (a single record) asks. A neighbour whose row
 * carries a redirect is skipped — linking to it would only bounce the reader
 * somewhere else — which is read off the row in code rather than in SQL, so a
 * table provisioned before the SEO columns still works.
 *
 * MUST mirror `findAdjacentBlogPosts` in teleport-gui
 * `packages/renderer/src/utils/blog-adjacent-posts.ts` (the canvas).
 *
 * In Manual Order (`arranged`) a post walks the published posts of its
 * PRIMARY category (the first of `category_ids`) the way the author arranged
 * them: the ones with a place (`sort_order`) by it, then the rest newest
 * first, ties by id — "previous" the one above it, "next" the one below. The
 * category is read off each row in code, since a list cell may be JSON or a
 * comma-separated list (see `array-overlap-sql.ts`). A post without a
 * category, or a table the query cannot read (a column it lacks), walks the
 * newest-first order above. MUST mirror `findArrangedAdjacentPosts` in
 * teleport-gui `apps/gui/app/project-page/features/blog/utils/arranged-order.ts`.
 */
export const generateAdjacentPostsCode = (postsTable: string, arranged = false): string => `
var BLOG_ADJACENT_CANDIDATES = ${ADJACENT_POST_CANDIDATES}
var BLOG_ARRANGED_ORDER = ${arranged}

function blogAdjacentPostsSql(comparison, direction) {
  return (
    'SELECT p.* FROM ${postsTable} p,' +
    ' (SELECT created_at, id FROM ${postsTable} WHERE id = $1) cur' +
    " WHERE p.status = 'published' AND (p.created_at, p.id) " + comparison + ' (cur.created_at, cur.id)' +
    ' ORDER BY p.created_at ' + direction + ', p.id ' + direction +
    ' LIMIT ' + BLOG_ADJACENT_CANDIDATES
  )
}

function firstLinkableBlogPost(result) {
  var rows = result && Array.isArray(result.rows) ? result.rows : []
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i]
    if (!row) continue
    var redirect = pickFirst(row.redirect_url, row.redirectUrl)
    if (typeof redirect === 'string' && redirect.trim() !== '') continue
    // Through JSON, like the rows the fetcher itself hands the transform.
    return JSON.parse(JSON.stringify(row))
  }
  return null
}

function blogPlaceOf(row) {
  var raw = pickFirst(row.sort_order, row.sortOrder)
  if (raw === null || raw === undefined || raw === '') return null
  var value = Number(raw)
  return isFinite(value) ? value : null
}

// The arranged posts by their place, then the rest newest first, ties by id descending.
function compareBlogPlaces(a, b) {
  var placeA = blogPlaceOf(a)
  var placeB = blogPlaceOf(b)
  if (placeA !== placeB) {
    if (placeA === null) return 1
    if (placeB === null) return -1
    return placeA - placeB
  }
  var byDate =
    normalizeTimestamp(pickFirst(b.created_at, b.createdAt)) -
    normalizeTimestamp(pickFirst(a.created_at, a.createdAt))
  if (byDate !== 0) return byDate
  var idA = String(a.id)
  var idB = String(b.id)
  return idA < idB ? 1 : idA > idB ? -1 : 0
}

// { previous, next } along the post's primary category in Manual Order, or
// null when the post has none (the caller then walks the newest-first order).
async function getArrangedAdjacentPosts(client, record) {
  var primary = parseJsonArray(record.category_ids)[0]
  if (!primary) return null
  var postId = String(record.id)
  var listed = await client.query(
    "SELECT id, category_ids, sort_order, created_at FROM ${postsTable} WHERE status = 'published' OR id = $1",
    [postId]
  )
  var chain = (listed && Array.isArray(listed.rows) ? listed.rows : [])
    .filter(function (row) {
      return String(row.id) === postId || parseJsonArray(row.category_ids)[0] === primary
    })
    .sort(compareBlogPlaces)
  var at = -1
  for (var i = 0; i < chain.length; i++) {
    if (String(chain[i].id) === postId) at = i
  }
  if (at < 0) return null
  var above = chain.slice(Math.max(0, at - BLOG_ADJACENT_CANDIDATES), at).reverse()
  var below = chain.slice(at + 1, at + 1 + BLOG_ADJACENT_CANDIDATES)
  var ids = above.concat(below).map(function (row) { return String(row.id) })
  if (ids.length === 0) return { previous: null, next: null }
  var full = await client.query(
    'SELECT p.* FROM ${postsTable} p WHERE p.id::text = ANY($1::text[])',
    [ids]
  )
  var byId = {}
  ;(full && Array.isArray(full.rows) ? full.rows : []).forEach(function (row) {
    byId[String(row.id)] = row
  })
  var rowsOf = function (entries) {
    return { rows: entries.map(function (row) { return byId[String(row.id)] }) }
  }
  return { previous: firstLinkableBlogPost(rowsOf(above)), next: firstLinkableBlogPost(rowsOf(below)) }
}

// { [postId]: { previous, next } } — raw rows or null — for a single-record
// fetch; {} otherwise and on any failure (the navigation then hides).
async function getAdjacentPostsMap(getClientFn, records) {
  var map = {}
  if (!Array.isArray(records) || records.length !== 1) return map
  var postId = records[0] && records[0].id
  if (postId === null || postId === undefined) return map

  var client
  try {
    client = getClientFn()
    await client.connect()
    var arranged = null
    if (BLOG_ARRANGED_ORDER) {
      try {
        arranged = await getArrangedAdjacentPosts(client, records[0])
      } catch (e) {
        // A table without the columns: the newest-first order below.
      }
    }
    if (arranged) {
      map[String(postId)] = arranged
      return map
    }
    var older = await client.query(blogAdjacentPostsSql('<', 'DESC'), [String(postId)])
    var newer = await client.query(blogAdjacentPostsSql('>', 'ASC'), [String(postId)])
    map[String(postId)] = {
      previous: firstLinkableBlogPost(older),
      next: firstLinkableBlogPost(newer),
    }
  } catch (e) {
    // Leaves the navigation hidden.
  } finally {
    if (client) {
      try { await client.end() } catch (e) { /* ignore */ }
    }
  }
  return map
}
`
