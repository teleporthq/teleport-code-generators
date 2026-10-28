import type { ProjectPluginStructure } from '@teleporthq/teleport-types'
import { AUTOMATIONS_PATH } from './automations-scope'
import { dueWaitsSql, retriableEventsSql } from './dispatcher-source'

/**
 * Activity kicks (spec §5.2): a due Wait, a failed run waiting for its retry,
 * and the work a stopped dispatcher left behind (a stale `pending` event, a
 * stale resume) have no event of their own to wake the queue, so the site's
 * activity does. `lib/automations/due-check.js` exports `kickWhenDue(req?)`, called by
 * every server read of the TeleportHQ database (the data-source modules a
 * page's server render and the admin's lists go through) and by the data API:
 *
 * - at most one check per minute per process (the rest return null at once);
 * - never on the request's path: the check is a cheap EXISTS query run after
 *   the call returns, kept alive by the platform's `waitUntil` on Vercel;
 * - when work is due it wakes the queue the way an emitter does
 *   (`scheduleDispatch`);
 * - never while `next build` renders the pages.
 *
 * Generated only with the event bus (generateAutomationFiles), like every
 * file of `lib/automations/`.
 */

const CHECK_EVERY_MS = 60 * 1000

/**
 * Work a dispatch pass would act on now, by the claims' own rules (shared with
 * the dispatcher), so the kick never wakes a pass with nothing to do: a Wait
 * that is due or whose resume went stale, and a failed or stale `pending`
 * event, of an automation of this build ($1: its workflow ids, $2: its event
 * types). New events are woken by their emitters.
 */
const DUE_SQL =
  `SELECT (EXISTS (SELECT 1 FROM teleport_automation_waits w WHERE ${dueWaitsSql('$1')}) ` +
  `OR EXISTS (SELECT 1 FROM teleport_events e WHERE ${retriableEventsSql('$2', '$1')})) AS due`

/** `lib/automations/due-check.js`, for the automations of this build. */
export const generateAutomationDueCheckCode = (
  workflowIds: string[],
  eventTypes: string[]
): string => `'use strict';
/**
 * Automations: the activity kick (generated). The site's server reads call
 * kickWhenDue(req): once a minute at most, off the request, it looks for a
 * Wait that is due, a failed run waiting for its retry, or work a stopped
 * dispatcher left behind, and wakes the queue when there is some.
 */
var store = require('./store');
var bus = require('./event-bus');

var CHECK_EVERY_MS = ${CHECK_EVERY_MS};
var WORKFLOW_IDS = ${JSON.stringify(workflowIds)};
var EVENT_TYPES = ${JSON.stringify(eventTypes)};
var DUE_SQL = ${JSON.stringify(DUE_SQL)};

var lastCheckAt = 0;

async function check(req) {
  try {
    var result = await store.withClient(function (client) {
      return client.query(DUE_SQL, [WORKFLOW_IDS, EVENT_TYPES]);
    });
    var row = result && result.rows && result.rows[0];
    var due = !!row && (row.due === true || row.due === 't');
    if (due) bus.scheduleDispatch(req);
    return due;
  } catch (error) {
    console.warn('[automations] could not check for due work: ' + store.errorMessage(error));
    return false;
  }
}

// Resolves whether it woke the queue; null when this minute's check ran already.
function kickWhenDue(req) {
  if (process.env.NEXT_PHASE === 'phase-production-build') return null;
  var now = Date.now();
  if (now - lastCheckAt < CHECK_EVERY_MS) return null;
  lastCheckAt = now;
  var work = Promise.resolve().then(function () { return check(req); });
  var waitUntil = process.env.VERCEL && typeof globalThis.__tqWaitUntil === 'function' ? globalThis.__tqWaitUntil : null;
  if (waitUntil) {
    try { waitUntil(work); } catch (_e) {}
  }
  return work;
}

module.exports = { kickWhenDue: kickWhenDue };
`

/** From a data-source module (`utils/data-sources/`, `pages/api/`) to the project root. */
const DUE_CHECK_IMPORT = `import { kickWhenDue as __tqKickDueAutomations } from '../../${AUTOMATIONS_PATH.join(
  '/'
)}/due-check'`

/**
 * The handler every data-source module of the data-source plugin runs for a
 * read (`generateDataSourceFetcherWithCore`: an API route, and a page's
 * server render through `fetchData`).
 */
const HANDLER_OPENING = '\nasync function handler(req, res) {\n'

const KICK_CALL =
  '  // Activity on the site: due automation work (a Wait, a retry) starts off this request.\n' +
  '  __tqKickDueAutomations(req)\n'

/** Where the data-source plugin writes the modules that read a table. */
const DATA_SOURCE_MODULE_FOLDERS = ['utils/data-sources', 'pages/api']

/**
 * Starts the due check from every module that reads the TeleportHQ database
 * (the data-source plugin names them `teleport-<table>-<id>`), the only one
 * automations run on: one import, one call at the top of its handler. A module
 * of another database, or one that only re-exports another's handler, is left
 * as it is. Runs after the page plugins wrote them.
 */
export const installAutomationActivityKicks = (structure: ProjectPluginStructure): void => {
  for (const entry of structure.files.values()) {
    if (DATA_SOURCE_MODULE_FOLDERS.indexOf(entry.path.join('/')) === -1) {
      continue
    }
    for (const file of entry.files) {
      const content = typeof file.content === 'string' ? file.content : ''
      const at = content.indexOf(HANDLER_OPENING)
      if (
        !file.name.startsWith('teleport-') ||
        at === -1 ||
        content.indexOf(HANDLER_OPENING, at + 1) !== -1 ||
        content.indexOf(DUE_CHECK_IMPORT) !== -1
      ) {
        continue
      }
      const bodyStart = at + HANDLER_OPENING.length
      file.content = `${DUE_CHECK_IMPORT}\n${content.slice(
        0,
        bodyStart
      )}${KICK_CALL}${content.slice(bodyStart)}`
    }
  }
}
