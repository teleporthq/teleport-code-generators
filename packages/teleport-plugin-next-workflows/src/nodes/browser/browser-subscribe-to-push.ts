import { WebPush } from '@teleporthq/teleport-shared'
import { NodeHandlerGenerator } from '../types'
import {
  currentPermissionSource,
  notConfiguredMessageSource,
  readServiceWorkerApiSource,
} from './push-api-access'

/**
 * Subscribes the visitor to the app's push notifications. The whole job —
 * asking for permission, registering the service worker, subscribing with the
 * project's key (and replacing a subscription made with an older key), saving
 * it on the server with the signed-in user — lives in the generated
 * service-worker module; this node only calls it.
 *
 * Returns `{ success, subscribed, permission, endpoint, expirationTime, keys }`.
 * A refusal (unsupported browser, permission denied, no push set up) comes back
 * as `success: false` with an `error` sentence.
 */
export const browserSubscribeToPush: NodeHandlerGenerator = {
  nodeType: WebPush.SUBSCRIBE_NODE_TYPE,
  executionEnv: 'client',
  generateHandler(): string {
    return `async function browser_subscribe_to_push() {
  ${readServiceWorkerApiSource()}
  if (!api || !api.push) {
    return { success: false, subscribed: false, permission: ${currentPermissionSource()}, error: ${notConfiguredMessageSource()} };
  }
  return api.push.subscribe();
}`
  },
}
