import { SessionCookieResolver } from '@teleporthq/teleport-shared'
import { securityRuntimeSpecifier } from '@teleporthq/teleport-plugin-next-workflows'
import { toJsLiteral } from '../pwa/source-literals'
import { FORUM_PAGE_DATA_MODULE_NAME, FORUM_PAGE_DATA_MODULE_PATH } from './page-data-source'

export const FORUM_REPLIES_ROUTE = '/api/plugins/forum/replies'

/** From `pages/api/plugins/forum/<route>.js` to the project root. */
export const FORUM_ROUTE_ROOT = '../../../..'
const DATA_MODULE_IMPORT = `${FORUM_ROUTE_ROOT}/${FORUM_PAGE_DATA_MODULE_PATH.join(
  '/'
)}/${FORUM_PAGE_DATA_MODULE_NAME}`

export const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

/**
 * `pages/api/plugins/forum/replies.js`: "Load more" and the reply sort on a
 * topic page (plan D15). `?topic=<id>&root=<reply id>&sort=best|new|old&after=<n>`
 * answers the next page of the tree through the data module, as the viewer
 * the session cookie names: the same visibility rules as the page itself,
 * never `readAsVisitor` (the replies table is bound by no public page). A
 * visitor may ask 120 times per 10 minutes, counted by the shared security
 * runtime. A topic the viewer may not read answers 404, like its page.
 * Only a request that carries no credentials at all (no cookie, no
 * authorization) may be cached: a member's list right after their own reply
 * must never come from a cache, even when their session could not be read.
 * `replyCount` is the topic's count of published replies.
 */
export const buildForumRepliesRouteSource = (
  options: { withSessionRevocation?: boolean } = {}
): string => `var forum = require(${toJsLiteral(DATA_MODULE_IMPORT)});
var security = require(${toJsLiteral(securityRuntimeSpecifier(FORUM_ROUTE_ROOT))});

${SessionCookieResolver.generateCommonJsSessionTokenResolverCode(FORUM_ROUTE_ROOT, {
  withRevocation: options.withSessionRevocation !== false,
})}

var UUID = new RegExp(${toJsLiteral(UUID_PATTERN)}, 'i');
var RATE_LIMIT = { scope: 'forum-replies', limit: 120, windowSeconds: 600 };

function carriesCredentials(req) {
  var headers = (req && req.headers) || {};
  return !!(headers.cookie || headers.authorization);
}

function one(value) {
  return String(Array.isArray(value) ? value[0] : value == null ? '' : value).trim();
}

async function sessionOf(req) {
  try {
    return await __tqSessionToken(req);
  } catch (error) {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!(await security.rateLimitRequest(req, res, RATE_LIMIT))) {
    return;
  }
  var topicId = one(req.query.topic);
  var rootReplyId = one(req.query.root);
  if (!UUID.test(topicId) || (rootReplyId && !UUID.test(rootReplyId))) {
    return res.status(400).json({ success: false, error: 'This is not a topic.' });
  }
  var session = await sessionOf(req);
  res.setHeader('Cache-Control', session || carriesCredentials(req) ? 'private, no-store' : 'public, s-maxage=30, stale-while-revalidate=300');
  try {
    var result = await forum.loadReplies({
      topicId: topicId,
      rootReplyId: rootReplyId || null,
      sort: one(req.query.sort),
      after: parseInt(one(req.query.after), 10) || 0,
      session: session,
    });
    if (!result) {
      return res.status(404).json({ success: false, error: 'This topic is no longer available.' });
    }
    return res.status(200).json({ success: true, replies: result.replies, hasMore: result.hasMore, nextOffset: result.nextOffset, replyCount: result.replyCount });
  } catch (error) {
    console.error('[forum] replies could not be read:', error && error.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ success: false, error: 'The replies could not be loaded.' });
  }
}
`
