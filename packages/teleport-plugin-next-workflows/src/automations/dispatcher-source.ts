import {
  CRON_BODY_DIGEST_HEADER,
  generateCronRequestVerificationCode,
} from '../cron-request-verification'
import { AUTOMATION_QUEUE_LIMITS, AUTOMATIONS_DISPATCH_ROUTE_PATH } from './automations-scope'

/** The largest body the dispatch route reads (64 KB); a larger one is refused (413). */
const DISPATCH_MAX_BODY_BYTES = 64 * 1024

/**
 * The queue worker (`lib/automations/dispatcher.js`) and the route that runs
 * it for the app itself (`pages/api/automations/dispatch.js`). The table is
 * the queue: a pass claims due events with FOR UPDATE SKIP LOCKED, so two
 * dispatchers never take the same event, and a delivery row per (event,
 * automation) — unique — keeps a handler from running twice at once.
 */

const {
  batchSize,
  maxAttempts,
  maxAgeDays,
  handlerTimeoutMs,
  passDeadlineMs,
  staleClaimMinutes,
  routeMaxDurationSeconds,
} = AUTOMATION_QUEUE_LIMITS
const STALE = `interval '${staleClaimMinutes} minutes'`

const EVENT_COLUMNS =
  'e.id, e.event_type, e.order_id, e.entity_type, e.entity_id, e.payload, e.actor, e.actor_type, e.status, e.attempts, e.claimed_at, e.created_at'

// A `pending` event is left over by a dispatcher that stopped once nothing
// has touched it for the stale window: neither its claim nor the latest start
// of one of its deliveries. Its running deliveries are then stale too, so the
// takeover never has to wait a second window for them. An event with a run
// parked at a Wait (a `waiting` delivery) is pending on purpose and never
// stale: the resume settles it. Only a run that can resume holds it: one of
// an automation of this build that is on (a switched-off, deleted or
// unpublished one's stays parked, and never resumes while it is so).
// `workflowIds` is the statement's parameter holding this build's workflow
// ids. The fragments below are shared with the activity kick's due check
// (activity-kicks.ts), so the kick wakes a pass exactly when it has work.
export const staleEventSql = (workflowIds: string): string =>
  '(GREATEST(COALESCE(e.claimed_at, e.created_at), ' +
  'COALESCE((SELECT max(d.started_at) FROM teleport_event_deliveries d WHERE d.event_id = e.id), e.created_at)) ' +
  `< now() - ${STALE} ` +
  "AND NOT EXISTS (SELECT 1 FROM teleport_event_deliveries d WHERE d.event_id = e.id AND d.status = 'waiting' " +
  `AND d.workflow_id = ANY(${workflowIds}::text[]) ` +
  'AND EXISTS (SELECT 1 FROM teleport_automations a WHERE a.workflow_id = d.workflow_id AND a.enabled)))'

const STALE_EVENT = staleEventSql('$2')

// An automation of this build of the event's type, on, and on when it happened.
const enabledForEventSql = (workflowIds: string): string =>
  'EXISTS (SELECT 1 FROM teleport_automations a WHERE a.event_type = e.event_type ' +
  `AND a.workflow_id = ANY(${workflowIds}::text[]) AND a.enabled AND COALESCE(a.enabled_at, a.created_at) <= e.created_at)`

/**
 * The events a pass takes besides the new ones: a failed one, and a stale
 * `pending` one (below the attempt limit, of an automation that is on; or
 * past it, only to be settled).
 */
export const retriableEventsSql = (eventTypes: string, workflowIds: string): string =>
  `e.event_type = ANY(${eventTypes}::text[]) ` +
  `AND ((e.attempts < ${maxAttempts} ` +
  `AND (e.status = 'failed' OR (e.status = 'pending' AND ${staleEventSql(workflowIds)})) ` +
  `AND ${enabledForEventSql(workflowIds)}) ` +
  `OR (e.status = 'pending' AND e.attempts >= ${maxAttempts} AND ${staleEventSql(workflowIds)}))`

/**
 * The Waits a pass resumes: due ones of an automation that is on (a
 * switched-off one's stay parked), and those whose resume was left running
 * for longer than the stale window.
 */
export const dueWaitsSql = (workflowIds: string): string =>
  `w.workflow_id = ANY(${workflowIds}::text[]) ` +
  "AND ((w.status = 'waiting' AND w.run_at <= now()) " +
  `OR (w.status = 'resuming' AND w.run_at < now() - ${STALE})) ` +
  'AND EXISTS (SELECT 1 FROM teleport_automations a WHERE a.workflow_id = w.workflow_id AND a.enabled)'

// Due, below the attempt limit, of a type with an automation of this build
// that was on when it happened: a new event within the window, a failed one
// whatever its age, and a stale `pending` one. A stale `pending` event that
// used its last attempt is claimed too, only to be settled as failed. New
// events go first.
const CLAIM_EVENTS_SQL =
  `SELECT ${EVENT_COLUMNS} FROM teleport_events e ` +
  'WHERE e.event_type = ANY($1::text[]) ' +
  `AND ((e.attempts < ${maxAttempts} ` +
  `AND ((e.status = 'recorded' AND e.created_at > now() - interval '${maxAgeDays} days') ` +
  "OR e.status = 'failed' " +
  `OR (e.status = 'pending' AND ${STALE_EVENT})) ` +
  `AND ${enabledForEventSql('$2')}) ` +
  `OR (e.status = 'pending' AND e.attempts >= ${maxAttempts} AND ${STALE_EVENT})) ` +
  "ORDER BY CASE WHEN e.status = 'recorded' THEN 0 ELSE 1 END, e.created_at " +
  `LIMIT ${batchSize} FOR UPDATE SKIP LOCKED`

// claimed_at is the claim's token (to the millisecond, so it reads back
// exactly): every later write of this claim names it, so a run that froze and
// woke after a takeover writes nothing over the dispatcher that took over.
const MARK_PENDING_SQL =
  "UPDATE teleport_events SET status = 'pending', claimed_at = date_trunc('milliseconds', now()) " +
  'WHERE id = ANY($1::uuid[]) RETURNING id, claimed_at'

