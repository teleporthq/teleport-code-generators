import type { NodeHandlerGenerator } from '../types'

/**
 * Wait (`general-wait { amount, unit } | { until }`): pauses an automation and
 * resumes it later (spec §5.2). Server only, and only inside an automation
 * handler module (`lib/automations/handlers/*.js`), which hands the node its
 * run through `context.__automation`:
 *
 * - the node works out when the run resumes and stores its output
 *   (`{ until }`, the node-context schema) on the context first, so the nodes
 *   after it read it once the run resumes;
 * - `context.__automation.park(nodeId, until)` stores the run — a
 *   `teleport_automation_waits` row with the event, the workflow, the next
 *   node and the context — and the node answers `{ __wait: true }`, which
 *   stops the handler's node loop: nothing after it runs now. A Wait with no
 *   step after it parks nothing (`park` answers null): the node answers
 *   `{ until }` and the run ends there, delivered, instead of waiting for a
 *   resume that would never come.
 *
 * A test event (`context.__automation.test`) parks nothing: the node answers
 * `{ __wait: true, wouldWait: { amount, unit } | { until } }` and the run stops
 * there, so a test never leaves a run behind.
 *
 * The dispatcher resumes the row once `until` has passed, at the next node,
 * with the stored context. Not in the node registry: no other route can run
 * it, and one that met it would fail with "No implementation" — a Wait is
 * refused outside automations by the editor's validation.
 *
 * Authored as a string so a consumer's minifier cannot rename the entry
 * function (see resolveHandlerEntryName).
 */
const GENERAL_WAIT_HANDLER = `async function general_wait(config, context) {
  var automation = context && context.__automation;
  if (!automation || typeof automation.park !== 'function') {
    throw new Error('A Wait runs only in an automation');
  }
  // Checked before anything else, a test included, so a test fails exactly
  // where the live run would: a Wait in a loop has no single place to resume.
  if (context.__loopScopeStack && context.__loopScopeStack.length > 0) {
    throw new Error('A Wait cannot run inside a loop');
  }
  var runAt;
  var untilMode = config.until !== undefined && config.until !== null && config.until !== '';
  if (untilMode) {
    runAt = new Date(config.until);
    if (isNaN(runAt.getTime())) {
      throw new Error('The Wait is set to a date that is not one: ' + String(config.until));
    }
  } else {
    var unitMs = { minutes: 60000, hours: 3600000, days: 86400000 }[config.unit || 'minutes'];
    var amount = Number(config.amount);
    if (!unitMs || !isFinite(amount) || amount < 0) {
      throw new Error('Set how many minutes, hours or days the Wait lasts');
    }
    runAt = new Date(Date.now() + amount * unitMs);
  }
  var until = runAt.toISOString();
  // A test event shows where the run would pause, and stops there: nothing is stored.
  if (automation.test) {
    return {
      __wait: true,
      until: until,
      wouldWait: untilMode ? { until: until } : { amount: Number(config.amount), unit: config.unit || 'minutes' },
    };
  }
  context[config.__nodeId] = { until: until };
  var parked = await automation.park(config.__nodeId, until);
  return parked ? { __wait: true, until: until } : { until: until };
}`

export const generalWait: NodeHandlerGenerator = {
  nodeType: 'general-wait',
  executionEnv: 'server',
  generateHandler(): string {
    return GENERAL_WAIT_HANDLER
  },
  generateServerHandler(): string {
    return GENERAL_WAIT_HANDLER
  },
}
