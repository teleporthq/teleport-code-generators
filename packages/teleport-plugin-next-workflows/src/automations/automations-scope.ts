import type {
  ProjectUIDL,
  UIDLAutomationsDataSourceType,
  UIDLAutomationsSettings,
  UIDLWorkflow,
  UIDLWorkflows,
} from '@teleporthq/teleport-types'

/**
 * Automations: workflows started by a business event (`event-business-event
 * { eventType }`, spec §5.2). They never run in a browser; the generated app
 * runs them itself, off the request path, from a Postgres-backed queue:
 *
 * - `lib/automations/event-bus.js` records an event and kicks the queue;
 * - `lib/automations/dispatcher.js` is the queue worker;
 * - `lib/automations/registry.js` maps each event type to its handlers;
 * - `lib/automations/handlers/<slug>-<id8>.js`, one per automation;
 * - `lib/automations/hydrate/<entity>.js` reads the record an event is about;
 * - `pages/api/automations/dispatch.js` runs the queue for the app itself;
 * - `lib/automations/due-check.js` wakes it on the site's activity
 *   (activity-kicks.ts).
 *
 * All of it is generated only when the project has at least one automation.
 *
 * Event types only generated routes record: `user-signed-up` and
 * `user-deleted` (the signup and account-deletion routes, the signup node),
 * `product-low-stock` (the data API), `waitlist-joined` and
 * `waitlist-spot-opened` (the waitlist routes). The editor's shared event
 * writer (teleport-gui `features/shared/builders/record-event-node.ts`, the
 * one writer a browser can reach) refuses these types, so a row of one of
 * them was written by the generated app itself. The `user` hydrator relies on
 * it for `user-deleted`: the account's row is gone before the route records
 * the event, so the snapshot the route recorded (`payload.user`, naming the
 * event's own `entity_id`) stands in for the record. Any other event whose
 * record is missing is refused ("No such <entity>").
 */

export const BUSINESS_EVENT_TRIGGER = 'event-business-event'
export const WAIT_NODE_TYPE = 'general-wait'

export const AUTOMATIONS_PATH = ['lib', 'automations']
export const AUTOMATION_HANDLERS_PATH = [...AUTOMATIONS_PATH, 'handlers']
export const AUTOMATION_HYDRATE_PATH = [...AUTOMATIONS_PATH, 'hydrate']
export const AUTOMATIONS_DISPATCH_ROUTE_PATH = ['pages', 'api', 'automations']
export const AUTOMATIONS_DISPATCH_URL = '/api/automations/dispatch'

/** Every generated file's key in the project structure starts with this. */
export const AUTOMATIONS_FILE_KEY_PREFIX = 'automations-'

/** The queue's limits (spec §5.2). */
export const AUTOMATION_QUEUE_LIMITS = {
  /** Events claimed, and Waits resumed, per pass. */
  batchSize: 20,
  /** An event is tried at most this many times. */
  maxAttempts: 5,
  /** Older events are left alone. */
  maxAgeDays: 3,
  /**
   * How long the dispatcher waits for one handler. A handler still running
   * then is left running (its delivery stays `running`): it is only taken
   * over once its claim is stale, never while it may still be at work.
   */
  handlerTimeoutMs: 25000,
  /**
   * A dispatch starts no handler after this long, and hands back the claims
   * it did not start, so one call stays inside a serverless time limit.
   */
  passDeadlineMs: 50000,
  /** A claim older than this was left by a run that died, and is taken over. */
  staleClaimMinutes: 15,
  /** The dispatch route's time limit on hosts that read it (Vercel). */
  routeMaxDurationSeconds: 60,
}

/**
 * The platform `waitUntil` the bus uses on Vercel (lib/automations/wait-until.js).
 * 2.x is the line that still runs on Node 18.
 */
export const VERCEL_FUNCTIONS_DEPENDENCY = { name: '@vercel/functions', version: '^2.2.13' }

/**
 * The database the bus opens, from `uidl.automations` (the data source the
 * editor keeps the automation tables in). Automations run only on the
 * TeleportHQ-managed database (v1): the platform fills `TELEPORT_DB_*` for
 * it, and the data API every event writer goes through opens it. Null for
 * anything else: no bus is generated then.
 */
export const resolveAutomationsDatabase = (
  settings: UIDLAutomationsSettings | undefined | null
): UIDLAutomationsDataSourceType | null =>
  settings && settings.dataSourceType === 'teleport' ? 'teleport' : null

/** Why a project with automations got no bus (the stub dispatch route answers it). */
export const AUTOMATIONS_UNAVAILABLE_REASON = 'no TeleportHQ database holds the automation tables'