const CLAIM_GUARD = "status = 'pending' AND claimed_at = "

// An attempt is counted when a handler of the event actually starts.
const COUNT_ATTEMPT_SQL = `UPDATE teleport_events SET attempts = attempts + 1 WHERE id = $1 AND ${CLAIM_GUARD}$2`

// Read when the event is delivered, so an automation switched off since the
// claim is skipped.
const EVENT_AUTOMATIONS_SQL =
  'SELECT a.workflow_id FROM teleport_automations a JOIN teleport_events e ON e.event_type = a.event_type ' +
  'WHERE e.id = $1 AND a.workflow_id = ANY($2::text[]) AND a.enabled ' +
  'AND COALESCE(a.enabled_at, a.created_at) <= e.created_at'

// The (event, automation) pair is unique: a pair delivered, or running and
// not yet stale, returns no row and is left alone; a failed one (or one whose
// run was left running for longer than the stale window) is taken again.
const CLAIM_DELIVERY_SQL =
  'INSERT INTO teleport_event_deliveries AS d (event_id, workflow_id, status, attempts, started_at) ' +
  "VALUES ($1, $2, 'running', 1, now()) " +
  "ON CONFLICT (event_id, workflow_id) DO UPDATE SET status = 'running', attempts = d.attempts + 1, " +
  'started_at = now(), finished_at = NULL, error = NULL ' +
  `WHERE d.status = 'failed' OR (d.status = 'running' AND d.started_at < now() - ${STALE}) ` +
  'RETURNING d.id, d.attempts'

// A run's outcome, written only while that same claim (its attempt number)
// still holds the row: the run awaited, and one the dispatcher stopped
// waiting for, alike.
// An automation that did not run because the event has no record behind it:
// its delivery says why (a delivered or running one is left alone).
const REFUSE_DELIVERY_SQL =
  'INSERT INTO teleport_event_deliveries AS d (event_id, workflow_id, status, attempts, error, started_at, finished_at) ' +
  "VALUES ($1, $2, 'failed', 0, $3, now(), now()) " +
  "ON CONFLICT (event_id, workflow_id) DO UPDATE SET status = 'failed', error = $3, finished_at = now() " +
  "WHERE d.status = 'failed'"

const FINISH_DELIVERY_SQL =
  'UPDATE teleport_event_deliveries SET status = $2, error = $3, finished_at = now() ' +
  "WHERE id = $1 AND status = 'running' AND attempts = $4"

// An event that used its last attempt: the runs it left running are over.
const TIME_OUT_DELIVERIES_SQL =
  "UPDATE teleport_event_deliveries SET status = 'failed', error = 'Timed out', finished_at = now() " +
  `WHERE event_id = $1 AND status = 'running' AND started_at < now() - ${STALE}`

// A resume's outcome, in ONE statement: the Wait is settled ('done' or
// 'failed') only while this claim (its run_at token) still holds it, and the
// run's delivery takes the resumed run's outcome ('delivered', 'failed', or
// 'waiting' again at a later Wait) only when it was. Two statements could be
// cut apart by the process dying between them, leaving the Wait done, the
// delivery waiting and the event pending for good. The delivery's started_at
// becomes the resume's, so the History's duration is the resumed part; its
// attempts stay those of the run. Its row count says whether the claim held
// (and the delivery was still waiting for it).
const FINISH_RESUME_SQL =
  'WITH w AS (UPDATE teleport_automation_waits SET status = $1 ' +
  "WHERE id = $2 AND status = 'resuming' AND run_at = $3 RETURNING id) " +
  'UPDATE teleport_event_deliveries SET status = $4, error = $5, started_at = $6, finished_at = now() ' +
  "WHERE event_id = $7 AND workflow_id = $8 AND status = 'waiting' AND EXISTS (SELECT 1 FROM w)"

const EVENT_DELIVERIES_SQL =
  'SELECT workflow_id, status FROM teleport_event_deliveries WHERE event_id = $1'

// Settles (or hands back) the event of this claim.
const FINISH_EVENT_SQL = `UPDATE teleport_events SET status = $2 WHERE id = $1 AND ${CLAIM_GUARD}$3`

// The ledger itself failed for this event (not a handler): retried, counted.
const FAIL_EVENT_SQL =
  "UPDATE teleport_events SET status = 'failed', attempts = attempts + 1 " +
  `WHERE id = $1 AND ${CLAIM_GUARD}$2`

// A test is recorded already settled, so the queue never claims it.
const INSERT_TEST_EVENT_SQL =
  'INSERT INTO teleport_events (event_type, dedupe_key, payload, actor, actor_type, status) ' +
  "VALUES ($1, $2, $3, $4, $5, 'test') RETURNING id, created_at"

const START_TEST_DELIVERY_SQL =
  'INSERT INTO teleport_event_deliveries (event_id, workflow_id, status, attempts, started_at) ' +
  "VALUES ($1, $2, 'running', 1, now()) RETURNING id, attempts"

// The Waits due (dueWaitsSql), oldest first.
const CLAIM_WAITS_SQL =
  'SELECT w.id, w.event_id, w.workflow_id, w.resume_node_id, w.context FROM teleport_automation_waits w ' +
  `WHERE ${dueWaitsSql('$1')} ` +
  `ORDER BY w.run_at LIMIT ${batchSize} FOR UPDATE SKIP LOCKED`

// run_at becomes the claim time (to the millisecond, so it reads back exactly).
const MARK_WAITS_SQL =
  "UPDATE teleport_automation_waits SET status = 'resuming', run_at = date_trunc('milliseconds', now()) " +
  'WHERE id = ANY($1::int[]) RETURNING id, run_at'

// Hands a claimed Wait back, only while that same claim (its run_at token) holds it.
const RELEASE_WAIT_SQL =
  "UPDATE teleport_automation_waits SET status = 'waiting' WHERE id = $1 AND status = 'resuming' AND run_at = $2"

