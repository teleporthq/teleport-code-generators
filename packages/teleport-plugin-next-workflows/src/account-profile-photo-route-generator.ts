/**
 * `pages/api/account/profile-photo.js`: deletes the profile photo a saved photo
 * change replaced. The account form's Update workflow posts the address the
 * form showed before the save (`POST { previous }`, same-origin JSON, a session
 * required, 20 calls per 10 minutes per visitor) once the row shows the new one.
 *
 * The address is only a hint: any member can write any address into their row's
 * `image` before a change, so the route never trusts it. A file is deleted only
 * when BOTH hold — the storage worker lists it in the profile-photo folder (only
 * the account form uploads there), and no account still shows it (any `image`
 * of the users table naming the file). A store-owned file, a forum picture, a
 * photo uploaded before the folder existed, or one another member shows is
 * left alone. The answer is the same either way (`{ success, deleted }`): the
 * save is already done, so a storage failure is logged, never shown.
 */
import { generatePgClientCode } from './pg-client-code'
import { generateCommonJsSessionTokenResolverCode } from './session-cookie-resolver'
import { securityRuntimeSpecifier } from './security-runtime'

/** ⛔ PAIRED with `PROFILE_PHOTO_RELEASE_ROUTE` in teleport-gui `features/authentication/constants/profile-photo.ts`. */
export const ACCOUNT_PROFILE_PHOTO_ROUTE = '/api/account/profile-photo'

/**
 * The runtime-storage folder the account form uploads profile photos into.
 * ⛔ PAIRED with `PROFILE_PHOTO_UPLOAD_FOLDER` in teleport-gui
 * `features/authentication/constants/profile-photo.ts`.
 */
export const PROFILE_PHOTO_UPLOAD_FOLDER = 'profile-photos'

/** Storage file ids are UUIDs: anything else in the address is not one of its files. */
export const FILE_ID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

/** `isSameOrigin(req)`: a browser call from the site's own pages (no header: a server, allowed). */
export const UPLOAD_RELEASE_SAME_ORIGIN_SOURCE = `function isSameOrigin(req) {
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
}
`

/** `storage(path, method)`: a call of the storage worker for the site's project, with its key. */
export const UPLOAD_RELEASE_STORAGE_SOURCE = `function storage(path, method) {
  return fetch(STORAGE_URL + '/project/' + encodeURIComponent(STORAGE_PROJECT) + path, {
    method: method,
    headers: { Authorization: 'Bearer ' + STORAGE_KEY },
  });
}
`

export interface AccountProfilePhotoRouteOptions {
  /** The auth identity table (resolved by the plugin). Defaults to `users`. */
  authUsersTableName?: string
  withSessionRevocation?: boolean
}

/**
 * Whether a workflow (or a custom node) uploads into `folder`: the route exists
 * only for a project whose account form files its photos there, so a project
 * whose form was built before the folder ships nothing new.
 */
export const workflowsUploadIntoFolder = (
  workflows: { workflows?: unknown; customNodes?: unknown } | undefined,
  folder: string
): boolean => {
  const groups = [workflows?.workflows, workflows?.customNodes]
  return groups.some(
    (group) =>
      !!group &&
      typeof group === 'object' &&
      Object.values(group as Record<string, { nodes?: unknown }>).some(
        (entry) =>
          Array.isArray(entry?.nodes) &&
          (entry.nodes as Array<{ type?: string; config?: { folder?: unknown } }>).some(
            (node) => node?.type === 'file-storage-upload' && node.config?.folder === folder
          )
      )
  )
}

export const generateAccountProfilePhotoRoute = (
  options: AccountProfilePhotoRouteOptions = {}
): string => {
  const usersTable = options.authUsersTableName || 'users'
  return `${generatePgClientCode()}
var security = require(${JSON.stringify(securityRuntimeSpecifier('../../..'))});
${generateCommonJsSessionTokenResolverCode('../../..', {
  withRevocation: options.withSessionRevocation !== false,
})}

var USERS_TABLE = ${JSON.stringify(usersTable)};
var FOLDER = ${JSON.stringify(PROFILE_PHOTO_UPLOAD_FOLDER)};
var FILE_ID = new RegExp(${JSON.stringify(FILE_ID_PATTERN)}, 'i');
var RATE_LIMIT = { scope: 'account-profile-photo', limit: 20, windowSeconds: 600 };
var STORAGE_URL = process.env.RUNTIME_STORAGE_URL;
var STORAGE_KEY = process.env.RUNTIME_STORAGE_API_KEY;
var STORAGE_PROJECT = process.env.RUNTIME_STORAGE_PROJECT_ID;

${UPLOAD_RELEASE_SAME_ORIGIN_SOURCE}
// A storage address is <bucket>/<project>/<file id>/<name>: the id is the
// segment before the name. Anything else names no file of ours.
function fileIdOf(address) {
  if (typeof address !== 'string' || address.length > 2048) {
    return '';
  }
  try {
    var parts = new URL(address).pathname.split('/').filter(Boolean);
    var id = parts.length >= 2 ? decodeURIComponent(parts[parts.length - 2]).toLowerCase() : '';
    return FILE_ID.test(id) ? id : '';
  } catch (error) {
    return '';
  }
}

${UPLOAD_RELEASE_STORAGE_SOURCE}

// Whether storage lists the file in the profile-photo folder.
async function isProfilePhoto(id) {
  var response = await storage(
    '/files?folder=' + encodeURIComponent(FOLDER) + '&limit=1&ids=' + encodeURIComponent(id),
    'GET'
  );
  if (!response.ok) {
    throw new Error('storage answered ' + response.status);
  }
  var data = await response.json();
  var listed = Array.isArray(data && data.files) ? data.files : [];
  return listed.some(function (file) { return String((file && file.id) || '').toLowerCase() === id; });
}

// Whether any account still shows the file (its address holds /<file id>/).
async function stillShown(id) {
  var client = getClient();
  await client.connect();
  try {
    var result = await client.query(
      'SELECT 1 FROM "' + USERS_TABLE + '" WHERE COALESCE(image, \\'\\') LIKE $1 LIMIT 1',
      ['%/' + id + '/%']
    );
    return result.rows.length > 0;
  } finally {
    await client.end().catch(function () {});
  }
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
  var id = fileIdOf(body.previous);
  if (id === '' || !STORAGE_URL || !STORAGE_KEY || !STORAGE_PROJECT) {
    return res.status(200).json({ success: true, deleted: 0 });
  }
  var deleted = 0;
  try {
    if ((await isProfilePhoto(id)) && !(await stillShown(id))) {
      var answer = await storage('/files/' + encodeURIComponent(id), 'DELETE');
      if (answer.ok || answer.status === 404) {
        deleted = 1;
      }
    }
  } catch (error) {
    console.error('[account] the replaced profile photo could not be removed:', error && error.message);
  }
  return res.status(200).json({ success: true, deleted: deleted });
}
`
}
