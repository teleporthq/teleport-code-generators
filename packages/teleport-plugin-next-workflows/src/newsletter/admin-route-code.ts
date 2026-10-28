/**
 * Not emitted. `NextNewsletterProjectPlugin` no longer writes this route or a
 * site token. The published admin panel schedules by editing the issue row.
 * Send now and send-a-test stay in the editor.
 *
 * Kept so the old route's checks stay readable. Do not wire it back into the
 * plugin: that would put a service token on the published site again.
 */
import type { ProjectUIDL } from '@teleporthq/teleport-types'
import { TableAccess } from '@teleporthq/teleport-shared'
import { generateCommonJsSessionTokenResolverCode } from '../session-cookie-resolver'
import { ROLE_OF_TOKEN_CODE } from '../workflow-auth-generator'
import { newsletterHelperSpecifier } from './newsletter-scope'

export const NEWSLETTER_ADMIN_ROUTE_FILE_KEY = 'newsletter-admin-route'
export const NEWSLETTER_ADMIN_ROUTE_PATH = ['pages', 'api', 'newsletter', 'admin']
export const NEWSLETTER_ADMIN_ROUTE_FILE_NAME = '[action]'

/** What the admin panel may ask for (R-N1: schedule and cancel are row edits). */
export const NEWSLETTER_ADMIN_ACTIONS = ['send', 'test'] as const

/**
 * The `.env` lines the production deploy fills (the worker's
 * `injectNewsletterServiceEnv`): the worker's public URL, the site's token and
 * its project id.
 */
export const NEWSLETTER_SERVICE_ENV_NAMES = [
  'NEWSLETTER_SERVICE_URL',
  'NEWSLETTER_SERVICE_TOKEN',
  'NEWSLETTER_SERVICE_PROJECT_ID',
] as const

/** How long the route waits for the worker. */
export const NEWSLETTER_SERVICE_TIMEOUT_MS = 15000

/** The issues table (teleport-gui `NEWSLETTER_ISSUES_TABLE`, Task 1). */
const NEWSLETTER_ISSUES_TABLE = 'teleport_newsletter_issues'

/** The one statement the route runs: does this site hold the issue. */
export const NEWSLETTER_ADMIN_ISSUE_SQL = `SELECT id FROM ${NEWSLETTER_ISSUES_TABLE} WHERE id = $1 LIMIT 1`

/** Every answer the route writes itself (the worker's are relayed). */
export const NEWSLETTER_ADMIN_MESSAGES = {
  method: 'Method not allowed',
  crossOrigin: 'This request must come from your site.',
  jsonOnly: 'This request must be sent as JSON.',
  signIn: 'Sign in again.',
  staffOnly: 'Staff only.',
  unknownAction: 'Unknown newsletter action.',
  notProduction: 'Newsletter sending from the admin panel works on the published production site.',
  missingIssue: 'Newsletter id is required.',
  noTestAddress: 'Your account has no email address to send the test to.',
  testAddressUnsupported:
    "Your account's email address cannot receive the test from the admin panel; send the test from the editor.",
  notFound: 'This newsletter no longer exists.',
  readFailed: 'The newsletter could not be read right now. Try again in a moment.',
  keyRefused:
    "The newsletter service did not accept this site's key. Publish the site again, then try again.",
  unreachable: 'The newsletter service could not be reached. Try again in a moment.',
  timeout:
    "The newsletter service did not answer in time. Check the newsletter's status before you try again.",
  badAnswer:
    "The newsletter service gave an answer that could not be read. Check the newsletter's status before you try again.",
  refused: 'The newsletter service could not do this.',
  serviceFailed: 'The newsletter could not be sent right now. Try again in a moment.',
}

/** From `pages/api/newsletter/admin/` to the project root. */
const RELATIVE_PREFIX = '../../../..'

/**
 * The route's source. Staff = the admin panel's roles and `admin`
 * (`TableAccess.resolveStaffRoles`), baked at build time; `withRevocation`
 * checks a stamped session against its account (a project with authentication).
 */