// Where a retried run picks up: the latest Wait of this (event, automation)
// whose resumed part failed. Everything before it ran already (its emails were
// sent), so the retry starts at the step after it, with the context it stored.
const FAILED_WAIT_SQL =
  'SELECT id, resume_node_id, context FROM teleport_automation_waits ' +
  "WHERE event_id = $1 AND workflow_id = $2 AND status = 'failed' ORDER BY id DESC LIMIT 1"

// A retry that got past its Wait (to the end, or to a later Wait): that Wait is done.
const SETTLE_FAILED_WAIT_SQL =
  "UPDATE teleport_automation_waits SET status = 'done' WHERE id = $1 AND status = 'failed'"

const EVENT_BY_ID_SQL = `SELECT ${EVENT_COLUMNS} FROM teleport_events e WHERE e.id = $1`

const ENTITY_LABELS: Record<string, string> = {
  giftCards: 'order',
  giftCard: 'order',
  cart: 'abandoned cart',
  waitlist: 'waitlist entry',
}

const STATEMENTS: Array<[string, string]> = [
  ['CLAIM_EVENTS_SQL', CLAIM_EVENTS_SQL],
  ['MARK_PENDING_SQL', MARK_PENDING_SQL],
  ['COUNT_ATTEMPT_SQL', COUNT_ATTEMPT_SQL],
  ['EVENT_AUTOMATIONS_SQL', EVENT_AUTOMATIONS_SQL],
  ['CLAIM_DELIVERY_SQL', CLAIM_DELIVERY_SQL],
  ['REFUSE_DELIVERY_SQL', REFUSE_DELIVERY_SQL],
  ['FINISH_DELIVERY_SQL', FINISH_DELIVERY_SQL],
  ['TIME_OUT_DELIVERIES_SQL', TIME_OUT_DELIVERIES_SQL],
  ['FINISH_RESUME_SQL', FINISH_RESUME_SQL],
  ['EVENT_DELIVERIES_SQL', EVENT_DELIVERIES_SQL],
  ['FINISH_EVENT_SQL', FINISH_EVENT_SQL],
  ['FAIL_EVENT_SQL', FAIL_EVENT_SQL],
  ['INSERT_TEST_EVENT_SQL', INSERT_TEST_EVENT_SQL],
  ['START_TEST_DELIVERY_SQL', START_TEST_DELIVERY_SQL],
  ['CLAIM_WAITS_SQL', CLAIM_WAITS_SQL],
  ['MARK_WAITS_SQL', MARK_WAITS_SQL],
  ['RELEASE_WAIT_SQL', RELEASE_WAIT_SQL],
  ['FAILED_WAIT_SQL', FAILED_WAIT_SQL],
  ['SETTLE_FAILED_WAIT_SQL', SETTLE_FAILED_WAIT_SQL],
  ['EVENT_BY_ID_SQL', EVENT_BY_ID_SQL],
]

/**
 * The delivery guarantee, worded for the editor's History drawer:
 *
 * Every automation runs at least once for each event of its type recorded
 * while it is on, and normally exactly once. A run that fails is retried the
 * next time the site is active, up to 5 attempts per event. A run that is
 * still going after 25 seconds is left to finish; if it never reports back
 * (its server stopped), it is run again 15 minutes later — so an automation
 * that is slow or interrupted can run twice for the same event. A run that
 * fails after a Wait is retried from the step after that Wait. A new event is
 * picked up within 3 days; a Wait resumes the next time the site is active
 * after its time has passed.
 */
export const AUTOMATION_DELIVERY_GUARANTEE =
  'Every automation runs at least once for each event of its type recorded while it is on, and normally exactly once. ' +
  'A run that fails is retried the next time the site is active, up to 5 attempts per event. ' +
  'A run that is still going after 25 seconds is left to finish; if it never reports back, it is run again 15 minutes later, ' +
  'so an automation that is slow or interrupted can run twice for the same event. ' +
  'A run that fails after a Wait is retried from the step after that Wait: the steps before it do not run again. ' +
  'A new event is picked up within 3 days; a Wait resumes the next time the site is active after its time has passed.'

/**
 * `lib/automations/dispatcher.js`. `entityByType` maps every event type of
 * the registry to its envelope key, `envelopeKeysByType` to its catalog blocks
 * (null: keep the payload whole); `hydratedEntities` are the entities a
 * `hydrate/<entity>.js` module was generated for.
 */
