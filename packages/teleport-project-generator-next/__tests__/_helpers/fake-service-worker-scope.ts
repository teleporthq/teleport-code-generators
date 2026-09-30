import vm from 'vm'

/**
 * Just enough of a service worker global scope to run the generated `sw.js`
 * for real: event listeners, CacheStorage, clients, the registration and a
 * scriptable network. Responses are plain objects so a test can give them the
 * `type` ('basic', 'opaqueredirect') a browser would.
 */

export const ORIGIN = 'https://shop.test'

/** Case-insensitive header bag — the jest environment has no fetch globals. */
export class FakeHeaders {
  private values = new Map<string, string>()

  constructor(init: Record<string, string> = {}) {
    Object.entries(init).forEach(([name, value]) => this.values.set(name.toLowerCase(), value))
  }

  get(name: string): string | null {
    return this.values.get(name.toLowerCase()) ?? null
  }
}

/** What the worker constructs itself (the offline page). */
export class WorkerResponse {
  status: number
  headers: FakeHeaders
  private body: string

  constructor(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
    this.body = body
    this.status = init.status ?? 200
    this.headers = new FakeHeaders(init.headers)
  }

  async text(): Promise<string> {
    return this.body
  }
}

export interface FakeResponse {
  status: number
  type: string
  redirected: boolean
  headers: FakeHeaders
  body: string
  clone(): FakeResponse
  text(): Promise<string>
}

export const fakeResponse = (
  body: string,
  init: {
    status?: number
    type?: string
    redirected?: boolean
    headers?: Record<string, string>
  } = {}
): FakeResponse => {
  const response: FakeResponse = {
    status: init.status ?? 200,
    type: init.type ?? 'basic',
    redirected: init.redirected ?? false,
    headers: new FakeHeaders(init.headers ?? { 'Content-Type': 'text/html; charset=utf-8' }),
    body,
    clone: () => fakeResponse(body, init),
    text: async () => body,
  }
  return response
}

export interface FakeRequest {
  url: string
  method: string
  mode: string
  destination: string
  cache: string
}

export const fakeRequest = (
  path: string,
  init: Partial<Omit<FakeRequest, 'url'>> = {}
): FakeRequest => ({
  url: new URL(path, ORIGIN).href,
  method: init.method ?? 'GET',
  mode: init.mode ?? 'no-cors',
  destination: init.destination ?? '',
  cache: init.cache ?? 'default',
})

const keyOf = (request: string | FakeRequest): string =>
  new URL(typeof request === 'string' ? request : request.url, ORIGIN).href

export class FakeCache {
  entries = new Map<string, FakeResponse>()

  async match(
    request: string | FakeRequest,
    options: { ignoreSearch?: boolean } = {}
  ): Promise<FakeResponse | undefined> {
    const key = keyOf(request)
    if (!options.ignoreSearch) {
      return this.entries.get(key)
    }
    const withoutSearch = (url: string) => url.split('?')[0]
    const match = Array.from(this.entries.keys()).find(
      (stored) => withoutSearch(stored) === withoutSearch(key)
    )
    return match ? this.entries.get(match) : undefined
  }

  async put(request: string | FakeRequest, response: FakeResponse): Promise<void> {
    const key = keyOf(request)
    this.entries.delete(key)
    this.entries.set(key, response)
  }

  async delete(request: string | FakeRequest): Promise<boolean> {
    return this.entries.delete(keyOf(request))
  }

  async keys(): Promise<Array<{ url: string }>> {
    return Array.from(this.entries.keys()).map((url) => ({ url }))
  }
}

export class FakeCacheStorage {
  stores = new Map<string, FakeCache>()

  async open(name: string): Promise<FakeCache> {
    if (!this.stores.has(name)) {
      this.stores.set(name, new FakeCache())
    }
    return this.stores.get(name) as FakeCache
  }

  async keys(): Promise<string[]> {
    return Array.from(this.stores.keys())
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name)
  }
}

type Listener = (event: Record<string, unknown>) => void
type NetworkHandler = (
  url: string,
  init?: Record<string, unknown>
) => FakeResponse | Promise<FakeResponse>

