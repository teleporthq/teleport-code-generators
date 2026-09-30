import { WebPush } from '@teleporthq/teleport-shared'
import { NodeHandlerGenerator } from '../types'

/**
 * Sends a push notification to the app's subscribers — everyone, one signed-in
 * user's browsers, or one subscription. The sending itself (the subscription
 * store, `web-push`, removing expired subscriptions) lives in the app's
 * internal `/api/push/send` route; this node calls it with a token only the
 * app's server can compute: an HMAC keyed with the VAPID private key.
 *
 * Returns `{ success, sent, failed, removed, complete }`. Reaching nobody is
 * not a failure (a user without a subscription is normal); a push that is not
 * set up, or a request the route refuses, is `success: false` with an `error`.
 */
export const pushSendNotification: NodeHandlerGenerator = {
  nodeType: WebPush.SEND_NODE_TYPE,
  executionEnv: 'server',
  generateHandler(): string {
    return `async function push_send_notification(config, context) {
  var failure = function (message) {
    return { success: false, sent: 0, failed: 0, removed: 0, complete: false, error: message };
  };
  var env = globalThis.process && globalThis.process.env;
  var privateKey = env ? String(env[${JSON.stringify(WebPush.PRIVATE_KEY_ENV)}] || '').trim() : '';
  if (!privateKey || privateKey.indexOf('teleporthq.secrets.') === 0) {
    return failure(${JSON.stringify(WebPush.NOT_CONFIGURED_MESSAGE)});
  }

  var __nodeRequire = typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require;
  var token = __nodeRequire('crypto')
    .createHmac('sha256', privateKey)
    .update(${JSON.stringify(WebPush.SEND_TOKEN_PURPOSE)})
    .digest('hex');
  var headers = Object.assign({ 'Content-Type': 'application/json' }, (context && context.__internalHeaders) || {});
  headers[${JSON.stringify(WebPush.SEND_TOKEN_HEADER)}] = token;
  var flag = function (value) {
    return value === true || value === 'true';
  };
  var request = {
    audience: config.audience || 'all',
    userId: config.userId,
    endpoint: config.endpoint,
    ttl: config.ttl,
    urgency: config.urgency,
    notification: {
      title: config.title,
      body: config.body,
      url: config.url,
      icon: config.icon,
      image: config.image,
      tag: config.tag,
      requireInteraction: flag(config.requireInteraction),
      silent: flag(config.silent),
    },
  };

  try {
    var response = await fetch(((context && context.__baseUrl) || '') + ${JSON.stringify(
      WebPush.SEND_ROUTE
    )}, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(request),
    });
    var data = await response.json().catch(function () {
      return null;
    });
    if (!response.ok || !data || data.success !== true) {
      return failure((data && data.error) || 'The push notification could not be sent (HTTP ' + response.status + ').');
    }
    return {
      success: true,
      sent: data.sent || 0,
      failed: data.failed || 0,
      removed: data.removed || 0,
      complete: data.complete !== false,
    };
  } catch (error) {
    return failure((error && error.message) || 'The push notification could not be sent.');
  }
}`
  },
}
