import { generateLazyPgClientCode } from '../pg-client-code'
import {
  WEBHOOK_DELIVERY_LEASE_SECONDS,
  WEBHOOK_DELIVERY_LEASE_TABLE,
} from './webhook-delivery-lease-scope'

/**
 * Emits `utils/workflows/webhook-delivery-lease.js` — one payment webhook
 * delivery at a time.
 *
 * A provider re-delivers an event it did not see answered in time (Paddle
 * waits five seconds; a checkout's chain of writes, emails and an invoice can
 * take longer), and the second delivery can arrive while the first is still
 * running. Every step is safe against a replay that comes AFTER the first run
 * — the order is paid by compare-and-set, events and renewals are keyed — but
 * two runs side by side can both pass a check before either writes: two
 * lifecycle emails, two license keys for one unit.
 *
 * So a verified delivery claims its body first. The same body arriving while
 * the claim is held is answered 503 with a Retry-After, and the provider
 * delivers it again later, when it is an ordinary replay. The claim is
 * released before the route replies; one left by a run that died expires
 * after a lease longer than any route may run.
 *
 * Contract: `claimWebhookDelivery` never throws. Without Postgres, a driver,
 * the table or the privilege to create it, it claims nothing and lets the
 * delivery run — as every delivery ran before the lease existed.
 */
export const generateWebhookDeliveryLeaseCode = (options: { pgSupported: boolean }): string => {
  if (!options.pgSupported) {
    return `/**
 * Payment webhook delivery lease — disabled: the project's data source is not Postgres.
 */
function claimWebhookDelivery() {
  return Promise.resolve({ claimed: true, release: function () { return Promise.resolve(); } });
}

module.exports = { claimWebhookDelivery };
`
  }

  return `/**
 * Payment webhook delivery lease: one run per delivered body at a time.
 */
var crypto = require('crypto');
${generateLazyPgClientCode()}

var TABLE_NAME = '${WEBHOOK_DELIVERY_LEASE_TABLE}';
var LEASE_SECONDS = ${WEBHOOK_DELIVERY_LEASE_SECONDS};
var QUERY_TIMEOUT_MS = 5000;
var CREATE_SQL = 'CREATE TABLE IF NOT EXISTS "' + TABLE_NAME + '" (' +
  'delivery_key TEXT PRIMARY KEY, claim_token TEXT NOT NULL, ' +
  'claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), attempts INTEGER NOT NULL DEFAULT 1)';
// Taken over only once the holder's lease ran out: a run that died.
var CLAIM_SQL = 'INSERT INTO "' + TABLE_NAME + '" AS d (delivery_key, claim_token) VALUES ($1, $2) ' +
  'ON CONFLICT (delivery_key) DO UPDATE SET claim_token = EXCLUDED.claim_token, claimed_at = NOW(), attempts = d.attempts + 1 ' +
  'WHERE d.claimed_at < NOW() - make_interval(secs => $3::int) RETURNING d.claim_token';
// Only this run's own claim, and whatever a dead run left a day ago.
var RELEASE_SQL = 'DELETE FROM "' + TABLE_NAME + '" WHERE (delivery_key = $1 AND claim_token = $2) ' +
  "OR claimed_at < NOW() - INTERVAL '1 day'";

var __tableReady = false;
var __disabledReason = '';

function __disable(reason) {
  if (__disabledReason) return;
  __disabledReason = reason;
  console.warn('[webhook-delivery-lease] disabled for this process: ' + reason);
}

function __hasDatabaseEnv() {
  return !!(process.env.TELEPORT_DB_CONNECTION_STRING || process.env.TELEPORT_DB_HOST);
}

function __withTimeout(promise, ms) {
  var timer;
  var timeout = new Promise(function (_resolve, reject) {
    timer = setTimeout(function () { reject(new Error('webhook-delivery-lease query timed out after ' + ms + 'ms')); }, ms);
  });
  return Promise.race([promise, timeout]).then(function (v) { clearTimeout(timer); return v; }, function (err) { clearTimeout(timer); throw err; });
}

async function __run(statements) {
  var client = getClient();
  await __withTimeout(client.connect(), QUERY_TIMEOUT_MS);
  try {
    var result = null;
    for (var i = 0; i < statements.length; i++) {
      result = await __withTimeout(client.query(statements[i].sql, statements[i].values), QUERY_TIMEOUT_MS);
    }
    return result;
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}

function __stableJson(value) {
  try { return JSON.stringify(value === undefined ? null : value) || ''; } catch (_e) { return ''; }
}

function __unheld() {
  return { claimed: true, release: function () { return Promise.resolve(); } };
}

/**
 * Claims one delivery: \`scope\` names the webhook, \`rawBody\` is what the
 * provider sent and \`verifiedBody\` the event it was verified as — a provider
 * that posts only an id (Mollie, CoinGate) posts the same body for every
 * change, and the state fetched for it tells two changes apart. Resolves
 * \`{ claimed, release }\`; \`claimed: false\` means the same delivery is
 * running right now. \`release\` never rejects.
 */
async function claimWebhookDelivery(scope, rawBody, verifiedBody) {
  if (__disabledReason || !__hasDatabaseEnv() || !__loadPg()) return __unheld();
  var key = crypto.createHash('sha256')
    .update(String(scope || ''))
    .update('\\n')
    .update(Buffer.isBuffer(rawBody) ? rawBody : String(rawBody == null ? '' : rawBody))
    .update('\\n')
    .update(__stableJson(verifiedBody))
    .digest('hex');
  var token = crypto.randomBytes(16).toString('hex');
  var statements = __tableReady ? [] : [{ sql: CREATE_SQL, values: [] }];
  statements.push({ sql: CLAIM_SQL, values: [key, token, LEASE_SECONDS] });
  var result;
  try {
    result = await __run(statements);
    __tableReady = true;
  } catch (err) {
    var code = err && err.code;
    if (code === '42501') { __disable('no privilege to create or write table ' + TABLE_NAME); }
    else { console.error('[webhook-delivery-lease] claim failed: ' + (err && err.message ? err.message : String(err))); }
    return __unheld();
  }
  if (!result || !Array.isArray(result.rows) || result.rows.length === 0) {
    return { claimed: false, release: function () { return Promise.resolve(); } };
  }
  return {
    claimed: true,
    release: function () {
      return __run([{ sql: RELEASE_SQL, values: [key, token] }]).then(
        function () {},
        function (err) { console.error('[webhook-delivery-lease] release failed: ' + (err && err.message ? err.message : String(err))); }
      );
    },
  };
}

module.exports = { claimWebhookDelivery };
`
}
