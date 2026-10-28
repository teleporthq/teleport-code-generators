import { UIDLWorkflows } from '@teleporthq/teleport-types'
import { generateCommonJsSessionTokenResolverCode } from './session-cookie-resolver'
import { REALTIME_TRIGGER_TYPES } from './graph-utils'

/**
 * Who a realtime request acts for, and what it may do.
 *
 * The site's `/api/realtime/*` routes hold the project's realtime key, so the
 * realtime worker trusts what they send. They used to forward the browser's
 * body as it came — `userId`, `senderId`, `senderName` — and the worker gave
 * every token every channel of the project (`<projectId>:*`): any visitor
 * subscribed to every channel, joined presence and published as anyone it
 * named.
 *
 * Now the route decides the identity itself, and the browser cannot name one:
 * - the signed-in user of the site's own session (its id, its name);
 * - otherwise an opaque per-visitor id, `anon_<hash>`, derived from a random
 *   key in an httpOnly cookie this route sets. The id is a one-way hash of the
 *   key, so knowing someone's id (presence shows it) does not let anyone
 *   present their cookie. On https the cookie is `__Host-tq_rt` (`Path=/`,
 *   `Secure`, no `Domain`), which a sibling site on the shared hosting domain
 *   cannot set; plain http (local development) uses `__tq_rt`. Its value is
 *   `<key>.<HMAC(app secret, key)>`: a value this server did not issue is
 *   replaced, never adopted, and without the app secret the route refuses.
 * It sends that identity to the worker in the `x-realtime-identity` header,
 * and the worker then (real-time-worker `src/lib/identity.ts`):
 * - uses it as the token's clientId, the presence member and the sender;
 * - grants a token exactly the channels that identity may use: the channels
 *   the site's pages subscribe to (`collectSiteRealtimeChannels`), the ones it
 *   joined, and its own `user.<id>` channel — never `<projectId>:*`;
 * - keeps `user.<id>` and `user.<id>.<anything>` private to `<id>`: nobody
 *   else may subscribe, join, list or publish there. Every other channel name
 *   is public.
 * Every route is rate-limited per visitor through the shared security runtime.
 * What Ably vouches for in presence is the member's clientId (that identity);
 * a member's presence `userName` / `userData` are what its own browser sent
 * with presence.enter, so they are display data, never proof of who it is.
 *
 * The workflow nodes that SEND (`realtime-send-channel-message/event`) run on
 * the server and call the worker with the key directly; they send as the
 * author configured, and may address any channel, `user.<id>` included — that
 * is how a site notifies one user.
 */
export const REALTIME_IDENTITY_HEADER = 'x-realtime-identity'
export const REALTIME_ANON_COOKIE = '__tq_rt'
export const REALTIME_ANON_COOKIE_SECURE = '__Host-tq_rt'
export const REALTIME_MAX_SITE_CHANNELS = 100

/** Per-visitor limits of each route, `[limit, windowSeconds]` pairs. */
export const REALTIME_ROUTE_LIMITS: Record<string, Array<[number, number]>> = {
  'realtime-token': [[60, 60]],
  'realtime-join': [[30, 60]],
  'realtime-leave': [[60, 60]],
  'realtime-message': [
    [20, 60],
    [300, 86400],
  ],
  'realtime-event': [
    [20, 60],
    [300, 86400],
  ],
  'realtime-channels-list': [[30, 60]],
  'realtime-channels-members': [[30, 60]],
}

const CHANNEL_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,256}$/

/**
 * The fixed channel names the site's pages subscribe to (the realtime
 * triggers). A token is granted these plus whatever the visitor joined; a
 * name bound to workflow context is not fixed and is granted on join.
 */
