import { parse } from '@babel/parser'
import { NextAnalyticsProjectPlugin } from '../src/analytics/project-plugin'
import { baseUidl, buildStructure, fileContent } from './_helpers/pwa-fixtures'

/**
 * A buyer back from their bank, wallet or 3-D Secure check lands with that
 * page's host as the referrer, which opened a new visit and dropped the
 * purchase from the one they shopped in. The analytics server keeps such a
 * landing in its visit once the pageview names the address's query parameters
 * (analytics-worker: payload_guard.ts accepts `queryKeys`, referrer-parser.ts
 * matches the payment-return sets), so the landing names them, never their
 * values.
 *
 * These tests run the tracker file a published site ships against a stubbed
 * browser and read the beacons it actually sends.
 */

type Sent = Record<string, unknown>

// The analytics-worker's own check for a name (src/api/middlewares/payload_guard.ts).
const SERVER_QUERY_KEY_PATTERN = /^[A-Za-z0-9_.[\]-]{1,64}$/

const emittedTracker = async (): Promise<string> => {
  const structure = buildStructure(baseUidl({ analytics: { enabled: true } }))
  await new NextAnalyticsProjectPlugin().runAfter(structure)
  return fileContent(structure, 'teleport-analytics-lib', 'teleport-analytics') as string
}

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => (values.has(key) ? values.get(key) : null),
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
  }
}

class FakeBlob {
  public readonly text: string
  constructor(parts: string[]) {
    this.text = parts.join('')
  }
}

interface BootOptions {
  search: string
  urlSearchParams?: unknown
}

function bootTracker(source: string, options: BootOptions) {
  const beacons: string[] = []
  const documentListeners: Record<string, () => void> = {}

  const fakeDocument = {
    visibilityState: 'visible',
    referrer: 'https://www.bank.example/',
    documentElement: { scrollHeight: 0 },
    addEventListener: (type: string, listener: () => void) => {
      documentListeners[type] = listener
    },
    querySelector: (): null => null,
  }
  const fakeWindow = {
    location: { hostname: 'shop.example.com', pathname: '/orders/ORD-1', search: options.search },
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    screen: { width: 1440 },
    innerHeight: 900,
    scrollY: 0,
    addEventListener: (): void => undefined,
  }
  const fakeNavigator = {
    webdriver: false,
    sendBeacon: (_url: string, blob: FakeBlob) => {
      beacons.push(blob.text)
      return true
    },
  }
  // Heartbeats go straight to fetch and carry no pageview.
  const fakeFetch = () => Promise.resolve({ status: 202 })

  const body = source.replace(/^export\s+/gm, '')
  const tracker = new Function(
    'process',
    'window',
    'document',
    'navigator',
    'fetch',
    'setInterval',
    'Blob',
    'URLSearchParams',
    `${body}\nreturn { initTeleportAnalytics, trackRouteChange }`
  )(
    {
      env: {
        NEXT_PUBLIC_TELEPORT_ANALYTICS_URL: 'https://analytics.example.com',
        NEXT_PUBLIC_TELEPORT_ANALYTICS_KEY: 'public-key',
      },
    },
    fakeWindow,
    fakeDocument,
    fakeNavigator,
    fakeFetch,
    () => 0,
    FakeBlob,
    'urlSearchParams' in options ? options.urlSearchParams : URLSearchParams
  )
  tracker.initTeleportAnalytics({})

  // Hiding the page sends the queue by beacon, the way a real tab switch does.
  const flush = () => {
    fakeDocument.visibilityState = 'hidden'
    documentListeners.visibilitychange()
    fakeDocument.visibilityState = 'visible'
    const raw = beacons.splice(0)
    const events: Sent[] = []
    for (const text of raw) {
      events.push(...JSON.parse(text).events)
    }
    return { raw: raw.join('\n'), pageviews: events.filter((event) => event.type === 'pageview') }
  }
  const navigate = (pathname: string, search: string) => {
    fakeWindow.location.pathname = pathname
    fakeWindow.location.search = search
    tracker.trackRouteChange(pathname + search)
  }

  return { flush, navigate }
}