export const isAutomationWorkflow = (workflow: UIDLWorkflow | undefined | null): boolean =>
  !!workflow && !!workflow.trigger && workflow.trigger.type === BUSINESS_EVENT_TRIGGER

/** The event an automation reacts to; empty when the trigger names none. */
export const automationEventType = (workflow: UIDLWorkflow): string => {
  const eventType = workflow.trigger.config ? workflow.trigger.config.eventType : undefined
  return typeof eventType === 'string' ? eventType.trim() : ''
}

export const collectAutomationWorkflows = (workflows?: UIDLWorkflows | null): UIDLWorkflow[] =>
  Object.values((workflows && workflows.workflows) || {}).filter(isAutomationWorkflow)

/**
 * Whether the project gets the in-app event bus (`lib/automations/event-bus.js`):
 * `generateAutomationFiles` writes it for the automations that name their
 * event. The routes that record or wake business events (signup, account
 * deletion, the data API) carry that code only then, so a project without
 * automations keeps them byte for byte. Takes the project's workflows, or the
 * automations `collectAutomationWorkflows` already found.
 */
export const hasAutomationEventBus = (
  workflows?: UIDLWorkflows | UIDLWorkflow[] | null
): boolean => {
  const automations = Array.isArray(workflows)
    ? workflows.filter(isAutomationWorkflow)
    : collectAutomationWorkflows(workflows)
  return automations.some((workflow) => automationEventType(workflow) !== '')
}

/**
 * Whether the generated app has the in-app event bus: an automation that names
 * its event (`hasAutomationEventBus`) and a database the queue runs on
 * (`resolveAutomationsDatabase`). The one gate of every plugin whose routes
 * record or wake business events, so those routes, `utils/app-events.js` and
 * `lib/automations/*` always agree.
 */
export const hasAutomationsBus = (uidl: Pick<ProjectUIDL, 'workflows' | 'automations'>): boolean =>
  hasAutomationEventBus(uidl.workflows) && resolveAutomationsDatabase(uidl.automations) !== null

/**
 * The envelope key of the record an event type is about — the catalog's
 * `entity` (teleport-gui `packages/workflow-schema/src/constants/business-events.ts`),
 * which this package cannot import. Types are named `<area>-<what happened>`,
 * so the prefix decides, except for the two gift-card events, whose blocks
 * differ. Null for an event without a known record (a plugin's own events):
 * its details come from the event's payload alone.
 */
const ENTITY_BY_PREFIX: Array<[string, string]> = [
  ['order-', 'order'],
  ['subscription-', 'subscription'],
  ['booking-', 'booking'],
  ['invoice-', 'invoice'],
  ['cart-', 'cart'],
  ['product-', 'product'],
  ['user-', 'user'],
  ['form-', 'form'],
  ['newsletter-', 'subscriber'],
  ['review-', 'review'],
  // The waitlist plugin's events (waitlist-joined, waitlist-spot-opened).
  ['waitlist-', 'waitlist'],
]

export const automationEntityOf = (eventType: string): string | null => {
  if (eventType === 'gift-card-issued') {
    return 'giftCards'
  }
  if (eventType === 'gift-card-credited') {
    return 'giftCard'
  }
  const match = ENTITY_BY_PREFIX.find(([prefix]) => eventType.startsWith(prefix))
  return match ? match[1] : null
}

/**
 * The envelope keys besides `event` and `actor` an event type carries — the
 * top-level blocks of the catalog's details: the entity, plus what some types
 * add (a refund, a parcel, the status it moved from). Null for an event the
 * catalog does not describe (a plugin's own): its payload is kept whole.
 */
const EXTRA_ENVELOPE_KEYS: Record<string, string[]> = {
  'order-awaiting-confirmation': ['payment'],
  'order-late-payment': ['payment'],
  'order-duplicate-payment': ['payment'],
  'order-underpaid': ['payment'],
  'order-refunded': ['refund'],
  'order-partially-refunded': ['refund'],
  'order-refund-failed': ['refund'],
  'order-status-changed': ['from', 'to'],
  'order-shipment-created': ['shipment'],
  'order-shipment-updated': ['shipment'],
  'order-shipment-delivered': ['shipment'],
  'order-digital-delivered': ['delivery'],
  'gift-card-issued': ['order'],
  'gift-card-credited': ['order'],
  'booking-moved': ['from'],
}

export const automationEnvelopeKeys = (eventType: string): string[] | null => {
  const entity = automationEntityOf(eventType)
  return entity ? [entity, ...(EXTRA_ENVELOPE_KEYS[eventType] || [])] : null
}