export const collectSiteRealtimeChannels = (workflows: UIDLWorkflows | undefined): string[] => {
  const names = new Set<string>()
  const add = (type: string, config: Record<string, unknown> | undefined) => {
    const channelName = config ? config.channelName : undefined
    if (
      REALTIME_TRIGGER_TYPES.has(type) &&
      typeof channelName === 'string' &&
      CHANNEL_NAME_PATTERN.test(channelName)
    ) {
      names.add(channelName)
    }
  }
  const all = (workflows && workflows.workflows) || {}
  for (const workflow of Object.values(all)) {
    if (workflow.trigger) {
      add(workflow.trigger.type, workflow.trigger.config)
    }
    for (const node of workflow.nodes || []) {
      add(node.type, node.config)
    }
  }
  return Array.from(names).sort().slice(0, REALTIME_MAX_SITE_CHANNELS)
}

/**
 * Whether a workflow node of the project calls `/api/realtime/<route>` (a
 * custom-code or HTTP node naming the path). The send nodes do not: they run
 * on the server and call the realtime worker directly. Without a caller the
 * browser-facing message / event routes are not emitted — each one is a way
 * to spend the project's message quota.
 */
export const projectCallsRealtimeRoute = (
  workflows: UIDLWorkflows | undefined,
  route: 'message' | 'event'
): boolean => {
  // The path itself, not a longer one that starts with it.
  const calls = new RegExp(`/api/realtime/${route}(?![A-Za-z0-9_-])`)
  const nodeLists: Array<Array<{ config?: unknown }>> = []
  for (const workflow of Object.values((workflows && workflows.workflows) || {})) {
    nodeLists.push(workflow.nodes || [])
  }
  for (const customNode of Object.values((workflows && workflows.customNodes) || {})) {
    nodeLists.push(
      ((customNode as { nodes?: Array<{ config?: unknown }> }).nodes || []) as Array<{
        config?: unknown
      }>
    )
  }
  return nodeLists.some((nodes) =>
    nodes.some((node) => calls.test(JSON.stringify(node.config === undefined ? null : node.config)))
  )
}

