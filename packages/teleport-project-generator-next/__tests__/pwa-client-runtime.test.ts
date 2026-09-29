import { buildClientRuntimeSource, ClientRuntimeConfig } from '../src/pwa/client-runtime-source'
import { resolvePwaMessagesForLocales } from '../src/pwa/messages'
import { findRulesOfHooksViolations } from './_helpers/rules-of-hooks'
import { fakeBrowser, fakeSubscription, loadClientRuntime } from './_helpers/load-client-runtime'
import { findElements, iPhone, renderClientRuntime } from './_helpers/render-client-runtime'

// 'BAAA' decodes to [4, 0, 0] — short, but the runtime only compares bytes.
const PUBLIC_KEY = 'BAAA'
const KEY_BYTES = [4, 0, 0]

const config = (overrides: Partial<ClientRuntimeConfig> = {}): ClientRuntimeConfig => ({
  mode: 'app',
  version: 'v1',
  appName: 'Northwind Coffee Roasters',
  shortName: 'Northwind',
  defaultLocale: 'en',
  prefixedLocales: ['es'],
  defaultLocalePrefix: 'en',
  manifests: { en: '/manifest.json', es: '/manifest-es.json' },
  themeColor: '#0f766e',
  appleTouchIcon: '/pwa/apple-touch-icon.png',
  bannerIcon: '/pwa/icon-192.png',
  launchScreen: { backgroundColor: '#fdf6ec', icon: '/pwa/icon-maskable-512.png' },
  installBanner: true,
  networkOnly: ['/api', '/checkout'],
  push: { vapidPublicKey: PUBLIC_KEY, subscriptionsPath: '/api/push/subscriptions' },
  ...overrides,
})

const source = (overrides: Partial<ClientRuntimeConfig> = {}) =>
  buildClientRuntimeSource({
    config: config(overrides),
    messages: resolvePwaMessagesForLocales(['en', 'es']),
    styles: '.tq-pwa-toast{}',
  })

describe('generated service-worker runtime — the component', () => {
  it.each([
    ['app', source()],
    ['notify', source({ mode: 'notify', manifests: {}, push: null })],
  ])('keeps the Rules of Hooks in %s mode', (_mode, code) => {
    expect(findRulesOfHooksViolations(code)).toEqual([])
  })

  it('puts the app name into the banner title literally, whatever characters it has', () => {
    expect(source()).toContain(".split('{app}').join(CONFIG.shortName)")
  })

  it('renders the manifest link with credentials, so a password-protected site stays installable', () => {
    expect(source()).toContain('crossOrigin="use-credentials"')
    expect(source()).toContain('rel="apple-touch-icon"')
    expect(source()).toContain('name="theme-color"')
  })
})

