import { WebPush } from '@teleporthq/teleport-shared'
import { NodeHandlerGenerator } from '../types'
import { currentPermissionSource, readServiceWorkerApiSource } from './push-api-access'

/**
 * Reports whether this browser can receive the app's push notifications and
 * already does, without prompting: `{ success, supported, permission,
 * subscribed, endpoint }`. Never fails — an unsupported browser or a site
 * without push is simply `supported: false` — so it can drive a toggle.
 */
export const browserGetPushSubscription: NodeHandlerGenerator = {
  nodeType: WebPush.GET_SUBSCRIPTION_NODE_TYPE,
  executionEnv: 'client',
  generateHandler(): string {
    return `async function browser_get_push_subscription() {
  ${readServiceWorkerApiSource()}
  if (!api || !api.push) {
    return { success: true, supported: false, permission: ${currentPermissionSource()}, subscribed: false, endpoint: '' };
  }
  return api.push.getSubscription();
}`
  },
}
