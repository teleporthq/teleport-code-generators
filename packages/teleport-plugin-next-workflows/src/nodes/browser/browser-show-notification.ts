import { NodeHandlerGenerator, handlerToString } from '../types'

async function browser_show_notification(config: any) {
  const title = config.title || ''
  const body = config.body || ''
  const icon = config.icon || ''
  const tag = config.tag || ''
  const requireInteraction = config.requireInteraction || false
  const silent = config.silent || false

  try {
    if (!('Notification' in window)) {
      return { success: false, error: 'Notifications are not supported' }
    }

    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        return { success: false, error: 'Notification permission denied' }
      }
    }

    const options: NotificationOptions = { body }
    if (icon) {
      options.icon = icon
    }
    if (tag) {
      options.tag = tag
    }
    if (requireInteraction) {
      options.requireInteraction = true
    }
    if (silent) {
      options.silent = true
    }

    new Notification(title, options)
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}
export const browserShowNotification: NodeHandlerGenerator = {
  nodeType: 'browser-show-notification',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(browser_show_notification)
  },
}