export const generateRealtimeServerHelperCode = (
  workflows?: UIDLWorkflows,
  options: { withSessionRevocation?: boolean } = {}
): string => {
  return `const crypto = require('crypto');
const __security = require('../security-runtime');

const REALTIME_SERVER_URL = process.env.REALTIME_SERVER_URL;
const REALTIME_SERVER_API_KEY = process.env.REALTIME_SERVER_API_KEY;

// The channels this site's pages subscribe to; every token covers them.
const SITE_CHANNELS = ${JSON.stringify(collectSiteRealtimeChannels(workflows))};

// Per-visitor limits of each route: [limit, windowSeconds].
const ROUTE_LIMITS = ${JSON.stringify(REALTIME_ROUTE_LIMITS)};

// __Host- on https: only this origin can set it (no Domain, Path=/, Secure).
const ANON_COOKIE_SECURE = '${REALTIME_ANON_COOKIE_SECURE}';
const ANON_COOKIE_PLAIN = '${REALTIME_ANON_COOKIE}';
// <32 hex key>.<64 hex HMAC of the key>
const ANON_COOKIE_PATTERN = /^([0-9a-f]{32})\\.([0-9a-f]{64})$/;
// What the realtime worker accepts as an identity id (no dots: user.<id>.<x>).
const IDENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

${generateCommonJsSessionTokenResolverCode('../..', {
  withRevocation: options.withSessionRevocation !== false,
})}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// Every value the request carries for the cookie name.
function readCookies(req, name) {
  const raw = (req && req.headers && req.headers.cookie) || '';
  const parts = String(raw).split(';');
  const values = [];
  for (let i = 0; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq > 0 && parts[i].slice(0, eq).trim() === name) {
      values.push(parts[i].slice(eq + 1).trim());
    }
  }
  return values;
}

function signAnonKey(secret, key) {
  return crypto.createHmac('sha256', secret).update('teleport-realtime-anon:v1:' + key).digest('hex');
}

// The key of a cookie this server issued, or null: an unsigned or wrongly
// signed value is never adopted.
function issuedAnonKey(req, name, secret) {
  const values = readCookies(req, name);
  for (let i = 0; i < values.length; i++) {
    const match = ANON_COOKIE_PATTERN.exec(values[i]);
    if (match && __security.safeEqual(match[2], signAnonKey(secret, match[1]))) {
      return match[1];
    }
  }
  return null;
}

function appendSetCookie(res, cookie) {
  const existing = res.getHeader ? res.getHeader('Set-Cookie') : undefined;
  const list = !existing ? [] : Array.isArray(existing) ? existing : [String(existing)];
  res.setHeader('Set-Cookie', list.concat([cookie]));
}

// Who this request acts for. The signed-in user of the site's own session;
// otherwise an opaque id derived from a random key in an httpOnly cookie this
// route sets. Nothing the browser sends can choose it.
async function resolveIdentity(req, res) {
  let token = null;
  try {
    token = await __tqSessionToken(req);
  } catch (e) {
    token = null;
  }
  const userId = token && typeof token === 'object' ? (token.id != null ? token.id : token.sub) : null;
  if (userId != null && String(userId) !== '') {
    const raw = String(userId);
    const name = typeof token.name === 'string' ? token.name.trim().slice(0, 100) : '';
    return {
      id: IDENTITY_ID_PATTERN.test(raw) ? raw : 'u_' + sha256Hex(raw).slice(0, 32),
      name: name || 'Anonymous',
    };
  }
  // The cookie is signed with the app secret; without it the route refuses.
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is not set: the anonymous realtime identity cannot be signed');
  }
  const secure = __tqRequestIsSecure(req);
  const cookieName = secure ? ANON_COOKIE_SECURE : ANON_COOKIE_PLAIN;
  let key = issuedAnonKey(req, cookieName, secret);
  if (!key) {
    key = crypto.randomBytes(16).toString('hex');
    appendSetCookie(
      res,
      cookieName + '=' + key + '.' + signAnonKey(secret, key) +
        (secure ? '; Path=/; Secure; HttpOnly; SameSite=Lax' : '; Path=/api/realtime; HttpOnly; SameSite=Lax')
    );
  }
  return { id: 'anon_' + sha256Hex('teleport-realtime-anon:' + key).slice(0, 32), name: 'Anonymous' };
}

// The visitor's rate limits for one route; false = the 429 is already sent.
async function allow(req, res, scope) {
  const limits = ROUTE_LIMITS[scope] || [];
  for (let i = 0; i < limits.length; i++) {
    const ok = await __security.rateLimitRequest(req, res, {
      scope: scope,
      limit: limits[i][0],
      windowSeconds: limits[i][1],
    });
    if (!ok) return false;
  }
  return true;
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try {
      const parsed = JSON.parse(req.body);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }
  return {};
}

async function realtimeServerFetch(path, options, identity) {
  const url = REALTIME_SERVER_URL + '/api/realtime' + path;
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + REALTIME_SERVER_API_KEY };
  if (identity) {
    headers['${REALTIME_IDENTITY_HEADER}'] = Buffer.from(
      JSON.stringify({ id: identity.id, name: identity.name })
    ).toString('base64url');
  }
  return fetch(url, Object.assign({}, options || {}, { headers: headers }));
}

// One proxied call: limits, identity, the worker's answer. The call names the
// route's limit scope, the worker path (from the browser's body), the method,
// the body sent upstream (only fields the route names) and whether the answer
// tells the browser who it is. The browser gets the worker's own answer or a
// generic error.
async function relay(req, res, call) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!(await allow(req, res, call.scope))) return;
  const input = readBody(req);
  try {
    const identity = await resolveIdentity(req, res);
    const path = call.path(input, identity);
    if (!path) {
      res.status(400).json({ error: 'channelName is required' });
      return;
    }
    const options = { method: call.method };
    if (call.body) {
      // The identity's fields as the old request shape names them, so a
      // realtime worker not yet updated still acts for this identity; an
      // updated one reads the identity header and ignores them.
      options.body = JSON.stringify(Object.assign({}, call.body(input), {
        userId: identity.id,
        userName: identity.name,
        senderId: identity.id,
        senderName: identity.name,
      }));
    }
    const response = await realtimeServerFetch(path, options, identity);
    const data = await response.json();
    if (call.withIdentity && response.ok && data && typeof data === 'object') {
      data.identity = { id: identity.id, name: identity.name };
    }
    res.status(response.status).json(data);
  } catch (error) {
    __security.sendClientError(res, 502, 'Realtime is unavailable right now.', error);
  }
}

module.exports = {
  realtimeServerFetch: realtimeServerFetch,
  resolveIdentity: resolveIdentity,
  relay: relay,
  SITE_CHANNELS: SITE_CHANNELS,
};
`
}

