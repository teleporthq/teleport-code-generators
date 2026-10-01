import { SessionCookieResolver, WebPush } from '@teleporthq/teleport-shared'
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
 * auth secret. Each server instance also caps the requests per client.
 */
export const buildSubscriptionsRouteSource = (): string => `var push = require(${toJsLiteral(
  MODULE_IMPORT
)});

${SessionCookieResolver.generateCommonJsSessionTokenResolverCode()}

var MISSING_TABLE = ${toJsLiteral(MISSING_TABLE)};
var KEY_CHANGED = 'This page uses push notification keys that have since been replaced. Reload the page and try again.';
var TAKEN = 'This push subscription is saved for another browser.';
// A visitor subscribes once and re-saves a few times per visit; more than this
// from one client within the window is somebody filling the table.
var RATE_WINDOW_MS = 10 * 60 * 1000;
var RATE_LIMIT = 30;
var RATE_TRACKED_CLIENTS = 10000;
var __requestsByClient = new Map();

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

function clientAddress(req) {
  var forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function isRateLimited(req) {
  var now = Date.now();
  var client = clientAddress(req);
  var entry = __requestsByClient.get(client);
  if (!entry || now - entry.start >= RATE_WINDOW_MS) {
    if (__requestsByClient.size >= RATE_TRACKED_CLIENTS) {
      __requestsByClient.forEach(function (tracked, key) {
        if (now - tracked.start >= RATE_WINDOW_MS) {
          __requestsByClient.delete(key);
        }
      });
      if (__requestsByClient.size >= RATE_TRACKED_CLIENTS) {
        __requestsByClient.clear();
      }
    }
    entry = { start: now, count: 0 };
    __requestsByClient.set(client, entry);
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
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
  if (isRateLimited(req)) {
    res.setHeader('Retry-After', String(RATE_WINDOW_MS / 1000));
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
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
 * the last subscription reached and relays on in turn.
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

function relayUrl(req) {
  var host = requestHost(req);
  var local = host.indexOf('localhost') === 0 || host.indexOf('127.0.0.1') === 0;
  var proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (local ? 'http' : 'https');
  return proto + '://' + host + SEND_ROUTE;
}

async function relay(req, body) {
  var headers = { 'Content-Type': 'application/json' };
  headers[TOKEN_HEADER] = String(req.headers[TOKEN_HEADER]);
  var bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) {
    headers['x-vercel-protection-bypass'] = bypass;
    headers['x-vercel-set-bypass-cookie'] = 'false';
  }
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
