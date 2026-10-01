import { WebPush } from '@teleporthq/teleport-shared'
import { NodeHandlerGenerator } from '../types'
import { notConfiguredMessageSource, readServiceWorkerApiSource } from './push-api-access'

/**
 * Stops push notifications for this browser: unsubscribes it and removes the
 * stored subscription. Returns `{ success, unsubscribed }` — `unsubscribed` is
 * false when the browser had no subscription to begin with.
 */
export const browserUnsubscribeFromPush: NodeHandlerGenerator = {
  nodeType: WebPush.UNSUBSCRIBE_NODE_TYPE,
  executionEnv: 'client',
  generateHandler(): string {
    return `async function browser_unsubscribe_from_push() {
  ${readServiceWorkerApiSource()}
  if (!api || !api.push) {
    return { success: false, unsubscribed: false, error: ${notConfiguredMessageSource()} };
  }
  return api.push.unsubscribe();
}`
  },
}