export const generateAutomationDispatcherCode = (options: {
  entityByType: Record<string, string | null>
  envelopeKeysByType: Record<string, string[] | null>
  hydratedEntities: string[]
}): string => {
  const hydrators = options.hydratedEntities
    .map((entity) => `  ${JSON.stringify(entity)}: require('./hydrate/${entity}.js').hydrate,`)
    .join('\n')
  return `'use strict';
/**
 * Automations: the queue worker (generated). teleport_events is the queue;
 * every pass claims due events, delivers each to the automations of its type
 * that are on, records every delivery, marks the event from its delivery
 * rows, then resumes the Waits that are due. Runs in-process, one handler at
 * a time, and starts nothing once its time budget is spent.
 *
 * At least once: ${AUTOMATION_DELIVERY_GUARANTEE}
 */
var crypto = require('crypto');
var store = require('./store');
var registry = require('./registry');

var HANDLER_TIMEOUT_MS = ${handlerTimeoutMs};
var PASS_DEADLINE_MS = ${passDeadlineMs};
var MAX_ATTEMPTS = ${maxAttempts};

var ENTITY_BY_TYPE = ${JSON.stringify(options.entityByType, null, 2)};

var ENVELOPE_KEYS = ${JSON.stringify(options.envelopeKeysByType, null, 2)};

// How a refusal names a missing record ("No such order").
var ENTITY_LABELS = ${JSON.stringify(ENTITY_LABELS, null, 2)};

var HYDRATORS = {
${hydrators}
};

${STATEMENTS.map(([name, text]) => `var ${name} = ${JSON.stringify(text)};`).join('\n')}

var TIMED_OUT = {};

function own(map, key) {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
}

function registryTypes() {
  return Object.keys(registry);
}

function registryWorkflowIds() {
  var ids = [];
  registryTypes().forEach(function (type) {
    (registry[type] || []).forEach(function (entry) { ids.push(entry.workflowId); });
  });
  return ids;
}

function findAutomation(workflowId) {
  var types = registryTypes();
  for (var i = 0; i < types.length; i++) {
    var entries = registry[types[i]] || [];
    for (var j = 0; j < entries.length; j++) {
      if (entries[j].workflowId === workflowId) return { type: types[i], entry: entries[j] };
    }
  }
  return null;
}

// Runs one handler, waiting at most timeoutMs for it. One still going then is
// left to finish: onLate gets its outcome when it settles.
async function runEntry(start, timeoutMs, onLate) {
  var timer;
  var running = Promise.resolve().then(start);
  var timeout = new Promise(function (resolve) {
    timer = setTimeout(function () { resolve(TIMED_OUT); }, timeoutMs);
  });
  try {
    var value = await Promise.race([running, timeout]);
    if (value === TIMED_OUT) {
      running.then(function (late) { onLate(null, late); }, function (error) { onLate(error, null); });
      return { timedOut: true };
    }
    return { timedOut: false, value: value };
  } catch (error) {
    return { timedOut: false, error: error };
  } finally {
    clearTimeout(timer);
  }
}

// What a run's delivery records: a run that stopped at a Wait is waiting.
function runStatus(error, value) {
  if (error) return 'failed';
  return value && value.waiting === true ? 'waiting' : 'delivered';
}

// Whether a guarded write found its row (the claim it names still held it).
function wrote(result) {
  return !!result && result.rowCount > 0;
}

function lateDeliveryWriter(delivery, testRun, resumePoint) {
  return function (error, value) {
    var message = error ? store.errorMessage(error) : null;
    var status = testRun ? 'test' : runStatus(error, value);
    store.withClient(async function (client) {
      var finished = await client.query(FINISH_DELIVERY_SQL, [delivery.id, status, message, delivery.attempts]);
      // Taken over meanwhile: the run that took it over owns the Wait too.
      if (resumePoint && !error && wrote(finished)) await client.query(SETTLE_FAILED_WAIT_SQL, [resumePoint.id]);
    }).catch(function (writeError) {
      console.error('[automations] could not record a late run: ' + store.errorMessage(writeError));
    });
  };
}

function lateWaitWriter(wait, resumedAt) {
  return function (error, value) {
    if (error) console.error('[automations] ' + wait.workflow_id + ' failed after its Wait: ' + store.errorMessage(error));
    // Nothing is written once another dispatcher took the stale resume over:
    // that run records the outcome.
    store.withClient(function (client) {
      return finishResume(client, wait, runStatus(error, value), error ? store.errorMessage(error) : null, resumedAt);
    }).catch(function (writeError) {
      console.error('[automations] could not record a late resume: ' + store.errorMessage(writeError));
    });
  };
}

async function inTransaction(client, work) {
  await client.query('BEGIN');
  try {
    var value = await work();
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_e) {}
    throw error;
  }
}

// The catalog blocks of the type out of source (an envelope or a payload):
// everything but event and actor when the catalog does not describe the type.
function envelopeBlocks(type, source) {
  var keys = own(ENVELOPE_KEYS, type);
  var blocks = {};
  Object.keys(source || {}).forEach(function (key) {
    if (key === 'event' || key === 'actor' || key === '__test') return;
    if (keys && keys.indexOf(key) === -1) return;
    blocks[key] = source[key];
  });
  return blocks;
}

// The person a record names: an order's or a booking's customer, an
// account's or a subscriber's address, a review's author, a waitlist entry.
function entityEmail(block) {
  if (!store.isPlainObject(block)) return null;
  if (store.isPlainObject(block.customer) && block.customer.email) return String(block.customer.email);
  if (store.isPlainObject(block.entry) && block.entry.email) return String(block.entry.email);
  if (block.email) return String(block.email);
  if (block.authorEmail) return String(block.authorEmail);
  return null;
}

// Who caused it. For an event with a record, the address is the record's
// own: the ledger row (and its actor) can be written by a caller, the record
// cannot. The recorded actor is used only when the record names nobody.
function actorOf(row, envelope, entity, hydrated) {
  var recorded = typeof row.actor === 'string' && row.actor.indexOf('@') !== -1 ? row.actor : null;
  var recordEmail = hydrated ? entityEmail(envelope[entity]) : null;
  return { type: row.actor_type || 'system', email: recordEmail || recorded };
}

// top laid over base, one level deep. A key top could not fill (undefined or
// null: the record has no such value) keeps base's value when base has one.
function overlay(base, top) {
  var merged = Object.assign({}, base);
  Object.keys(top).forEach(function (key) {
    var value = top[key];
    if (value === undefined) return;
    if (value === null && merged[key] !== undefined && merged[key] !== null) return;
    merged[key] = value;
  });
  return merged;
}

function refusal(message) {
  var error = new Error(message);
  error.refusal = true;
  return error;
}

// The envelope every handler receives: { event, actor, <entity>, ... }. The
// record is read afresh and is the truth: laid OVER what the ledger row
// recorded (a caller could have written that row), whose other keys, and the
// values the record has none for, are kept.
// An event whose record is not there is refused ("No such <entity>"): the
// automations never act on a row nothing in the database stands behind.
// A read that fails (other than a table or column the project lacks) throws:
// the event is retried rather than delivered without its record.
async function buildEnvelope(client, row, context) {
  var payload = store.parseJson(row.payload) || {};
  var entity = own(ENTITY_BY_TYPE, row.event_type);
  var hydrate = entity ? own(HYDRATORS, entity) : null;
  var envelope = {
    event: {
      id: String(row.id),
      type: row.event_type,
      version: 1,
      occurredAt: store.toIso(row.created_at),
      test: false,
    },
  };
  if (hydrate) {
    Object.assign(envelope, (await hydrate(client, row, payload, { baseUrl: context.baseUrl })) || {});
    if (!store.isPlainObject(envelope[entity]) && !Array.isArray(envelope[entity])) {
      throw refusal('No such ' + (own(ENTITY_LABELS, entity) || entity));
    }
  }
  var blocks = envelopeBlocks(row.event_type, payload);
  Object.keys(blocks).forEach(function (key) {
    var value = blocks[key];
    if (store.isPlainObject(value) && store.isPlainObject(envelope[key])) {
      envelope[key] = overlay(value, envelope[key]);
      return;
    }
    // A hydrated event's flat values (an order's from / to) were read into
    // its blocks by the hydrator.
    if (hydrate && !store.isPlainObject(value) && !Array.isArray(value)) return;
    if (!hydrate || !(key in envelope)) envelope[key] = value;
  });
  envelope.actor = actorOf(row, envelope, entity, !!hydrate);
  return envelope;
}

async function claimEvents(client) {
  return inTransaction(client, async function () {
    var result = await client.query(CLAIM_EVENTS_SQL, [registryTypes(), registryWorkflowIds()]);
    var rows = (result && result.rows) || [];
    if (rows.length > 0) {
      var marked = (await client.query(MARK_PENDING_SQL, [rows.map(function (row) { return row.id; })])).rows || [];
      rows.forEach(function (row) {
        var mark = marked.filter(function (m) { return String(m.id) === String(row.id); })[0];
        row.claimedAt = mark ? mark.claimed_at : null;
      });
    }
    return rows;
  });
}

// The automations of the event that are on now, by workflow id.
async function enabledAutomations(client, row) {
  var result = await client.query(EVENT_AUTOMATIONS_SQL, [row.id, registryWorkflowIds()]);
  return ((result && result.rows) || []).map(function (a) { return a.workflow_id; });
}

// A stale event that used its last attempt: the runs it left running are
// timed out, then it settles from its delivery rows like any other (a 5th
// attempt that finished late, successfully, ends delivered). No handler starts.
async function settleExhausted(client, row) {
  await client.query(TIME_OUT_DELIVERIES_SQL, [row.id]);
  var enabled = await enabledAutomations(client, row);
  await client.query(FINISH_EVENT_SQL, [row.id, await settledStatus(client, row, enabled), row.claimedAt]);
}

// What a claimed event goes back to when none of its automations ran.
function releasedStatus(row) {
  return row.status === 'recorded' ? 'recorded' : 'failed';
}

// From the delivery rows of the automations that are on: pending while one
// is still running, failed when one failed, delivered when all were; an
// event the pass ran out of time for goes back to where it was.
async function settledStatus(client, row, workflowIds) {
  var rows = ((await client.query(EVENT_DELIVERIES_SQL, [row.id])).rows) || [];
  var byWorkflow = {};
  rows.forEach(function (delivery) { byWorkflow[delivery.workflow_id] = delivery.status; });
  var statuses = workflowIds.map(function (id) { return byWorkflow[id] || null; });
  // Still open: a run going on, or one parked at a Wait.
  if (statuses.indexOf('running') !== -1 || statuses.indexOf('waiting') !== -1) return 'pending';
  if (statuses.indexOf('failed') !== -1) return 'failed';
  // None on any more (all switched off since the claim): nothing was delivered.
  if (statuses.length > 0 && statuses.every(function (status) { return status === 'delivered'; })) return 'delivered';
  return releasedStatus(row);
}

async function failedWaitOf(client, eventId, workflowId) {
  var result = await client.query(FAILED_WAIT_SQL, [eventId, workflowId]);
  return (result && result.rows && result.rows[0]) || null;
}

// A run from its first step, or, for a retry of one that failed after a
// Wait, from the step after that Wait with the context the Wait stored.
function startRun(entry, envelope, resumePoint, baseUrl) {
  return function () {
    if (!resumePoint) return entry.run(envelope, { __baseUrl: baseUrl }, undefined);
    var saved = store.parseJson(resumePoint.context) || {};
    saved.__baseUrl = baseUrl;
    return entry.run(envelope, saved, resumePoint.resume_node_id);
  };
}

async function deliverEvent(client, row, context) {
  var outcome = { delivered: 0, failed: 0 };
  var enabled = await enabledAutomations(client, row);
  // All switched off since the claim: nothing runs, so nothing is read or
  // counted, and the event goes back as it was.
  if (enabled.length === 0) {
    await client.query(FINISH_EVENT_SQL, [row.id, releasedStatus(row), row.claimedAt]);
    return outcome;
  }
  var envelope;
  try {
    envelope = await buildEnvelope(client, row, context);
  } catch (error) {
    if (!error || !error.refusal) throw error;
    // No record behind the row: no automation runs. Each one's delivery says
    // why; the event fails like any other (retried, in case the record was
    // not committed yet, then given up).
    console.warn('[automations] event ' + row.id + ' refused: ' + error.message);
    for (var r = 0; r < enabled.length; r++) {
      await client.query(REFUSE_DELIVERY_SQL, [row.id, enabled[r], error.message]);
    }
    await client.query(FAIL_EVENT_SQL, [row.id, row.claimedAt]);
    outcome.failed = enabled.length;
    return outcome;
  }
  var entries = (registry[row.event_type] || []).filter(function (entry) {
    return enabled.indexOf(entry.workflowId) !== -1;
  });
  var counted = false;
  for (var i = 0; i < entries.length; i++) {
    if (Date.now() >= context.deadline) break;
    var entry = entries[i];
    var claimed = await client.query(CLAIM_DELIVERY_SQL, [row.id, entry.workflowId]);
    var delivery = claimed && claimed.rows && claimed.rows[0];
    if (!delivery) continue;
    if (!counted) {
      await client.query(COUNT_ATTEMPT_SQL, [row.id, row.claimedAt]);
      counted = true;
    }
    // A retry of a run that failed after a Wait resumes after that Wait. A
    // first attempt has no earlier run to resume.
    var resumePoint = delivery.attempts > 1 ? await failedWaitOf(client, row.id, entry.workflowId) : null;
    // Each handler gets its own copy: one run cannot change what the next reads.
    var ran = await runEntry(
      startRun(entry, JSON.parse(JSON.stringify(envelope)), resumePoint, context.baseUrl),
      context.timeoutMs,
      lateDeliveryWriter(delivery, false, resumePoint)
    );
    // Still running: its row stays running, so no dispatcher starts it again
    // until the claim is stale.
    if (ran.timedOut) {
      console.warn('[automations] ' + entry.name + ' is still running for event ' + row.id + '; its outcome is recorded when it ends');
      continue;
    }
    var error = ran.error ? store.errorMessage(ran.error) : null;
    if (error) console.error('[automations] ' + entry.name + ' failed for event ' + row.id + ': ' + error);
    // A run that stopped at a Wait is not finished: its delivery waits too.
    var finished = await client.query(FINISH_DELIVERY_SQL, [delivery.id, runStatus(ran.error, ran.value), error, delivery.attempts]);
    if (resumePoint && !error && wrote(finished)) await client.query(SETTLE_FAILED_WAIT_SQL, [resumePoint.id]);
    if (error) outcome.failed += 1;
    else outcome.delivered += 1;
  }
  await client.query(FINISH_EVENT_SQL, [row.id, await settledStatus(client, row, enabled), row.claimedAt]);
  return outcome;
}

async function resumeWaits(client, context) {
  var workflowIds = registryWorkflowIds();
  if (workflowIds.length === 0 || Date.now() >= context.deadline) return 0;
  var waits = await inTransaction(client, async function () {
    var result = await client.query(CLAIM_WAITS_SQL, [workflowIds]);
    var rows = (result && result.rows) || [];
    if (rows.length === 0) return rows;
    var marked = (await client.query(MARK_WAITS_SQL, [rows.map(function (wait) { return wait.id; })])).rows || [];
    rows.forEach(function (wait) {
      var mark = marked.filter(function (m) { return m.id === wait.id; })[0];
      wait.claimedRunAt = mark ? mark.run_at : null;
    });
    return rows;
  });
  var resumed = 0;
  for (var i = 0; i < waits.length; i++) {
    var wait = waits[i];
    if (Date.now() >= context.deadline) {
      await client.query(RELEASE_WAIT_SQL, [wait.id, wait.claimedRunAt]);
      continue;
    }
    var found = findAutomation(wait.workflow_id);
    var envelope = null;
    var eventRow = null;
    var resumedAt = new Date();
    try {
      eventRow = ((await client.query(EVENT_BY_ID_SQL, [wait.event_id])).rows || [])[0] || null;
      envelope = eventRow ? await buildEnvelope(client, eventRow, context) : null;
    } catch (error) {
      // Its record is gone: the parked run cannot go on.
      if (error && error.refusal) {
        console.warn('[automations] a Wait of ' + wait.workflow_id + ' cannot resume: ' + error.message);
        await finishResumedRun(client, wait, eventRow, 'failed', error.message, resumedAt);
        continue;
      }
      // The ledger, not the automation, failed: the Wait is resumed at the next kick.
      console.error('[automations] could not read the event of a Wait: ' + store.errorMessage(error));
      await client.query(RELEASE_WAIT_SQL, [wait.id, wait.claimedRunAt]);
      continue;
    }
    var saved = store.parseJson(wait.context) || {};
    saved.__baseUrl = context.baseUrl;
    var ran = await runEntry(function () {
      if (!found) throw new Error('This automation is no longer published');
      return found.entry.run(envelope, saved, wait.resume_node_id);
    }, context.timeoutMs, lateWaitWriter(wait, resumedAt));
    if (ran.timedOut) continue;
    if (ran.error) {
      console.error('[automations] could not resume ' + wait.workflow_id + ' after its Wait: ' + store.errorMessage(ran.error));
    } else {
      resumed += 1;
    }
    await finishResumedRun(
      client,
      wait,
      eventRow,
      runStatus(ran.error, ran.value),
      ran.error ? store.errorMessage(ran.error) : null,
      resumedAt
    );
  }
  return resumed;
}

// Settles the Wait and records the resumed run's outcome on its delivery, in
// one statement, only while this claim still holds the Wait; whether it did.
async function finishResume(client, wait, status, error, resumedAt) {
  var waitStatus = status === 'failed' ? 'failed' : 'done';
  return wrote(await client.query(FINISH_RESUME_SQL, [
    waitStatus, wait.id, wait.claimedRunAt, status, error, resumedAt, wait.event_id, wait.workflow_id,
  ]));
}

// The resume's outcome (see finishResume), then the event settled from its
// delivery rows like after any run (pending while something is still open,
// failed when a run failed, so Run again and the retries see it). Nothing
// when another dispatcher's claim holds the Wait now: that run settles it.
async function finishResumedRun(client, wait, eventRow, status, error, resumedAt) {
  if (!(await finishResume(client, wait, status, error, resumedAt)) || !eventRow) return;
  var enabled = await enabledAutomations(client, eventRow);
  await client.query(FINISH_EVENT_SQL, [eventRow.id, await settledStatus(client, eventRow, enabled), eventRow.claimed_at]);
}

async function dispatchPass(context) {
  var totals = { claimed: 0, delivered: 0, failed: 0, resumed: 0 };
  if (registryTypes().length === 0) return totals;
  await store.withClient(async function (client) {
    var events = await claimEvents(client);
    for (var i = 0; i < events.length; i++) {
      var row = events[i];
      // Settling starts no handler, so an exhausted event is settled even out
      // of time: it never turns final with runs still marked running.
      if (row.attempts >= MAX_ATTEMPTS) {
        await settleExhausted(client, row);
        continue;
      }
      // Out of time: the claims not started go back as they were.
      if (Date.now() >= context.deadline) {
        await client.query(FINISH_EVENT_SQL, [row.id, releasedStatus(row), row.claimedAt]);
        continue;
      }
      totals.claimed += 1;
      try {
        var outcome = await deliverEvent(client, row, context);
        totals.delivered += outcome.delivered;
        totals.failed += outcome.failed;
      } catch (error) {
        console.error('[automations] could not deliver event ' + row.id + ': ' + store.errorMessage(error));
        try { await client.query(FAIL_EVENT_SQL, [row.id, row.claimedAt]); } catch (_e) {}
      }
    }
    totals.resumed = await resumeWaits(client, context);
  });
  return totals;
}

// One dispatcher per process at a time. A call while one runs joins it and
// asks for another pass, run while the time budget lasts. Once it is spent,
// nothing more starts in this call (the host stops it soon after): what the
// late caller recorded stays in the queue for the next kick.
var running = null;
var again = false;

function dispatch(options) {
  if (running) {
    again = true;
    return running;
  }
  var settings = options || {};
  var context = {
    baseUrl: store.appBaseUrl(settings.req),
    deadline: Date.now() + (settings.deadlineMs || PASS_DEADLINE_MS),
    timeoutMs: settings.handlerTimeoutMs || HANDLER_TIMEOUT_MS,
  };
  running = (async function () {
    var totals = { claimed: 0, delivered: 0, failed: 0, resumed: 0 };
    do {
      again = false;
      var pass = await dispatchPass(context);
      totals.claimed += pass.claimed;
      totals.delivered += pass.delivered;
      totals.failed += pass.failed;
      totals.resumed += pass.resumed;
    } while (again && Date.now() < context.deadline);
    return totals;
  })();
  var current = running;
  var settle = function () {
    running = null;
    again = false;
  };
  current.then(settle, settle);
  return current;
}

function httpError(status, message) {
  var error = new Error(message);
  error.status = status;
  return error;
}

// The editor's "send a test": runs ONE automation once, with the catalog
// blocks of the example it sends, switched on or not. It is recorded as a
// test (never claimed, never retried), and a Wait it meets stops the run and
// is reported as wouldWait instead of parking it.
async function runTest(input, options) {
  var request = input || {};
  var found = findAutomation(request.workflowId);
  if (!found) throw httpError(404, 'This automation is not on the published site yet');
  var source = store.isPlainObject(request.event) ? request.event : {};
  var sourceType = source.event && source.event.type;
  if (sourceType && sourceType !== found.type) {
    throw httpError(400, 'The test is a ' + sourceType + ' event, and this automation reacts to ' + found.type);
  }
  var blocks = envelopeBlocks(found.type, source);
  var actor = store.isPlainObject(source.actor) ? source.actor : {};
  var settings = options || {};
  var baseUrl = store.appBaseUrl(settings.req);
  var timeoutMs = settings.handlerTimeoutMs || HANDLER_TIMEOUT_MS;
  return store.withClient(async function (client) {
    var event = (await client.query(INSERT_TEST_EVENT_SQL, [
      found.type,
      'test:' + crypto.randomUUID(),
      JSON.stringify(Object.assign({}, blocks, { __test: true })),
      store.toText(actor.email),
      store.toText(actor.type) || 'system',
    ])).rows[0];
    var delivery = (await client.query(START_TEST_DELIVERY_SQL, [event.id, found.entry.workflowId])).rows[0];
    var envelope = Object.assign(
      {
        event: { id: String(event.id), type: found.type, version: 1, occurredAt: store.toIso(event.created_at), test: true },
        actor: { type: store.toText(actor.type) || 'system', email: store.toText(actor.email) },
      },
      blocks
    );
    var totals = { claimed: 1, delivered: 0, failed: 0, resumed: 0 };
    var ran = await runEntry(function () {
      return found.entry.run(envelope, { __baseUrl: baseUrl }, undefined);
    }, timeoutMs, lateDeliveryWriter(delivery, true));
    if (ran.timedOut) return totals;
    var wouldWait = ran.value && ran.value.wouldWait ? ran.value.wouldWait : null;
    var note = ran.error ? store.errorMessage(ran.error) : wouldWait ? JSON.stringify({ wouldWait: wouldWait }) : null;
    await client.query(FINISH_DELIVERY_SQL, [delivery.id, 'test', note, delivery.attempts]);
    if (ran.error) totals.failed = 1;
    else totals.delivered = 1;
    if (wouldWait) totals.wouldWait = wouldWait;
    return totals;
  });
}

module.exports = { dispatch: dispatch, runTest: runTest };
`
}

