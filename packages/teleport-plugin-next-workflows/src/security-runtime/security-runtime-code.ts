import { generateLazyPgClientCode } from '../pg-client-code'

/**
 * Where the shared security runtime lives in the generated project
 * (`utils/security-runtime.js`), and the table its rate limits keep.
 */
export const SECURITY_RUNTIME_FILE_KEY = 'security-runtime'
export const SECURITY_RUNTIME_PATH = ['utils']
export const SECURITY_RUNTIME_FILE_NAME = 'security-runtime'
export const RATE_LIMITS_TABLE = 'teleport_rate_limits'

/** What `rateLimitRequest` answers a refused request, with a 429. */
export const TOO_MANY_REQUESTS_MESSAGE = 'Too many requests. Try again later.'

/**
 * The `require` specifier of the runtime from a generated file whose folder
 * is `relativePrefix` below the project root: `'../../..'` for
 * `pages/api/<folder>/<route>.js`, `'../..'` for `pages/api/<route>.js` and
 * for `utils/workflows/server-runtime.js`.
 */
export const securityRuntimeSpecifier = (relativePrefix: string): string =>
  `${relativePrefix}/${SECURITY_RUNTIME_PATH.join('/')}/${SECURITY_RUNTIME_FILE_NAME}`

/**
 * Emits `utils/security-runtime.js` — the one place the generated app's
 * server code takes the visitor's address, compares secrets, counts rate
 * limits and answers errors from.
 *
 * - `clientIp(req)` reads the address only where the host guarantees it: on
 *   Vercel the headers its edge sets; elsewhere `X-Forwarded-For` only when
 *   the connection comes from a proxy on a private address, and only the hop
 *   that proxy appended; otherwise the socket address. A visitor-written hop
 *   is never read. `TQ_TRUSTED_PROXY` (`private` default | `vercel` | `none`)
 *   lets a self-hoster narrow that (see the emitted header).
 * - `safeEqual(a, b)` is a constant-time compare that is false for anything
 *   missing, empty or of another length, and never throws.
 * - `visitorKey(ip)` is the visitor an address stands for: an IPv4 address
 *   itself, an IPv6 one its /64 (an IPv4 tail counted as the two groups it
 *   fills). Every rate limit keyed by visitor uses it.
 * - `rateLimit` counts fixed windows in the app's Postgres database (table
 *   `teleport_rate_limits`, which the editor makes, created here under an
 *   advisory lock only when it is really missing), so every instance of a
 *   serverless app counts together. Only an app with no
 *   database (or no `pg` driver) counts in a bounded per-instance map; a
 *   database error counts in that map for a short while and is logged once.
 *   A request waits on the database at most 1.5 s; after a failure one
 *   request at a time probes it. Keys are stored as `<windowSeconds>:<sha256>`,
 *   so no address or email reaches the table; each row carries its indexed
 *   `expires_at`, and an unawaited cleanup deletes windows that are over.
 * - `rateLimitRequest` keys by route scope, visitor (an IPv6 visitor by its
 *   /64) and optional parts, and answers a refusal with a 429 itself.
 * - `sendClientError` answers `{ error, id }` with a generic message and logs
 *   the detail under the same opaque id, server-side only.
 *
 * One module for every app: whether a database is there is read at run time
 * (`TELEPORT_DB_CONNECTION_STRING` / `TELEPORT_DB_HOST` and the driver), and
 * the driver is loaded on first use, so an app without `pg` still builds.
 */
