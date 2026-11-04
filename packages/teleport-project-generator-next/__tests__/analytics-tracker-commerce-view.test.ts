import { TRACKER_SOURCE } from '../src/analytics/tracker-source'

/**
 * The funnel steps a page declares with `data-tq-commerce-view`, run through
 * the emitted tracker against a stubbed browser whose page changes the way a
 * published store's does.
 *
 * The order page is the case this exists for. The editor builds it with its
 * "loaded" section (which carries the purchase marker) showing by default, so
 * the designer can preview it; on the live site the page therefore paints that
 * section with an EMPTY order, then hides it while the order loads, then shows
 * it again with the real order number. The tracker used to look once, when the
 * page had painted: it either caught the empty section and sent the store's
 * Google tags a purchase with no order number, or caught the loading state and
 * sent nothing.
 */

type Attributes = Record<string, string>
type Sent = Record<string, unknown>

interface Mutation {
  type: 'childList' | 'attributes'
  addedNodes: FakeElement[]
  attributeName?: string
}

const MARKER = 'data-tq-commerce-view'

class FakeElement {
  readonly nodeType = 1

  constructor(public attributes: Attributes, public children: FakeElement[] = []) {}

  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name]
      : null
  }

  matches(selector: string): boolean {
    const attribute = /^\[([\w-]+)\]$/.exec(selector)
    return attribute !== null && this.getAttribute(attribute[1]) !== null
  }

  querySelector(selector: string): FakeElement | null {
    for (const child of this.children) {
      if (child.matches(selector)) {
        return child
      }
      const inside = child.querySelector(selector)
      if (inside) {
        return inside
      }
    }
    return null
  }
}

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => (values.has(key) ? values.get(key) : null),
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
  }
}

function bootTracker(
  options: {
    path?: string
    localStorage?: ReturnType<typeof memoryStorage>
    /** No analytics key: our tracker is off, the merchant's Google tags are not. */
    analyticsOff?: boolean
  } = {}
) {
  const localStorage = options.localStorage || memoryStorage()
  const batches: Sent[][] = []
  const documentListeners: Record<string, () => void> = {}
  const body = new FakeElement({})

  const observers = new Set<FakeMutationObserver>()
  class FakeMutationObserver {
    private attributeFilter: string[] | null = null

    constructor(private readonly callback: (records: Mutation[]) => void) {}

    observe(_root: unknown, init: { attributeFilter?: string[] }) {
      this.attributeFilter = init.attributeFilter || null
      observers.add(this)
    }

    disconnect() {
      observers.delete(this)
    }

    deliver(records: Mutation[]) {
      const seen = records.filter(
        (record) =>
          record.type !== 'attributes' ||
          !this.attributeFilter ||
          this.attributeFilter.includes(record.attributeName as string)
      )
      if (seen.length > 0) {
        this.callback(seen)
      }
    }
  }
  const mutate = (records: Mutation[]) => Array.from(observers).forEach((o) => o.deliver(records))

  const fakeDocument = {
    visibilityState: 'visible',
    referrer: '',
    body,
    documentElement: { scrollHeight: 0 },
    addEventListener: (type: string, listener: () => void) => {
      documentListeners[type] = listener
    },
    querySelector: (selector: string) => body.querySelector(selector),
    querySelectorAll: (): FakeElement[] => [],
  }
  const fakeWindow = {
    location: { hostname: 'shop.example.com', pathname: options.path || '/', search: '' },
    localStorage,
    sessionStorage: memoryStorage(),
    screen: { width: 1440 },
    innerHeight: 900,
    scrollY: 0,
    addEventListener: (): void => undefined,
    // The merchant's Google tag, as a fresh page load starts it.
    dataLayer: [] as Array<Record<string, unknown>>,
  }
  const fakeFetch = (url: string, init: { body: string }) => {
    if (!url.endsWith('/heartbeat')) {
      batches.push(JSON.parse(init.body).events)
    }
    return Promise.resolve({ status: 202 })
  }

  const source = TRACKER_SOURCE.replace(/^export\s+/gm, '')
  const tracker = new Function(
    'process',
    'window',
    'document',
    'navigator',
    'fetch',
    'setInterval',
    'setTimeout',
    'MutationObserver',
    `${source}\nreturn { initTeleportAnalytics, trackRouteChange, trackCommerceView, resetCommerceView }`
  )(
    {
      env: {
        NEXT_PUBLIC_TELEPORT_ANALYTICS_URL: 'https://analytics.example.com',
        NEXT_PUBLIC_TELEPORT_ANALYTICS_KEY: options.analyticsOff ? '' : 'public-key',
      },
    },
    fakeWindow,
    fakeDocument,
    { webdriver: false },
    fakeFetch,
    () => 0,
    () => 0,
    FakeMutationObserver
  )

  const page = {
    tracker,
    localStorage,
    show(node: FakeElement) {
      body.children.push(node)
      mutate([{ type: 'childList', addedNodes: [node] }])
    },
    hide(node: FakeElement) {
      body.children = body.children.filter((child) => child !== node)
      mutate([{ type: 'childList', addedNodes: [] }])
    },
    setAttribute(node: FakeElement, name: string, value: string) {
      node.attributes[name] = value
      mutate([{ type: 'attributes', addedNodes: [], attributeName: name }])
    },
    /** What the tracker component does once the page it mounted on has painted. */
    painted() {
      tracker.initTeleportAnalytics({})
      tracker.trackCommerceView()
    },
    /**
     * A client-side navigation, in the router's order: the address changes and
     * the next page paints BEFORE the navigation is announced to the component.
     */
    navigate(path: string, ...nextPage: FakeElement[]) {
      fakeWindow.location.pathname = path
      body.children = nextPage
      mutate([{ type: 'childList', addedNodes: nextPage }])
      tracker.trackRouteChange(path)
      tracker.resetCommerceView()
      tracker.trackCommerceView()
    },
    /** The commerce steps sent to our analytics, as "step@page[:record]". */
    commerceSent(): string[] {
      if (documentListeners.visibilitychange) {
        fakeDocument.visibilityState = 'hidden'
        documentListeners.visibilitychange()
        fakeDocument.visibilityState = 'visible'
      }
      return batches
        .splice(0)
        .flat()
        .filter((event) => event.type === 'commerce')
        .map((event) => `${event.name}@${event.path}${event.rid ? `:${event.rid}` : ''}`)
    },
    /** What reached the store's Google tags, as "event[:transaction_id]". */
    sentToGoogle(): string[] {
      return fakeWindow.dataLayer
        .filter((entry) => entry.event)
        .map((entry) => `${entry.event}${entry.transaction_id ? `:${entry.transaction_id}` : ''}`)
    },
  }
  return page
}

