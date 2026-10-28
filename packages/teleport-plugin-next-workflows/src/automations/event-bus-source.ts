import { generateLazyPgClientCode } from '../pg-client-code'
import { AUTOMATIONS_DISPATCH_URL } from './automations-scope'
import { generateSelfCallHeadersCode } from '../self-call-headers'

/**
 * The automations' shared runtime: the database access (`store.js`), the
 * platform's `waitUntil` (`wait-until.js`) and the event bus
 * (`event-bus.js`). All three live in `lib/automations/` and are generated
 * only for a project with at least one automation.
 */

const EVENT_COLUMNS =
  'event_type, dedupe_key, order_id, entity_type, entity_id, payload, actor, actor_type'

/** Where the dispatch route remembers the signed requests it took (see `takeSignedRequest`). */
export const SIGNED_REQUESTS_TABLE = 'teleport_automation_requests'

/** The ledger row every emitter writes; a replayed dedupe key writes nothing. */
export const INSERT_EVENT_SQL = `INSERT INTO teleport_events (${EVENT_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`

/**
 * `lib/automations/store.js`: one connection per call (`withClient`), with
 * every statement bounded in time so a stuck database cannot hold the queue;
 * the Wait writer; the signed requests the dispatch route has taken (each
 * once, `takeSignedRequest`); where and with which credentials the app calls
 * itself;
 * and the small value helpers the dispatcher and the hydrators share. The
 * database is the TeleportHQ one (`TELEPORT_DB_*`, the data API's client):
 * the only one automations run on (v1).
 */