export const generateRealtimeClientCode = (): string => {
  return `const Ably = require('ably');

let _ablyClient = null;
let _namespace = null;
// Who the server says this visitor is (its session, or an opaque id it
// issued). Set from every token and join answer; never chosen here.
let _identity = null;
let _userId = null;
let _userName = null;
let _channelRefCounts = {};
let _readyCallbacks = [];
let _isReady = false;
// A token a join answer brought, handed to Ably on its next authorize().
let _pendingTokenRequest = null;
let _authorizing = null;

function _notifyReady() {
  _isReady = true;
  const cbs = _readyCallbacks.slice();
  _readyCallbacks = [];
  for (let i = 0; i < cbs.length; i++) cbs[i]();
}

function whenReady() {
  const ready = _isReady && _namespace
    ? Promise.resolve()
    : new Promise(function(resolve) { _readyCallbacks.push(resolve); });
  return _authorizing ? Promise.all([ready, _authorizing]).then(function() {}) : ready;
}

function _absorb(data) {
  if (!data) return;
  if (data.namespace) _namespace = data.namespace;
  if (data.identity && data.identity.id) _identity = data.identity;
}

function getIdentity() { return _identity; }
function getUserId() { return (_identity && _identity.id) || _userId || ''; }
function getUserName() { return (_identity && _identity.name) || _userName || 'Anonymous'; }
function setUser(userId, userName) { _userId = userId; _userName = userName; }
function getNamespace() { return _namespace; }

function getNamespacedChannelName(channelName) {
  if (!_namespace) return channelName;
  return _namespace + ':' + channelName;
}

function _authCallback(tokenParams, callback) {
  if (_pendingTokenRequest) {
    const t = _pendingTokenRequest;
    _pendingTokenRequest = null;
    callback(null, t);
    return;
  }
  fetch('/api/realtime/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  }).then(function(res) { return res.json(); })
    .then(function(data) {
      _absorb(data);
      if (data.tokenRequest) {
        if (!_isReady) _notifyReady();
        callback(null, data.tokenRequest);
      } else {
        callback(new Error((data.error && data.error.message) || 'Token request failed'), null);
      }
    }).catch(function(err) { callback(err, null); });
}

function _createClient() {
  _ablyClient = new Ably.Realtime({ authCallback: _authCallback });
  _ablyClient.connection.on('connected', function() {
    if (_namespace && !_isReady) _notifyReady();
  });
  return _ablyClient;
}

function getAblyClient() {
  if (_ablyClient) return _ablyClient;
  if (typeof window === 'undefined') return null;
  return _createClient();
}

function initializeClient(joinData) {
  _absorb(joinData);
  const tokenRequest = joinData && joinData.tokenRequest ? joinData.tokenRequest : null;
  if (_ablyClient) {
    if (tokenRequest) {
      // The join widened the channels this connection may use: swap its token.
      _pendingTokenRequest = tokenRequest;
      const authorizing = Promise.resolve()
        .then(function() { return _ablyClient.auth.authorize(); })
        .catch(function() {})
        .then(function() { if (_authorizing === authorizing) _authorizing = null; });
      _authorizing = authorizing;
    }
    if (_namespace && !_isReady) _notifyReady();
    return _ablyClient;
  }
  if (typeof window === 'undefined') return null;
  _pendingTokenRequest = tokenRequest;
  return _createClient();
}

function closeClient() {
  if (_ablyClient) {
    _ablyClient.close();
    _ablyClient = null;
  }
  _namespace = null;
  _identity = null;
  _channelRefCounts = {};
  _isReady = false;
  _readyCallbacks = [];
  _pendingTokenRequest = null;
  _authorizing = null;
}

function incrementChannelRef(channelName) {
  _channelRefCounts[channelName] = (_channelRefCounts[channelName] || 0) + 1;
  return _channelRefCounts[channelName];
}

function decrementChannelRef(channelName) {
  const count = (_channelRefCounts[channelName] || 1) - 1;
  _channelRefCounts[channelName] = Math.max(0, count);
  return _channelRefCounts[channelName];
}

function getChannelRefCount(channelName) {
  return _channelRefCounts[channelName] || 0;
}

const _exports = {
  getAblyClient: getAblyClient,
  initializeClient: initializeClient,
  closeClient: closeClient,
  whenReady: whenReady,
  getNamespace: getNamespace,
  getNamespacedChannelName: getNamespacedChannelName,
  getIdentity: getIdentity,
  getUserId: getUserId,
  getUserName: getUserName,
  setUser: setUser,
  incrementChannelRef: incrementChannelRef,
  decrementChannelRef: decrementChannelRef,
  getChannelRefCount: getChannelRefCount
};

if (typeof window !== 'undefined') {
  window.__teleportRealtime = _exports;
  window.addEventListener('beforeunload', function() {
    closeClient();
  });
}

module.exports = _exports;
`
}