export const generateNewsletterAdminRouteCode = (
  uidl: Pick<ProjectUIDL, 'authentication'>,
  options: { withRevocation: boolean }
): string => `/**
 * POST /api/newsletter/admin/[action]   JSON body { issueId }
 * The admin panel's "Send now" (send) and "Send a test" (test). Staff only,
 * from a page of this site only.
 * Asks the newsletter service to act on one issue of this site and relays its
 * answer: { success: true, status, message } or { success: false, error }.
 * A test goes to the signed-in staff member's own address.
 */

var __newsletter = require('${newsletterHelperSpecifier(RELATIVE_PREFIX)}');

${generateCommonJsSessionTokenResolverCode(RELATIVE_PREFIX, {
  withRevocation: options.withRevocation,
})}
${ROLE_OF_TOKEN_CODE}

var STAFF_ROLES = ${JSON.stringify(TableAccess.resolveStaffRoles(uidl.authentication))};
var NEWSLETTER_ADMIN_ACTIONS = ${JSON.stringify(NEWSLETTER_ADMIN_ACTIONS)};
var SERVICE_TIMEOUT_MS = ${NEWSLETTER_SERVICE_TIMEOUT_MS};
var ISSUE_SQL = ${JSON.stringify(NEWSLETTER_ADMIN_ISSUE_SQL)};
var MESSAGES = ${JSON.stringify(NEWSLETTER_ADMIN_MESSAGES, null, 2)};

function readBody(req) {
  var body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  return body && typeof body === 'object' ? body : {};
}

function fail(res, status, error) {
  return res.status(status).json({ success: false, error: error });
}

// A page of this site sent the request (R-N25). Sibling sites on the shared
// hosting domain count as same-site, so the session cookie alone proves
// nothing: the browser's Sec-Fetch-Site, when sent, must say same-origin, and
// the Origin (or, without one, the Referer) must name this host. Browsers send
// Origin on every POST; a request that names no page is refused.
function isSameOrigin(req) {
  var headers = req.headers || {};
  var site = headers['sec-fetch-site'];
  if (site && site !== 'same-origin') {
    return false;
  }
  var source = headers.origin || headers.referer;
  if (typeof source !== 'string' || !source || !headers.host) {
    return false;
  }
  try {
    return new URL(source).host === String(headers.host).toLowerCase();
  } catch (error) {
    return false;
  }
}

// The admin panel posts JSON; a cross-origin form cannot.
function isJsonRequest(req) {
  var type = String((req.headers && req.headers['content-type']) || '');
  return type.split(';')[0].trim().toLowerCase() === 'application/json';
}

// This deployment's newsletter service, or null: only the production deploy
// of the site is given one.
function newsletterService() {
  var url = String(process.env.NEWSLETTER_SERVICE_URL || '').trim().replace(/\\/+$/, '');
  var token = String(process.env.NEWSLETTER_SERVICE_TOKEN || '').trim();
  var project = String(process.env.NEWSLETTER_SERVICE_PROJECT_ID || '').trim();
  return url && token && project ? { url: url, token: token, project: project } : null;
}

// The signed-in staff member's address (a test's recipient), or ''.
function staffAddress(token) {
  return __newsletter.normalizeEmail(token.email);
}

// The address as a request header can carry it (printable ASCII), or ''.
function headerSafe(email) {
  return /^[ -~]+$/.test(email) ? email : '';
}

// Who the newsletter service records as acting: the address, else the account id.
function staffName(token, email) {
  if (email) return email;
  var id = token.id != null ? token.id : token.sub;
  return id == null ? '' : String(id).replace(/[^ -~]/g, '').slice(0, 255);
}

// Whether this site's database holds the issue. Another project's issue is
// never in it.
async function issueExists(issueId) {
  return __newsletter.withNewsletterDb(async function (db) {
    var found = await db.query(ISSUE_SQL, [issueId]);
    return !!(found && found.rows && found.rows[0]);
  });
}

// The service's answer as the admin panel reads it: the contract's fields only.
// A server failure's own text stays on the server.
function relayedAnswer(response, answer) {
  if (response.ok && answer.success === true) {
    return {
      success: true,
      status: typeof answer.status === 'string' ? answer.status : '',
      message: typeof answer.message === 'string' ? answer.message : '',
    };
  }
  if (response.status >= 500) {
    return { success: false, error: MESSAGES.serviceFailed };
  }
  return {
    success: false,
    error: typeof answer.error === 'string' && answer.error ? answer.error : MESSAGES.refused,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: MESSAGES.method });
  }
  if (!isSameOrigin(req)) {
    return fail(res, 403, MESSAGES.crossOrigin);
  }
  if (!isJsonRequest(req)) {
    return fail(res, 415, MESSAGES.jsonOnly);
  }

  var token = null;
  try {
    token = await __tqSessionToken(req);
  } catch (err) {
    console.warn('[newsletter] admin: could not read the session — ' + (err && err.message));
    token = null;
  }
  if (!token) {
    return fail(res, 401, MESSAGES.signIn);
  }
  var role = roleOf(token);
  if (!role || STAFF_ROLES.indexOf(role) < 0) {
    return fail(res, 403, MESSAGES.staffOnly);
  }

  var action = req.query && typeof req.query.action === 'string' ? req.query.action : '';
  if (NEWSLETTER_ADMIN_ACTIONS.indexOf(action) < 0) {
    return fail(res, 404, MESSAGES.unknownAction);
  }

  var service = newsletterService();
  if (!service) {
    return fail(res, 503, MESSAGES.notProduction);
  }

  var body = readBody(req);
  var issueId = typeof body.issueId === 'string' ? body.issueId.trim() : '';
  if (!issueId || issueId.length > 255) {
    return fail(res, 400, MESSAGES.missingIssue);
  }
  var address = staffAddress(token);
  var email = headerSafe(address);
  if (action === 'test' && !address) {
    return fail(res, 422, MESSAGES.noTestAddress);
  }
  if (action === 'test' && !email) {
    return fail(res, 422, MESSAGES.testAddressUnsupported);
  }
  var staff = staffName(token, email);

  try {
    if (!(await issueExists(issueId))) {
      return fail(res, 404, MESSAGES.notFound);
    }
  } catch (err) {
    console.error('[newsletter] admin ' + action + ': could not read the newsletter — ' + ((err && (err.code || err.message)) || 'error'));
    return fail(res, 503, MESSAGES.readFailed);
  }

  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, SERVICE_TIMEOUT_MS);
  var response = null;
  var answer = null;
  try {
    response = await fetch(service.url + '/newsletter/site/' + action, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Teleport-Service-Token': service.token,
        'X-Teleport-Service-Project': service.project,
        'X-Teleport-Staff': staff,
      },
      body: JSON.stringify({ issueId: issueId }),
      signal: controller.signal,
      // A redirect would carry the token to another host: refused (502).
      redirect: 'error',
    });
    try {
      answer = await response.json();
    } catch (readErr) {
      if (controller.signal.aborted) throw readErr;
      answer = null;
    }
  } catch (err) {
    var timedOut = controller.signal.aborted || (err && err.name === 'AbortError');
    // The failure's code only: a message can quote the request.
    console.error('[newsletter] admin ' + action + ': the newsletter service ' + (timedOut ? 'did not answer within ' + SERVICE_TIMEOUT_MS + ' ms' : 'could not be reached (' + ((err && err.cause && err.cause.code) || (err && err.name) || 'error') + ')'));
    return fail(res, timedOut ? 504 : 502, timedOut ? MESSAGES.timeout : MESSAGES.unreachable);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401) {
    // The site's key is not the current one (reset since this deploy).
    console.error('[newsletter] admin ' + action + ': the newsletter service refused the site key; publish the site again');
    return fail(res, 503, MESSAGES.keyRefused);
  }
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    console.error('[newsletter] admin ' + action + ': the newsletter service answered ' + response.status + ' without its JSON answer');
    return fail(res, 502, MESSAGES.badAnswer);
  }
  return res.status(response.status).json(relayedAnswer(response, answer));
};
`

/**
 * Declares the newsletter service's `.env` lines, empty: the worker fills them
 * on a production deploy only (`injectNewsletterServiceEnv` acts on a declared
 * `NEWSLETTER_SERVICE_URL=` line).
 */
export const declareNewsletterServiceEnv = (uidl: ProjectUIDL): void => {
  if (!uidl.globals) {
    ;(uidl as { globals: unknown }).globals = { settings: { language: 'en' }, assets: [], env: {} }
  }
  if (!uidl.globals.env) {
    uidl.globals.env = {}
  }
  for (const name of NEWSLETTER_SERVICE_ENV_NAMES) {
    if (!uidl.globals.env[name]) {
      uidl.globals.env[name] = ''
    }
  }
}