export const generateAutomationStoreCode = (): string => `'use strict';
/**
 * Automations: database access and shared helpers (generated).
 */
${generateLazyPgClientCode()}

var QUERY_TIMEOUT_MS = 15000;

var SAVE_WAIT_SQL = 'INSERT INTO teleport_automation_waits (event_id, workflow_id, resume_node_id, context, run_at, status) ' +
  "VALUES ($1, $2, $3, $4, $5, 'waiting')";

// What a table the project does not have, or a column it never gained, fails
// with: the record then reads as missing. Every other error is real.
var MISSING_RELATION_CODES = ['42P01', '42703'];

function errorMessage(error) {
  return error && error.message ? String(error.message) : String(error);
}

function withTimeout(promise, ms, what) {
  var timer;
  var timeout = new Promise(function (_resolve, reject) {
    timer = setTimeout(function () { reject(new Error('[automations] ' + what + ' timed out after ' + ms + 'ms')); }, ms);
  });
  return Promise.race([promise, timeout]).then(
    function (value) { clearTimeout(timer); return value; },
    function (error) { clearTimeout(timer); throw error; }
  );
}

// Runs fn(client) on a connection of its own, closed afterwards.
async function withClient(fn) {
  if (!process.env.TELEPORT_DB_CONNECTION_STRING && !process.env.TELEPORT_DB_HOST) {
    throw new Error('[automations] no database is configured (TELEPORT_DB_CONNECTION_STRING)');
  }
  if (!__loadPg()) {
    throw new Error('[automations] the pg driver is not installed');
  }
  var raw = getClient();
  var client = {
    query: function (sql, values) {
      return withTimeout(raw.query(sql, values), QUERY_TIMEOUT_MS, 'a query');
    },
  };
  try {
    await withTimeout(raw.connect(), QUERY_TIMEOUT_MS, 'connecting to the database');
    return await fn(client);
  } finally {
    try { await raw.end(); } catch (_e) {}
  }
}

// Stores a run parked at a Wait (see the general-wait node).
async function saveWait(wait) {
  await withClient(function (client) {
    return client.query(SAVE_WAIT_SQL, [wait.eventId, wait.workflowId, wait.resumeNodeId, wait.context, wait.runAt]);
  });
}

// The signed requests the dispatch route has taken, each kept until its
// signature can no longer verify: the same request again is refused. The
// table (and its expiry index) is made on first use, two instances taking
// turns under the lock. The rows that are over are deleted at most once per
// instance every SIGNED_REQUESTS_CLEANUP_MS, a bounded batch at a time.
var SIGNED_REQUESTS_TABLE = '${SIGNED_REQUESTS_TABLE}';
var LOCK_SIGNED_REQUESTS_SQL = 'SELECT pg_advisory_xact_lock(hashtext($1))';
var CREATE_SIGNED_REQUESTS_SQL = 'CREATE TABLE IF NOT EXISTS ' + SIGNED_REQUESTS_TABLE +
  ' (request_key TEXT PRIMARY KEY, expires_at BIGINT NOT NULL)';
var INDEX_SIGNED_REQUESTS_SQL = 'CREATE INDEX IF NOT EXISTS ' + SIGNED_REQUESTS_TABLE + '_expires_at ON ' +
  SIGNED_REQUESTS_TABLE + ' (expires_at)';
var FORGET_SIGNED_REQUESTS_SQL = 'DELETE FROM ' + SIGNED_REQUESTS_TABLE + ' WHERE request_key IN (SELECT request_key FROM ' +
  SIGNED_REQUESTS_TABLE + ' WHERE expires_at < $1 LIMIT 1000)';
var TAKE_SIGNED_REQUEST_SQL = 'INSERT INTO ' + SIGNED_REQUESTS_TABLE + ' (request_key, expires_at) VALUES ($1, $2) ' +
  'ON CONFLICT (request_key) DO NOTHING RETURNING request_key';
var SIGNED_REQUESTS_CLEANUP_MS = 600000;
var __signedRequestsReady = false;
var __signedRequestsCleanedAt = 0;

// true the first time a signed request (its key) is taken, false every time
// after while it is kept (until expiresAt, unix seconds). Throws when the
// database cannot say: the route then refuses.
async function takeSignedRequest(key, expiresAt) {
  return withClient(async function (client) {
    if (!__signedRequestsReady) {
      await client.query('BEGIN');
      try {
        await client.query(LOCK_SIGNED_REQUESTS_SQL, [SIGNED_REQUESTS_TABLE]);
        await client.query(CREATE_SIGNED_REQUESTS_SQL);
        await client.query(INDEX_SIGNED_REQUESTS_SQL);
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_e) {}
        throw error;
      }
      __signedRequestsReady = true;
    }
    var nowMs = Date.now();
    if (nowMs - __signedRequestsCleanedAt >= SIGNED_REQUESTS_CLEANUP_MS) {
      __signedRequestsCleanedAt = nowMs;
      await client.query(FORGET_SIGNED_REQUESTS_SQL, [Math.floor(nowMs / 1000)]);
    }
    var taken = await client.query(TAKE_SIGNED_REQUEST_SQL, [key, expiresAt]);
    return !!(taken && taken.rows && taken.rows[0]);
  });
}

function isLoopbackHost(host) {
  var name = String(host || '').replace(/:[0-9]+$/, '').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]' || name === '0.0.0.0';
}

// The origin of an absolute http(s) URL, or of a bare host ("shop.com", as
// Vercel's own variables hold it, taken as https); '' for anything else.
function originOf(value, bareHostScheme) {
  var text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  if (!/^https?:[/][/]/i.test(text)) {
    if (!bareHostScheme || text.indexOf('/') !== -1) return '';
    text = bareHostScheme + '://' + text;
  }
  try { return new URL(text).origin; } catch (_e) { return ''; }
}

// NEXTAUTH_URL as the deployment configured it. The auth route rewrites
// process.env.NEXTAUTH_URL on every request (to the request's own origin when
// the configured one is local or unset), after keeping the configured value
// on globalThis.__tqConfiguredNextAuthUrl, once per process: that value is
// read here, never the rewritten one. Kept the same way (and by the same rule:
// a placeholder or anything but an http(s) URL is unset) when this module
// reads it first.
function configuredNextAuthUrl() {
  var scope = globalThis;
  if (typeof scope.__tqConfiguredNextAuthUrl !== 'string') {
    var raw = process.env.NEXTAUTH_URL;
    var usable = typeof raw === 'string' && raw.indexOf('teleporthq.secrets.') !== 0 && /^https?:[/][/]/i.test(raw);
    scope.__tqConfiguredNextAuthUrl = usable ? raw : '';
  }
  return scope.__tqConfiguredNextAuthUrl;
}

// The site's address when one is configured: NEXTAUTH_URL naming a real
// (non-local) origin. The generated default (http://localhost:3000) counts as
// unset.
function configuredSiteOrigin() {
  var origin = originOf(configuredNextAuthUrl());
  return origin && !isLoopbackHost(new URL(origin).host) ? origin : '';
}

function firstValue(value) {
  return String(Array.isArray(value) ? value[0] : value || '').split(',')[0].trim();
}

// The app's own origin, where it calls its own routes with the app secret:
// - the configured site address (a real NEXTAUTH_URL), whatever a request says;
// - on Vercel, the origin the request reached (Vercel routes only this
//   deployment's domains to it), else the production domain, else the
//   deployment's own URL;
// - anywhere else a request's Host is whatever its caller sent: it is used
//   only when it names this machine (a local server, which keeps its own
//   port), never to send the secret to a host a caller picked.
function appBaseUrl(req) {
  var configured = configuredSiteOrigin();
  if (configured) return configured;
  var headers = (req && req.headers) || {};
  var host = firstValue(headers.host);
  var proto = firstValue(headers['x-forwarded-proto']);
  if (process.env.VERCEL) {
    if (host) {
      var reached = originOf((proto || (isLoopbackHost(host) ? 'http' : 'https')) + '://' + host);
      if (reached) return reached;
    }
    var deployed =
      originOf(process.env.VERCEL_PROJECT_PRODUCTION_URL, 'https') || originOf(process.env.VERCEL_URL, 'https');
    if (deployed) return deployed;
  }
  if (host && isLoopbackHost(host)) {
    return (proto === 'https' ? 'https' : 'http') + '://' + host;
  }
  return 'http://localhost:' + (process.env.PORT || '3000');
}

${generateSelfCallHeadersCode()}

// What the app presents to its own routes: the app secret, and the Vercel
// deployment-protection bypass where one is set.
function internalHeaders() {
  return __selfCallHeaders({ 'Content-Type': 'application/json' });
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

// JSON columns are TEXT (see teleport_events.payload): parsed, or null.
function parseJson(value) {
  if (isPlainObject(value) || Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return null;
  try { return JSON.parse(value); } catch (_e) { return null; }
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  var n = Number(value);
  return isFinite(n) ? n : null;
}

function toIso(value) {
  if (value === null || value === undefined || value === '') return null;
  var date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

function toText(value) {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function isMissingRelation(error) {
  return !!error && MISSING_RELATION_CODES.indexOf(error.code) !== -1;
}

// The first row a statement returns, or null. A table or column the project
// lacks also reads as no row; any other failure is thrown, so the event is
// retried instead of being delivered without its record.
async function firstRow(client, sql, values) {
  var rows = await allRows(client, sql, values);
  return rows[0] || null;
}

async function allRows(client, sql, values) {
  try {
    var result = await client.query(sql, values);
    return (result && result.rows) || [];
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
    console.warn('[automations] ' + errorMessage(error));
    return [];
  }
}

module.exports = {
  firstRow: firstRow,
  allRows: allRows,
  withClient: withClient,
  saveWait: saveWait,
  takeSignedRequest: takeSignedRequest,
  appBaseUrl: appBaseUrl,
  internalHeaders: internalHeaders,
  errorMessage: errorMessage,
  isPlainObject: isPlainObject,
  parseJson: parseJson,
  toNumber: toNumber,
  toIso: toIso,
  toText: toText,
};
`

