/**
 * How many TOP-LEVEL comments a post page carries: the newest ones, shown
 * oldest-first, each with all of its replies. The count in the section's
 * heading still counts every approved comment.
 *
 * ⛔ PAIRED with `BLOG_COMMENTS_RENDER_LIMIT` in teleport-gui
 * `features/blog/constants/blog-comments.ts` (the canvas mirror).
 */
export const BLOG_COMMENTS_RENDER_LIMIT = 200

/**
 * Generates the code that loads and shapes a post's approved comments.
 *
 * Read server-side, with the post: only a post DETAILS fetch (a single record)
 * asks, so a listing never pays for it, and the comments arrive in the page's
 * HTML — rendered by SSR/ISR, carried along a client-side navigation to another
 * post, no request of their own.
 *
 * Public columns only. `teleport_blog_comments` holds the commenters' email
 * addresses and the comments still waiting for approval, which is why it is a
 * customer-record table no browser may read (see teleport-shared's
 * `table-access.ts`); nothing here selects either.
 *
 * Replies are one level deep: a reply whose parent is not among the rows (not
 * approved, deleted) is dropped rather than promoted to the top level.
 *
 * MUST mirror `buildBlogComments` in teleport-gui
 * `packages/renderer/src/utils/blog-comments.ts` (the canvas).
 */
export const generateBlogCommentsCode = (commentsTable: string): string => `
var BLOG_COMMENTS_RENDER_LIMIT = ${BLOG_COMMENTS_RENDER_LIMIT}

var BLOG_COMMENTS_SQL =
  'WITH top AS (' +
  ' SELECT id FROM ${commentsTable}' +
  " WHERE post_id = $1 AND parent_id IS NULL AND status = 'approved'" +
  ' ORDER BY created_at DESC, id DESC LIMIT ' + BLOG_COMMENTS_RENDER_LIMIT +
  ')' +
  ' SELECT c.id, c.parent_id, c.author_name, c.content, c.is_author_reply, c.created_at' +
  ' FROM ${commentsTable} c' +
  " WHERE c.post_id = $1 AND c.status = 'approved'" +
  ' AND (c.id IN (SELECT id FROM top) OR c.parent_id IN (SELECT id FROM top))' +
  ' ORDER BY c.created_at ASC, c.id ASC'

// Every approved comment the page could show — a reply counts only while the
// comment it answers is approved too.
var BLOG_COMMENTS_COUNT_SQL =
  'SELECT COUNT(*) AS n FROM ${commentsTable} c' +
  " WHERE c.post_id = $1 AND c.status = 'approved'" +
  ' AND (c.parent_id IS NULL OR EXISTS (' +
  ' SELECT 1 FROM ${commentsTable} p' +
  " WHERE p.id = c.parent_id AND p.status = 'approved'))"

function blogAuthorInitials(name) {
  if (typeof name !== 'string') return ''
  var words = name.trim().split(' ').filter(function(word) { return word !== '' })
  if (words.length === 0) return ''
  // Code points, not UTF-16 units: an initial may be an emoji or a letter
  // outside the BMP, and half of a surrogate pair renders as a box.
  var first = Array.from(words[0])[0] || ''
  var last = words.length > 1 ? Array.from(words[words.length - 1])[0] || '' : ''
  return (first + last).toUpperCase()
}

function buildBlogComment(row) {
  var name = typeof row.author_name === 'string' ? row.author_name.trim() : ''
  var authorName = name || 'Reader'
  return {
    id: String(row.id),
    authorName: authorName,
    authorInitials: blogAuthorInitials(authorName),
    content: typeof row.content === 'string' ? row.content : '',
    createdAt: normalizeTimestamp(row.created_at),
    isAuthorReply: coerceBoolean(row.is_author_reply, false),
  }
}

function isTopLevelComment(row) {
  return row.parent_id === null || row.parent_id === undefined || row.parent_id === ''
}

function buildBlogComments(rows) {
  var comments = []
  if (!Array.isArray(rows)) return comments
  var byId = {}
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i]
    if (!row || row.id == null || !isTopLevelComment(row)) continue
    var comment = buildBlogComment(row)
    comment.replies = []
    byId[comment.id] = comment
    comments.push(comment)
  }
  for (var j = 0; j < rows.length; j++) {
    var reply = rows[j]
    if (!reply || reply.id == null || isTopLevelComment(reply)) continue
    var parent = byId[String(reply.parent_id)]
    if (parent) parent.replies.push(buildBlogComment(reply))
  }
  return comments
}

// { [postId]: { rows, count } } for a single-record (details) fetch; {} for
// anything else, and on any failure — a blog whose comments table does not
// exist yet renders its posts without comments rather than failing the page.
async function getBlogCommentsMap(getClientFn, records) {
  var map = {}
  if (!Array.isArray(records) || records.length !== 1) return map
  var postId = records[0] && records[0].id
  if (postId === null || postId === undefined) return map

  var client
  try {
    client = getClientFn()
    await client.connect()
    var listed = await client.query(BLOG_COMMENTS_SQL, [String(postId)])
    var counted = await client.query(BLOG_COMMENTS_COUNT_SQL, [String(postId)])
    // Through JSON, like every other row the fetcher hands the transform: the
    // driver returns timestamps as Date objects.
    var rows = listed && Array.isArray(listed.rows) ? JSON.parse(JSON.stringify(listed.rows)) : []
    var count = counted && counted.rows && counted.rows[0] ? Number(counted.rows[0].n) : NaN
    map[String(postId)] = { rows: rows, count: isNaN(count) ? rows.length : count }
  } catch (e) {
    // Leaves the post without comments.
  } finally {
    if (client) {
      try { await client.end() } catch (e) { /* ignore */ }
    }
  }
  return map
}
`