export interface WorkerScope {
  caches: FakeCacheStorage
  skipWaitingCalls: number
  claimCalls: number
  unregisterCalls: number
  /** The registration's navigation-preload state, as the worker last set it. */
  navigationPreload: boolean | null
  shownNotifications: Array<{ title: string; options: Record<string, unknown> }>
  openedWindows: string[]
  focusedWindows: string[]
  windowClients: Array<{ url: string }>
  requests: Array<{ url: string; init?: Record<string, unknown> }>
  subscribeCalls: Array<Record<string, unknown>>
  network: NetworkHandler
  listeners: Record<string, Listener[]>
  /** Timers the worker set; they only fire when a test calls `runTimers`. */
  timers: Array<() => void>
  runTimers(): void
  dispatch(type: string, event: Record<string, unknown>): Promise<unknown>
  fetchEvent(
    request: FakeRequest,
    extra?: { preloadResponse?: Promise<FakeResponse | undefined> }
  ): Promise<FakeResponse | undefined>
}

export const createWorkerScope = (source: string): WorkerScope => {
  const scope: WorkerScope = {
    caches: new FakeCacheStorage(),
    skipWaitingCalls: 0,
    claimCalls: 0,
    unregisterCalls: 0,
    navigationPreload: null,
    shownNotifications: [],
    openedWindows: [],
    focusedWindows: [],
    windowClients: [],
    requests: [],
    subscribeCalls: [],
    network: () => {
      throw new TypeError('Failed to fetch')
    },
    listeners: {},
    timers: [],

    runTimers() {
      const due = scope.timers.splice(0)
      due.forEach((callback) => callback())
    },

    async dispatch(type, event) {
      const pending: Array<Promise<unknown>> = []
      let responded: Promise<unknown> | undefined
      const fullEvent = {
        ...event,
        waitUntil: (promise: Promise<unknown>) => pending.push(promise),
        respondWith: (promise: Promise<unknown>) => {
          responded = Promise.resolve(promise)
        },
      }
      ;(scope.listeners[type] || []).forEach((listener) => listener(fullEvent))
      const response = responded ? await responded : undefined
      // Background work registered while answering (revalidation) settles too.
      let settled = 0
      while (settled < pending.length) {
        const batch = pending.slice(settled)
        settled = pending.length
        await Promise.all(batch)
      }
      return response
    },

    fetchEvent(request, extra = {}) {
      return scope.dispatch('fetch', { request, ...extra }) as Promise<FakeResponse | undefined>
    },
  }

  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => {
      scope.listeners[type] = [...(scope.listeners[type] || []), listener]
    },
    skipWaiting: async () => {
      scope.skipWaitingCalls += 1
    },
    clients: {
      claim: async () => {
        scope.claimCalls += 1
      },
      matchAll: async () =>
        scope.windowClients.map((client) => ({
          url: client.url,
          focus: async () => {
            scope.focusedWindows.push(client.url)
          },
        })),
      openWindow: async (url: string) => {
        scope.openedWindows.push(url)
      },
    },
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        scope.shownNotifications.push({ title, options })
      },
      unregister: async () => {
        scope.unregisterCalls += 1
        return true
      },
      navigationPreload: {
        enable: async () => {
          scope.navigationPreload = true
        },
        disable: async () => {
          scope.navigationPreload = false
        },
      },
      pushManager: {
        subscribe: async (options: Record<string, unknown>) => {
          scope.subscribeCalls.push(options)
          return { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/new' }) }
        },
      },
    },
  }

  const context = vm.createContext({
    self,
    caches: scope.caches,
    fetch: async (input: string | FakeRequest, init?: Record<string, unknown>) => {
      const url = keyOf(input)
      scope.requests.push({ url, init })
      return scope.network(url, init)
    },
    Response: WorkerResponse,
    URL,
    setTimeout: (callback: () => void) => {
      scope.timers.push(callback)
      return scope.timers.length
    },
    atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
    Uint8Array,
    Promise,
    JSON,
    console,
  })
  vm.runInContext(source, context)
  return scope
}
