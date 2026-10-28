import { SessionCookieResolver, WebPush } from '@teleporthq/teleport-shared'
import {
  CONFIGURED_NEXTAUTH_URL_EXPRESSION,
  generateProtectionBypassHeaderStatements,
  securityRuntimeSpecifier,
} from '@teleporthq/teleport-plugin-next-workflows'
import { toJsLiteral } from '../pwa/source-literals'
import { WEB_PUSH_MODULE_NAME, WEB_PUSH_MODULE_PATH } from './server-module-source'

/** From `pages/api/push/<route>.js` to the project root. */
const MODULE_IMPORT = `../../../${WEB_PUSH_MODULE_PATH.join('/')}/${WEB_PUSH_MODULE_NAME}`

const MISSING_TABLE =
  'The push subscriptions table is missing. In the editor, open a push notification step, choose "Set up push notifications" and publish again.'

/**
 * `pages/api/push/subscriptions.js`: a browser saves (POST) or forgets
 * (DELETE) its own subscription. Public — a visitor does not need an account
 * to subscribe — so it only accepts a same-origin JSON request (a cross-site
 * page cannot link its own device to a signed-in visitor), validates the
 * subscription completely, takes the user from the session cookie, never from
 * the body, and changes a stored subscription only for the browser holding its
 * auth secret. Each visitor (an IPv6 one by its /64) may send 30 requests per
 * 10 minutes, counted in the app's database by the shared security runtime —
 * every instance together, keyed on the address the host vouches for, never on
 * a forwarded header the visitor wrote.
 */
export const buildSubscriptionsRouteSource = (
  // The project has authentication: the session reader checks revocation.
  options: { withSessionRevocation?: boolean } = {}
): string => `var push = require(${toJsLiteral(MODULE_IMPORT)});
var security = require(${toJsLiteral(securityRuntimeSpecifier('../../..'))});

${SessionCookieResolver.generateCommonJsSessionTokenResolverCode('../../..', {
  withRevocation: options.withSessionRevocation !== false,
})}

var MISSING_TABLE = ${toJsLiteral(MISSING_TABLE)};
var KEY_CHANGED = 'This page uses push notification keys that have since been replaced. Reload the page and try again.';
var TAKEN = 'This push subscription is saved for another browser.';
// A visitor subscribes once and re-saves a few times per visit; more than this
// from one client within the window is somebody filling the table.
var RATE_LIMIT = { scope: 'push-subscriptions', limit: 30, windowSeconds: 600 };

function isSameOrigin(req) {
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

async function signedInUserId(req) {
  try {
    var token = await __tqSessionToken(req);
    return token ? push.normalizeUserId(token.id || token.sub) : null;
  } catch (error) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isSameOrigin(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // Answers the 429 itself (with Retry-After) past the limit.
  if (!(await security.rateLimitRequest(req, res, RATE_LIMIT))) {
    return;
  }
  var problem = push.configurationProblem();
  if (problem) {
    return res.status(503).json({ error: problem });
  }

  var body = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    if (req.method === 'DELETE') {
      return res.status(200).json({ deleted: await push.deleteSubscription(body.endpoint, body.auth) });
    }
    var subscription = push.normalizeSubscription(body.subscription);
    if (!subscription) {
      return res.status(400).json({ error: 'This is not a valid push subscription.' });
    }
    if (!push.isCurrentKey(body.applicationServerKey)) {
      return res.status(409).json({ error: KEY_CHANGED });
    }
    var saved = await push.saveSubscription(subscription, {
      userId: await signedInUserId(req),
      previousEndpoint: body.previousEndpoint,
      previousAuth: body.previousAuth,
    });
    return saved ? res.status(200).json({ saved: true }) : res.status(409).json({ error: TAKEN });
  } catch (error) {
    var missingTable = !!error && error.code === '42P01';
    console.error('[push] subscription request failed:', error && error.message);
    return res
      .status(missingTable ? 503 : 500)
      .json({ error: missingTable ? MISSING_TABLE : 'The push subscription could not be saved.' });
  }
}
`