export const generateSecurityRuntimeCode = (): string => `/**
 * Shared security runtime. Server-only; CommonJS, so API routes and the
 * workflow server runtime \`require\` it.
 *
 *   clientIp(req)                                       the visitor's address, read only where the host guarantees it
 *   safeEqual(a, b)                                     constant-time compare of secrets and tokens
 *   visitorKey(ip)                                      the visitor an address stands for: itself, or an IPv6 address's /64
 *   rateLimit({ key, limit, windowSeconds })            durable fixed-window counter -> { allowed, retryAfter }
 *   rateLimitRequest(req, res, { scope, limit, windowSeconds, keyParts })
 *                                                       the same per route and visitor; answers 429 itself, resolves false
 *   peekRateLimitRequest(req, { scope, limit, windowSeconds, keyParts })
 *                                                       what that has counted so far, counting nothing -> { allowed, retryAfter }
 *   sendClientError(res, status, publicMessage, err)    a generic error with an opaque id; the detail stays in the server log
 *
 * TQ_TRUSTED_PROXY (environment) says which proxy may tell clientIp the visitor's address:
 *   private  (default) on Vercel the headers its edge sets; elsewhere the last X-Forwarded-For hop,
 *            only when the connection comes from a private or loopback address (a load balancer or
 *            reverse proxy in front of the app); otherwise the socket address.
 *            A self-hosted app that visitors reach directly through a private address (Docker port
 *            publishing, a Kubernetes NodePort, any SNAT) must set "none": there the visitor writes
 *            the last hop itself and could pick its own rate-limit bucket.
 *   vercel   the Vercel edge headers (x-vercel-forwarded-for, x-real-ip) only, wherever it runs.
 *   none     the socket address only; every forwarding header is ignored.
 */
var crypto = require('crypto');
var net = require('net');
${generateLazyPgClientCode()}

var RATE_LIMITS_TABLE = '${RATE_LIMITS_TABLE}';
var TOO_MANY_REQUESTS = '${TOO_MANY_REQUESTS_MESSAGE}';
// A guarded request waits on the database at most DATABASE_BUDGET_MS in all:
// connect and each query get at most a second of it. The limits are enforced
// here, on the client: a server-side statement_timeout would be a startup
// parameter that pooled connection strings refuse, or a session SET that a
// pooler hands to the next client.
var CONNECT_TIMEOUT_MS = 1000;
var QUERY_TIMEOUT_MS = 1000;
var DATABASE_BUDGET_MS = 1500;
// After a database error, count in memory this long before one request asks the database again.
var DATABASE_RETRY_MS = 30000;
// How often one instance deletes the windows that are over, and how much one pass deletes.
var CLEANUP_INTERVAL_MS = 60000;
var CLEANUP_BATCH = 5000;
var CLEANUP_MAX_BATCHES = 3;
var CLEANUP_QUERY_TIMEOUT_MS = 5000;
var MEMORY_MAX_WINDOWS = 10000;

// A site's database role may read and write its tables without being allowed
// to create one, and CREATE ... IF NOT EXISTS asks for that permission even when
// the table is there: these run only for a table that really is missing.
var CREATE_SQL = 'CREATE TABLE IF NOT EXISTS "' + RATE_LIMITS_TABLE + '" (' +
  '"key" TEXT NOT NULL, "window_start" BIGINT NOT NULL, "count" INTEGER NOT NULL DEFAULT 0, ' +
  '"expires_at" BIGINT NOT NULL, PRIMARY KEY ("key", "window_start"))';
var INDEX_SQL = 'CREATE INDEX IF NOT EXISTS "' + RATE_LIMITS_TABLE + '_expires_at_idx" ' +
  'ON "' + RATE_LIMITS_TABLE + '" ("expires_at")';
// Two instances creating the table at the same moment can still collide in
// Postgres, IF NOT EXISTS or not: they take turns under this lock.
var LOCK_SQL = 'SELECT pg_advisory_xact_lock(hashtext($1))';
// One atomic statement: the window's row is created or its count raised under
// the row lock, and the new count comes back. expires_at is when the window ends.
var HIT_SQL = 'INSERT INTO "' + RATE_LIMITS_TABLE + '" AS r ("key", "window_start", "count", "expires_at") ' +
  'VALUES ($1, $2, 1, $3) ' +
  'ON CONFLICT ("key", "window_start") DO UPDATE SET "count" = r."count" + 1 RETURNING "count"';
// Windows that are over, a batch at a time, through the expires_at index.
var CLEANUP_SQL = 'DELETE FROM "' + RATE_LIMITS_TABLE + '" WHERE ctid IN (SELECT ctid FROM "' + RATE_LIMITS_TABLE + '" ' +
  'WHERE "expires_at" < $1 LIMIT ' + CLEANUP_BATCH + ')';

var __logged = {};

function __logOnce(kind, level, message) {
  if (__logged[kind]) return;
  __logged[kind] = true;
  console[level]('[security-runtime] ' + message);
}

function __errorText(err) {
  return err && err.message ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// clientIp
// ---------------------------------------------------------------------------

function __header(req, name) {
  var value = req && req.headers ? req.headers[name] : undefined;
  if (Array.isArray(value)) value = value.join(',');
  return typeof value === 'string' ? value : '';
}

function __normalizeIp(raw) {
  if (typeof raw !== 'string') return '';
  var ip = raw.trim().toLowerCase();
  if (!ip || ip.length > 64) return '';
  var bracketed = /^\\[([^\\]]+)\\](?::\\d{1,5})?$/.exec(ip);
  if (bracketed) {
    ip = bracketed[1];
  } else if (/^\\d{1,3}(?:\\.\\d{1,3}){3}:\\d{1,5}$/.test(ip)) {
    ip = ip.slice(0, ip.lastIndexOf(':'));
  }
  var zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  // An IPv4 address mapped into IPv6, dotted (::ffff:10.0.0.1) or hex (::ffff:a00:1).
  if (ip.indexOf('::ffff:') === 0) {
    var mapped = ip.slice(7);
    var hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped);
    if (hex) {
      var high = parseInt(hex[1], 16);
      var low = parseInt(hex[2], 16);
      mapped = (high >> 8) + '.' + (high & 255) + '.' + (low >> 8) + '.' + (low & 255);
    }
    if (net.isIPv4(mapped)) ip = mapped;
  }
  return net.isIP(ip) ? ip : '';
}

// The last hop of a forwarded list is the one the nearest proxy wrote; every
// earlier hop is whatever the visitor sent. Only the last is ever read.
function __lastHop(value) {
  if (!value) return '';
  var hops = value.split(',');
  return __normalizeIp(hops[hops.length - 1]);
}

function __isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    var o = ip.split('.').map(Number);
    return o[0] === 127 || o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
      (o[0] === 192 && o[1] === 168) || (o[0] === 169 && o[1] === 254) ||
      (o[0] === 100 && o[1] >= 64 && o[1] <= 127);
  }
  return ip === '::1' || /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
}

/**
 * TQ_TRUSTED_PROXY (see the top of this file): private (default), vercel or none.
 * An unknown value keeps the default and is reported once.
 */
function __trustedProxy() {
  var mode = String(process.env.TQ_TRUSTED_PROXY || '').trim().toLowerCase();
  if (!mode || mode === 'private') return 'private';
  if (mode === 'vercel' || mode === 'none') return mode;
  __logOnce('trusted-proxy', 'warn', 'TQ_TRUSTED_PROXY=' + JSON.stringify(mode) + ' is not private, vercel or none: using private');
  return 'private';
}

/**
 * The visitor's address. On Vercel its edge sets x-vercel-forwarded-for and
 * x-real-ip itself, whatever the visitor sent. Elsewhere X-Forwarded-For is
 * read only when the connection comes from a proxy on a private address (a
 * load balancer, a reverse proxy on the same host), and only the hop that
 * proxy appended; a visitor connecting directly is its socket address.
 */
function clientIp(req) {
  var trusted = __trustedProxy();
  if (trusted === 'vercel' || (trusted === 'private' && process.env.VERCEL)) {
    var edge = __lastHop(__header(req, 'x-vercel-forwarded-for')) || __lastHop(__header(req, 'x-real-ip'));
    if (edge) return edge;
  }
  var socket = (req && (req.socket || req.connection)) || null;
  var peer = __normalizeIp(socket ? socket.remoteAddress : '');
  if (trusted === 'private' && peer && __isPrivateAddress(peer)) {
    var hop = __lastHop(__header(req, 'x-forwarded-for'));
    if (hop) return hop;
  }
  return peer || 'unknown';
}

// One visitor on IPv6 holds a whole /64 (often more): counting each address
// apart would let it rotate through 2^64 of them, so the /64 is the visitor.
function __visitorKey(ip) {
  if (!net.isIPv6(ip)) return ip;
  var halves = ip.split('::');
  var head = halves[0] ? halves[0].split(':') : [];
  var tail = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  var last = tail.length ? tail[tail.length - 1] : head[head.length - 1];
  var missing = 8 - head.length - tail.length - (last && last.indexOf('.') !== -1 ? 1 : 0);
  var groups = head.slice();
  for (var i = 0; i < missing; i++) groups.push('0');
  return groups.concat(tail).slice(0, 4).map(function (group) {
    return (parseInt(group, 16) || 0).toString(16);
  }).join(':') + '::/64';
}

// ---------------------------------------------------------------------------
// safeEqual
// ---------------------------------------------------------------------------

/**
 * Constant-time compare; false for anything missing, empty or of another
 * length (so two empty values are NOT equal: an unset secret never matches).
 * The digests are compared, so the time taken does not tell the length either.
 * Never throws.
 */
function safeEqual(a, b) {
  try {
    if ((typeof a !== 'string' && !Buffer.isBuffer(a)) || (typeof b !== 'string' && !Buffer.isBuffer(b))) return false;
    var left = Buffer.isBuffer(a) ? a : Buffer.from(a, 'utf8');
    var right = Buffer.isBuffer(b) ? b : Buffer.from(b, 'utf8');
    if (left.length === 0 || right.length === 0) return false;
    var same = crypto.timingSafeEqual(
      crypto.createHash('sha256').update(left).digest(),
      crypto.createHash('sha256').update(right).digest()
    );
    return same && left.length === right.length;
  } catch (_e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// rateLimit
// ---------------------------------------------------------------------------

// NO-DATABASE FALLBACK ONLY. These counts live in this one process: on a host
// that runs several instances of the app (serverless) each instance counts on
// its own, so a limit here holds per instance, not for the app. Used only when
// the app has no database (or no pg driver), and for DATABASE_RETRY_MS after a
// database error, so a database outage never takes the routes it guards down
// with it. Bounded: at most MEMORY_MAX_WINDOWS windows, the oldest go first —
// so in this fallback a sender of 10,000 fresh keys can push an older
// visitor's count out and give it a fresh window. The database path has no
// such limit.
var __memoryWindows = new Map();

function __memoryMakeRoom(nowSec) {
  __memoryWindows.forEach(function (entry, mapKey) {
    if (entry.endsAt <= nowSec) __memoryWindows.delete(mapKey);
  });
  var keys = __memoryWindows.keys();
  while (__memoryWindows.size >= MEMORY_MAX_WINDOWS) {
    __memoryWindows.delete(keys.next().value);
  }
}

function __memoryHit(storageKey, windowStart, windowSeconds, nowSec) {
  var mapKey = storageKey + '@' + windowStart;
  var entry = __memoryWindows.get(mapKey);
  if (!entry) {
    if (__memoryWindows.size >= MEMORY_MAX_WINDOWS) __memoryMakeRoom(nowSec);
    entry = { count: 0, endsAt: windowStart + windowSeconds };
    __memoryWindows.set(mapKey, entry);
  }
  entry.count += 1;
  return entry.count;
}

// Healthy, every request asks the database. After a failure, requests count in
// memory until __databaseRetryAt; then ONE request probes (it pushes the retry
// time back before it asks), so the requests beside it never wait on a
// database that may still be down.
var __databaseFailing = false;
var __databaseRetryAt = 0;
var __lastCleanupAt = 0;
var __cleanupRunning = false;

function __hasDatabase() {
  return !!(process.env.TELEPORT_DB_CONNECTION_STRING || process.env.TELEPORT_DB_HOST) && !!__loadPg();
}

function __withTimeout(promise, ms, onTimeout) {
  var timer;
  var timeout = new Promise(function (_resolve, reject) {
    timer = setTimeout(function () {
      if (onTimeout) onTimeout();
      reject(new Error('rate-limit database call timed out after ' + Math.max(0, ms) + 'ms'));
    }, Math.max(0, ms));
  });
  return Promise.race([promise, timeout]).then(
    function (value) { clearTimeout(timer); return value; },
    function (err) { clearTimeout(timer); throw err; }
  );
}

// Closes a client without waiting for it: a database that stopped answering
// may never acknowledge the close either. A client that timed out has its
// socket destroyed first.
function __release(client, destroy) {
  if (destroy) {
    try { client.connection.stream.destroy(); } catch (_e) {}
  }
  try {
    var ended = client.end();
    if (ended && typeof ended.catch === 'function') ended.catch(function () {});
  } catch (_e) {}
}

// Deletes windows that are over on the client the request used, after the
// request has its answer: never awaited by it. On Vercel the platform's
// waitUntil, when the app has one, keeps the function alive for it.
function __cleanupOn(client, nowSec) {
  __cleanupRunning = true;
  var timedOut = false;
  var cut = function () { timedOut = true; };
  var pass = (async function () {
    for (var batch = 0; batch < CLEANUP_MAX_BATCHES; batch++) {
      var result = await __withTimeout(client.query(CLEANUP_SQL, [nowSec]), CLEANUP_QUERY_TIMEOUT_MS, cut);
      if (!result || !(result.rowCount >= CLEANUP_BATCH)) break;
    }
  })().then(
    function () {},
    function (err) { __logOnce('cleanup', 'error', 'could not delete rate-limit windows that are over: ' + __errorText(err)); }
  ).then(function () {
    __cleanupRunning = false;
    __release(client, timedOut);
  });
  var waitUntil = process.env.VERCEL && typeof globalThis.__tqWaitUntil === 'function' ? globalThis.__tqWaitUntil : null;
  if (waitUntil) {
    try { waitUntil(pass); } catch (_e) {}
  }
}

async function __databaseHit(storageKey, windowStart, expiresAt, nowSec) {
  var client = getClient();
  if (typeof client.on === 'function') client.on('error', function () {});
  var deadline = Date.now() + DATABASE_BUDGET_MS;
  var timedOut = false;
  var cut = function () { timedOut = true; };
  var within = function (promise, cap) {
    return __withTimeout(promise, Math.min(cap, deadline - Date.now()), cut);
  };
  var run = function (sql, values) {
    return within(client.query(sql, values || []), QUERY_TIMEOUT_MS);
  };
  var createTable = async function () {
    try {
      await run('BEGIN');
      await run(LOCK_SQL, [RATE_LIMITS_TABLE]);
      await run(CREATE_SQL);
      await run(INDEX_SQL);
      await run('COMMIT');
    } catch (err) {
      throw new Error('the table ' + RATE_LIMITS_TABLE + ' is missing and could not be created: ' + __errorText(err));
    }
  };
  var hit = function () {
    return run(HIT_SQL, [storageKey, windowStart, expiresAt]);
  };
  var handedToCleanup = false;
  try {
    await within(client.connect(), CONNECT_TIMEOUT_MS);
    var result;
    try {
      result = await hit();
    } catch (err) {
      // The table is not there (dropped, or the database restored from an
      // older backup): create it and count this request in it.
      if (!err || err.code !== '42P01') throw err;
      await createTable();
      result = await hit();
    }
    var count = result && result.rows && result.rows[0] ? Number(result.rows[0].count) : NaN;
    if (!(count >= 1)) throw new Error('the rate-limit upsert returned no count');
    if (!__cleanupRunning && Date.now() - __lastCleanupAt >= CLEANUP_INTERVAL_MS) {
      __lastCleanupAt = Date.now();
      handedToCleanup = true;
      __cleanupOn(client, nowSec);
    }
    return count;
  } finally {
    if (!handedToCleanup) __release(client, timedOut);
  }
}

function __atLeastOne(value) {
  return typeof value === 'number' && isFinite(value) && value >= 1;
}

/**
 * Counts one request against \`key\` in the current fixed window of
 * \`windowSeconds\`. Resolves \`{ allowed, retryAfter }\`: \`retryAfter\` is the
 * seconds until the window ends when refused, 0 when allowed. Rejects with a
 * TypeError for a missing key or a limit/window below 1 (a route that cannot
 * say what it limits refuses, never opens).
 */
async function rateLimit(options) {
  var o = options || {};
  if (typeof o.key !== 'string' || !o.key) throw new TypeError('rateLimit: key must be a non-empty string');
  if (!__atLeastOne(o.limit)) throw new TypeError('rateLimit: limit must be a number of at least 1');
  if (!__atLeastOne(o.windowSeconds)) throw new TypeError('rateLimit: windowSeconds must be a number of at least 1');
  var windowSeconds = Math.floor(o.windowSeconds);
  var nowMs = Date.now();
  var nowSec = Math.floor(nowMs / 1000);
  var windowStart = nowSec - (nowSec % windowSeconds);
  var storageKey = windowSeconds + ':' + crypto.createHash('sha256').update(o.key).digest('hex');
  var count = 0;
  if (!__hasDatabase()) {
    __logOnce('no-database', 'warn', 'no database is configured: rate limits are counted per server instance only');
  } else if (nowMs >= __databaseRetryAt) {
    // After a failure this request is the one probe: the rest count in memory until it answers.
    if (__databaseFailing) __databaseRetryAt = nowMs + DATABASE_RETRY_MS;
    try {
      count = await __databaseHit(storageKey, windowStart, windowStart + windowSeconds, nowSec);
      __databaseFailing = false;
      __databaseRetryAt = 0;
      __logged.database = false;
    } catch (err) {
      count = 0;
      __databaseFailing = true;
      __databaseRetryAt = Date.now() + DATABASE_RETRY_MS;
      __logOnce('database', 'error', 'the rate-limit database failed, counting in memory per instance until it answers again: ' + __errorText(err));
    }
  }
  if (!count) count = __memoryHit(storageKey, windowStart, windowSeconds, nowSec);
  var allowed = count <= o.limit;
  return { allowed: allowed, retryAfter: allowed ? 0 : Math.max(1, windowStart + windowSeconds - nowSec) };
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

function __sendJson(res, status, body, headers) {
  if (!res || res.headersSent || res.writableEnded) return;
  try {
    var names = headers ? Object.keys(headers) : [];
    for (var i = 0; i < names.length; i++) res.setHeader(names[i], headers[names[i]]);
    if (typeof res.status === 'function' && typeof res.json === 'function') {
      res.status(status).json(body);
      return;
    }
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  } catch (err) {
    console.error('[security-runtime] could not send a ' + status + ' response: ' + __errorText(err));
  }
}

/**
 * Counts the request against \`scope\` for this visitor (and \`keyParts\`, e.g.
 * the email a sign-in names). Resolves true when it may go on; otherwise
 * answers 429 with Retry-After and \`{ error: TOO_MANY_REQUESTS }\` and
 * resolves false — the route returns without writing anything else.
 */
async function rateLimitRequest(req, res, options) {
  var o = options || {};
  if (typeof o.scope !== 'string' || !o.scope) throw new TypeError('rateLimitRequest: scope must be a non-empty string');
  var parts = Array.isArray(o.keyParts)
    ? o.keyParts.map(function (part) { return part == null ? '' : String(part); })
    : [];
  var key = JSON.stringify(['request', o.scope, __visitorKey(clientIp(req))].concat(parts));
  var result = await rateLimit({ key: key, limit: o.limit, windowSeconds: o.windowSeconds });
  if (result.allowed) return true;
  __sendJson(res, 429, { error: TOO_MANY_REQUESTS }, { 'Retry-After': String(result.retryAfter) });
  return false;
}

/**
 * What \`rateLimitRequest\` with the same arguments has counted so far in the
 * current window, WITHOUT counting this call: \`{ allowed, retryAfter }\`, where
 * \`allowed\` is false once \`limit\` hits are in. For a limit on failures only
 * (a sign-in): peek before the attempt, count with \`rateLimitRequest(req, null,
 * …)\` after a failure — \`res\` null answers nothing. A table not created yet
 * is a window with no hits; a database error reads the in-memory count.
 */
async function peekRateLimitRequest(req, options) {
  var o = options || {};
  if (typeof o.scope !== 'string' || !o.scope) throw new TypeError('peekRateLimitRequest: scope must be a non-empty string');
  if (!__atLeastOne(o.limit)) throw new TypeError('peekRateLimitRequest: limit must be a number of at least 1');
  if (!__atLeastOne(o.windowSeconds)) throw new TypeError('peekRateLimitRequest: windowSeconds must be a number of at least 1');
  var parts = Array.isArray(o.keyParts)
    ? o.keyParts.map(function (part) { return part == null ? '' : String(part); })
    : [];
  var key = JSON.stringify(['request', o.scope, __visitorKey(clientIp(req))].concat(parts));
  var windowSeconds = Math.floor(o.windowSeconds);
  var nowMs = Date.now();
  var nowSec = Math.floor(nowMs / 1000);
  var windowStart = nowSec - (nowSec % windowSeconds);
  var storageKey = windowSeconds + ':' + crypto.createHash('sha256').update(key).digest('hex');
  var memory = __memoryWindows.get(storageKey + '@' + windowStart);
  var count = memory ? memory.count : 0;
  // A failing database is left to rateLimit's one probe: until it answers,
  // the counts are the in-memory ones.
  if (__hasDatabase() && !__databaseFailing) {
    var client = getClient();
    if (typeof client.on === 'function') client.on('error', function () {});
    var deadline = Date.now() + DATABASE_BUDGET_MS;
    var timedOut = false;
    var cut = function () { timedOut = true; };
    try {
      await __withTimeout(client.connect(), Math.min(CONNECT_TIMEOUT_MS, deadline - Date.now()), cut);
      var result = await __withTimeout(
        client.query('SELECT "count" FROM "' + RATE_LIMITS_TABLE + '" WHERE "key" = $1 AND "window_start" = $2', [storageKey, windowStart]),
        Math.min(QUERY_TIMEOUT_MS, deadline - Date.now()),
        cut
      );
      var stored = result && result.rows && result.rows[0] ? Number(result.rows[0].count) : 0;
      count = Math.max(count, isFinite(stored) ? stored : 0);
    } catch (err) {
      // 42P01: nothing was ever counted, so the table is not there yet.
      if (!err || err.code !== '42P01') {
        __databaseFailing = true;
        __databaseRetryAt = Date.now() + DATABASE_RETRY_MS;
        __logOnce('database', 'error', 'the rate-limit database failed, counting in memory per instance until it answers again: ' + __errorText(err));
      }
    } finally {
      __release(client, timedOut);
    }
  }
  var allowed = count < o.limit;
  return { allowed: allowed, retryAfter: allowed ? 0 : Math.max(1, windowStart + windowSeconds - nowSec) };
}

/**
 * Answers \`{ error: publicMessage, id }\` with \`status\` (500 unless a 4xx/5xx)
 * and logs \`err\` under the same opaque id, server-side only: the client never
 * sees a driver, provider or secret-name detail. Leaves a response that is
 * already sent alone. Returns the id.
 */
function sendClientError(res, status, publicMessage, err) {
  var id = crypto.randomBytes(8).toString('hex');
  var code = typeof status === 'number' && status >= 400 && status <= 599 ? Math.floor(status) : 500;
  var message = typeof publicMessage === 'string' && publicMessage ? publicMessage : 'Something went wrong.';
  var line = '[request-error ' + id + '] ' + code + ' ' + message;
  if (err !== undefined) {
    console.error(line, err);
  } else {
    console.warn(line);
  }
  __sendJson(res, code, { error: message, id: id });
  return id;
}

module.exports = { clientIp, safeEqual, visitorKey: __visitorKey, rateLimit, rateLimitRequest, peekRateLimitRequest, sendClientError };
`