// The order page's loaded section as the editor builds it: the marker's
// attributes are bound to the order's page state, empty until the order loads.
const orderSection = (orderId = '') =>
  new FakeElement({
    [MARKER]: 'purchase',
    'data-tq-commerce-id': orderId,
    'data-tq-commerce-value': orderId ? '42.5' : '',
    'data-tq-commerce-currency': orderId ? 'EUR' : '',
  })

const ledger = (page: { localStorage: ReturnType<typeof memoryStorage> }) =>
  JSON.parse(page.localStorage.getItem('tp_purchases') || 'null')

describe('tracker — an order page reports its purchase once the order has loaded', () => {
  it('when the tracker first looks at the empty order the page paints before loading', () => {
    const page = bootTracker({ path: '/orders/ORD-1' })
    const emptyOrder = orderSection()
    page.show(emptyOrder)
    page.painted()

    page.hide(emptyOrder)
    page.show(orderSection('ORD-1'))

    expect(page.sentToGoogle()).toEqual(['purchase:ORD-1'])
    // The sale itself is reported by the site's server, never by the browser.
    expect(page.commerceSent()).toEqual([])
  })

  it('when the tracker first looks while the order is still loading', () => {
    const page = bootTracker({ path: '/orders/ORD-1' })
    const emptyOrder = orderSection()
    page.show(emptyOrder)
    page.hide(emptyOrder)
    page.painted()

    page.show(orderSection('ORD-1'))

    expect(page.sentToGoogle()).toEqual(['purchase:ORD-1'])
  })

  it('records the order in the ledger when the visitor has accepted cookies', () => {
    const localStorage = memoryStorage()
    localStorage.setItem('cookieConsent', 'accepted')
    const page = bootTracker({ path: '/orders/ORD-1', localStorage })
    page.painted()
    page.show(orderSection('ORD-1'))

    expect(ledger(page)).toEqual(['ORD-1'])
  })

  it('keeps it in memory, not on the device, until cookies are accepted', () => {
    const page = bootTracker({ path: '/orders/ORD-1' })
    page.painted()
    page.show(orderSection('ORD-1'))

    expect(page.sentToGoogle()).toEqual(['purchase:ORD-1'])
    expect(ledger(page)).toBeNull()
  })

  it('reaches the Google tags even when our own analytics is off', () => {
    const page = bootTracker({ path: '/orders/ORD-1', analyticsOff: true })
    page.painted()
    page.show(orderSection('ORD-1'))

    expect(page.sentToGoogle()).toEqual(['purchase:ORD-1'])
  })

  it('is not sent again when the loaded order re-renders', () => {
    const page = bootTracker({ path: '/orders/ORD-1' })
    page.painted()
    const loaded = orderSection('ORD-1')
    page.show(loaded)
    page.hide(loaded)
    page.show(orderSection('ORD-1'))
    page.setAttribute(loaded, 'data-tq-commerce-id', 'ORD-1')

    expect(page.sentToGoogle()).toEqual(['purchase:ORD-1'])
  })

  it('is not sent again when the shopper comes back to it in the same visit', () => {
    const page = bootTracker({ path: '/orders/ORD-1' })
    page.painted()
    page.show(orderSection('ORD-1'))
    page.navigate('/orders')
    page.navigate('/orders/ORD-1', orderSection('ORD-1'))

    expect(page.sentToGoogle()).toEqual(['purchase:ORD-1'])
  })

  it('with consent, is not sent again when the order page is reloaded', () => {
    const localStorage = memoryStorage()
    localStorage.setItem('cookieConsent', 'accepted')
    const confirmation = bootTracker({ path: '/orders/ORD-1', localStorage })
    const emptyOrder = orderSection()
    confirmation.show(emptyOrder)
    confirmation.painted()
    confirmation.hide(emptyOrder)
    confirmation.show(orderSection('ORD-1'))
    expect(confirmation.sentToGoogle()).toEqual(['purchase:ORD-1'])

    const reloaded = bootTracker({ path: '/orders/ORD-1', localStorage })
    const reloadedEmptyOrder = orderSection()
    reloaded.show(reloadedEmptyOrder)
    reloaded.painted()
    reloaded.hide(reloadedEmptyOrder)
    reloaded.show(orderSection('ORD-1'))

    expect(reloaded.sentToGoogle()).toEqual([])
    expect(ledger(reloaded)).toEqual(['ORD-1'])
  })
})

