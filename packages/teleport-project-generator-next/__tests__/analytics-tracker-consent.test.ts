import { TRACKER_SOURCE } from '../src/analytics/tracker-source'

/**
 * Retention only recognises visitors who accepted the cookie banner. The banner
 * is accepted on a page the tracker is already running on, so the tracker must
 * pick the consent up mid-visit — reading it only at boot left the accepting
 * visit (and every client-side navigation after it) anonymous, and a visitor
 * needed a THIRD visit before they could ever count as returning.
 *
 * These tests run the emitted tracker against a stubbed browser and read what
 * it actually sends.
 */

type Sent = Record<string, unknown>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => (values.has(key) ? values.get(key) : null),
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
  }
}

function bootTracker() {
  const localStorage = memoryStorage()
  const sessionStorage = memoryStorage()
  const batches: Sent[][] = []
  const heartbeats: Sent[] = []
  const documentListeners: Record<string, () => void> = {}

  const fakeDocument = {
    visibilityState: 'visible',
    referrer: '',
    documentElement: { scrollHeight: 0 },
    addEventListener: (type: string, listener: () => void) => {
      documentListeners[type] = listener
    },
    querySelector: () => null,
  }
  const fakeWindow = {
    location: { hostname: 'shop.example.com', pathname: '/', search: '' },
    localStorage,
    sessionStorage,
    screen: { width: 1440 },
    innerHeight: 900,
    scrollY: 0,
    addEventListener: () => undefined,
  }
  const fakeFetch = (url: string, init: { body: string }) => {
    const payload = JSON.parse(init.body)
    if (url.endsWith('/heartbeat')) {
      heartbeats.push(payload)
    } else {
      batches.push(payload.events)
    }
    return Promise.resolve({ status: 202 })
  }

  const body = TRACKER_SOURCE.replace(/^export\s+/gm, '')
  const tracker = new Function(
    'process',
    'window',
    'document',
    'navigator',
    'fetch',
    'setInterval',
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
    { webdriver: false },
    fakeFetch,
    () => 0
  )

  // Hiding the page flushes the queue — the same path a real tab switch takes.
  const flush = (): Sent[] => {
    fakeDocument.visibilityState = 'hidden'
    documentListeners.visibilitychange()
    fakeDocument.visibilityState = 'visible'
    return batches.splice(0).flat()
  }
  // Showing the page again sends a heartbeat straight away.
  const show = () => {
    fakeDocument.visibilityState = 'visible'
    documentListeners.visibilitychange()
  }
  const navigate = (path: string) => {
    fakeWindow.location.pathname = path
    tracker.trackRouteChange(path)
  }

  return { tracker, localStorage, sessionStorage, heartbeats, flush, show, navigate }
}

describe('tracker — consent given or withdrawn mid-visit', () => {
  it('upgrades the running visit to the persistent id once the banner is accepted', () => {
    const page = bootTracker()
    page.tracker.initTeleportAnalytics({})
    const [landing] = page.flush()

    expect(landing.visitorId).toBeNull()
    expect(page.localStorage.getItem('tp_aid')).toBeNull()

    page.localStorage.setItem('cookieConsent', 'accepted')
    page.navigate('/pricing')
    const [next] = page.flush()

    const visitorId = page.localStorage.getItem('tp_aid')
    expect(visitorId).toMatch(UUID)
    expect(next.visitorId).toBe(visitorId)
    // Same session: the server hands it to the consented visitor instead of
    // counting a second visit.
    expect(next.sessionId).toBe(landing.sessionId)
    expect(page.sessionStorage.getItem('tp_sid')).toBe(landing.sessionId)
  })

  it('sends the persistent id on heartbeats after the banner is accepted', () => {
    const page = bootTracker()
    page.tracker.initTeleportAnalytics({})
    expect(page.heartbeats[0].visitorId).toBeNull()

    page.localStorage.setItem('cookieConsent', 'accepted')
    page.show()

    const lastBeat = page.heartbeats[page.heartbeats.length - 1]
    expect(lastBeat.visitorId).toMatch(UUID)
    expect(lastBeat.visitorId).toBe(page.localStorage.getItem('tp_aid'))
  })

  it('reuses the stored id for a visitor who accepted on an earlier visit', () => {
    const page = bootTracker()
    page.localStorage.setItem('cookieConsent', 'accepted')
    page.localStorage.setItem('tp_aid', '0f8fad5b-d9cb-469f-a165-70867728950e')
    page.tracker.initTeleportAnalytics({})

    const [landing] = page.flush()
    expect(landing.visitorId).toBe('0f8fad5b-d9cb-469f-a165-70867728950e')
  })

  it('drops the persistent id in a fresh anonymous session when consent disappears', () => {
    const page = bootTracker()
    page.localStorage.setItem('cookieConsent', 'accepted')
    page.tracker.initTeleportAnalytics({})
    const [landing] = page.flush()
    expect(landing.visitorId).toMatch(UUID)

    page.localStorage.removeItem('cookieConsent')
    page.navigate('/contact')
    const [next] = page.flush()

    expect(next.visitorId).toBeNull()
    expect(next.sessionId).toMatch(UUID)
    expect(next.sessionId).not.toBe(landing.sessionId)
  })
})
