import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'

/**
 * `utils/app-events.js`: how a generated route records a business event
 * (spec §5.1) on its own database connection — the data API's low-stock
 * alert:
 *
 *   const { recordAppEvent } = require('<root>/utils/app-events');
 *   await recordAppEvent(db, { type, entityType, entityId, orderId?, payload,
 *     actor, actorType, dedupeKey }, req);
 *
 * `db` is the route's own Postgres client (anything with `query(text,
 * values)` resolving `{ rows }`), so the row is written on the route's
 * connection; call it once the route's own writes are committed, or the queue
 * cannot see the row yet. A replayed `dedupeKey` writes nothing. Never
 * throws: it resolves `{ recorded, id }`, so the event ledger can never fail
 * the operation it records.
 *
 * The row is always written: it is the record timelines and the editor's
 * history read. When the project has automations (`withAutomations`, decided
 * at generation: the in-app event bus `lib/automations/event-bus.js` exists)
 * a new row also wakes the queue, off the request path, on the app's own
 * origin as `req` reached it (never a URL a caller hands in). Without them
 * the module never names the bus.
 */

export const APP_EVENTS_FILE_KEY = 'app-events'
export const APP_EVENTS_PATH = ['utils']
export const APP_EVENTS_FILE_NAME = 'app-events'

/** From `utils/app-events.js` to the bus the automations plugin generates. */
const EVENT_BUS_REQUIRE_PATH = '../lib/automations/event-bus'

const INSERT_EVENT_SQL =
  'INSERT INTO teleport_events (event_type, dedupe_key, order_id, entity_type, entity_id, payload, actor, actor_type) ' +
  'VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id'

const KICK_WITH_AUTOMATIONS = `// The project has automations: a new event wakes their queue.
function kick(req) {
  try {
    require('${EVENT_BUS_REQUIRE_PATH}').scheduleDispatch(req);
  } catch (error) {
    console.warn('[app-events] could not wake the automations: ' + errorMessage(error));
  }
}`

const KICK_WITHOUT_AUTOMATIONS = `// The project has no automations: the row is the whole record.
function kick() {}`

export const generateAppEventsModuleCode = (options: {
  withAutomations: boolean
}): string => `'use strict';
/**
 * Business events recorded by the app's routes (generated).
 */
var crypto = require('crypto');

var INSERT_EVENT_SQL = ${JSON.stringify(INSERT_EVENT_SQL)};

function errorMessage(error) {
  return error && error.message ? String(error.message) : String(error);
}

${options.withAutomations ? KICK_WITH_AUTOMATIONS : KICK_WITHOUT_AUTOMATIONS}

function column(value, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).slice(0, maxLength);
}

async function recordAppEvent(db, event, req) {
  var input = event || {};
  try {
    var type = column(input.type, 100);
    if (!type) throw new Error('An event needs its type');
    var result = await db.query(INSERT_EVENT_SQL, [
      type,
      column(input.dedupeKey, 255) || type + ':' + crypto.randomUUID(),
      column(input.orderId, 64),
      column(input.entityType, 40),
      column(input.entityId, 64),
      input.payload === undefined || input.payload === null ? null : JSON.stringify(input.payload),
      column(input.actor, 255),
      column(input.actorType, 50) || 'system',
    ]);
    var row = result && result.rows && result.rows[0];
    if (!row) return { recorded: false, id: null };
    kick(req);
    return { recorded: true, id: String(row.id) };
  } catch (error) {
    console.error('[app-events] could not record the ' + String(input.type) + ' event: ' + errorMessage(error));
    return { recorded: false, id: null };
  }
}

module.exports = { recordAppEvent: recordAppEvent };
`

/** Writes `utils/app-events.js` into the project, once. */
export const ensureAppEventsModule = (
  structure: ProjectPluginStructure,
  withAutomations: boolean
): void => {
  if (structure.files.has(APP_EVENTS_FILE_KEY)) {
    return
  }
  structure.files.set(APP_EVENTS_FILE_KEY, {
    path: APP_EVENTS_PATH,
    files: [
      {
        name: APP_EVENTS_FILE_NAME,
        fileType: FileType.JS,
        content: generateAppEventsModuleCode({ withAutomations }),
      },
    ],
  })
}
