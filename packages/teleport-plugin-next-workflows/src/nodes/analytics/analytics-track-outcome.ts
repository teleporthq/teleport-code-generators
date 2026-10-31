import { NodeHandlerGenerator } from '../types'

/**
 * Reports what a visit produced to Growth analytics.
 *
 * Two bodies, one node. In the browser the tracker does the sending (it holds
 * the visitor's identity and queues the beacon); on the server — where the
 * order or booking row has just been written — the segment posts straight to
 * the analytics service with the SERVER key, so a purchase cannot be forged by
 * a visitor's browser nor lost to an ad blocker. The money names are refused
 * on the client for exactly that reason.
 *
 * Attribution: a browser outcome inherits the session's; a server outcome
 * carries the ids the trigger stamped on the context (`__tpa`, set by every
 * generated trigger) plus whatever first-touch snapshot the caller binds in
 * `attribution` (the checkout stamps `utm_*`, `referrer_host`, `landing_path`).
 * A snapshot naming a `session_id` is the visit that placed an order, read back
 * by a run outside that visit (a payment webhook, a cron, an admin page): its
 * `session_id`, `visitor_id` and `exp` stand in for the trigger's ids. Otherwise
 * the visitor id is the tracker's alone: a browser may still hold a persistent
 * id from before its consent was withdrawn.
 *
 * Never throws: an outcome that cannot be reported answers `{ sent: false }`
 * and the workflow continues — analytics must never cost a sale.
 */
const SERVER_ONLY_OUTCOMES = ['purchase', 'booking_made']

const CLIENT_BODY = `async function analytics_track_outcome(config, context) {
  var name = config.name == null ? '' : String(config.name);
  if (!name) {
    return { sent: false, reason: 'no-name' };
  }
  if (${JSON.stringify(SERVER_ONLY_OUTCOMES)}.indexOf(name) !== -1) {
    return { sent: false, reason: 'server-only' };
  }
  try {
    var tracker = typeof window !== 'undefined' ? window.tpAnalytics : null;
    if (tracker && typeof tracker.track === 'function') {
      tracker.track(name, {
        value: config.value,
        currency: config.currency,
        outcomeId: config.outcomeId,
        recordId: config.recordId,
        query: config.query,
        results: config.results
      });
      return { sent: true };
    }
  } catch (err) {
    /* analytics must never break the page */
  }
  return { sent: false, reason: 'tracker-unavailable' };
}`

const SERVER_BODY = `async function analytics_track_outcome(config, context) {
  var name = config.name == null ? '' : String(config.name);
  if (!name) {
    return { sent: false, reason: 'no-name' };
  }
  // \`globalThis.process\` (member access): webpack rewrites a bare \`process\`.
  var env = globalThis.process && globalThis.process.env;
  var baseUrl = (env && env.NEXT_PUBLIC_TELEPORT_ANALYTICS_URL) || '';
  var publicKey = (env && env.NEXT_PUBLIC_TELEPORT_ANALYTICS_KEY) || '';
  var serverKey = (env && env.TELEPORT_ANALYTICS_SERVER_KEY) || '';
  if (baseUrl.indexOf('http') !== 0 || !publicKey || !serverKey) {
    return { sent: false, reason: 'not-configured' };
  }
  // The service dedupes on this id and drops an outcome without one.
  if (config.outcomeId == null || config.outcomeId === '') {
    return { sent: false, reason: 'no-outcome-id' };
  }
  var ids = context && context.__tpa && typeof context.__tpa === 'object' ? context.__tpa : {};
  var attribution = config.attribution && typeof config.attribution === 'object' ? config.attribution : {};
  var visit = attribution.session_id
    ? { sessionId: attribution.session_id, visitorId: attribution.visitor_id, exp: attribution.exp }
    : ids;
  var outcome = {
    name: name,
    value: config.value == null || config.value === '' ? null : Number(config.value),
    currency: config.currency == null ? null : String(config.currency),
    outcomeId: config.outcomeId == null ? null : String(config.outcomeId),
    recordId: config.recordId == null ? null : String(config.recordId),
    sessionId: visit.sessionId || null,
    visitorId: visit.visitorId || null,
    path: visit.path || null,
    exp: visit.exp || null,
    attribution: {
      utmSource: attribution.utm_source || attribution.utmSource || null,
      utmMedium: attribution.utm_medium || attribution.utmMedium || null,
      utmCampaign: attribution.utm_campaign || attribution.utmCampaign || null,
      utmContent: attribution.utm_content || attribution.utmContent || null,
      referrerHost: attribution.referrer_host || attribution.referrerHost || null,
      landingPath: attribution.landing_path || attribution.landingPath || null
    }
  };
  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = controller ? setTimeout(function () { controller.abort(); }, 3000) : null;
  try {
    var response = await fetch(baseUrl.replace(/\\/$/, '') + '/events/' + publicKey + '/server', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tp-server-key': serverKey },
      body: JSON.stringify({ outcomes: [outcome] }),
      signal: controller ? controller.signal : undefined
    });
    return { sent: response.status < 400, status: response.status };
  } catch (err) {
    return { sent: false, reason: 'network' };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}`

export const analyticsTrackOutcome: NodeHandlerGenerator = {
  nodeType: 'analytics-track-outcome',
  executionEnv: 'universal',
  generateHandler(): string {
    return CLIENT_BODY
  },
  generateServerHandler(): string {
    return SERVER_BODY
  },
}
