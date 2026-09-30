import {
  buildRetiringWorkerSource,
  buildServiceWorkerSource,
  ServiceWorkerConfig,
} from '../src/pwa/service-worker-source'
import {
  createWorkerScope,
  fakeRequest,
  fakeResponse,
  FakeResponse,
  ORIGIN,
  WorkerResponse,
  WorkerScope,
} from './_helpers/fake-service-worker-scope'

const VERSION = 'v1'
const PAGES = `tq-pwa-${VERSION}-pages`
const STATIC = `tq-pwa-${VERSION}-static`
const ASSETS = `tq-pwa-${VERSION}-assets`

const OFFLINE_PAGES = {
  en: '<html lang="en">You are offline</html>',
  es: '<html lang="es">Sin conexión</html>',
}

const appConfig = (overrides: Partial<ServiceWorkerConfig> = {}): ServiceWorkerConfig => ({
  version: VERSION,
  mode: 'app',
  appName: 'Northwind',
  cacheContent: true,
  precacheUrls: ['/', '/es'],
  networkOnly: ['/admin', '/api', '/checkout', '/orders'],
  defaultLocale: 'en',
  prefixedLocales: ['es'],
  defaultLocalePrefix: 'en',
  notificationIcon: '/pwa/icon-192.png',
  push: null,
  ...overrides,
})

const startWorker = (overrides: Partial<ServiceWorkerConfig> = {}): WorkerScope =>
  createWorkerScope(buildServiceWorkerSource(appConfig(overrides), OFFLINE_PAGES))

const HOME_HTML =
  '<html><head><script src="/_next/static/chunks/main-1a.js" defer></script>' +
  '<link rel="stylesheet" href="/_next/static/css/app-2b.css"></head><body>Home</body></html>'

const page = (body: string, headers: Record<string, string> = {}): FakeResponse =>
  fakeResponse(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers } })

const navigation = (path: string) =>
  fakeRequest(path, { mode: 'navigate', destination: 'document' })

const servedAt = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60 * 1000).toUTCString()

/** A network that answers only when the test says so. */
const pendingNetwork = () => {
  let answer: (response: FakeResponse) => void = () => undefined
  const response = new Promise<FakeResponse>((resolve) => {
    answer = resolve
  })
  return { network: () => response, answer: (value: FakeResponse) => answer(value) }
}

/** Lets the worker reach its next await before the test acts. */
const settle = () => new Promise((resolve) => setImmediate(resolve))

const cachedUrls = async (scope: WorkerScope, cacheName: string) =>
  Array.from((await scope.caches.open(cacheName)).entries.keys()).map((url) =>
    url.replace(ORIGIN, '')
  )

describe('generated service worker — install and activate', () => {
  it('precaches every start URL and the build files they reference, then takes over', async () => {
    const scope = startWorker()
    scope.network = (url) => {
      if (url === `${ORIGIN}/` || url === `${ORIGIN}/es`) {
        return page(HOME_HTML)
      }
      return fakeResponse('asset', { headers: { 'Content-Type': 'application/javascript' } })
    }

    await scope.dispatch('install', {})

    expect(await cachedUrls(scope, PAGES)).toEqual(['/', '/es'])
    expect((await cachedUrls(scope, STATIC)).sort()).toEqual([
      '/_next/static/chunks/main-1a.js',
      '/_next/static/css/app-2b.css',
    ])
    expect(scope.skipWaitingCalls).toBe(1)
  })

  it('survives a start URL that cannot be fetched', async () => {
    const scope = startWorker()
    await scope.dispatch('install', {})
    expect(await cachedUrls(scope, PAGES)).toEqual([])
    expect(scope.skipWaitingCalls).toBe(1)
  })

  it('waits for the visitor when an earlier version already served pages from its cache', async () => {
    const scope = startWorker({ precacheUrls: [] })
    await scope.caches.open('tq-pwa-v0-pages')
    await scope.dispatch('install', {})
    expect(scope.skipWaitingCalls).toBe(0)

    await scope.dispatch('message', { data: { type: 'TQ_SW_ACTIVATE_UPDATE' } })
    expect(scope.skipWaitingCalls).toBe(1)
  })

  it('never caches ahead of a password-protected site', async () => {
    const scope = startWorker({ cacheContent: false })
    scope.network = () => page(HOME_HTML)
    await scope.dispatch('install', {})
    expect(scope.requests).toEqual([])
    expect(scope.skipWaitingCalls).toBe(1)
  })

  it('deletes every cache of another version, keeps the rest, and claims the open pages', async () => {
    const scope = startWorker()
    await Promise.all(
      ['tq-pwa-v0-pages', 'tq-pwa-v0-static', PAGES, 'someone-elses-cache'].map((name) =>
        scope.caches.open(name)
      )
    )
    await scope.dispatch('activate', {})
    expect((await scope.caches.keys()).sort()).toEqual(['someone-elses-cache', PAGES])
    expect(scope.claimCalls).toBe(1)
  })

  it('tells a page which version it was built for, so a current page never asks to refresh', async () => {
    const scope = startWorker()
    const answers: unknown[] = []
    await scope.dispatch('message', {
      data: { type: 'TQ_SW_VERSION' },
      ports: [{ postMessage: (message: unknown) => answers.push(message) }],
    })
    expect(answers).toEqual([{ version: VERSION }])
    expect(scope.skipWaitingCalls).toBe(0)
  })

  it('lets the browser start loading a page while the worker wakes up', async () => {
    const app = startWorker()
    await app.dispatch('activate', {})
    expect(app.navigationPreload).toBe(true)

    const notify = startWorker({ mode: 'notify', cacheContent: false, precacheUrls: [] })
    await notify.dispatch('activate', {})
    expect(notify.navigationPreload).toBe(false)
  })
})