/**
 * `lib/automations/wait-until.js`: on Vercel, the platform's `waitUntil`
 * (`@vercel/functions`, a dependency of every project with automations),
 * published as `globalThis.__tqWaitUntil` unless the app set one of its own.
 * Anywhere else it is null and the bus calls its own dispatch route: a
 * `waitUntil` that is not the host's would keep nothing alive.
 */
export const generateAutomationWaitUntilCode = (): string => `'use strict';
/**
 * Automations: the platform's waitUntil, on Vercel (generated).
 */
var waitUntil = null;
if (process.env.VERCEL) {
  try {
    var vercelFunctions = require('@vercel/functions');
    if (vercelFunctions && typeof vercelFunctions.waitUntil === 'function') {
      waitUntil = vercelFunctions.waitUntil;
    }
  } catch (_e) {
    waitUntil = null;
  }
}
if (waitUntil && typeof globalThis.__tqWaitUntil !== 'function') {
  globalThis.__tqWaitUntil = waitUntil;
}

module.exports = { waitUntil: waitUntil };
`

/**
 * `lib/automations/event-bus.js`:
 *
 * - `emitBusinessEvent({ type, entityType, entityId, orderId?, payload,
 *   actor, actorType, dedupeKey }, req?)` writes the `teleport_events` row (a
 *   replayed dedupe key writes nothing) and, for a new row, schedules the
 *   queue. `req` is the request being served, when there is one: a local
 *   server's own address is read from it (see `appBaseUrl` in store.js; never
 *   a URL a caller hands in). Never throws: it resolves `{ recorded, id }`.
 * - `scheduleDispatch(req?)` runs `dispatch()` off the request path: on
 *   Vercel inside its `waitUntil`, elsewhere through a non-awaited call to
 *   the app's own dispatch route. The visitor's request never waits for a
 *   handler.
 * - `runTestEvent({ workflowId, event }, req)` runs one automation once for
 *   the editor's "send a test" (see the dispatcher).
 * - `takeSignedRequest(key, expiresAt)` resolves true the first time the
 *   dispatch route takes a signed request, false for the same request again.
 * - `dispatch({ req })` is the queue worker (./dispatcher.js).
 */