const relayRoute = (depth: string, call: string): string =>
  `const realtimeServer = require('${depth}/utils/realtime/server');

// See realtime-generator.ts: the identity is the server's, never the body's.
module.exports = async function handler(req, res) {
  await realtimeServer.relay(req, res, {
${call}
  });
};
`

export const generateRealtimeTokenRoute = (): string =>
  relayRoute(
    '../../..',
    `    scope: 'realtime-token',
    method: 'POST',
    path: function() { return '/auth/token'; },
    body: function() { return { channels: realtimeServer.SITE_CHANNELS }; },
    withIdentity: true,`
  )

export const generateRealtimeJoinRoute = (): string =>
  relayRoute(
    '../../..',
    `    scope: 'realtime-join',
    method: 'POST',
    path: function() { return '/channels/join'; },
    // The answer's token replaces the connection's, so it covers the site's channels too.
    body: function(input) {
      return { channelName: input.channelName, userData: input.userData, channels: realtimeServer.SITE_CHANNELS };
    },
    withIdentity: true,`
  )

export const generateRealtimeLeaveRoute = (): string =>
  relayRoute(
    '../../..',
    `    scope: 'realtime-leave',
    method: 'POST',
    path: function() { return '/channels/leave'; },
    body: function(input) { return { channelName: input.channelName }; },`
  )

export const generateRealtimeMessageRoute = (): string =>
  relayRoute(
    '../../..',
    `    scope: 'realtime-message',
    method: 'POST',
    path: function() { return '/channels/message'; },
    body: function(input) {
      return { channelName: input.channelName, message: input.message, messageData: input.messageData };
    },`
  )

export const generateRealtimeEventRoute = (): string =>
  relayRoute(
    '../../..',
    `    scope: 'realtime-event',
    method: 'POST',
    path: function() { return '/channels/event'; },
    body: function(input) {
      return { channelName: input.channelName, eventName: input.eventName, eventData: input.eventData };
    },`
  )

export const generateRealtimeChannelsListRoute = (): string =>
  relayRoute(
    '../../../..',
    `    scope: 'realtime-channels-list',
    method: 'GET',
    path: function(input, identity) {
      return '/channels' + (input.filterByUser ? '?filterByUser=true&userId=' + encodeURIComponent(identity.id) : '');
    },`
  )

export const generateRealtimeChannelsMembersRoute = (): string =>
  relayRoute(
    '../../../..',
    `    scope: 'realtime-channels-members',
    method: 'GET',
    path: function(input) {
      return typeof input.channelName === 'string' && input.channelName
        ? '/channels/' + encodeURIComponent(input.channelName) + '/members'
        : null;
    },`
  )