/**
 * `pages/api/automations/dispatch.js`: POST, for this app's own server code
 * (the app secret in `x-internal-data-secret`) or a signed request (the cron
 * signature, see cron-request-verification.ts). Runs the queue and answers
 * `{ claimed, delivered, failed, resumed }`.
 *
 * `{ test: true, workflowId, event }` runs that one automation once instead
 * and answers the same, plus `wouldWait` when the test met a Wait. A test acts
 * on what its body says, so it is taken only from a signed request whose
 * signature covers the body (`x-teleport-body-sha256`): 400 "Unsigned body"
 * otherwise, and 400 naming what is missing when `workflowId` or `event` is.
 * The route reads its body itself (`bodyParser: false`) to hash exactly what
 * was sent. A request that presents none of the credentials is refused (401)
 * before a byte of its body is read, unless the site allows unsigned calls (a
 * local run, `TELEPORT_CRON_ALLOW_UNSIGNED`); a body over 64 KB is refused
 * (413) without reading past it.
 *
 * A signed request is taken once: its execution id, bound into the signature,
 * is remembered (`takeSignedRequest`, table `teleport_automation_requests`)
 * for as long as that signature could still verify, and the same request
 * again is refused (409) before anything runs. A captured request cannot run
 * an automation a second time. When the database cannot say whether it was
 * seen, the request is refused (503). The app's own calls (the app secret)
 * name no execution and are never remembered.
 */
