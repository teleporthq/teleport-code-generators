import { NextPwaProjectPlugin } from '../src/pwa/project-plugin'
import { toNetworkOnlyPattern } from '../src/pwa/network-only-paths'
import { computeWorkerVersion } from '../src/pwa/worker-version'
import {
  APP_SOURCE,
  NEXT_CONFIG_SOURCE,
  baseUidl,
  buildStructure,
  fileContent,
  installableApp,
  workflowsUsing,
} from './_helpers/pwa-fixtures'

const run = async (extra: Record<string, unknown>, options: { withNextConfig?: boolean } = {}) => {
  const structure = buildStructure(baseUidl(extra), options)
  await new NextPwaProjectPlugin().runAfter(structure)
  return structure
}

const workerSource = (structure: Awaited<ReturnType<typeof run>>) =>
  fileContent(structure, 'pwa-service-worker', 'sw') || ''

const workerConfig = (structure: Awaited<ReturnType<typeof run>>) => {
  const match = workerSource(structure).match(/const CONFIG = (.*);\n/)
  return match ? JSON.parse(match[1]) : null
}

const clientConfig = (structure: Awaited<ReturnType<typeof run>>) => {
  const source = fileContent(structure, 'pwa-service-worker-component', 'teleport-service-worker')
  const match = (source || '').match(/const CONFIG = (.*)\n/)
  return match ? JSON.parse(match[1]) : null
}

const manifest = (structure: Awaited<ReturnType<typeof run>>, name: string) =>
  JSON.parse(fileContent(structure, 'pwa-manifests', name) || 'null')

describe('NextPwaProjectPlugin — a project that is not an app', () => {
  it('emits nothing and leaves _app and next.config untouched', async () => {
    const structure = await run({})
    expect(structure.files.has('pwa-service-worker')).toBe(false)
    expect(structure.files.has('pwa-service-worker-component')).toBe(false)
    expect(structure.files.has('pwa-manifests')).toBe(false)
    expect(fileContent(structure, '_app', '_app')).toBe(APP_SOURCE)
    expect(fileContent(structure, 'next.config', 'next.config')).toBe(NEXT_CONFIG_SOURCE)
  })

  it('retires the notifications worker of a project whose push steps were removed', async () => {
    const structure = await run({ webPush: { vapidPublicKey: 'BKey' } })
    expect(workerSource(structure)).toContain('this site is no longer an installable app')
    expect(workerSource(structure)).toContain('self.registration.unregister()')
    expect(structure.files.has('pwa-service-worker-component')).toBe(false)
    expect(fileContent(structure, '_app', '_app')).toBe(APP_SOURCE)
  })
})