/**
 * `pages/api/push/send.js`: sends one notification to the stored
 * subscriptions. Internal — only the app's own server code can compute the
 * token it requires (an HMAC keyed with the VAPID private key). The request's
 * own host is the VAPID contact subject.
 *
 * One call sends for as long as a serverless call can wait; the rest of a
 * large audience is relayed to a new call of this route, which resumes after
 * the last subscription reached and relays on in turn — at the app's own
 * origin (the server runtime's trustedBaseUrl rule), never at a host a request
 * header named, with the bypass header the self-call helper builds.
 */
export const buildSendRouteSource = (): string => `var push = require(${toJsLiteral(
  MODULE_IMPORT
)});

var TOKEN_HEADER = ${toJsLiteral(WebPush.SEND_TOKEN_HEADER)};
var SEND_ROUTE = ${toJsLiteral(WebPush.SEND_ROUTE)};
var MISSING_TABLE = ${toJsLiteral(MISSING_TABLE)};
var MAX_RELAYS = 100;
// How long a call waits for its relay to be picked up; the relay then runs on its own.
var RELAY_HANDOFF_MS = 1500;

function requestHost(req) {
  return String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
}

function contactSubject(req) {
  return 'https://' + requestHost(req);
}

function isLoopbackHost(host) {
  var name = String(host || '').replace(/:[0-9]+$/, '').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]';
}

// The relay carries the send token and the protection bypass, so it goes to
// this deployment's own origin by the rule every such self-call follows (the
// workflow server runtime's trustedBaseUrl, which the push step's own call to
// this route was sent by), never to a host a header named: on Vercel the
// request's host (Vercel routes only this deployment's domains to it);
// elsewhere NEXTAUTH_URL as the deployment configured it, except that a local
// server keeps its own loopback address.
function relayUrl(req) {
  var host = String(req.headers.host || '');
  var proto = String(req.headers['x-forwarded-proto'] || (isLoopbackHost(host) ? 'http' : 'https')).split(',')[0].trim();
  var origin = proto + '://' + host;
  if (!process.env.VERCEL) {
    var configured = String(${CONFIGURED_NEXTAUTH_URL_EXPRESSION} || '').trim();
    if (configured) {
      try {
        var own = new URL(configured).origin;
        if (!(isLoopbackHost(host) && isLoopbackHost(new URL(own).host))) origin = own;
      } catch (e) {}
    }
  }
  return origin + SEND_ROUTE;
}

async function relay(req, body) {
  var headers = { 'Content-Type': 'application/json' };
  headers[TOKEN_HEADER] = String(req.headers[TOKEN_HEADER]);
${generateProtectionBypassHeaderStatements('headers')}
  var controller = new AbortController();
  var timer = setTimeout(function () {
    controller.abort();
  }, RELAY_HANDOFF_MS);
  try {
    await fetch(relayUrl(req), { method: 'POST', headers: headers, body: JSON.stringify(body), signal: controller.signal });
    return true;
  } catch (error) {
    // Still running when the wait ended: it was picked up.
    return !!error && error.name === 'AbortError';
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  var problem = push.configurationProblem();
  if (problem) {
    return res.status(503).json({ success: false, error: problem });
  }
  if (!push.verifySendToken(req.headers[TOKEN_HEADER])) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    var request = req.body && typeof req.body === 'object' ? req.body : {};
    var result = await push.sendNotification(request, contactSubject(req));
    var cursor = result.cursor;
    delete result.cursor;
    if (!result.complete && cursor) {
      var relays = (parseInt(request.relay, 10) || 0) + 1;
      var relayed =
        relays <= MAX_RELAYS && (await relay(req, Object.assign({}, request, { after: cursor, relay: relays })));
      if (!relayed) {
        console.error('[push] the rest of the audience could not be handed on after relay', relays - 1);
      }
    }
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    var missingTable = !!error && error.code === '42P01';
    console.error('[push] send failed:', error && error.message);
    return res
      .status(missingTable ? 503 : 500)
      .json({ success: false, error: missingTable ? MISSING_TABLE : 'The notification could not be sent.' });
  }
}
`
