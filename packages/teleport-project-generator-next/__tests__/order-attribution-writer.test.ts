import { generateEcommerceContextFileContent } from '../src/ecommerce/ecommerce-context-generator'
import { TRACKER_SOURCE } from '../src/analytics/tracker-source'
import type { UIDLEcommerceSettings } from '@teleporthq/teleport-types'

/**
 * The first-touch attribution snapshot the storefront takes on the landing
 * page, and the checkout reads back to stamp onto the order.
 *
 * Nothing goes into the visitor's browser storage until they accept the cookie
 * banner: until then the snapshot is held in memory for the open page, where
 * the checkout reads it too. Once they accept, it is stored for the visit
 * before the page goes, so a full page load keeps the first touch.
 *
 * The behaviour is EXECUTED here rather than pattern-matched. Every failure this
 * can have is a silent one — a snapshot that never writes, one written before
 * consent, one that overwrites itself on the next page, or a throw in a private
 * window — and none of them is visible from reading the emitted string.
 */

const settings = {
  cashOnDelivery: true,
  deliveryEnabled: true,
  storePickupEnabled: false,
  guestCheckout: true,
  stockManagement: false,
  orderNotifications: false,
  deliveryConfig: null,
  stockManagementConfig: null,
  orderNotificationConfig: null,
  paymentProviders: [],
} as unknown as UIDLEcommerceSettings

const providerSource = (cartDbEnabled: boolean): string =>
  generateEcommerceContextFileContent(settings, undefined, 'ds1', cartDbEnabled, true)

type Writer = Record<string, ((...args: unknown[]) => unknown) | undefined>

