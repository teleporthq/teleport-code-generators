import { WebPush } from '@teleporthq/teleport-shared'

/**
 * Handler source that reads the page-side API the generated service-worker
 * module publishes on `window` (`components/teleport-service-worker.js`) into
 * a local `api`. Handlers are serialized into the app as source text and
 * cannot import that module, so the global is their only way to it; a project
 * with no worker simply has no global.
 */
export const readServiceWorkerApiSource = (): string =>
  `var api = typeof window !== 'undefined' ? window[${JSON.stringify(
    WebPush.SERVICE_WORKER_GLOBAL
  )}] : undefined;`

/** The notification permission as a handler reports it, without prompting. */
export const currentPermissionSource = (): string =>
  "typeof Notification === 'undefined' ? 'default' : Notification.permission"

export const notConfiguredMessageSource = (): string =>
  JSON.stringify(WebPush.NOT_CONFIGURED_MESSAGE)