describe('generated service worker — fetch', () => {
  it('loads a public page from the network — current prices, never an old copy — and keeps it for offline', async () => {
    const scope = startWorker()
    await (await scope.caches.open(PAGES)).put('/menu', page('old menu', { Date: servedAt(1) }))
    scope.network = () => page('new menu')

    const response = await scope.fetchEvent(navigation('/menu'))

    expect(response?.body).toBe('new menu')
    expect((await (await scope.caches.open(PAGES)).match('/menu'))?.body).toBe('new menu')
  })

  it('uses the page the browser preloaded while the worker woke up', async () => {
    const scope = startWorker()
    const response = await scope.fetchEvent(navigation('/menu'), {
      preloadResponse: Promise.resolve(page('preloaded menu')),
    })
    expect(response?.body).toBe('preloaded menu')
    expect(scope.requests).toEqual([])
    expect(await cachedUrls(scope, PAGES)).toEqual(['/menu'])
  })

  it('lets a recent copy stand in for a slow network, and does not store the late answer', async () => {
    const scope = startWorker()
    await (await scope.caches.open(PAGES)).put('/menu', page('recent menu', { Date: servedAt(5) }))
    const slow = pendingNetwork()
    scope.network = slow.network

    const answered = scope.fetchEvent(navigation('/menu'))
    await settle()
    scope.runTimers()
    await settle()
    slow.answer(page('late menu'))

    expect((await answered)?.body).toBe('recent menu')
    expect((await (await scope.caches.open(PAGES)).match('/menu'))?.body).toBe('recent menu')
  })

  it('waits for a slow network rather than show an old copy', async () => {
    const scope = startWorker()
    await (
      await scope.caches.open(PAGES)
    ).put('/menu', page('menu from last month', { Date: servedAt(60 * 24 * 30) }))
    const slow = pendingNetwork()
    scope.network = slow.network

    const answered = scope.fetchEvent(navigation('/menu'))
    await settle()
    scope.runTimers()
    await settle()
    slow.answer(page('current menu'))

    expect((await answered)?.body).toBe('current menu')
  })

  it('shows the cached copy, however old, when offline', async () => {
    const scope = startWorker()
    await (
      await scope.caches.open(PAGES)
    ).put('/menu', page('menu from last month', { Date: servedAt(60 * 24 * 30) }))
    expect((await scope.fetchEvent(navigation('/menu')))?.body).toBe('menu from last month')
  })

  it('fetches and caches a public page it has never seen', async () => {
    const scope = startWorker()
    scope.network = () => page('about')
    expect((await scope.fetchEvent(navigation('/about')))?.body).toBe('about')
    expect(await cachedUrls(scope, PAGES)).toEqual(['/about'])
  })

  it('shows the offline page in the language of the address when the page cannot be fetched', async () => {
    const scope = startWorker()
    const english = (await scope.fetchEvent(navigation('/about'))) as unknown as WorkerResponse
    const spanish = (await scope.fetchEvent(navigation('/es/about'))) as unknown as WorkerResponse

    expect(english.status).toBe(200)
    expect(english.headers.get('Cache-Control')).toBe('no-store')
    expect(await english.text()).toContain('You are offline')
    expect(await spanish.text()).toContain('Sin conexión')
  })

  it.each([
    '/checkout',
    '/checkout/',
    '/CHECKOUT/step-2',
    '/es/checkout',
    '/en/checkout',
    '/orders/ORD-1',
    '/admin',
  ])('never answers %s from the cache, and never stores it', async (path) => {
    const scope = startWorker()
    await (await scope.caches.open(PAGES)).put(path, page('stale private page'))
    scope.network = () => page('fresh private page')

    const response = await scope.fetchEvent(navigation(path))

    expect(response?.body).toBe('fresh private page')
    expect((await (await scope.caches.open(PAGES)).match(path))?.body).toBe('stale private page')
  })

  it('shows the offline page for a private page that cannot be fetched — checkout refuses offline', async () => {
    const scope = startWorker()
    const response = (await scope.fetchEvent(navigation('/checkout'))) as unknown as WorkerResponse
    expect(await response.text()).toContain('You are offline')
  })

  it('does not treat a page that merely starts like a private one as private', async () => {
    const scope = startWorker()
    scope.network = () => page('checkout guide')
    await scope.fetchEvent(navigation('/checkout-guide'))
    expect(await cachedUrls(scope, PAGES)).toEqual(['/checkout-guide'])
  })

  it('leaves API calls, other methods and other origins to the browser', async () => {
    const scope = startWorker()
    expect(await scope.fetchEvent(fakeRequest('/api/workflows/x'))).toBeUndefined()
    expect(
      await scope.fetchEvent(fakeRequest('/menu', { method: 'POST', mode: 'navigate' }))
    ).toBeUndefined()
    expect(
      await scope.fetchEvent(fakeRequest('https://cdn.example.com/a.png', { destination: 'image' }))
    ).toBeUndefined()
    expect(scope.requests).toEqual([])
  })

  it('never stores a private, redirected or non-HTML answer — and drops the stale copy', async () => {
    const cases: FakeResponse[] = [
      page('mine', { 'Cache-Control': 'private, no-cache, no-store, max-age=0, must-revalidate' }),
      fakeResponse('', { type: 'opaqueredirect', status: 0 }),
      fakeResponse('{}', { headers: { 'Content-Type': 'application/json' } }),
      fakeResponse('gone', { status: 404 }),
    ]

    for (const answer of cases) {
      const scope = startWorker()
      await (await scope.caches.open(PAGES)).put('/profile-card', page('cached copy'))
      scope.network = () => answer
      await scope.fetchEvent(navigation('/profile-card'))
      const kept = await (await scope.caches.open(PAGES)).match('/profile-card')
      if (
        answer.type === 'basic' &&
        answer.status === 200 &&
        answer.headers.get('Content-Type')?.includes('json')
      ) {
        // A 200 that is not a page is simply not stored; the page copy stays.
        expect(kept?.body).toBe('cached copy')
      } else {
        expect(kept).toBeUndefined()
      }
    }
  })

  it('shows and keeps the last good copy when the server errors', async () => {
    const scope = startWorker()
    await (await scope.caches.open(PAGES)).put('/menu', page('good copy'))
    scope.network = () => fakeResponse('boom', { status: 503 })
    expect((await scope.fetchEvent(navigation('/menu')))?.body).toBe('good copy')
    expect((await (await scope.caches.open(PAGES)).match('/menu'))?.body).toBe('good copy')
  })

  it('removes everything it stored once the site asks for a password', async () => {
    const scope = startWorker()
    await (await scope.caches.open(PAGES)).put('/menu', page('menu'))
    await (await scope.caches.open(STATIC)).put('/_next/static/chunks/a.js', fakeResponse('chunk'))
    scope.network = () => fakeResponse('Password required', { status: 401 })

    await scope.fetchEvent(navigation('/about'))

    expect((await scope.caches.keys()).filter((key) => key.startsWith('tq-pwa-'))).toEqual([])
  })

  it('serves build files cache-first', async () => {
    const scope = startWorker()
    scope.network = () =>
      fakeResponse('chunk', { headers: { 'Content-Type': 'application/javascript' } })
    const first = await scope.fetchEvent(
      fakeRequest('/_next/static/chunks/a.js', { destination: 'script' })
    )
    scope.network = () => {
      throw new TypeError('offline')
    }
    const second = await scope.fetchEvent(
      fakeRequest('/_next/static/chunks/a.js', { destination: 'script' })
    )
    expect(first?.body).toBe('chunk')
    expect(second?.body).toBe('chunk')
  })

  it('keeps the image cache bounded', async () => {
    const scope = startWorker()
    scope.network = () => fakeResponse('png', { headers: { 'Content-Type': 'image/png' } })
    for (let index = 0; index < 82; index++) {
      await scope.fetchEvent(fakeRequest(`/pictures/${index}.png`, { destination: 'image' }))
    }
    const cached = await cachedUrls(scope, ASSETS)
    expect(cached).toHaveLength(80)
    expect(cached[0]).toBe('/pictures/2.png')
  })

  it('touches no page at all for a password-protected site, but still shows the offline page', async () => {
    const scope = startWorker({ cacheContent: false })
    scope.network = () => page('secret menu')
    expect((await scope.fetchEvent(navigation('/menu')))?.body).toBe('secret menu')
    expect(await cachedUrls(scope, PAGES)).toEqual([])
    expect(
      await scope.fetchEvent(fakeRequest('/pictures/1.png', { destination: 'image' }))
    ).toBeUndefined()
  })
})

