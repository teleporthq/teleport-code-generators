import { SessionCookieResolver } from '@teleporthq/teleport-shared'
import { securityRuntimeSpecifier } from '@teleporthq/teleport-plugin-next-workflows'
import { toJsLiteral } from '../pwa/source-literals'
import { FORUM_PAGE_DATA_MODULE_NAME, FORUM_PAGE_DATA_MODULE_PATH } from './page-data-source'
import { FORUM_ROUTE_ROOT } from './replies-route'

export const FORUM_NOTIFICATIONS_ROUTE = '/api/plugins/forum/notifications'

/**
 * `isSameOrigin(req)`: a write the forum's routes take only from the site's
 * own pages (the browser's `Sec-Fetch-Site`, else the `Origin` against the host).
 */
export const FORUM_SAME_ORIGIN_SOURCE = `function isSameOrigin(req) {
  var site = req.headers['sec-fetch-site'];
  if (site) {
    return site === 'same-origin';
  }
  var origin = req.headers.origin;
  if (!origin) {
    return true;
  }
  try {
    return new URL(origin).host === req.headers.host;
  } catch (error) {
    return false;
  }
}`
const DATA_MODULE_IMPORT = `${FORUM_ROUTE_ROOT}/${FORUM_PAGE_DATA_MODULE_PATH.join(
  '/'
)}/${FORUM_PAGE_DATA_MODULE_NAME}`

/**
 * `pages/api/plugins/forum/notifications.js`: the bell. `GET` answers the
 * signed-in member's latest notifications and their unread count; `POST`
 * (`{ ids?: [] }`, same-origin JSON) marks them — or all of them — read.
 * The member is the session cookie's, never a body value; a visitor without
 * a session gets 401. 60 requests per 10 minutes per visitor.
 */
export const buildForumNotificationsRouteSource = (
  options: { withSessionRevocation?: boolean } = {}
): string => `var forum = require(${toJsLiteral(DATA_MODULE_IMPORT)});
var security = require(${toJsLiteral(securityRuntimeSpecifier(FORUM_ROUTE_ROOT))});

${SessionCookieResolver.generateCommonJsSessionTokenResolverCode(FORUM_ROUTE_ROOT, {
  withRevocation: options.withSessionRevocation !== false,
})}

var RATE_LIMIT = { scope: 'forum-notifications', limit: 60, windowSeconds: 600 };

${FORUM_SAME_ORIGIN_SOURCE}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!(await security.rateLimitRequest(req, res, RATE_LIMIT))) {
    return;
  }
  var session = null;
  try {
    session = await __tqSessionToken(req);
  } catch (error) {
    session = null;
  }
  if (!session || !(session.id || session.sub)) {
    return res.status(401).json({ success: false, error: 'Sign in to see your notifications.' });
  }
  try {
    if (req.method === 'GET') {
      var limit = parseInt(String(Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit || ''), 10);
      var page = await forum.loadNotifications(session, { limit: limit });
      return res.status(200).json({ success: true, items: page.items, unreadCount: page.unreadCount });
    }
    if (!isSameOrigin(req)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    var body = req.body && typeof req.body === 'object' ? req.body : {};
    var marked = await forum.markNotificationsRead(session, Array.isArray(body.ids) ? body.ids : null);
    return res.status(200).json({ success: true, marked: marked });
  } catch (error) {
    console.error('[forum] notifications failed:', error && error.message);
    return res.status(500).json({ success: false, error: 'Your notifications could not be loaded.' });
  }
}
`