describe('tracker — a funnel step whose marker appears after the page has painted', () => {
  it('is reported once when the marker is inserted later', () => {
    const page = bootTracker({ path: '/items/rose' })
    page.painted()

    const item = new FakeElement({ [MARKER]: 'view_item', 'data-tq-commerce-id': 'item-7' })
    page.show(new FakeElement({}, [item]))
    page.setAttribute(item, 'data-tq-commerce-id', 'item-7')
    page.show(new FakeElement({}, [new FakeElement({ [MARKER]: 'view_item' })]))

    expect(page.commerceSent()).toEqual(['view_item@/items/rose:item-7'])
    expect(page.sentToGoogle()).toEqual(['view_item'])
  })

  it('waits for an id that is bound but not filled in yet', () => {
    const page = bootTracker({ path: '/items/rose' })
    const item = new FakeElement({ [MARKER]: 'view_item', 'data-tq-commerce-id': '' })
    page.show(item)
    page.painted()

    page.setAttribute(item, 'data-tq-commerce-id', 'item-7')

    expect(page.commerceSent()).toEqual(['view_item@/items/rose:item-7'])
  })

  it('still reports a marker that names no id the moment the page paints', () => {
    const page = bootTracker({ path: '/checkout' })
    page.show(new FakeElement({ [MARKER]: 'begin_checkout' }))
    page.painted()

    expect(page.commerceSent()).toEqual(['begin_checkout@/checkout'])
    expect(page.sentToGoogle()).toEqual(['begin_checkout'])
  })

  it("counts the next page's step once, for that page, when the router paints it before announcing the navigation", () => {
    const page = bootTracker({ path: '/cart' })
    page.painted()

    page.navigate('/checkout', new FakeElement({ [MARKER]: 'begin_checkout' }))

    expect(page.commerceSent()).toEqual(['begin_checkout@/checkout'])
    expect(page.sentToGoogle()).toEqual(['begin_checkout'])
  })
})
