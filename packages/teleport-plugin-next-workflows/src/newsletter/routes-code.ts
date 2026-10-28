/**
 * The newsletter's public routes, `pages/api/newsletter/*.js`. Each makes its
 * decision through the helper (`utils/newsletter/newsletter.js`), never from
 * what the browser claims beyond the address or the link's token.
 *
 * - `subscribe` — POST `{ email, website, signUpPoint }`: `website` is the
 *   form's honeypot; `signUpPoint` one of the site pages' own (`block`,
 *   `footer`, `popup`, `form`), else `block`; errors are logged by code and
 *   message only (never a database row); every answer is `{ ok: true, pending }`, after at least
 *   `NEWSLETTER_MIN_RESPONSE_MS`, whatever happened to the address.
 * - `confirm` — POST `{ token }` → `{ ok, email? }`.
 * - `unsubscribe` — POST `{ token }` → `{ ok, email? }`; a GET with `?t=`
 *   (a click in a mail client) answers a small page whose button POSTs it, so a
 *   link scanner that opens every link unsubscribes nobody.
 */
import { securityRuntimeSpecifier } from '../security-runtime/security-runtime-code'
import {
  NEWSLETTER_UNSUBSCRIBE_URL,
  NEWSLETTER_VISITOR_LIMIT,
  NEWSLETTER_VISITOR_SCOPE,
  newsletterHelperSpecifier,
} from './newsletter-scope'

/** From `pages/api/newsletter/` to the project root. */
const RELATIVE_PREFIX = '../../..'

/** Confirm and unsubscribe attempts per visitor per hour. */
export const NEWSLETTER_LINK_VISITOR_LIMIT = 30

const ROUTE_PREAMBLE = `var __security = require('${securityRuntimeSpecifier(RELATIVE_PREFIX)}');
var __newsletter = require('${newsletterHelperSpecifier(RELATIVE_PREFIX)}');

function readBody(req) {
  var body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  return body && typeof body === 'object' ? body : {};
}`

const methodGuard = (methods: string[]): string => `  if (${methods
  .map((method) => `req.method !== '${method}'`)
  .join(' && ')}) {
    res.setHeader('Allow', '${methods.join(', ')}');
    return res.status(405).json({ error: 'Method not allowed' });
  }`

export const generateNewsletterSubscribeRoute = (): string => `${ROUTE_PREAMBLE}

module.exports = async function handler(req, res) {
${methodGuard(['POST'])}
  // ${NEWSLETTER_VISITOR_LIMIT} sign-ups per visitor per hour, one budget with the sign-up
  // workflows' steps (their visitorLimit scope '${NEWSLETTER_VISITOR_SCOPE}').
  if (!(await __security.rateLimitRequest(req, res, { scope: 'visitor-limit:${NEWSLETTER_VISITOR_SCOPE}', limit: ${NEWSLETTER_VISITOR_LIMIT}, windowSeconds: 3600 }))) {
    return;
  }
  var startedAt = Date.now();
  var body = readBody(req);
  var answer = __newsletter.publicSubscribeAnswer();
  // The honeypot: a field people never see, which a bot fills. It is thanked
  // like a person and nothing is written.
  var trap = body.website == null ? '' : String(body.website).trim();
  if (trap) {
    await __newsletter.waitUntilElapsed(startedAt, __newsletter.NEWSLETTER_MIN_RESPONSE_MS);
    return res.status(200).json(answer);
  }
  var email = __newsletter.normalizeEmail(body.email);
  if (!email) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  try {
    await __newsletter.withNewsletterDb(function (db) {
      return __newsletter.subscribeNewsletterPerson({
        db: db,
        email: email,
        // Only the site pages' own points: the server-side ones are never a visitor's.
        signUpPoint: __newsletter.publicRouteSignUpPoint(body.signUpPoint),
        req: req,
      });
    });
  } catch (err) {
    return __security.sendClientError(res, 503, 'We could not add you to the newsletter. Please try again in a moment.', __newsletter.safeError(err));
  }
  await __newsletter.waitUntilElapsed(startedAt, __newsletter.NEWSLETTER_MIN_RESPONSE_MS);
  return res.status(200).json(answer);
};
`

