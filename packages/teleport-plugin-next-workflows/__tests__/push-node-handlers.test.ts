import crypto from 'crypto'
import { loadHandler } from './_helpers/load-handler'

/**
 * The push and notification nodes are thin adapters over the page-side API the
 * generated service-worker module publishes on `window`, plus the server node
 * that calls the app's internal send route. Every handler here runs for real.
 */

type Globals = Record<string, unknown>
const globalScope = globalThis as unknown as Globals
const GLOBAL_KEYS = ['window', 'Notification', 'fetch', '__non_webpack_require__']

let saved: Globals = {}
beforeEach(() => {
  saved = {}
  GLOBAL_KEYS.forEach((key) => {
    saved[key] = globalScope[key]
  })
})
afterEach(() => {
  GLOBAL_KEYS.forEach((key) => {
    if (saved[key] === undefined) {
      delete globalScope[key]
    } else {
      globalScope[key] = saved[key]
    }
  })
  delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY
})

const withNotification = (permission: string, answer = permission) => {
  const shown: Array<{ title: string; options: Record<string, unknown> }> = []
  const NotificationFake = function (
    this: unknown,
    title: string,
    options: Record<string, unknown>
  ) {
    shown.push({ title, options })
  } as unknown as { permission: string; requestPermission: () => Promise<string> }
  NotificationFake.permission = permission
  NotificationFake.requestPermission = async () => {
    NotificationFake.permission = answer
    return answer
  }
  globalScope.Notification = NotificationFake
  return shown
}

describe('push nodes on a site without push', () => {
  it('subscribe and unsubscribe report that push is not set up; the status is simply unsupported', async () => {
    globalScope.window = {}
    withNotification('default')

    expect(await loadHandler('browser-subscribe-to-push')({}, {})).toEqual({
      success: false,
      subscribed: false,
      permission: 'default',
      error: 'Push notifications are not set up for this site.',
    })
    expect(await loadHandler('browser-unsubscribe-from-push')({}, {})).toEqual({
      success: false,
      unsubscribed: false,
      error: 'Push notifications are not set up for this site.',
    })
    expect(await loadHandler('browser-get-push-subscription')({}, {})).toEqual({
      success: true,
      supported: false,
      permission: 'default',
      subscribed: false,
      endpoint: '',
    })
  })
})

describe('push nodes on a site with push', () => {
  it('delegate to the service-worker module', async () => {
    const calls: string[] = []
    globalScope.window = {
      __teleportServiceWorker: {
        push: {
          subscribe: async () => {
            calls.push('subscribe')
            return { success: true, subscribed: true }
          },
          unsubscribe: async () => {
            calls.push('unsubscribe')
            return { success: true, unsubscribed: true }
          },
          getSubscription: async () => {
            calls.push('status')
            return { success: true, supported: true, subscribed: true }
          },
        },
      },
    }

    expect(await loadHandler('browser-subscribe-to-push')({}, {})).toEqual({
      success: true,
      subscribed: true,
    })
    expect(await loadHandler('browser-unsubscribe-from-push')({}, {})).toEqual({
      success: true,
      unsubscribed: true,
    })
    expect(await loadHandler('browser-get-push-subscription')({}, {})).toMatchObject({
      subscribed: true,
    })
    expect(calls).toEqual(['subscribe', 'unsubscribe', 'status'])
  })
})

