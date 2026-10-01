import { WebPush } from '@teleporthq/teleport-shared'
import { NodeHandlerGenerator } from '../types'
import { readServiceWorkerApiSource } from './push-api-access'

/**
 * Shows a system notification from the page. Chrome on Android refuses the
 * page-level `Notification` constructor, so the notification goes through the
 * app's service worker whenever the project ships one (clicking it returns to
 * the page), and falls back to the constructor where the worker is not
 * available (a desktop browser on a project without one).
 *
 * Returns `{ success, permission }`; a refusal is `success: false` with an
 * `error` sentence.
 */
export const browserShowNotification: NodeHandlerGenerator = {
  nodeType: WebPush.SHOW_NOTIFICATION_NODE_TYPE,
  executionEnv: 'client',
  generateHandler(): string {
    return `async function browser_show_notification(config) {
  if (typeof Notification === 'undefined') {
    return { success: false, permission: 'default', error: 'This browser cannot show notifications.' };
  }

  var permission = Notification.permission;
  try {
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
  } catch (error) {
    permission = Notification.permission;
  }
  if (permission !== 'granted') {
    return { success: false, permission: permission, error: 'Notifications are blocked for this site.' };
  }

  var title = String(config.title || '');
  var options = {};
  if (config.body) {
    options.body = String(config.body);
  }
  if (config.icon) {
    options.icon = String(config.icon);
  }
  if (config.tag) {
    options.tag = String(config.tag);
  }
  if (config.requireInteraction === true || config.requireInteraction === 'true') {
    options.requireInteraction = true;
  }
  if (config.silent === true || config.silent === 'true') {
    options.silent = true;
  }

  ${readServiceWorkerApiSource()}
  if (api) {
    try {
      await api.showNotification(title, options);
      return { success: true, permission: permission };
    } catch (error) {
      // No worker on this page (a frame, development): the page can still try.
    }
  }

  try {
    new Notification(title, options);
    return { success: true, permission: permission };
  } catch (error) {
    return { success: false, permission: permission, error: (error && error.message) || 'The notification could not be shown.' };
  }
}`
  },
}
