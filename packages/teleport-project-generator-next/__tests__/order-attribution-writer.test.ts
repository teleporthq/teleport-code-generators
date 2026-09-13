import { generateEcommerceContextFileContent } from '../src/ecommerce/ecommerce-context-generator'
import type { UIDLEcommerceSettings } from '@teleporthq/teleport-types'

/**
 * The first-touch attribution snapshot the storefront writes on the landing
 * page, and the checkout reads back to stamp onto the order.
 *
 * The behaviour is EXECUTED here rather than pattern-matched. Every failure this
 * can have is a silent one — a snapshot that never writes, one that overwrites
 * itself on the next page, or a throw in a private window — and none of them is
 * visible from reading the emitted string.
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

/** Pulls the writer out of the emitted module and evaluates it. */
const loadWriter = (cartDbEnabled = true): (() => void) => {
  const source = providerSource(cartDbEnabled)
  const start = source.indexOf('const ATTRIBUTION_KEY')
  const end = source.indexOf('\n}\n', source.indexOf('function captureOrderAttribution')) + 3
  expect(start).toBeGreaterThan(-1)
  const block = source.slice(start, end)
  // eslint-disable-next-line no-new-func
  return new Function(`${block}\nreturn captureOrderAttribution;`)() as () => void
}

interface FakeWindow {
  location: { search: string; pathname: string; host: string }
  sessionStorage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void }
}

const installWindow = (
  search: string,
  pathname: string,
  store: Record<string, string>,
  referrer = ''
): FakeWindow => {
  const win: FakeWindow = {
    location: { search, pathname, host: 'shop.test' },
    sessionStorage: {
      getItem: (key) => (key in store ? store[key] : null),
      setItem: (key, value) => {
        store[key] = value
      },
    },
  }
  ;(globalThis as Record<string, unknown>).window = win
  ;(globalThis as Record<string, unknown>).document = { referrer }
  return win
}

const clearWindow = () => {
  delete (globalThis as Record<string, unknown>).window
  delete (globalThis as Record<string, unknown>).document
}

afterEach(clearWindow)

describe('captureOrderAttribution', () => {
  it('is emitted whether or not the database cart is enabled', () => {
    // The provider's mount effect calls it unconditionally; gating it behind
    // the DB-cart flag would be a ReferenceError on every localStorage store.
    for (const cartDb of [true, false]) {
      expect(providerSource(cartDb)).toContain('function captureOrderAttribution()')
    }
  })

  it('records the campaign, the landing path and the referring host', () => {
    const store: Record<string, string> = {}
    installWindow('?utm_source=news&utm_campaign=spring', '/sale', store, 'https://news.example/a')

    loadWriter()()

    expect(JSON.parse(store.tq_attribution)).toEqual({
      utm_source: 'news',
      utm_medium: null,
      utm_campaign: 'spring',
      utm_term: null,
      utm_content: null,
      landing_path: '/sale',
      referrer_host: 'news.example',
    })
  })

  // The rule the whole feature rests on: a shopper who lands on a campaign URL,
  // browses, and checks out three pages later has a clean address bar by then.
  it('is FIRST touch — a later page never overwrites it', () => {
    const store: Record<string, string> = {}
    const writer = loadWriter()

    installWindow('?utm_campaign=spring', '/sale', store)
    writer()
    installWindow('', '/checkout', store)
    writer()

    const snapshot = JSON.parse(store.tq_attribution)
    expect(snapshot.utm_campaign).toBe('spring')
    expect(snapshot.landing_path).toBe('/sale')
  })

  // Internal navigation is not a traffic source.
  it('ignores a same-origin referrer', () => {
    const store: Record<string, string> = {}
    installWindow('', '/sale', store, 'https://shop.test/home')
    loadWriter()()
    expect(JSON.parse(store.tq_attribution).referrer_host).toBeNull()
  })

  it('survives an unparseable referrer', () => {
    const store: Record<string, string> = {}
    installWindow('', '/sale', store, 'not a url')
    expect(() => loadWriter()()).not.toThrow()
    expect(JSON.parse(store.tq_attribution).referrer_host).toBeNull()
  })

  // A 4KB UTM value is a broken link or an attack; an over-long value would be
  // rejected by the column and abort the whole checkout INSERT.
  it('truncates an over-long campaign to the column width', () => {
    const store: Record<string, string> = {}
    installWindow(`?utm_campaign=${'x'.repeat(600)}`, '/', store)
    loadWriter()()
    expect(JSON.parse(store.tq_attribution).utm_campaign).toHaveLength(255)
  })

  // A query string can carry an email or a token, and this is written into the
  // merchant's database.
  it('records the path only, never the landing query string', () => {
    const store: Record<string, string> = {}
    installWindow('?token=secret&utm_source=ads', '/welcome', store)
    loadWriter()()
    const snapshot = JSON.parse(store.tq_attribution)
    expect(snapshot.landing_path).toBe('/welcome')
    expect(JSON.stringify(snapshot)).not.toContain('secret')
  })

  it('does nothing during server-side rendering', () => {
    clearWindow()
    expect(() => loadWriter()()).not.toThrow()
  })

  it('does not throw when storage is unavailable', () => {
    ;(globalThis as Record<string, unknown>).window = {
      location: { search: '', pathname: '/', host: 'shop.test' },
      sessionStorage: {
        getItem: () => {
          throw new Error('storage disabled')
        },
        setItem: () => {
          throw new Error('storage disabled')
        },
      },
    }
    ;(globalThis as Record<string, unknown>).document = { referrer: '' }
    expect(() => loadWriter()()).not.toThrow()
  })

  // ⚠️ The reader lives in teleport-gui and looks the snapshot up by this exact
  // key. A mismatch reads back nothing and silently unattributes every order.
  it('uses the key the checkout reader looks for', () => {
    expect(providerSource(true)).toContain("const ATTRIBUTION_KEY = 'tq_attribution'")
  })
})