export const generateAutomationDispatchRouteCode = (): string => {
  const rootPrefix = AUTOMATIONS_DISPATCH_ROUTE_PATH.map(() => '..').join('/')
  return `/**
 * Automations dispatch route (generated): runs lib/automations/dispatcher.js.
 */
var crypto = require('crypto');
var bus = require('${rootPrefix}/lib/automations/event-bus');
${generateCronRequestVerificationCode({ bodyDigest: true })}

// A test event's example is a few KB; nothing the route takes is near this.
var MAX_BODY_BYTES = ${DISPATCH_MAX_BODY_BYTES};

function tooLarge() {
  var error = new Error('The request body is too large');
  error.status = 413;
  return error;
}

// The body exactly as sent, up to MAX_BODY_BYTES: past that the route stops
// reading and refuses it.
function readBody(req) {
  return new Promise(function (resolve, reject) {
    if (req.body && Buffer.isBuffer(req.body)) {
      if (req.body.length > MAX_BODY_BYTES) reject(tooLarge());
      else resolve(req.body);
      return;
    }
    if (Number(req.headers && req.headers['content-length']) > MAX_BODY_BYTES) {
      reject(tooLarge());
      return;
    }
    var chunks = [];
    var size = 0;
    var done = false;
    req.on('data', function (chunk) {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', function (error) {
      if (done) return;
      done = true;
      reject(error);
    });
  });
}

function parseBody(rawBody) {
  try {
    return JSON.parse(rawBody.toString('utf-8'));
  } catch (_e) {
    return {};
  }
}

// What a caller can authenticate with: the app secret, the cron signature, or
// Vercel Cron's bearer token. One that presents none is refused unread.
function presentsCredentials(req) {
  var headers = (req && req.headers) || {};
  return !!(headers['x-internal-data-secret'] || headers['x-teleport-cron-signature'] || headers.authorization);
}

// Only server code can read NEXTAUTH_SECRET, so a browser cannot present it.
function presentsAppSecret(req) {
  var given = req && req.headers ? req.headers['x-internal-data-secret'] : '';
  var expected = process.env.NEXTAUTH_SECRET;
  if (typeof given !== 'string' || !given || !expected) return false;
  var a = Buffer.from(given);
  var b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// A signature that covers this very body.
function signsBody(req, rawBody) {
  return !!__cronHeader(req, '${CRON_BODY_DIGEST_HEADER}') && __verifyCronSignature(req, rawBody);
}

// A signed request is remembered for as long as its signature could verify
// (its timestamp may be that far off either way); after that it is refused
// as too old anyway.
var SIGNED_REQUEST_MEMORY_SECONDS = 2 * __CRON_SIGNATURE_TOLERANCE_SECONDS;

// What identifies a signed request: the execution it names, under its sender.
// A digest, so nothing a caller sent is stored as it was sent.
function signedRequestKey(req) {
  var named = [
    __cronHeader(req, 'x-teleport-project-id'),
    __cronHeader(req, 'x-teleport-cron-id'),
    __cronHeader(req, 'x-teleport-cron-execution-id'),
  ];
  return crypto.createHash('sha256').update(JSON.stringify(named)).digest('hex');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!presentsCredentials(req) && process.env.TELEPORT_CRON_ALLOW_UNSIGNED !== 'true') {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  var rawBody;
  try {
    rawBody = await readBody(req);
  } catch (error) {
    if (error && error.status === 413) {
      res.status(413).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: 'The request body could not be read' });
    return;
  }
  var signed = __verifyCronSignature(req, rawBody);
  if (!signed && !presentsAppSecret(req) && !verifyCronRequest(req, rawBody)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (signed) {
    var taken;
    try {
      taken = await bus.takeSignedRequest(
        signedRequestKey(req),
        Math.floor(Date.now() / 1000) + SIGNED_REQUEST_MEMORY_SECONDS
      );
    } catch (error) {
      console.error('[automations] could not check a signed request:', error);
      res.status(503).json({ error: 'The request could not be checked. Try again.' });
      return;
    }
    if (!taken) {
      res.status(409).json({ error: 'This request was already received' });
      return;
    }
  }
  var body = parseBody(rawBody);
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
  try {
    if (body.test === true) {
      if (!signsBody(req, rawBody)) {
        res.status(400).json({ error: 'Unsigned body' });
        return;
      }
      if (typeof body.workflowId !== 'string' || !body.workflowId) {
        res.status(400).json({ error: 'A test names the automation to run: workflowId is missing' });
        return;
      }
      if (!body.event || typeof body.event !== 'object') {
        res.status(400).json({ error: 'A test carries the event to send: event is missing' });
        return;
      }
      res.status(200).json(await bus.runTestEvent({ workflowId: body.workflowId, event: body.event }, req));
      return;
    }
    res.status(200).json(await bus.dispatch({ req: req }));
  } catch (error) {
    if (error && (error.status === 400 || error.status === 404)) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('[automations] dispatch failed:', error);
    res.status(500).json({ error: 'Dispatch failed' });
  }
};

// The body is read raw (see above). maxDuration is read by hosts that take a
// function's time limit from its config (Vercel); Next.js itself reads only
// config.api, so that key is otherwise inert.
module.exports.config = { api: { bodyParser: false }, maxDuration: ${routeMaxDurationSeconds} };
`
}

/**
 * `pages/api/automations/dispatch.js` for a project whose automations cannot
 * run (no bus was generated, see generateAutomationFiles): every request is
 * answered 503 with the reason, so the editor's test-event proxy shows the
 * owner that sentence instead of a missing page.
 */
export const generateAutomationsUnavailableRouteCode = (reason: string): string => `/**
 * Automations dispatch route (generated): automations do not run on this site.
 */
var MESSAGE = ${JSON.stringify(`Automations are not set up on this site: ${reason}`)};

module.exports = function handler(req, res) {
  res.status(503).json({ error: MESSAGE });
};
`
