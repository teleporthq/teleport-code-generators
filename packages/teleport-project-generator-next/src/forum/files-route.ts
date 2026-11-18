import { SessionCookieResolver } from '@teleporthq/teleport-shared'
import { securityRuntimeSpecifier } from '@teleporthq/teleport-plugin-next-workflows'
import { toJsLiteral } from '../pwa/source-literals'
import { FORUM_PAGE_DATA_MODULE_NAME, FORUM_PAGE_DATA_MODULE_PATH } from './page-data-source'
import { FORUM_SAME_ORIGIN_SOURCE } from './notifications-route'
import { FORUM_ROUTE_ROOT, UUID_PATTERN } from './replies-route'

/** ⛔ PAIRED with `FORUM_FILES_ROUTE` in teleport-gui `features/forum/constants/forum-markers.ts`. */
export const FORUM_FILES_ROUTE = '/api/plugins/forum/files'

/**
 * The runtime-storage folder the forum's composers upload pictures into.
 * ⛔ PAIRED with `FORUM_UPLOAD_FOLDER` in teleport-gui
 * `features/forum/constants/forum-markers.ts`.
 */
export const FORUM_UPLOAD_FOLDER = 'forum'

/** The most file ids one call names (a topic and its replies, at four pictures each, rarely reach it). */
const MAX_FILES = 40

const DATA_MODULE_IMPORT = `${FORUM_ROUTE_ROOT}/${FORUM_PAGE_DATA_MODULE_PATH.join(
  '/'
)}/${FORUM_PAGE_DATA_MODULE_NAME}`

/**
 * `pages/api/plugins/forum/files.js`: takes the pictures of deleted posts out
 * of runtime storage. A delete's statement answers the file ids its posts
 * showed and the page posts them here (`POST { files: [id] }`, same-origin
 * JSON, a session required, 30 calls per 10 minutes per visitor).
 *
 * The ids are only a hint: a post's pictures are addresses its author wrote,
 * so any public file of the project could be named. A file is removed only
 * when BOTH hold — the storage worker lists it in the forum's upload folder
 * (only the composers upload there), and no topic or reply still shows it
 * (`filesStillShown`). Anything else is left alone, and the answer is the
 * same either way (`{ success, deleted }`): the post is already gone, so a
 * storage failure is logged, never shown.
 */
export const buildForumFilesRouteSource = (
  options: { withSessionRevocation?: boolean } = {}
): string => `var forum = require(${toJsLiteral(DATA_MODULE_IMPORT)});
var security = require(${toJsLiteral(securityRuntimeSpecifier(FORUM_ROUTE_ROOT))});

${SessionCookieResolver.generateCommonJsSessionTokenResolverCode(FORUM_ROUTE_ROOT, {
  withRevocation: options.withSessionRevocation !== false,
})}

var UUID = new RegExp(${toJsLiteral(UUID_PATTERN)}, 'i');
var RATE_LIMIT = { scope: 'forum-files', limit: 30, windowSeconds: 600 };
var FOLDER = ${toJsLiteral(FORUM_UPLOAD_FOLDER)};
var MAX_FILES = ${MAX_FILES};
var STORAGE_URL = process.env.RUNTIME_STORAGE_URL;
var STORAGE_KEY = process.env.RUNTIME_STORAGE_API_KEY;
var STORAGE_PROJECT = process.env.RUNTIME_STORAGE_PROJECT_ID;

${FORUM_SAME_ORIGIN_SOURCE}

function storage(path, method) {
  return fetch(STORAGE_URL + '/project/' + encodeURIComponent(STORAGE_PROJECT) + path, {
    method: method,
    headers: { Authorization: 'Bearer ' + STORAGE_KEY },
  });
}

// The named files the forum's composers uploaded: the ones storage lists in the forum's folder.
async function forumFilesAmong(ids) {
  var response = await storage(
    '/files?folder=' + encodeURIComponent(FOLDER) + '&limit=' + ids.length + '&ids=' + ids.map(encodeURIComponent).join(','),
    'GET'
  );
  if (!response.ok) {
    throw new Error('storage answered ' + response.status);
  }
  var data = await response.json();
  var listed = Array.isArray(data && data.files) ? data.files : [];
  return listed
    .map(function (file) { return String((file && file.id) || ''); })
    .filter(function (id) { return ids.indexOf(id) !== -1; });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!(await security.rateLimitRequest(req, res, RATE_LIMIT))) {
    return;
  }
  if (!isSameOrigin(req)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  var session = null;
  try {
    session = await __tqSessionToken(req);
  } catch (error) {
    session = null;
  }
  if (!session || !(session.id || session.sub)) {
    return res.status(401).json({ success: false, error: 'Sign in first.' });
  }
  var body = req.body && typeof req.body === 'object' ? req.body : {};
  var ids = [];
  (Array.isArray(body.files) ? body.files : []).forEach(function (value) {
    var id = String(value == null ? '' : value).trim().toLowerCase();
    if (UUID.test(id) && ids.indexOf(id) === -1 && ids.length < MAX_FILES) {
      ids.push(id);
    }
  });
  if (ids.length === 0 || !STORAGE_URL || !STORAGE_KEY || !STORAGE_PROJECT) {
    return res.status(200).json({ success: true, deleted: 0 });
  }
  var deleted = 0;
  try {
    var forumIds = await forumFilesAmong(ids);
    var shown = forumIds.length > 0 ? await forum.filesStillShown(forumIds) : [];
    var unused = forumIds.filter(function (id) { return shown.indexOf(id) === -1; });
    for (var i = 0; i < unused.length; i++) {
      try {
        var answer = await storage('/files/' + encodeURIComponent(unused[i]), 'DELETE');
        if (answer.ok || answer.status === 404) {
          deleted += 1;
        }
      } catch (error) {
        console.error('[forum] a picture could not be removed:', error && error.message);
      }
    }
  } catch (error) {
    console.error('[forum] pictures could not be checked:', error && error.message);
  }
  return res.status(200).json({ success: true, deleted: deleted });
}
`