/** Every function the emitted writer declares, evaluated as the published module runs them. */
const loadWriter = (cartDbEnabled = true): Writer => {
  const source = providerSource(cartDbEnabled)
  const start = source.indexOf('const ATTRIBUTION_KEY')
  const end = source.indexOf('const CART_STORAGE_KEY', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const block = source.slice(start, end)
  const names = (block.match(/^function \w+\(/gm) || []).map((declaration) =>
    declaration.slice('function '.length, -1)
  )
  // eslint-disable-next-line no-new-func
  return new Function(`${block}\nreturn { ${names.join(', ')} }`)() as Writer
}

const capture = (writer: Writer) => (writer.captureOrderAttribution as () => void)()
const watch = (writer: Writer) =>
  (writer.watchOrderAttributionConsent as () => (() => void) | undefined)()

// ⚠️ Read by the checkout (teleport-gui `order-attribution-script.ts`) by these
// exact names. Spelled out, never imported, so a rename here fails this test.
const STORAGE_KEY = 'tq_attribution'
const MEMORY_GLOBAL = '__teleportOrderAttribution'

type Store = Record<string, string>
type Listener = () => void

const memoryStorage = (data: Store) => ({
  getItem: (key: string) => (key in data ? data[key] : null),
  setItem: (key: string, value: string) => {
    data[key] = String(value)
  },
  removeItem: (key: string) => {
    delete data[key]
  },
})

const throwingStorage = () => ({
  getItem: () => {
    throw new Error('storage disabled')
  },
  setItem: () => {
    throw new Error('storage disabled')
  },
  removeItem: () => {
    throw new Error('storage disabled')
  },
})

const eventTarget = () => {
  const listeners: Record<string, Listener[]> = {}
  return {
    listeners,
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = [...(listeners[type] || []), listener]
    },
    removeEventListener: (type: string, listener: Listener) => {
      listeners[type] = (listeners[type] || []).filter((candidate) => candidate !== listener)
    },
    fire: (type: string) => (listeners[type] || []).forEach((listener) => listener()),
  }
}

/**
 * A full page load: a fresh window, so nothing is held in memory, over the
 * tab's session storage and the site's local storage, which outlive it.
 */
const loadPage = (
  url: string,
  options: { session?: Store; local?: Store; referrer?: string } = {}
) => {
  const session = options.session ?? {}
  const local = options.local ?? {}
  const address = new URL(url, 'https://shop.test')
  const windowEvents = eventTarget()
  const documentEvents = eventTarget()
  const fakeDocument = {
    referrer: options.referrer ?? '',
    visibilityState: 'visible',
    addEventListener: documentEvents.addEventListener,
    removeEventListener: documentEvents.removeEventListener,
  }
  const fakeWindow: Record<string, unknown> = {
    location: { search: address.search, pathname: address.pathname, host: address.host },
    sessionStorage: memoryStorage(session),
    localStorage: memoryStorage(local),
    addEventListener: windowEvents.addEventListener,
    removeEventListener: windowEvents.removeEventListener,
  }
  ;(globalThis as Record<string, unknown>).window = fakeWindow
  ;(globalThis as Record<string, unknown>).document = fakeDocument
  return {
    session,
    local,
    window: fakeWindow,
    held: () => fakeWindow[MEMORY_GLOBAL] as Record<string, unknown> | undefined,
    stored: () =>
      STORAGE_KEY in session ? (JSON.parse(session[STORAGE_KEY]) as Record<string, unknown>) : null,
    // A client-side route change: the same window, a new address.
    navigate: (to: string) => {
      const next = new URL(to, 'https://shop.test')
      fakeWindow.location = { search: next.search, pathname: next.pathname, host: next.host }
    },
    accept: () => {
      local.cookieConsent = 'accepted'
    },
    hide: () => {
      fakeDocument.visibilityState = 'hidden'
      documentEvents.fire('visibilitychange')
    },
    show: () => {
      fakeDocument.visibilityState = 'visible'
      documentEvents.fire('visibilitychange')
    },
    leave: () => windowEvents.fire('pagehide'),
  }
}

const SPRING = {
  utm_source: 'news',
  utm_medium: null,
  utm_campaign: 'spring',
  utm_term: null,
  utm_content: null,
  landing_path: '/sale',
  referrer_host: 'news.example',
}

const landOnSpringSale = (options: { session?: Store; local?: Store } = {}) =>
  loadPage('/sale?utm_source=news&utm_campaign=spring', {
    ...options,
    referrer: 'https://news.example/a',
  })

const ACCEPTED = { cookieConsent: 'accepted' }

const clearWindow = () => {
  delete (globalThis as Record<string, unknown>).window
  delete (globalThis as Record<string, unknown>).document
}

afterEach(clearWindow)

describe('captureOrderAttribution — the snapshot', () => {
  it('is emitted whether or not the database cart is enabled', () => {
    // The provider's mount effect calls it unconditionally; gating it behind
    // the DB-cart flag would be a ReferenceError on every localStorage store.
    for (const cartDb of [true, false]) {
      expect(providerSource(cartDb)).toContain('function captureOrderAttribution()')
    }
  })

  it('records the campaign, the landing path and the referring host', () => {
    const page = landOnSpringSale({ local: { ...ACCEPTED } })
    capture(loadWriter())
    expect(page.stored()).toEqual(SPRING)
    expect(page.held()).toEqual(SPRING)
  })

  // The rule the whole feature rests on: a shopper who lands on a campaign URL,
  // browses, and checks out three pages later has a clean address bar by then.
  it('is FIRST touch — a later page never overwrites it', () => {
    const writer = loadWriter()
    const local = { ...ACCEPTED }
    const landing = landOnSpringSale({ local })
    capture(writer)
    loadPage('/checkout', { session: landing.session, local })
    capture(writer)
    expect(landing.stored()).toEqual(SPRING)
  })

  it('is FIRST touch within the open page too — a second mount keeps the landing', () => {
    const page = landOnSpringSale()
    const writer = loadWriter()
    capture(writer)
    page.navigate('/checkout')
    capture(writer)
    expect(page.held()).toEqual(SPRING)
  })

  // Internal navigation is not a traffic source.
  it('ignores a same-origin referrer', () => {
    const page = loadPage('/sale', { referrer: 'https://shop.test/home' })
    capture(loadWriter())
    expect(page.held()?.referrer_host).toBeNull()
  })

  it('survives an unparseable referrer', () => {
    const page = loadPage('/sale', { referrer: 'not a url' })
    expect(() => capture(loadWriter())).not.toThrow()
    expect(page.held()?.referrer_host).toBeNull()
  })

  // A 4KB UTM value is a broken link or an attack; an over-long value would be
  // rejected by the column and abort the whole checkout INSERT.
  it('truncates an over-long campaign to the column width', () => {
    const page = loadPage(`/?utm_campaign=${'x'.repeat(600)}`)
    capture(loadWriter())
    expect(page.held()?.utm_campaign).toHaveLength(255)
  })

  // A query string can carry an email or a token, and this is written into the
  // merchant's database.
  it('records the path only, never the landing query string', () => {
    const page = loadPage('/welcome?token=secret&utm_source=ads', { local: { ...ACCEPTED } })
    capture(loadWriter())
    expect(page.held()?.landing_path).toBe('/welcome')
    expect(JSON.stringify(page.held())).not.toContain('secret')
    expect(JSON.stringify(page.stored())).not.toContain('secret')
  })

  it('does nothing during server-side rendering', () => {
    clearWindow()
    const writer = loadWriter()
    expect(() => capture(writer)).not.toThrow()
    expect(watch(writer)).toBeUndefined()
  })

  it('does not throw when storage is unavailable, and still holds the snapshot', () => {
    const page = landOnSpringSale()
    page.window.sessionStorage = throwingStorage()
    page.window.localStorage = throwingStorage()
    const writer = loadWriter()
    expect(() => capture(writer)).not.toThrow()
    expect(() => watch(writer)).not.toThrow()
    expect(() => page.leave()).not.toThrow()
    expect(page.held()).toEqual(SPRING)
  })
})

describe('nothing is stored before the visitor accepts the cookie banner', () => {
  it('holds the snapshot in memory and stores nothing while the banner is unanswered', () => {
    const page = landOnSpringSale()
    capture(loadWriter())
    expect(page.session).toEqual({})
    expect(page.held()).toEqual(SPRING)
  })

  it('stores nothing for a visitor who declined', () => {
    const page = landOnSpringSale({ local: { cookieConsent: 'declined' } })
    const writer = loadWriter()
    capture(writer)
    expect(page.session).toEqual({})
    watch(writer)
    page.hide()
    page.leave()
    expect(page.session).toEqual({})
    expect(page.held()).toEqual(SPRING)
  })

  it('stores the snapshot at once for a visitor who accepted on an earlier visit', () => {
    const page = landOnSpringSale({ local: { ...ACCEPTED } })
    capture(loadWriter())
    expect(page.stored()).toEqual(SPRING)
  })

  // Accept is clicked while the page is open, and the banner's write fires no
  // event in its own tab: the snapshot is stored when the page is left, which
  // happens before every full page load.
  it('stores the original first touch once the visitor accepts, when the page is left', () => {
    const writer = loadWriter()
    const page = landOnSpringSale()
    capture(writer)
    expect(page.session).toEqual({})
    watch(writer)
    page.navigate('/products/vase')
    page.accept()
    page.navigate('/checkout')
    expect(page.session).toEqual({})

    page.leave()
    expect(page.stored()).toEqual(SPRING)

    // The full page load that follows keeps it as the visit's first touch.
    const next = loadPage('/checkout', { session: page.session, local: page.local })
    capture(writer)
    expect(next.stored()).toEqual(SPRING)
  })

  // On a phone the page can be discarded once hidden, without ever being left.
  it('stores it when the page is hidden, too', () => {
    const page = landOnSpringSale()
    const writer = loadWriter()
    capture(writer)
    expect(page.session).toEqual({})
    watch(writer)
    page.accept()
    page.show()
    expect(page.session).toEqual({})
    page.hide()
    expect(page.stored()).toEqual(SPRING)
  })

  it('stores nothing when a page that was never accepted is hidden or left', () => {
    const page = landOnSpringSale()
    const writer = loadWriter()
    capture(writer)
    expect(page.session).toEqual({})
    watch(writer)
    page.hide()
    page.leave()
    expect(page.session).toEqual({})
  })

  it('removes a snapshot an earlier build stored without consent', () => {
    const earlier = JSON.stringify({ ...SPRING, utm_campaign: 'stored-before-consent' })
    const page = loadPage('/checkout', { session: { [STORAGE_KEY]: earlier } })
    capture(loadWriter())
    expect(page.session).toEqual({})
    expect(page.held()?.landing_path).toBe('/checkout')
  })

  it('stops listening when the provider unmounts', () => {
    const page = landOnSpringSale()
    const writer = loadWriter()
    capture(writer)
    expect(page.session).toEqual({})
    const stop = watch(writer)
    expect(typeof stop).toBe('function')
    ;(stop as () => void)()
    page.accept()
    page.hide()
    page.leave()
    expect(page.session).toEqual({})
  })

  // One answer, one meaning: the analytics tracker keeps a lasting visitor id
  // only for this answer, and the snapshot is stored only for it too.
  it('reads consent exactly as the analytics tracker does', () => {
    const start = TRACKER_SOURCE.indexOf('function hasConsent()')
    const trackerHasConsent = TRACKER_SOURCE.slice(start, TRACKER_SOURCE.indexOf('\n}\n', start))
    // eslint-disable-next-line no-new-func
    const trackerConsent = new Function(
      `${trackerHasConsent}\n}\nreturn hasConsent`
    )() as () => boolean
    const writerConsent = loadWriter().hasAttributionConsent as () => boolean
    expect(typeof writerConsent).toBe('function')
    for (const answer of [undefined, 'accepted', 'declined', 'Accepted', 'true', '']) {
      const page = loadPage('/', { local: answer === undefined ? {} : { cookieConsent: answer } })
      expect(writerConsent()).toBe(trackerConsent())
      page.window.localStorage = throwingStorage()
      expect(writerConsent()).toBe(trackerConsent())
    }
    loadPage('/', { local: { ...ACCEPTED } })
    expect(writerConsent()).toBe(true)
  })
})

describe('the contract with the checkout reader', () => {
  // ⚠️ The reader lives in teleport-gui and looks the snapshot up by this exact
  // key. A mismatch reads back nothing and silently unattributes every order.
  it('uses the key the checkout reader looks for', () => {
    expect(providerSource(true)).toContain(`const ATTRIBUTION_KEY = '${STORAGE_KEY}'`)
  })

  // ⚠️ The same contract for a visitor who has not accepted: the reader falls
  // back to this global when the session holds nothing.
  it('holds the snapshot on the global the checkout reader falls back to', () => {
    expect(providerSource(true)).toContain(`const ATTRIBUTION_GLOBAL = '${MEMORY_GLOBAL}'`)
    const page = landOnSpringSale()
    capture(loadWriter())
    expect(page.window[MEMORY_GLOBAL]).toEqual(SPRING)
  })

  it('is captured when the provider mounts and watched until it unmounts', () => {
    const source = providerSource(true)
    const provider = source.slice(source.indexOf('export const EcommerceProvider'))
    expect(provider).toContain('captureOrderAttribution()')
    expect(provider).toContain('useEffect(() => watchOrderAttributionConsent(), [])')
  })
})