describe('NextPwaProjectPlugin — installable app', () => {
  it('ships the worker, the manifest, the icons and the runtime rendered from _app', async () => {
    const structure = await run({ pwa: installableApp() })

    expect(workerSource(structure)).toContain("self.addEventListener('fetch', onFetch)")
    expect(structure.files.get('pwa-service-worker')?.path).toEqual(['public'])

    const icons = structure.files.get('pwa-icons')
    expect(icons?.path).toEqual(['public', 'pwa'])
    expect(icons?.files.map((file) => `${file.name}.${file.fileType}`).sort()).toEqual([
      'apple-touch-icon.png',
      'icon-192.png',
      'icon-512.png',
      'icon-maskable-512.png',
    ])
    expect(icons?.files.every((file) => file.contentEncoding === 'base64')).toBe(true)

    const app = fileContent(structure, '_app', '_app') || ''
    expect(app).toContain(
      "import TeleportServiceWorker from '../components/teleport-service-worker'"
    )
    expect(app).toContain('<TeleportServiceWorker />')
  })

  it('replaces the manifest an old globals.manifest produced', async () => {
    const structure = buildStructure(baseUidl({ pwa: installableApp() }))
    structure.files.set('manifest', {
      path: ['public'],
      files: [{ name: 'manifest', fileType: 'json', content: '{"name":"legacy"}' }],
    })

    await new NextPwaProjectPlugin().runAfter(structure)

    expect(structure.files.has('manifest')).toBe(false)
    expect(manifest(structure, 'manifest').name).toBe('Northwind Coffee Roasters')
  })

  it('describes the app in a manifest scoped to the whole site', async () => {
    const structure = await run({ pwa: installableApp() })
    const content = manifest(structure, 'manifest')

    expect(content).toMatchObject({
      id: '/',
      name: 'Northwind Coffee Roasters',
      short_name: 'Northwind',
      description: 'Fresh roasts, delivered.',
      lang: 'en',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: '#0f766e',
      background_color: '#ffffff',
    })
    expect(content.dir).toBeUndefined()
    expect(content.icons).toEqual([
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/pwa/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ])
  })

  it('writes one manifest per language, each opening on its own home page', async () => {
    const structure = await run({
      pwa: installableApp(),
      globals: {
        settings: { title: 'Northwind', language: 'en', rtlLocales: ['ar'] },
        meta: [],
        assets: [],
      },
      internationalization: {
        main: { name: 'English', locale: 'en' },
        languages: { en: 'English', ar: 'Arabic' },
        translations: {},
      },
    })

    expect(manifest(structure, 'manifest')).toMatchObject({ id: '/', start_url: '/', lang: 'en' })
    expect(manifest(structure, 'manifest-ar')).toMatchObject({
      id: '/',
      start_url: '/ar',
      lang: 'ar',
      dir: 'rtl',
    })
    expect(clientConfig(structure).manifests).toEqual({
      en: '/manifest.json',
      ar: '/manifest-ar.json',
    })
    expect(workerConfig(structure).prefixedLocales).toEqual(['ar'])
    expect(workerConfig(structure).defaultLocalePrefix).toBe('en')
    expect(clientConfig(structure).version).toBe(workerConfig(structure).version)
    expect(workerConfig(structure).precacheUrls).toEqual(['/', '/ar'])
  })

  it('also strips the locale Next.js serves a single-language site under, whatever its language', async () => {
    const structure = await run({
      pwa: installableApp(),
      globals: { settings: { title: 'Kaffee', language: 'de' }, assets: [], meta: [] },
    })
    expect(workerConfig(structure)).toMatchObject({
      defaultLocale: 'de',
      prefixedLocales: [],
      defaultLocalePrefix: 'en',
    })
    expect(clientConfig(structure).defaultLocalePrefix).toBe('en')
  })

  it('never lets a colour that is not a hex literal reach the manifest', async () => {
    const structure = await run({
      pwa: installableApp({ themeColor: 'red;}</style>', backgroundColor: 'url(x)' }),
    })
    expect(manifest(structure, 'manifest')).toMatchObject({
      theme_color: '#111827',
      background_color: '#ffffff',
    })
  })

  it('omits icons it was not given, and falls back to the favicon for notifications', async () => {
    const structure = await run({ pwa: installableApp({ icons: undefined }) })
    expect(structure.files.has('pwa-icons')).toBe(false)
    expect(manifest(structure, 'manifest').icons).toBeUndefined()
    expect(clientConfig(structure).appleTouchIcon).toBeNull()
    expect(clientConfig(structure).launchScreen).toEqual({ backgroundColor: '#ffffff', icon: null })
    expect(workerConfig(structure).notificationIcon).toBe('/favicon.png')
  })

  it('draws the iPhone launch screen from the maskable icon on the background colour', async () => {
    const structure = await run({ pwa: installableApp({ backgroundColor: '#FDF6EC' }) })
    expect(clientConfig(structure).launchScreen).toEqual({
      backgroundColor: '#fdf6ec',
      icon: '/pwa/icon-maskable-512.png',
    })
  })

  it('lists the screenshots for the larger install dialog in every language, named after the app', async () => {
    const phone = {
      src: 'https://cdn.example.com/phone.jpg',
      width: 780,
      height: 1688,
      type: 'image/jpeg',
      formFactor: 'narrow' as const,
    }
    const computer = {
      ...phone,
      src: '/pwa/computer.png',
      width: 1280,
      height: 800,
      type: 'image/png',
      formFactor: 'wide' as const,
    }
    const structure = await run({
      pwa: installableApp({ screenshots: [phone, computer] }),
      internationalization: {
        main: { name: 'English', locale: 'en' },
        languages: { en: 'English', es: 'Spanish' },
        translations: {},
      },
    })

    const expected = [
      {
        src: 'https://cdn.example.com/phone.jpg',
        sizes: '780x1688',
        type: 'image/jpeg',
        form_factor: 'narrow',
        label: 'Northwind Coffee Roasters',
      },
      {
        src: '/pwa/computer.png',
        sizes: '1280x800',
        type: 'image/png',
        form_factor: 'wide',
        label: 'Northwind Coffee Roasters',
      },
    ]
    expect(manifest(structure, 'manifest').screenshots).toEqual(expected)
    expect(manifest(structure, 'manifest-es').screenshots).toEqual(expected)
  })

  it('leaves out screenshots a browser would refuse', async () => {
    const phone = {
      src: 'https://cdn.example.com/phone.jpg',
      width: 780,
      height: 1688,
      type: 'image/jpeg',
      formFactor: 'narrow' as const,
    }
    const refused = [
      { ...phone, src: 'http://cdn.example.com/insecure.jpg' },
      { ...phone, src: '//cdn.example.com/protocol-relative.jpg' },
      { ...phone, src: 'javascript:alert(1)' },
      { ...phone, width: 300, height: 650 },
      { ...phone, width: 780, height: 4000 },
      { ...phone, width: 400, height: 1000 },
      { ...phone, type: 'image/webp' },
    ]
    // Fine on its own, but not the shape of the first phone screenshot.
    const otherShape = { ...phone, width: 1080, height: 1920 }
    const structure = await run({
      pwa: installableApp({ screenshots: [phone, ...refused, otherShape] }),
    })

    expect(manifest(structure, 'manifest').screenshots).toHaveLength(1)
    const many = await run({ pwa: installableApp({ screenshots: Array(10).fill(phone) }) })
    expect(manifest(many, 'manifest').screenshots).toHaveLength(8)
    const none = await run({ pwa: installableApp({ screenshots: refused }) })
    expect(manifest(none, 'manifest').screenshots).toBeUndefined()
  })

  it('keeps every private route and API off the cache', async () => {
    const structure = await run({
      pwa: installableApp(),
      ecommerceSettings: {},
      authentication: {
        enabled: true,
        pageProtection: {
          profile: {
            requiresAuth: true,
            allowedRoles: [],
            pageName: 'Profile',
            route: '/Profile/',
          },
          order: {
            requiresAuth: true,
            allowedRoles: [],
            pageName: 'Order',
            route: '/order-details',
            routePattern: '/order-details/[order_number]',
          },
          adminOrders: {
            requiresAuth: true,
            allowedRoles: ['admin'],
            pageName: 'Admin orders',
            route: '/admin/orders',
          },
          settings: {
            requiresAuth: true,
            allowedRoles: [],
            pageName: 'Settings',
            route: '/profile/settings',
          },
        },
        folderProtection: {},
        authPages: {
          signIn: { pageId: 'a', pageName: 'Sign in', route: '/sign-in' },
          signUp: { pageId: 'b', pageName: 'Sign up', route: '/sign-up' },
        },
      },
    })

    // Each pattern covers what is beneath it, so /admin/orders and /profile/settings go.
    expect(workerConfig(structure).networkOnly).toEqual([
      '/admin',
      '/api',
      '/checkout',
      '/order-details',
      '/orders',
      '/pay',
      '/profile',
      '/sign-in',
      '/sign-up',
    ])
    expect(clientConfig(structure).networkOnly).toEqual(workerConfig(structure).networkOnly)
  })

  it('precaches nothing when the home page is private or the site is password protected', async () => {
    const privateHome = await run({ pwa: installableApp({ networkOnlyPaths: ['/'] }) })
    expect(workerConfig(privateHome).precacheUrls).toEqual([])

    const protectedSite = await run({ pwa: installableApp({ cacheContent: false }) })
    expect(workerConfig(protectedSite).precacheUrls).toEqual([])
    expect(workerConfig(protectedSite).cacheContent).toBe(false)
  })

  it('serves the worker and the manifests with the right headers through next.config', async () => {
    const structure = await run({ pwa: installableApp() })
    const config = fileContent(structure, 'next.config', 'next.config') || ''

    expect(config).toContain('async headers()')
    expect(config).toContain('"source": "/sw.js"')
    expect(config).toContain('"value": "no-cache, no-store, must-revalidate"')
    expect(config).toContain('"source": "/manifest.json"')
    expect(config).toContain('"value": "application/manifest+json; charset=utf-8"')
    expect(config).toContain("locales: ['en', 'es']")
    // The file must still evaluate to a config object.
    const moduleShim = { exports: {} as Record<string, unknown> }
    new Function('module', config)(moduleShim)
    expect(typeof moduleShim.exports.headers).toBe('function')
  })

  it('creates a next.config when the project has none', async () => {
    const structure = await run({ pwa: installableApp() }, { withNextConfig: false })
    const config = fileContent(structure, 'next.config', 'next.config') || ''
    const moduleShim = { exports: {} as Record<string, unknown> }
    new Function('module', config)(moduleShim)
    expect(typeof moduleShim.exports.headers).toBe('function')
  })

  it('carries the install-banner choice and the push keys to the page runtime', async () => {
    const withBanner = await run({
      pwa: installableApp(),
      webPush: { vapidPublicKey: 'BKey' },
      workflows: workflowsUsing('browser-subscribe-to-push'),
    })
    expect(clientConfig(withBanner)).toMatchObject({
      mode: 'app',
      installBanner: true,
      push: { vapidPublicKey: 'BKey', subscriptionsPath: '/api/push/subscriptions' },
    })
    expect(workerConfig(withBanner).push).toEqual({
      vapidPublicKey: 'BKey',
      subscriptionsPath: '/api/push/subscriptions',
    })

    const withoutBanner = await run({ pwa: installableApp({ installBanner: false }) })
    expect(clientConfig(withoutBanner)).toMatchObject({ installBanner: false, push: null })
  })
})

