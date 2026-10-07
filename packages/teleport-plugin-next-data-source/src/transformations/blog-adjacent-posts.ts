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
 */
export const generateAdjacentPostsCode = (postsTable: string): string => `
var BLOG_ADJACENT_CANDIDATES = ${ADJACENT_POST_CANDIDATES}

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