describe('generated service worker — page data', () => {
  const MENU_PROPS = { pageProps: { dishes: ['Soup'] }, __N_SSG: true }

  /** A page as Next.js renders it: its props in the __NEXT_DATA__ script. */
  const nextPage = (props: Record<string, unknown>) =>
    page(
      '<html><body><div id="__next">Menu</div>' +
        '<script id="__NEXT_DATA__" type="application/json">' +
        JSON.stringify({ props, page: '/menu', buildId: 'build' }) +
        '</script></body></html>'
    )

  const data = (path: string) => fakeRequest(`/_next/data/build${path}`, { mode: 'cors' })

  const json = async (response: FakeResponse | undefined) =>
    JSON.parse((await response?.text()) ?? 'null')

  it('fetches a page’s data from the network, and stores none of it', async () => {
    const scope = startWorker()
    scope.network = () =>
      fakeResponse('{"pageProps":{"dishes":["Stew"]}}', {
        headers: { 'Content-Type': 'application/json' },
      })

    expect(await json(await scope.fetchEvent(data('/menu.json')))).toEqual({
      pageProps: { dishes: ['Stew'] },
    })
    expect(scope.caches.stores.size).toBe(0)
  })

  it('offline, reads the data from the cached page, so the page hydrates instead of reloading', async () => {
    const scope = startWorker()
    await (await scope.caches.open(PAGES)).put('/menu?utm_source=mail', nextPage(MENU_PROPS))

    const response = await scope.fetchEvent(data('/menu.json?lang=en'))

    expect(response?.headers.get('Content-Type')).toContain('application/json')
    expect(await json(response)).toEqual(MENU_PROPS)
  })

  it('finds the home page, whichever way its data is asked for', async () => {
    const scope = startWorker()
    const pages = await scope.caches.open(PAGES)
    await pages.put('/', nextPage({ pageProps: { home: true } }))
    await pages.put('/es', nextPage({ pageProps: { home: 'es' } }))

    expect(await json(await scope.fetchEvent(data('/index.json')))).toEqual({
      pageProps: { home: true },
    })
    expect(await json(await scope.fetchEvent(data('/en.json')))).toEqual({
      pageProps: { home: true },
    })
    expect(await json(await scope.fetchEvent(data('/es.json')))).toEqual({
      pageProps: { home: 'es' },
    })
  })

  it('stands in for a server error with the cached page’s data, and passes other answers on', async () => {
    const scope = startWorker()
    await (await scope.caches.open(PAGES)).put('/menu', nextPage(MENU_PROPS))

    scope.network = () => fakeResponse('down', { status: 503 })
    expect(await json(await scope.fetchEvent(data('/menu.json')))).toEqual(MENU_PROPS)

    scope.network = () => fakeResponse('{"notFound":true}', { status: 404 })
    expect((await scope.fetchEvent(data('/menu.json')))?.status).toBe(404)
  })

  it('fails like the network when the page was never cached, or carries no data', async () => {
    const scope = startWorker()
    await expect(scope.fetchEvent(data('/specials.json'))).rejects.toThrow('Failed to fetch')

    await (await scope.caches.open(PAGES)).put('/plain', page('<html>No data</html>'))
    await expect(scope.fetchEvent(data('/plain.json'))).rejects.toThrow('Failed to fetch')

    scope.network = () => fakeResponse('down', { status: 500 })
    expect((await scope.fetchEvent(data('/specials.json')))?.status).toBe(500)
  })

  it('leaves the data of private pages to the network, in any language', async () => {
    const scope = startWorker()
    await (await scope.caches.open(PAGES)).put('/checkout', nextPage(MENU_PROPS))

    expect(await scope.fetchEvent(data('/checkout.json'))).toBeUndefined()
    expect(await scope.fetchEvent(data('/es/orders/42.json?id=42'))).toBeUndefined()
    expect(await scope.fetchEvent(data('/en/admin.json'))).toBeUndefined()
    expect(scope.requests).toEqual([])
  })

  it('leaves page data alone on a password-protected site', async () => {
    const scope = startWorker({ cacheContent: false })
    expect(await scope.fetchEvent(data('/menu.json'))).toBeUndefined()
    expect(scope.requests).toEqual([])
  })
})