export const generateAutomationEventBusCode = (): string => `'use strict';
/**
 * Automations: the in-app event bus (generated).
 */
if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = require('node-fetch');
}
var crypto = require('crypto');
var store = require('./store');
require('./wait-until');

var DISPATCH_PATH = '${AUTOMATIONS_DISPATCH_URL}';
var INSERT_EVENT_SQL = '${INSERT_EVENT_SQL}';

function column(value, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).slice(0, maxLength);
}

function eventValues(input) {
  var type = column(input.type, 100);
  if (!type) throw new Error('An event needs its type');
  var payload = input.payload !== undefined ? input.payload : input.details;
  return [
    type,
    column(input.dedupeKey, 255) || type + ':' + crypto.randomUUID(),
    column(input.orderId, 64),
    column(input.entityType, 40),
    column(input.entityId, 64),
    payload === undefined || payload === null ? null : JSON.stringify(payload),
    column(input.actor, 255),
    column(input.actorType, 50) || 'system',
  ];
}

async function emitBusinessEvent(input, req) {
  var event = input || {};
  try {
    var values = eventValues(event);
    var result = await store.withClient(function (client) {
      return client.query(INSERT_EVENT_SQL, values);
    });
    var row = result && result.rows && result.rows[0];
    if (!row) return { recorded: false, id: null };
    scheduleDispatch(req);
    return { recorded: true, id: String(row.id) };
  } catch (error) {
    console.error('[automations] could not record the ' + String(event.type) + ' event: ' + store.errorMessage(error));
    return { recorded: false, id: null };
  }
}

function scheduleDispatch(req) {
  var waitUntil = process.env.VERCEL && typeof globalThis.__tqWaitUntil === 'function' ? globalThis.__tqWaitUntil : null;
  if (waitUntil) {
    try {
      waitUntil(dispatch({ req: req }).catch(function (error) {
        console.error('[automations] dispatch failed: ' + store.errorMessage(error));
      }));
      return 'wait-until';
    } catch (_e) {}
  }
  try {
    globalThis.fetch(store.appBaseUrl(req) + DISPATCH_PATH, {
      method: 'POST',
      headers: store.internalHeaders(),
      body: '{}',
    }).catch(function () {});
    return 'fetch';
  } catch (_e) {
    return 'none';
  }
}

function dispatch(options) {
  return require('./dispatcher').dispatch(options);
}

function runTestEvent(input, req) {
  return require('./dispatcher').runTest(input, { req: req });
}

function takeSignedRequest(key, expiresAt) {
  return store.takeSignedRequest(key, expiresAt);
}

module.exports = {
  emitBusinessEvent: emitBusinessEvent,
  scheduleDispatch: scheduleDispatch,
  dispatch: dispatch,
  runTestEvent: runTestEvent,
  takeSignedRequest: takeSignedRequest,
};
`