export const generateNewsletterConfirmRoute = (): string => `${ROUTE_PREAMBLE}

module.exports = async function handler(req, res) {
${methodGuard(['POST'])}
  if (!(await __security.rateLimitRequest(req, res, { scope: 'newsletter-confirm', limit: ${NEWSLETTER_LINK_VISITOR_LIMIT}, windowSeconds: 3600 }))) {
    return;
  }
  var body = readBody(req);
  var token = typeof body.token === 'string' ? body.token : '';
  if (!token) {
    return res.status(200).json({ ok: false });
  }
  try {
    var result = await __newsletter.withNewsletterDb(function (db) {
      return __newsletter.confirmNewsletter({ db: db, token: token, req: req });
    });
    return res.status(200).json(result.ok ? { ok: true, email: result.email } : { ok: false });
  } catch (err) {
    return __security.sendClientError(res, 503, 'We could not confirm the subscription. Please try again in a moment.', __newsletter.safeError(err));
  }
};
`

export const generateNewsletterUnsubscribeRoute = (): string => `${ROUTE_PREAMBLE}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The page a mail client's click lands on: plain, never indexed, never cached.
function sendPage(res, status, title, message, form) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.end(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>' + escapeHtml(title) + '</title>' +
    '<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;color:#111;line-height:1.5}' +
    'button{font:inherit;padding:10px 18px;border:0;border-radius:6px;background:#111;color:#fff;cursor:pointer}</style>' +
    '</head><body><h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(message) + '</p>' + (form || '') + '</body></html>'
  );
}

var NOT_A_LINK = 'This unsubscribe link does not work. Use the link in a newer email from us.';

module.exports = async function handler(req, res) {
${methodGuard(['GET', 'POST'])}
  if (!(await __security.rateLimitRequest(req, res, { scope: 'newsletter-unsubscribe', limit: ${NEWSLETTER_LINK_VISITOR_LIMIT}, windowSeconds: 3600 }))) {
    return;
  }
  if (req.method === 'GET') {
    // Opening the link changes nothing: the button does.
    var linkToken = req.query && typeof req.query.t === 'string' ? req.query.t : '';
    if (!__newsletter.verifyNewsletterToken(linkToken, 'unsubscribe')) {
      return sendPage(res, 200, 'Link not valid', NOT_A_LINK, '');
    }
    return sendPage(
      res,
      200,
      'Unsubscribe',
      'Stop receiving the newsletter at this address?',
      '<form method="post" action="${NEWSLETTER_UNSUBSCRIBE_URL}"><input type="hidden" name="t" value="' +
        escapeHtml(linkToken) + '"><button type="submit">Unsubscribe</button></form>'
    );
  }
  var body = readBody(req);
  var fromForm = String((req.headers && req.headers['content-type']) || '').indexOf('application/x-www-form-urlencoded') !== -1;
  var token = typeof body.token === 'string' ? body.token : typeof body.t === 'string' ? body.t : '';
  var result = { ok: false };
  try {
    if (token) {
      result = await __newsletter.withNewsletterDb(function (db) {
        return __newsletter.unsubscribeNewsletter({ db: db, token: token, req: req });
      });
    }
  } catch (err) {
    if (fromForm) {
      console.error('[newsletter] unsubscribe failed:', __newsletter.safeError(err));
      return sendPage(res, 503, 'Please try again', 'We could not unsubscribe you just now. Please try again in a moment.', '');
    }
    return __security.sendClientError(res, 503, 'We could not unsubscribe you. Please try again in a moment.', __newsletter.safeError(err));
  }
  if (fromForm) {
    return result.ok
      ? sendPage(res, 200, "You're unsubscribed", 'You will not receive the newsletter at this address any more.', '')
      : sendPage(res, 200, 'Link not valid', NOT_A_LINK, '');
  }
  return res.status(200).json(result.ok ? { ok: true, email: result.email } : { ok: false });
};
`
