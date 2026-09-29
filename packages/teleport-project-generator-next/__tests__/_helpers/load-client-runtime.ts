import { transformSync } from '@babel/core'

/**
 * Evaluates the generated `components/teleport-service-worker.js` the way the
 * browser would load it — module code runs, the component is not rendered —
 * inside a scriptable fake browser, and returns what it published on
 * `window.__teleportServiceWorker`.
 */

export interface FakeSubscription {
  endpoint: string
  options: { applicationServerKey: ArrayBuffer | null }
  unsubscribed: boolean
  toJSON(): Record<string, unknown>
  unsubscribe(): Promise<boolean>
}

export const fakeSubscription = (endpoint: string, keyBytes: number[] | null): FakeSubscription => {
  const subscription: FakeSubscription = {
    endpoint,
    options: { applicationServerKey: keyBytes ? new Uint8Array(keyBytes).buffer : null },
    unsubscribed: false,
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'P256', auth: 'AUTH' } }),
    unsubscribe: async () => {
      subscription.unsubscribed = true
      return true
    },
  }
  return subscription
}

export interface FakeBrowser {
  permission: string
  permissionAnswer: string
  nodeEnv: string
  inFrame: boolean
  hasPushManager: boolean
  userAgent: string
  standalone: boolean
  existingSubscription: FakeSubscription | null
  fetchStatus: number
  /** What the push route answers, as JSON. */
  fetchBody: unknown
  /** The session the app's sign-in bridge holds; no bridge when null. */
  authSession: { status: string; session: { user: Record<string, unknown> } | null } | null
  registrations: Array<{ url: string; options: Record<string, unknown> }>
  subscribeCalls: Array<{ applicationServerKey: Uint8Array }>
  requests: Array<{ url: string; init: Record<string, unknown> }>
  notifications: Array<{ title: string; options: Record<string, unknown> }>
}

export const fakeBrowser = (overrides: Partial<FakeBrowser> = {}): FakeBrowser => ({
  permission: 'default',
  permissionAnswer: 'granted',
  nodeEnv: 'production',
  inFrame: false,
  hasPushManager: true,
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/128.0 Safari/537.36',
  standalone: false,
  existingSubscription: null,
  fetchStatus: 200,
  fetchBody: { saved: true },
  authSession: null,
  registrations: [],
  subscribeCalls: [],
  requests: [],
  notifications: [],
  ...overrides,
})

export const moduleBody = (source: string): string => {
  const withoutModuleSyntax = source
    .replace(/^import .*$/gm, '')
    .replace('export default function', 'function')
  const transformed = transformSync(withoutModuleSyntax, {
    presets: ['@babel/preset-react'],
    babelrc: false,
    configFile: false,
  })
  return transformed?.code || ''
}

export const loadClientRuntime = (source: string, browser: FakeBrowser) => {
  const storage = () => {
    const values = new Map<string, string>()
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    }
  }

  const registration = {
    pushManager: {
      getSubscription: async () => browser.existingSubscription,
      subscribe: async (options: { applicationServerKey: Uint8Array }) => {
        browser.subscribeCalls.push(options)
        browser.existingSubscription = fakeSubscription(
          'https://fcm.googleapis.com/fcm/send/fresh',
          Array.from(options.applicationServerKey)
        )
        return browser.existingSubscription
      },
    },
    showNotification: async (title: string, options: Record<string, unknown>) => {
      browser.notifications.push({ title, options })
    },
  }

  const navigatorFake = {
    userAgent: browser.userAgent,
    platform: 'Linux x86_64',
    maxTouchPoints: 0,
    standalone: browser.standalone,
    serviceWorker: {
      controller: null as unknown,
      ready: Promise.resolve(registration),
      register: async (url: string, options: Record<string, unknown>) => {
        browser.registrations.push({ url, options })
        return registration
      },
    },
  }

  const topWindow = {}
  const windowFake: Record<string, unknown> = {
    isSecureContext: true,
    navigator: navigatorFake,
    location: { href: 'https://shop.test/menu' },
    atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
    localStorage: storage(),
    sessionStorage: storage(),
    matchMedia: () => ({ matches: browser.standalone }),
    setTimeout: (callback: () => void) => {
      callback()
      return 0
    },
  }
  if (browser.authSession) {
    windowFake.__teleportNextAuth = { getSession: () => browser.authSession }
  }
  windowFake.self = windowFake
  windowFake.top = browser.inFrame ? topWindow : windowFake
  if (browser.hasPushManager) {
    windowFake.PushManager = function PushManager(): undefined {
      return undefined
    }
  }

  const notificationFake = {
    get permission() {
      return browser.permission
    },
    requestPermission: async () => {
      browser.permission = browser.permissionAnswer
      return browser.permission
    },
  }

  const fetchFake = async (url: string, init: Record<string, unknown>) => {
    browser.requests.push({ url, init })
    return {
      ok: browser.fetchStatus < 400,
      status: browser.fetchStatus,
      json: async () => browser.fetchBody,
    }
  }

  const noop = (): undefined => undefined
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const evaluate = new Function(
    'window',
    'navigator',
    'Notification',
    'fetch',
    'process',
    'React',
    'useCallback',
    'useEffect',
    'useState',
    'Head',
    'useRouter',
    moduleBody(source)
  )
  evaluate(
    windowFake,
    navigatorFake,
    notificationFake,
    fetchFake,
    { env: { NODE_ENV: browser.nodeEnv } },
    { createElement: noop, Fragment: 'fragment' },
    noop,
    noop,
    noop,
    noop,
    noop
  )

  return {
    sessionStorage: windowFake.sessionStorage as { getItem(key: string): string | null },
    ...(windowFake.__teleportServiceWorker as object),
  } as {
    sessionStorage: { getItem(key: string): string | null }
    register: () => Promise<unknown>
    showNotification: (title: string, options: Record<string, unknown>) => Promise<void>
    push: null | {
      subscribe: () => Promise<Record<string, unknown>>
      unsubscribe: () => Promise<Record<string, unknown>>
      getSubscription: () => Promise<Record<string, unknown>>
    }
  }
}