describe('NextPwaProjectPlugin — notifications without an app', () => {
  it('ships a notifications-only worker when a workflow shows notifications', async () => {
    const structure = await run({ workflows: workflowsUsing('browser-show-notification') })
    const source = workerSource(structure)

    expect(workerConfig(structure)).toMatchObject({
      mode: 'notify',
      cacheContent: false,
      push: null,
    })
    expect(source).toContain("self.addEventListener('push'")
    expect(clientConfig(structure).mode).toBe('notify')
    expect(structure.files.has('pwa-manifests')).toBe(false)
    expect(fileContent(structure, '_app', '_app')).toContain('<TeleportServiceWorker />')
  })

  it('prefers the notifications worker over retiring an earlier app', async () => {
    const structure = await run({
      pwa: { installable: false },
      workflows: workflowsUsing('push-send-notification'),
      webPush: { vapidPublicKey: 'BKey' },
    })
    expect(workerConfig(structure)).toMatchObject({
      mode: 'notify',
      push: { vapidPublicKey: 'BKey' },
    })
  })
})

describe('NextPwaProjectPlugin — retiring an earlier app', () => {
  it('replaces the worker with one that unregisters itself, and nothing else', async () => {
    const structure = await run({ pwa: { installable: false } })
    const source = workerSource(structure)

    expect(source).toContain('self.registration.unregister()')
    expect(source).not.toContain("addEventListener('fetch'")
    expect(structure.files.has('pwa-service-worker-component')).toBe(false)
    expect(structure.files.has('pwa-manifests')).toBe(false)
    expect(fileContent(structure, '_app', '_app')).toBe(APP_SOURCE)
  })
})

describe('network-only route patterns', () => {
  it('cuts a route at its first dynamic segment and normalises it', () => {
    expect(toNetworkOnlyPattern('/orders/[id]')).toBe('/orders')
    expect(toNetworkOnlyPattern('Account/Settings/')).toBe('/account/settings')
    expect(toNetworkOnlyPattern('/shop/:slug')).toBe('/shop')
    expect(toNetworkOnlyPattern('/checkout?step=2')).toBe('/checkout')
    expect(toNetworkOnlyPattern('/')).toBe('/')
  })

  it('refuses a route that is dynamic from its first segment rather than covering the whole site', () => {
    expect(toNetworkOnlyPattern('/[slug]')).toBeNull()
    expect(toNetworkOnlyPattern('   ')).toBeNull()
  })
})

describe('worker version', () => {
  it('is stable for the same project and changes with any edit', () => {
    const uidl = baseUidl({ pwa: installableApp() })
    expect(computeWorkerVersion(uidl)).toBe(
      computeWorkerVersion(baseUidl({ pwa: installableApp() }))
    )
    expect(computeWorkerVersion(uidl)).not.toBe(
      computeWorkerVersion(baseUidl({ pwa: installableApp({ name: 'Other' }) }))
    )
  })
})
