import { generatePgClientCode } from '../pg-client-code'

/**
 * Emits `utils/email/sent-email-log.js` — the ONE place every email the
 * generated app sends is recorded into `teleport_sent_emails`.
 *
 * Callers (in this order of coverage):
 *   - workflow `email-*` / Gmail / Outlook nodes: wrapped per server route by
 *     `wrapEmailNodeHandler` (see `generateNodeHandlersForSegment`);
 *   - the invoice sender (`utils/invoices/email-sender.js`);
 *   - the welcome / farewell routes (`transactional-email-code.ts`);
 *   - the order-notification / low-stock routes (`utils/ecommerce/email-sender.js`).
 *
 * Contract: `recordSentEmail` never throws and never rejects, the send is
 * never delayed by it, and a route drains it before replying (a serverless
 * function may be frozen the instant it responds). Only an explicit allow-list
 * of fields is stored — a node config carries credentials.
 *
 * `pgSupported=false` (a MySQL / Mongo / Firestore project) emits a module with
 * the same exports that records nothing, so consumers need no branching.
 */
const PG_REQUIRE_LINE = "const { Client } = require('pg');"

/**
 * The shared `getClient()` boilerplate with its eager `require('pg')` swapped
 * for the lazy loader above: a project can carry an email node and no
 * Postgres driver, and a top-level require would fail the build of every
 * workflow route ("Collecting page data"). `new Client(opts)` keeps working —
 * a constructor that returns an object yields that object.
 */
const lazyPgClientCode = (): string => {
  const code = generatePgClientCode()
  if (!code.startsWith(PG_REQUIRE_LINE)) {
    throw new Error(
      'sent-email-log: generatePgClientCode() no longer starts with the pg require line'
    )
  }
  return code.replace(
    PG_REQUIRE_LINE,
    'function Client(opts) { var pg = __loadPg(); return new pg.Client(opts); }'
  )
}