describe('generated service-worker runtime — push subscription', () => {
  it('asks for permission, subscribes with the project key and saves the subscription', async () => {
    const browser = fakeBrowser()
    const api = loadClientRuntime(source(), browser)

    const result = await api.push!.subscribe()

    expect(result).toEqual({
      success: true,
      subscribed: true,
      permission: 'granted',
      endpoint: 'https://fcm.googleapis.com/fcm/send/fresh',
      expirationTime: null,
      keys: { p256dh: 'P256', auth: 'AUTH' },
    })
    expect(browser.registrations).toEqual([
      { url: '/sw.js', options: { scope: '/', updateViaCache: 'none' } },
    ])
    expect(Array.from(browser.subscribeCalls[0].applicationServerKey)).toEqual(KEY_BYTES)
    expect(browser.requests[0].url).toBe('/api/push/subscriptions')
    expect(browser.requests[0].init.method).toBe('POST')
    expect(JSON.parse(browser.requests[0].init.body as string)).toEqual({
      subscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/fresh',
        expirationTime: null,
        keys: { p256dh: 'P256', auth: 'AUTH' },
      },
      previousEndpoint: null,
      previousAuth: null,
      applicationServerKey: PUBLIC_KEY,
    })
  })

  it('remembers who the saved subscription belongs to, so a sign-in re-saves it', async () => {
    const browser = fakeBrowser({
      authSession: {
        status: 'authenticated',
        session: { user: { id: 'google-109876', email: 'a@b.test' } },
      },
    })
    const api = loadClientRuntime(source(), browser)

    await api.push!.subscribe()

    expect(JSON.parse(api.sessionStorage.getItem('tq-pwa-push-synced') as string)).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/fresh',
      user: 'google-109876',
    })
  })

  it('keeps a subscription already made with the project key', async () => {
    const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/kept', KEY_BYTES)
    const browser = fakeBrowser({ permission: 'granted', existingSubscription: existing })
    const result = await loadClientRuntime(source(), browser).push!.subscribe()

    expect(result.endpoint).toBe('https://fcm.googleapis.com/fcm/send/kept')
    expect(browser.subscribeCalls).toEqual([])
    expect(existing.unsubscribed).toBe(false)
  })

  it('replaces a subscription made with an older key and tells the server which one it replaces', async () => {
    const stale = fakeSubscription('https://fcm.googleapis.com/fcm/send/stale', [4, 9, 9])
    const browser = fakeBrowser({ permission: 'granted', existingSubscription: stale })
    await loadClientRuntime(source(), browser).push!.subscribe()

    expect(stale.unsubscribed).toBe(true)
    expect(browser.subscribeCalls).toHaveLength(1)
    expect(JSON.parse(browser.requests[0].init.body as string)).toMatchObject({
      previousEndpoint: 'https://fcm.googleapis.com/fcm/send/stale',
      previousAuth: 'AUTH',
    })
  })

  it('reports a refusal instead of subscribing', async () => {
    const browser = fakeBrowser({ permissionAnswer: 'denied' })
    const result = await loadClientRuntime(source(), browser).push!.subscribe()

    expect(result).toMatchObject({ success: false, subscribed: false, permission: 'denied' })
    expect(result.error).toContain('blocked')
    expect(browser.registrations).toEqual([])
  })

  it('reports what the server said when it could not save, and undoes the new subscription', async () => {
    const browser = fakeBrowser({
      fetchStatus: 503,
      fetchBody: { error: 'Push notifications are not set up for this site.' },
    })
    const result = await loadClientRuntime(source(), browser).push!.subscribe()
    expect(result).toMatchObject({
      success: false,
      subscribed: false,
      error: 'Push notifications are not set up for this site.',
    })
    expect(browser.existingSubscription?.unsubscribed).toBe(true)
  })

  it('names the HTTP status when the server gave no reason, and keeps a subscription it did not make', async () => {
    const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/kept', KEY_BYTES)
    const browser = fakeBrowser({
      permission: 'granted',
      existingSubscription: existing,
      fetchStatus: 500,
      fetchBody: null,
    })
    const result = await loadClientRuntime(source(), browser).push!.subscribe()
    expect(result.error).toContain('HTTP 500')
    expect(existing.unsubscribed).toBe(false)
  })

  it('tells an iPhone visitor to add the site to the Home Screen first', async () => {
    const browser = fakeBrowser({
      hasPushManager: false,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile/15E148 Safari/604.1',
    })
    const result = await loadClientRuntime(source(), browser).push!.subscribe()
    expect(result.success).toBe(false)
    expect(result.error).toContain('Home Screen')
  })

  it.each([
    ['in development', { nodeEnv: 'development' }],
    ['inside a frame (the editor canvas, a preview)', { inFrame: true }],
  ])('never registers the worker %s', async (_label, overrides) => {
    const browser = fakeBrowser(overrides)
    const api = loadClientRuntime(source(), browser)

    expect((await api.push!.subscribe()).success).toBe(false)
    await expect(api.register()).rejects.toThrow('not available')
    expect(browser.registrations).toEqual([])
  })

  it('unsubscribes and forgets the stored subscription', async () => {
    const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/kept', KEY_BYTES)
    const browser = fakeBrowser({ permission: 'granted', existingSubscription: existing })
    const result = await loadClientRuntime(source(), browser).push!.unsubscribe()

    expect(result).toEqual({ success: true, unsubscribed: true })
    expect(existing.unsubscribed).toBe(true)
    expect(browser.requests[0].init.method).toBe('DELETE')
    expect(JSON.parse(browser.requests[0].init.body as string)).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/kept',
      auth: 'AUTH',
    })
  })

  it('reports nothing to unsubscribe from', async () => {
    const result = await loadClientRuntime(source(), fakeBrowser()).push!.unsubscribe()
    expect(result).toEqual({ success: true, unsubscribed: false })
  })

  it('reports the subscription status without prompting', async () => {
    const existing = fakeSubscription('https://fcm.googleapis.com/fcm/send/kept', KEY_BYTES)
    const subscribed = fakeBrowser({ permission: 'granted', existingSubscription: existing })
    expect(await loadClientRuntime(source(), subscribed).push!.getSubscription()).toEqual({
      success: true,
      supported: true,
      permission: 'granted',
      subscribed: true,
      endpoint: 'https://fcm.googleapis.com/fcm/send/kept',
    })

    const fresh = fakeBrowser()
    expect(await loadClientRuntime(source(), fresh).push!.getSubscription()).toMatchObject({
      supported: true,
      permission: 'default',
      subscribed: false,
    })
    expect(fresh.permission).toBe('default')

    // Read-only: a subscription made with a replaced key is reported as none,
    // and the page's own sync replaces it.
    const stale = fakeSubscription('https://fcm.googleapis.com/fcm/send/stale', [4, 9, 9])
    const staleBrowser = fakeBrowser({ permission: 'granted', existingSubscription: stale })
    expect(await loadClientRuntime(source(), staleBrowser).push!.getSubscription()).toMatchObject({
      subscribed: false,
      endpoint: '',
    })
    expect(stale.unsubscribed).toBe(false)
    expect(staleBrowser.subscribeCalls).toEqual([])

    const unsupported = fakeBrowser({ hasPushManager: false })
    expect(await loadClientRuntime(source(), unsupported).push!.getSubscription()).toMatchObject({
      success: true,
      supported: false,
      subscribed: false,
    })
  })

  it('publishes no push API for a project without push, but still shows notifications', async () => {
    const browser = fakeBrowser({ permission: 'granted' })
    const api = loadClientRuntime(source({ push: null }), browser)

    expect(api.push).toBeNull()
    await api.showNotification('Saved', { body: 'Your list was saved' })
    expect(browser.notifications).toEqual([
      {
        title: 'Saved',
        options: { body: 'Your list was saved', data: { url: 'https://shop.test/menu' } },
      },
    ])
  })
})