describe('browser-show-notification', () => {
  const config = {
    title: 'Saved',
    body: 'Your list was saved',
    tag: 'list',
    requireInteraction: 'true',
  }

  it('reports a browser without notifications', async () => {
    globalScope.window = {}
    delete globalScope.Notification
    expect(await loadHandler('browser-show-notification')(config, {})).toEqual({
      success: false,
      permission: 'default',
      error: 'This browser cannot show notifications.',
    })
  })

  it('asks for permission once, and reports a refusal', async () => {
    globalScope.window = {}
    withNotification('default', 'denied')
    expect(await loadHandler('browser-show-notification')(config, {})).toEqual({
      success: false,
      permission: 'denied',
      error: 'Notifications are blocked for this site.',
    })
  })

  it('shows the notification through the service worker when the site has one', async () => {
    const viaWorker: Array<{ title: string; options: Record<string, unknown> }> = []
    globalScope.window = {
      __teleportServiceWorker: {
        showNotification: async (title: string, options: Record<string, unknown>) => {
          viaWorker.push({ title, options })
        },
      },
    }
    const onPage = withNotification('granted')

    expect(await loadHandler('browser-show-notification')(config, {})).toEqual({
      success: true,
      permission: 'granted',
    })
    expect(viaWorker).toEqual([
      {
        title: 'Saved',
        options: { body: 'Your list was saved', tag: 'list', requireInteraction: true },
      },
    ])
    expect(onPage).toEqual([])
  })

  it('falls back to the page when the worker is unavailable, and reports a page that refuses too', async () => {
    globalScope.window = {
      __teleportServiceWorker: {
        showNotification: async () => {
          throw new Error('Service workers are not available on this page.')
        },
      },
    }
    const onPage = withNotification('granted')
    expect((await loadHandler('browser-show-notification')(config, {})).success).toBe(true)
    expect(onPage).toHaveLength(1)

    globalScope.window = {}
    globalScope.Notification = Object.assign(
      function () {
        throw new TypeError(
          'Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead.'
        )
      },
      { permission: 'granted', requestPermission: async () => 'granted' }
    )
    expect(await loadHandler('browser-show-notification')(config, {})).toEqual({
      success: false,
      permission: 'granted',
      error: 'Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead.',
    })
  })
})

describe('push-send-notification', () => {
  const PRIVATE_KEY = 'vapid-private-key'
  const context = {
    __baseUrl: 'https://shop.test',
    __internalHeaders: { cookie: 'session=abc', 'x-vercel-protection-bypass': 'bypass' },
  }
  const config = {
    title: 'Order shipped',
    body: 'On its way',
    url: '/orders/1',
    audience: 'user',
    userId: 'user-1',
    ttl: '3600',
    urgency: 'high',
    requireInteraction: 'true',
  }

  const respondWith = (status: number, body: unknown) => {
    const requests: Array<{ url: string; init: Record<string, unknown> }> = []
    globalScope.fetch = async (url: string, init: Record<string, unknown>) => {
      requests.push({ url, init })
      return { ok: status < 400, status, json: async () => body }
    }
    globalScope.__non_webpack_require__ = require
    return requests
  }

  it('refuses to run before the push keys reach the environment', async () => {
    respondWith(200, {})
    const missing = await loadHandler('push-send-notification')(config, context)
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'teleporthq.secrets.WEB_PUSH_VAPID_PRIVATE_KEY'
    const placeholder = await loadHandler('push-send-notification')(config, context)

    const failure = {
      success: false,
      sent: 0,
      failed: 0,
      removed: 0,
      complete: false,
      error: 'Push notifications are not set up for this site.',
    }
    expect(missing).toEqual(failure)
    expect(placeholder).toEqual(failure)
  })

  it('calls the internal send route with the derived token and returns its counts', async () => {
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = PRIVATE_KEY
    const requests = respondWith(200, {
      success: true,
      sent: 2,
      failed: 1,
      removed: 1,
      complete: true,
    })

    const result = await loadHandler('push-send-notification')(config, context)

    expect(result).toEqual({ success: true, sent: 2, failed: 1, removed: 1, complete: true })
    expect(requests[0].url).toBe('https://shop.test/api/push/send')
    expect(requests[0].init.headers).toEqual({
      'Content-Type': 'application/json',
      cookie: 'session=abc',
      'x-vercel-protection-bypass': 'bypass',
      'x-teleport-push-token': crypto
        .createHmac('sha256', PRIVATE_KEY)
        .update('teleport-web-push-send')
        .digest('hex'),
    })
    expect(JSON.parse(requests[0].init.body as string)).toEqual({
      audience: 'user',
      userId: 'user-1',
      ttl: '3600',
      urgency: 'high',
      notification: {
        title: 'Order shipped',
        body: 'On its way',
        url: '/orders/1',
        requireInteraction: true,
        silent: false,
      },
    })
  })

  it('reports what the route refused', async () => {
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = PRIVATE_KEY
    respondWith(400, { success: false, error: 'A push notification needs a title.' })
    expect(await loadHandler('push-send-notification')({}, context)).toMatchObject({
      success: false,
      error: 'A push notification needs a title.',
    })

    respondWith(502, null)
    expect(await loadHandler('push-send-notification')(config, context)).toMatchObject({
      success: false,
      error: 'The push notification could not be sent (HTTP 502).',
    })
  })
})