export const generateSentEmailLogCode = (options: { pgSupported: boolean }): string => {
  if (!options.pgSupported) {
    return `/**
 * Sent-email ledger — disabled: the project's data source is not Postgres.
 */
function recordSentEmail() { return Promise.resolve(false); }
function settleSentEmailLog() { return Promise.resolve(); }
function wrapEmailNodeHandler(_nodeType, handler) { return handler; }

module.exports = { recordSentEmail, settleSentEmailLog, wrapEmailNodeHandler };
`
  }

  return `/**
 * Sent-email ledger.
 *
 * Every email the app sends — workflow email nodes, the invoice sender, the
 * welcome/farewell routes, order and stock alerts — lands here as one row of
 * \`teleport_sent_emails\`: who it went to, what it said, the values the
 * template was filled with, and whether the provider accepted it.
 *
 * Never awaited by the send itself; never throws; drained before a route
 * replies (see settleSentEmailLog).
 */
var __pg = null;
var __pgLoadFailed = false;
function __loadPg() {
  if (__pg || __pgLoadFailed) return __pg;
  try { __pg = require('pg'); } catch (_e) { __pgLoadFailed = true; __pg = null; }
  return __pg;
}

${lazyPgClientCode()}

var TABLE_NAME = 'teleport_sent_emails';
var BODY_MAX_CHARS = 1000000;
var PAYLOAD_MAX_CHARS = 200000;
var SUBJECT_MAX_CHARS = 2000;
var ADDRESS_MAX_CHARS = 320;
var TRUNCATION_MARKER = '\\n<!-- truncated by sent-email-log -->';
var INSERT_TIMEOUT_MS = 15000;
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Template parameters whose VALUE must not be persisted: a reset link carries
// a live token, and the ledger is readable from the admin panel.
var SENSITIVE_PARAM_KEY_RE = /token|password|secret|otp|reset|verif|magic|passcode/i;
var REDACTED = '[redacted]';

var __pending = [];
var __disabledReason = '';
var __consecutiveFailures = 0;
var MAX_CONSECUTIVE_FAILURES = 3;

function __disable(reason) {
  if (__disabledReason) return;
  __disabledReason = reason;
  console.warn('[sent-email-log] disabled for this process: ' + reason);
}

function __hasDatabaseEnv() {
  return !!(process.env.TELEPORT_DB_CONNECTION_STRING || process.env.TELEPORT_DB_HOST);
}

function __toArray(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) {
    var out = [];
    for (var i = 0; i < value.length; i++) { out = out.concat(__toArray(value[i])); }
    return out;
  }
  if (typeof value === 'object') {
    // Provider SDK shapes: { email, name } / { address }.
    var addr = value.email || value.address || value.emailAddress;
    return addr ? [String(addr)] : [];
  }
  return String(value).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

function __truncate(text, max) {
  if (text == null) return null;
  var str = String(text);
  if (str.length <= max) return str;
  return str.slice(0, max) + TRUNCATION_MARKER;
}

function __safeStringify(value, max) {
  if (value == null) return null;
  var json;
  try {
    json = JSON.stringify(value, function (_k, v) {
      if (typeof v === 'bigint') return String(v);
      if (v && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)) return '[buffer ' + v.data.length + ' bytes]';
      return v;
    });
  } catch (_e) {
    return '"[unserializable]"';
  }
  if (json == null) return null;
  return __truncate(json, max);
}

// "Acme Billing <billing@acme.com>" → { name, email }; "billing@acme.com" → { name: '', email }.
function __parseAddress(from) {
  var str = String(from || '').trim();
  if (!str) return { name: '', email: '' };
  var m = /^(.*)<([^<>]+)>\\s*$/.exec(str);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, ''), email: m[2].trim() };
  return { name: '', email: str };
}

function __uuidOrNull(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) return null;
  return value;
}

// templateParams arrive as [{ key, value }] (workflow nodes) or as a plain
// object (routes). Returns { payload, redactedValues } where redactedValues
// are the string values of sensitive keys, to be scrubbed from the body too.
function __normalizePayload(params) {
  var payload = {};
  var redactedValues = [];
  var entries = [];
  if (Array.isArray(params)) {
    for (var i = 0; i < params.length; i++) {
      var p = params[i];
      if (p && typeof p === 'object' && typeof p.key === 'string') entries.push([p.key, p.value]);
    }
  } else if (params && typeof params === 'object') {
    var keys = Object.keys(params);
    for (var k = 0; k < keys.length; k++) entries.push([keys[k], params[keys[k]]]);
  }
  for (var e = 0; e < entries.length; e++) {
    var key = entries[e][0];
    var value = entries[e][1];
    if (SENSITIVE_PARAM_KEY_RE.test(key)) {
      if (typeof value === 'string' && value.length >= 8) redactedValues.push(value);
      payload[key] = REDACTED;
    } else {
      payload[key] = value;
    }
  }
  return { payload: entries.length ? payload : null, redactedValues: redactedValues };
}

function __scrub(text, redactedValues) {
  if (!text) return text;
  var out = String(text);
  for (var i = 0; i < redactedValues.length; i++) {
    out = out.split(redactedValues[i]).join(REDACTED);
  }
  return out;
}

function __normalizeAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return null;
  var out = [];
  for (var i = 0; i < attachments.length; i++) {
    var a = attachments[i] || {};
    out.push({
      filename: a.filename || a.name || a.Name || 'attachment',
      contentType: a.contentType || a.type || a.ContentType || null,
      sizeBytes: typeof a.sizeBytes === 'number' ? a.sizeBytes : null,
      url: a.url || null,
    });
  }
  return __safeStringify(out, PAYLOAD_MAX_CHARS);
}

/**
 * Maps a loose entry onto the table's columns. Returns null when there is
 * nothing to record (no recipient at all).
 *
 * entry: { emailType, audience, to, cc, bcc, from, fromName, replyTo, subject,
 *          html, payload, attachments, provider, providerMessageId, status,
 *          error, source, sourceRef, orderId, userId, referenceType, referenceId }
 */
function buildSentEmailRow(entry) {
  var e = entry || {};
  var recipients = __toArray(e.to);
  if (recipients.length === 0) return null;
  var from = __parseAddress(e.from);
  var fromName = e.fromName ? String(e.fromName) : from.name;
  var normalized = __normalizePayload(e.payload);
  var cc = __toArray(e.cc);
  var bcc = __toArray(e.bcc);
  var status = e.status === 'failed' ? 'failed' : 'sent';
  return {
    email_type: __truncate(e.emailType || 'custom', 100),
    audience: __truncate(e.audience || 'other', 20),
    recipient_email: __truncate(recipients[0], ADDRESS_MAX_CHARS),
    recipients: JSON.stringify(recipients),
    cc: cc.length ? JSON.stringify(cc) : null,
    bcc: bcc.length ? JSON.stringify(bcc) : null,
    reply_to: e.replyTo ? __truncate(__toArray(e.replyTo)[0] || '', ADDRESS_MAX_CHARS) : null,
    from_email: from.email ? __truncate(from.email, ADDRESS_MAX_CHARS) : null,
    from_name: fromName ? __truncate(fromName, 255) : null,
    subject: __truncate(__scrub(e.subject, normalized.redactedValues), SUBJECT_MAX_CHARS),
    body_html: __truncate(__scrub(e.html, normalized.redactedValues), BODY_MAX_CHARS) || '',
    payload: __safeStringify(normalized.payload, PAYLOAD_MAX_CHARS),
    attachments: __normalizeAttachments(e.attachments),
    provider: e.provider ? __truncate(e.provider, 50) : null,
    provider_message_id: e.providerMessageId ? __truncate(String(e.providerMessageId), 255) : null,
    status: status,
    error_message: e.error ? __truncate(String(e.error), 4000) : null,
    source: __truncate(e.source || 'app', 50),
    source_ref: e.sourceRef ? __truncate(String(e.sourceRef), 255) : null,
    order_id: __uuidOrNull(e.orderId),
    user_id: __uuidOrNull(e.userId),
    reference_type: e.referenceType ? __truncate(String(e.referenceType), 50) : null,
    reference_id: e.referenceId ? __truncate(String(e.referenceId), 255) : null,
  };
}

function __newId() {
  try {
    var crypto = require('crypto');
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    var b = crypto.randomBytes(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = b.toString('hex');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  } catch (_e) {
    return null;
  }
}

function __withTimeout(promise, ms) {
  var timer;
  var timeout = new Promise(function (_resolve, reject) {
    timer = setTimeout(function () { reject(new Error('sent-email-log insert timed out after ' + ms + 'ms')); }, ms);
  });
  return Promise.race([promise, timeout]).then(function (v) { clearTimeout(timer); return v; }, function (err) { clearTimeout(timer); throw err; });
}

async function __insert(row) {
  var columns = Object.keys(row);
  var values = columns.map(function (c) { return row[c]; });
  var id = __newId();
  if (id) { columns.unshift('id'); values.unshift(id); }
  var placeholders = values.map(function (_v, i) { return '$' + (i + 1); });
  var sql = 'INSERT INTO "' + TABLE_NAME + '" (' + columns.map(function (c) { return '"' + c + '"'; }).join(', ') + ') VALUES (' + placeholders.join(', ') + ')';
  var client = getClient();
  await client.connect();
  try {
    await __withTimeout(client.query(sql, values), INSERT_TIMEOUT_MS);
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}

/**
 * Records one send attempt. Resolves to true when the row landed, false
 * otherwise. NEVER rejects.
 */
function recordSentEmail(entry) {
  var task = (async function () {
    if (__disabledReason) return false;
    if (!__hasDatabaseEnv()) { __disable('no database connection configured'); return false; }
    if (!__loadPg()) { __disable('the pg driver is not installed'); return false; }
    var row;
    try { row = buildSentEmailRow(entry); } catch (buildErr) {
      console.error('[sent-email-log] could not build the row:', buildErr && buildErr.message ? buildErr.message : buildErr);
      return false;
    }
    if (!row) return false;
    try {
      await __insert(row);
      __consecutiveFailures = 0;
      return true;
    } catch (err) {
      var code = err && err.code;
      if (code === '42P01') { __disable('table ' + TABLE_NAME + ' does not exist — re-run the feature activation in the editor'); return false; }
      if (code === '42703') { __disable('table ' + TABLE_NAME + ' is missing a column — re-run the feature activation in the editor'); return false; }
      __consecutiveFailures += 1;
      console.error('[sent-email-log] insert failed: ' + (err && err.message ? err.message : String(err)));
      if (__consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) __disable('repeated insert failures');
      return false;
    }
  })();
  __pending.push(task);
  task.then(function () { __forget(task); }, function () { __forget(task); });
  return task;
}

function __forget(task) {
  var idx = __pending.indexOf(task);
  if (idx >= 0) __pending.splice(idx, 1);
}

/** Awaits every in-flight record. Never rejects. */
async function settleSentEmailLog() {
  for (var pass = 0; pass < 5 && __pending.length > 0; pass++) {
    await Promise.all(__pending.slice());
  }
}

// Provider name from a node type: 'email-resend' → 'resend', 'integration-gmail' → 'gmail'.
function __providerOf(nodeType) {
  var t = String(nodeType || '');
  if (t.indexOf('email-') === 0) return t.slice(6);
  if (t.indexOf('integration-') === 0) return t.slice(12);
  return t || null;
}

function __shouldRecordNode(nodeType, config) {
  if (String(nodeType).indexOf('email-') === 0) return true;
  return !!config && config.action === 'send-email';
}

function __entryFromNode(nodeType, config, result, error) {
  var c = config || {};
  var r = result || {};
  var failed = !!error || r.success === false || (typeof r.error === 'string' && r.error) || r.error === true;
  var message = r.message && typeof r.message === 'object' ? r.message : null;
  var providerMessageId = r.messageId || r.id || (message && message.id) || null;
  var errorText = error ? (error.message || String(error)) : (typeof r.error === 'string' ? r.error : (r.error === true && typeof r.message === 'string' ? r.message : null));
  return {
    emailType: c.emailPurpose || 'custom',
    audience: c.emailAudience || 'other',
    to: c.to,
    cc: c.cc,
    bcc: c.bcc,
    from: c.from,
    fromName: c.fromName,
    replyTo: c.replyTo,
    subject: c.subject,
    html: c.body != null ? c.body : (c.html != null ? c.html : c.text),
    payload: c.templateParams,
    provider: __providerOf(nodeType),
    providerMessageId: providerMessageId,
    status: failed ? 'failed' : 'sent',
    error: errorText,
    source: 'workflow',
    sourceRef: nodeType,
  };
}

/**
 * Wraps a server node handler so every send is recorded. The record is
 * registered on the workflow context's fire-and-forget queue — the same one
 * \`settlePendingNodePromises\` drains before the route replies — and pushed
 * BEFORE the handler's result is returned, so the drain always sees it.
 * Extra arguments (a streaming callback) are forwarded untouched.
 */
function wrapEmailNodeHandler(nodeType, handler) {
  if (typeof handler !== 'function') return handler;
  return async function (config, context) {
    if (!__shouldRecordNode(nodeType, config)) {
      return handler.apply(this, arguments);
    }
    var result;
    try {
      result = await handler.apply(this, arguments);
    } catch (err) {
      __register(context, recordSentEmail(__entryFromNode(nodeType, config, null, err)));
      throw err;
    }
    __register(context, recordSentEmail(__entryFromNode(nodeType, config, result, null)));
    return result;
  };
}

function __register(context, promise) {
  if (!context || typeof context !== 'object') return;
  if (!Array.isArray(context.__pendingNodePromises)) context.__pendingNodePromises = [];
  context.__pendingNodePromises.push(promise);
}

module.exports = {
  recordSentEmail: recordSentEmail,
  settleSentEmailLog: settleSentEmailLog,
  wrapEmailNodeHandler: wrapEmailNodeHandler,
  buildSentEmailRow: buildSentEmailRow,
};
`
}