describe('generated service-worker runtime — iPhone and iPad launch screens', () => {
  const launchLinks = (tree: unknown) =>
    findElements(tree, 'link').filter((link) => link.props.rel === 'apple-touch-startup-image')

  it('draws the icon on the background colour, the size of the screen both ways up, once the page settles', async () => {
    const page = renderClientRuntime(source({ push: null }), iPhone())

    expect(launchLinks(page.render())).toEqual([])
    expect(page.timers.map((timer) => timer.delay)).toContain(1500)
    await page.runTimers()

    expect(launchLinks(page.render()).map((link) => link.props)).toEqual([
      expect.objectContaining({
        media: '(orientation: portrait)',
        href: 'data:image/png;base64,1170x2532',
      }),
      expect.objectContaining({
        media: '(orientation: landscape)',
        href: 'data:image/png;base64,2532x1170',
      }),
    ])
    const [portrait] = page.canvases
    expect(portrait.operations).toContainEqual({ name: 'set fillStyle', args: ['#fdf6ec'] })
    expect(portrait.operations).toContainEqual({ name: 'fillRect', args: [0, 0, 1170, 2532] })
    expect(portrait.operations.filter((operation) => operation.name === 'arcTo')).toHaveLength(4)
    // 30% of the 390 px short side is 117 px, drawn at 3 device pixels each.
    const drawn = portrait.operations.find((operation) => operation.name === 'drawImage')
    expect(drawn?.args.slice(1)).toEqual([410, 1091, 351, 351])
  })

  it('keeps the icon within bounds on a big screen', async () => {
    const page = renderClientRuntime(
      source({ push: null }),
      iPhone({ screen: { width: 1024, height: 1366 }, devicePixelRatio: 2, platform: 'MacIntel' })
    )
    page.render()
    await page.runTimers()

    const drawn = page.canvases[0].operations.find((operation) => operation.name === 'drawImage')
    expect(drawn?.args.slice(3)).toEqual([320, 320])
  })

  it('reuses what it drew for this publish on the next page, and draws again after the next publish', async () => {
    const device = iPhone()
    const first = renderClientRuntime(source({ push: null }), device)
    first.render()
    await first.runTimers()

    const next = renderClientRuntime(source({ push: null }), device)
    next.render()
    expect(launchLinks(next.render())).toHaveLength(2)
    expect(next.canvases).toEqual([])

    const republished = renderClientRuntime(source({ push: null, version: 'v2' }), device)
    republished.render()
    expect(launchLinks(republished.render())).toEqual([])
    await republished.runTimers()
    expect(republished.canvases).toHaveLength(2)
  })

  it('draws for an iPad that asks for the desktop site', async () => {
    const page = renderClientRuntime(
      source({ push: null }),
      iPhone({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5,
        screen: { width: 820, height: 1180 },
        devicePixelRatio: 2,
      })
    )
    page.render()
    await page.runTimers()

    expect(launchLinks(page.render()).map((link) => link.props.href)).toEqual([
      'data:image/png;base64,1640x2360',
      'data:image/png;base64,2360x1640',
    ])
  })

  it('shows the background alone when the app has no icon, or the icon does not load', async () => {
    const withoutIcon = renderClientRuntime(
      source({ push: null, launchScreen: { backgroundColor: '#123456', icon: null } }),
      iPhone()
    )
    withoutIcon.render()
    await withoutIcon.runTimers()
    const missing = renderClientRuntime(source({ push: null }), iPhone({ iconMissing: true }))
    missing.render()
    await missing.runTimers()

    for (const page of [withoutIcon, missing]) {
      expect(launchLinks(page.render())).toHaveLength(2)
      expect(page.canvases[0].operations.map((operation) => operation.name)).not.toContain(
        'drawImage'
      )
    }
  })

  it('draws nothing where it is never read: other devices, an installed app, or a site without an app', async () => {
    const pages = [
      renderClientRuntime(
        source({ push: null }),
        iPhone({
          userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/128.0 Mobile Safari/537.36',
          platform: 'Linux armv8l',
        })
      ),
      renderClientRuntime(source({ push: null }), iPhone({ standalone: true })),
      renderClientRuntime(
        source({ mode: 'notify', manifests: {}, push: null, launchScreen: null }),
        iPhone()
      ),
    ]
    for (const page of pages) {
      page.render()
      await page.runTimers()
      expect(page.canvases).toEqual([])
      expect(launchLinks(page.render())).toEqual([])
    }
  })
})