describe('generated service worker — notifications', () => {
  const pushEvent = (payload: unknown) => ({
    data: {
      json: () => (typeof payload === 'string' ? JSON.parse(payload) : payload),
      text: () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    },
  })

  it('shows every push, with only safe links and images', async () => {
    const scope = startWorker()
    await scope.dispatch(
      'push',
      pushEvent({
        title: 'Order shipped',
        body: 'Your coffee is on its way',
        url: '/orders/ORD-1',
        image: 'https://images.example.com/box.png',
        icon: 'data:image/png;base64,AAAA',
        tag: 'order-ORD-1',
      })
    )
    await scope.dispatch('push', pushEvent({ body: 'No title', url: 'javascript:alert(1)' }))

    expect(scope.shownNotifications[0]).toEqual({
      title: 'Order shipped',
      options: {
        body: 'Your coffee is on its way',
        data: { url: '/orders/ORD-1' },
        icon: '/pwa/icon-192.png',
        image: 'https://images.example.com/box.png',
        tag: 'order-ORD-1',
        renotify: true,
      },
    })
    expect(scope.shownNotifications[1]).toEqual({
      title: 'Northwind',
      options: { body: 'No title', data: { url: '/' }, icon: '/pwa/icon-192.png' },
    })
  })

  it('shows a push whose payload is plain text', async () => {
    const scope = startWorker()
    await scope.dispatch('push', {
      data: {
        json: () => {
          throw new SyntaxError('not json')
        },
        text: () => 'Flash sale today',
      },
    })
    expect(scope.shownNotifications[0].options.body).toBe('Flash sale today')
  })

  it('focuses the tab already on the notification’s page, or opens it', async () => {
    const scope = startWorker()
    scope.windowClients = [{ url: `${ORIGIN}/orders/ORD-1` }]
    const click = (url: string) => ({ notification: { close: () => undefined, data: { url } } })

    await scope.dispatch('notificationclick', click('/orders/ORD-1'))
    await scope.dispatch('notificationclick', click('/menu'))

    expect(scope.focusedWindows).toEqual([`${ORIGIN}/orders/ORD-1`])
    expect(scope.openedWindows).toEqual([`${ORIGIN}/menu`])
  })

  it('re-subscribes with the same key when the push service replaces the subscription', async () => {
    const scope = startWorker({
      push: { vapidPublicKey: 'BAAA', subscriptionsPath: '/api/push/subscriptions' },
    })
    scope.network = () => fakeResponse('{}', { headers: { 'Content-Type': 'application/json' } })

    await scope.dispatch('pushsubscriptionchange', {
      oldSubscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/old',
        toJSON: () => ({
          endpoint: 'https://fcm.googleapis.com/fcm/send/old',
          keys: { auth: 'old-secret' },
        }),
      },
    })

    expect(Array.from(scope.subscribeCalls[0].applicationServerKey as Uint8Array)).toEqual([
      4, 0, 0,
    ])
    expect(scope.requests[0].url).toBe(`${ORIGIN}/api/push/subscriptions`)
    expect(JSON.parse(scope.requests[0].init?.body as string)).toEqual({
      subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/new' },
      previousEndpoint: 'https://fcm.googleapis.com/fcm/send/old',
      previousAuth: 'old-secret',
      applicationServerKey: 'BAAA',
    })
  })

  it('in notifications-only mode takes over at once and leaves the network alone', async () => {
    const scope = startWorker({ mode: 'notify', cacheContent: false, precacheUrls: [] })
    await scope.dispatch('install', {})
    expect(scope.skipWaitingCalls).toBe(1)
    expect(scope.listeners.fetch).toBeUndefined()
    expect(scope.listeners.pushsubscriptionchange).toBeUndefined()
  })
})

describe('retiring worker', () => {
  it('takes over, deletes the app caches and unregisters, without touching other caches', async () => {
    const scope = createWorkerScope(buildRetiringWorkerSource())
    await Promise.all([PAGES, STATIC, 'someone-elses-cache'].map((name) => scope.caches.open(name)))

    await scope.dispatch('install', {})
    await scope.dispatch('activate', {})

    expect(scope.skipWaitingCalls).toBe(1)
    expect(await scope.caches.keys()).toEqual(['someone-elses-cache'])
    expect(scope.unregisterCalls).toBe(1)
    expect(scope.listeners.fetch).toBeUndefined()
  })
})
