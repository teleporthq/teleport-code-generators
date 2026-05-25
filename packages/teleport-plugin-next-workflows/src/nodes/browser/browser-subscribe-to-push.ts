import { NodeHandlerGenerator, handlerToString } from '../types'

async function browser_subscribe_to_push(config: any) {
  const vapidPublicKey = config.vapidPublicKey

  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return { subscription: null, error: 'Push API is not supported' }
    }

    const registration = await navigator.serviceWorker.ready

    const existingSub = await registration.pushManager.getSubscription()
    if (existingSub) {
      return { subscription: existingSub.toJSON() }
    }

    const padding = (4 - (vapidPublicKey.length % 4)) % 4
    const base64 = (vapidPublicKey + '='.repeat(padding)).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = atob(base64)
    const outputArray = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; i++) {
      outputArray[i] = rawData.charCodeAt(i)
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: outputArray,
    })

    return { subscription: subscription.toJSON() }
  } catch (err: unknown) {
    return { subscription: null, error: (err as Error).message }
  }
}
export const browserSubscribeToPush: NodeHandlerGenerator = {
  nodeType: 'browser-subscribe-to-push',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(browser_subscribe_to_push)
  },
}
