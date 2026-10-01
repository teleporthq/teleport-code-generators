/**
 * The names the published app's service worker, its push routes and the
 * workflow nodes that use them have to agree on. The node handlers are
 * serialized into the generated app as source text, so they interpolate these
 * values at generation time rather than importing them.
 */

/** The browsers that agreed to receive the app's push notifications, in the project database. */
export const SUBSCRIPTIONS_TABLE = 'teleport_push_subscriptions'

/** Public: a browser saves (POST) or forgets (DELETE) its own subscription here. */
export const SUBSCRIPTIONS_ROUTE = '/api/push/subscriptions'

/** Internal: only the app's own server code may send a notification through it. */
export const SEND_ROUTE = '/api/push/send'

/** What a visitor-facing push step reports when the project has no push keys or no worker. */
export const NOT_CONFIGURED_MESSAGE = 'Push notifications are not set up for this site.'

export const PUBLIC_KEY_ENV = 'WEB_PUSH_VAPID_PUBLIC_KEY'

/** Filled at deploy from the project secret of the same name. */
export const PRIVATE_KEY_ENV = 'WEB_PUSH_VAPID_PRIVATE_KEY'

/**
 * The send route accepts a request only when this header carries an HMAC of
 * `SEND_TOKEN_PURPOSE` keyed with the VAPID private key — a value only the
 * app's own server holds, so no extra secret has to be provisioned.
 */
export const SEND_TOKEN_HEADER = 'x-teleport-push-token'
export const SEND_TOKEN_PURPOSE = 'teleport-web-push-send'

/**
 * The page-side API the generated service-worker module publishes on `window`.
 * A workflow node handler has no module scope, so a global is the only way it
 * can reach the worker registration.
 */
export const SERVICE_WORKER_GLOBAL = '__teleportServiceWorker'

export const SUBSCRIBE_NODE_TYPE = 'browser-subscribe-to-push'
export const UNSUBSCRIBE_NODE_TYPE = 'browser-unsubscribe-from-push'
export const GET_SUBSCRIPTION_NODE_TYPE = 'browser-get-push-subscription'
export const SHOW_NOTIFICATION_NODE_TYPE = 'browser-show-notification'
export const SEND_NODE_TYPE = 'push-send-notification'

/** Nodes that manage the visitor's push subscription and therefore need the push routes. */
export const PUSH_NODE_TYPES: ReadonlyArray<string> = [
  SUBSCRIBE_NODE_TYPE,
  UNSUBSCRIBE_NODE_TYPE,
  GET_SUBSCRIPTION_NODE_TYPE,
  SEND_NODE_TYPE,
]

/**
 * Nodes that need a service worker on the page: push itself, and on-page
 * notifications, which Chrome on Android only shows through a worker.
 */
export const SERVICE_WORKER_NODE_TYPES: ReadonlyArray<string> = [
  ...PUSH_NODE_TYPES,
  SHOW_NOTIFICATION_NODE_TYPE,
]