describe('tracker — the landing names its query parameters, never their values', () => {
  let source: string
  beforeAll(async () => {
    source = await emittedTracker()
  })

  it.each([
    [
      "the store's PayPal return",
      '?payment=success&token=7XK12345AB&PayerID=QWE987ZX',
      ['payment', 'token', 'PayerID'],
      ['success', '7XK12345AB', 'QWE987ZX'],
    ],
    [
      "Stripe's redirect return",
      '?payment_intent=pi_3Nx7&payment_intent_client_secret=pi_3Nx7_secret_Kq2&redirect_status=succeeded',
      ['payment_intent', 'payment_intent_client_secret', 'redirect_status'],
      ['pi_3Nx7', 'secret_Kq2', 'succeeded'],
    ],
  ])('names the parameters of %s', (_label, search, names, values) => {
    const { raw, pageviews } = bootTracker(source, { search }).flush()

    expect(pageviews).toHaveLength(1)
    expect(pageviews[0].path).toBe('/orders/ORD-1')
    expect(pageviews[0].queryKeys).toEqual(names)
    for (const value of values) {
      expect(raw).not.toContain(value)
    }
  })

  it('sends only names the server accepts, each once', () => {
    const search =
      '?payment=success&filter%5Bcolor%5D=red&a+b=1&me%40mail.com=1&path%2Fto=1&=orphan&' +
      `${'x'.repeat(65)}=1&caf%C3%A9=1&payment=again&utm_source=news`
    const [landing] = bootTracker(source, { search }).flush().pageviews

    expect(landing.queryKeys).toEqual(['payment', 'filter[color]', 'utm_source'])
    for (const name of landing.queryKeys as string[]) {
      expect(name).toMatch(SERVER_QUERY_KEY_PATTERN)
    }
  })

  it('sends at most 20, and a refused name takes no place', () => {
    const refused = ['a b', 'x@y', 'a/b', '%%', ''].map((name) => `${encodeURIComponent(name)}=1`)
    const accepted = Array.from({ length: 25 }, (_, index) => `k${index}=v${index}`)
    const search = `?${refused.concat(accepted).join('&')}`
    const [landing] = bootTracker(source, { search }).flush().pageviews

    expect(landing.queryKeys).toEqual(Array.from({ length: 20 }, (_, index) => `k${index}`))
  })

  it('names nothing on a landing without a query, nor on any later page', () => {
    const [bare] = bootTracker(source, { search: '' }).flush().pageviews
    expect(bare).not.toHaveProperty('queryKeys')

    const page = bootTracker(source, { search: '?payment=success' })
    page.navigate('/account', '?tab=orders')
    const [landing, next] = page.flush().pageviews

    expect(landing.queryKeys).toEqual(['payment'])
    expect(next.path).toBe('/account')
    expect(next).not.toHaveProperty('queryKeys')
  })

  it('still sends the landing when the address cannot be read', () => {
    const [odd] = bootTracker(source, { search: '?%E0%A4%A&%%%=1&&&;=&payment' }).flush().pageviews
    expect(odd.queryKeys).toEqual(['payment'])

    // A browser without URLSearchParams.
    const [old] = bootTracker(source, {
      search: '?payment=success',
      urlSearchParams: undefined,
    }).flush().pageviews
    expect(old.path).toBe('/orders/ORD-1')
    expect(old).not.toHaveProperty('queryKeys')
  })
})

describe('the tracker file a published site ships', () => {
  it("checks a name with the analytics server's own pattern", async () => {
    // Written inside a template literal: an unescaped backslash would vanish
    // there and leave a pattern that refuses every name.
    const source = await emittedTracker()
    expect(source).toContain(`const QUERY_KEY_PATTERN = ${SERVER_QUERY_KEY_PATTERN}`)
    expect(source).toContain('const MAX_QUERY_KEYS = 20')
  })

  it('parses whole, down to its last export', async () => {
    const program = parse(await emittedTracker(), { sourceType: 'module' }).program
    const exported = program.body
      .filter((node) => node.type === 'ExportNamedDeclaration')
      .map((node) => (node as { declaration?: { id?: { name: string } } }).declaration?.id?.name)

    expect(exported).toEqual([
      'initTeleportAnalytics',
      'trackRouteLeave',
      'trackRouteChange',
      'trackCommerceEvent',
      'trackCommerceView',
      'resetCommerceView',
    ])
  })
})
