import { TRACKER_SOURCE } from '../src/analytics/tracker-source'
import { TRACKER_COMPONENT_SOURCE } from '../src/analytics/tracker-component'

/**
 * Tracker v2: element identity and positions on every click, friction
 * (rage / dead / error / not-found), form progress without values, outcomes,
 * vitals, errors and fold samples. These tests run the emitted tracker against
 * a stubbed browser and read what it sends.
 */

type Sent = Record<string, any>

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => (values.has(key) ? values.get(key) : null),
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
  }
}

interface FakeElement {
  tagName: string
  attrs: Record<string, string>
  parent: FakeElement | null
  id: string
  classList: string[]
  textContent: string
  value?: string
  getAttribute(name: string): string | null
  matches(selector: string): boolean
  closest(selector: string): FakeElement | null
  getBoundingClientRect(): { left: number; top: number; width: number; height: number }
}

// A tiny selector engine: a comma list of `tag`, `[attr]`, `tag[attr="v"]`,
// `[role="button"]` — enough for the selectors the tracker uses.
function matchesSimple(element: FakeElement, selector: string): boolean {
  return selector.split(',').some((part) => {
    const token = part.trim()
    const tagMatch = token.match(/^[a-z]+/)
    const attrMatches = Array.from(token.matchAll(/\[([a-z-]+)(?:="([^"]*)")?\]/g))
    if (tagMatch && element.tagName.toLowerCase() !== tagMatch[0]) {
      return false
    }
    return attrMatches.every(([, name, value]) => {
      const actual = element.attrs[name]
      return value === undefined ? actual !== undefined : actual === value
    })
  })
}

function makeElement(
  tagName: string,
  attrs: Record<string, string> = {},
  parent: FakeElement | null = null,
  rect = { left: 100, top: 200, width: 200, height: 50 }
): FakeElement {
  const element: FakeElement = {
    tagName: tagName.toUpperCase(),
    attrs,
    parent,
    id: attrs.id ?? '',
    classList: (attrs.class ?? '').split(' ').filter(Boolean),
    textContent: attrs.text ?? '',
    value: attrs.value,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    matches: (selector) => matchesSimple(element, selector),
    closest: (selector) => {
      let cursor: FakeElement | null = element
      while (cursor) {
        if (matchesSimple(cursor, selector)) {
          return cursor
        }
        cursor = cursor.parent
      }
      return null
    },
    getBoundingClientRect: () => rect,
  }
  return element
}

function bootTracker(options: { pointer?: boolean } = {}) {
  const batches: Sent[][] = []
  const listeners: Record<string, Array<(event: any) => void>> = {}
  const timers: Array<{ fn: () => void; delay: number }> = []
  let mutationCallback: (() => void) | null = null
  let activeElement: FakeElement | null = null
  const forms: FakeElement[] = []

  const on = (type: string, listener: (event: any) => void) => {
    listeners[type] = listeners[type] ?? []
    listeners[type].push(listener)
  }
  const fire = (type: string, event: any = {}) => {
    for (const listener of listeners[type] ?? []) {
      listener(event)
    }
  }

  const fakeDocument = {
    visibilityState: 'visible',
    referrer: '',
    documentElement: { scrollHeight: 2000, scrollWidth: 1000 },
    body: {},
    get activeElement() {
      return activeElement
    },
    addEventListener: on,
    querySelector: (_selector?: string): unknown => null,
    querySelectorAll: (selector: string) => (selector === 'form' ? forms : []),
  }
  const fakeWindow = {
    location: {
      hostname: 'shop.example.com',
      pathname: '/',
      search: '',
      origin: 'https://shop.example.com',
    },
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    screen: { width: 1440 },
    innerHeight: 900,
    innerWidth: 1200,
    scrollY: 0,
    scrollX: 0,
    addEventListener: on,
    getComputedStyle: () => ({ cursor: options.pointer ? 'pointer' : 'auto' }),
    requestAnimationFrame: (fn: () => void) => fn(),
  }
  const fakeFetch = (url: string, init: { body: string }) => {
    if (!url.endsWith('/heartbeat')) {
      batches.push(JSON.parse(init.body).events)
    }
    return Promise.resolve({ status: 202 })
  }
  class FakeMutationObserver {
    constructor(callback: () => void) {
      mutationCallback = callback
    }
    observe() {
      return undefined
    }
  }

  const body = TRACKER_SOURCE.replace(/^export\s+/gm, '').replace(/^export \{[^}]*\}\s*$/gm, '')
  const tracker = new Function(
    'process',
    'window',
    'document',
    'navigator',
    'fetch',
    'setInterval',
    'setTimeout',
    'clearTimeout',
    'MutationObserver',
    'PerformanceObserver',
    'performance',
    'Math',
    `${body}\nreturn { initTeleportAnalytics, trackRouteChange, trackRouteLeave, trackOutcome, analyticsIds, trackNotFound, trackCommerceEvent }`
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
    () => 0,
    (fn: () => void, delay: number) => {
      timers.push({ fn, delay })
      return timers.length
    },
    () => undefined,
    FakeMutationObserver,
    undefined,
    { getEntriesByType: () => [] },
    Object.assign(Object.create(Math), { random: () => 0.99 })
  )

  const flush = (): Sent[] => {
    fakeDocument.visibilityState = 'hidden'
    fire('visibilitychange')
    fakeDocument.visibilityState = 'visible'
    return batches.splice(0).flat()
  }
  const click = (target: FakeElement, at = { clientX: 150, clientY: 225 }, now?: number) => {
    if (now !== undefined) {
      Date.now = () => now
    }
    fire('click', { target, ...at })
  }
  const runTimers = () => {
    const pending = timers.splice(0)
    pending.forEach((timer) => timer.fn())
  }
  const mutate = () => mutationCallback && mutationCallback()
  const focus = (target: FakeElement | null) => {
    activeElement = target
    if (target) {
      fire('focusin', { target })
    }
  }

  return {
    tracker,
    flush,
    click,
    runTimers,
    mutate,
    focus,
    fire,
    fakeWindow,
    fakeDocument,
    forms,
    timers,
  }
}

const realNow = Date.now

afterEach(() => {
  Date.now = realNow
})

describe('tracker v2 — clicks carry element identity and positions', () => {
  it('reports every click with its marker, document position and viewport class', () => {
    const page = bootTracker()
    page.tracker.initTeleportAnalytics({})
    page.flush()

    const section = makeElement('section', { 'data-tq-el': 'ab12cd' }, null, {
      left: 0,
      top: 0,
      width: 1000,
      height: 400,
    })
    const paragraph = makeElement('p', { text: 'Some reading' }, section)
    page.click(paragraph, { clientX: 500, clientY: 100 })
    const [click] = page.flush()

    expect(click.type).toBe('click')
    expect(click.el).toBe('ab12cd')
    expect(click.vc).toBe('d')
    // The document is at least as wide as the viewport (1200), so 500 px is 0.417 of it.
    expect(click.point).toEqual({ ex: 0.5, ey: 0.25, px: 0.417, py: 0.05, vw: 1200, vh: 900 })
    // A paragraph is not interactive: no text, no id, no classes leave the page.
    expect(click.click.text).toBeNull()
    expect(click.click.tag).toBe('p')
  })

  it('keeps the text and href of an interactive element only', () => {
    const page = bootTracker()
    page.tracker.initTeleportAnalytics({})
    page.flush()

    const link = makeElement('a', {
      href: '/pricing?ref=x',
      class: 'nav-link',
      text: 'Pricing',
      'data-tq-el': 'ff00aa',
    })
    page.click(link)
    const [click] = page.flush()
    expect(click.click).toMatchObject({
      tag: 'a',
      text: 'Pricing',
      href: '/pricing',
      cls: 'nav-link',
    })
    expect(click.el).toBe('ff00aa')
  })

  it('samples every other non-interactive click past the per-page budget, never an interactive one', () => {
    const page = bootTracker()
    page.tracker.initTeleportAnalytics({})
    page.flush()
    const div = makeElement('div')
    const button = makeElement('button', { text: 'Go' })
    for (let i = 0; i < 60; i++) {
      page.click(div, { clientX: 10 + i * 5, clientY: 10 + i * 5 }, 1000 + i * 2000)
    }
    for (let i = 0; i < 10; i++) {
      page.click(button, { clientX: 300 + i * 5, clientY: 300 }, 200000 + i * 2000)
    }
    const sent = page.flush().filter((event) => event.type === 'click')
    expect(sent.filter((event) => event.click.tag === 'div')).toHaveLength(50)
    expect(sent.filter((event) => event.click.tag === 'button')).toHaveLength(10)
  })
})

describe('tracker v2 — friction', () => {
  it('reports a rage cluster once: three clicks within 700 ms and 30 px', () => {
    const page = bootTracker()
    page.tracker.initTeleportAnalytics({})
    page.flush()
    const image = makeElement('img', { 'data-tq-el': 'img001' })
    page.click(image, { clientX: 100, clientY: 100 }, 1000)
    page.click(image, { clientX: 105, clientY: 102 }, 1200)
    page.click(image, { clientX: 110, clientY: 99 }, 1400)
    page.click(image, { clientX: 111, clientY: 99 }, 1500)
    const friction = page.flush().filter((event) => event.type === 'friction')
    expect(friction).toHaveLength(1)
    expect(friction[0]).toMatchObject({ kind: 'rage', el: 'img001' })
  })

  it('reports a dead click on something that looks clickable and changed nothing', () => {
    const page = bootTracker({ pointer: true })
    page.tracker.initTeleportAnalytics({})
    page.flush()
    const card = makeElement('div', { 'data-tq-el': 'card01' })
    page.click(card)
    page.runTimers()
    const friction = page.flush().filter((event) => event.type === 'friction')
    expect(friction).toEqual([expect.objectContaining({ kind: 'dead', el: 'card01' })])
  })

  it('does not count a click as dead when the page mutated anywhere, even if the target is gone', () => {
    const page = bootTracker({ pointer: true })
    page.tracker.initTeleportAnalytics({})
    page.flush()
    const menuItem = makeElement('div', { 'data-tq-el': 'menu01' })
    page.click(menuItem)
    // The dropdown closes: the clicked node is removed, a sibling re-renders.
    page.mutate()
    page.runTimers()
    expect(page.flush().filter((event) => event.type === 'friction')).toHaveLength(0)
  })

  it('does not count a click as dead when focus moved or the page navigated', () => {
    const page = bootTracker({ pointer: true })
    page.tracker.initTeleportAnalytics({})
    page.flush()
    const input = makeElement('input', { name: 'email' })
    page.click(input)
    page.focus(input)
    page.runTimers()
    const link = makeElement('a', { href: '/next' })
    page.click(link)
    page.fakeWindow.location.pathname = '/next'
    page.runTimers()
    expect(page.flush().filter((event) => event.type === 'friction')).toHaveLength(0)
  })

  it('ties a script error to the click just before it', () => {
    const page = bootTracker()
    page.tracker.initTeleportAnalytics({})
    page.flush()
    const button = makeElement('button', { 'data-tq-el': 'btn001', text: 'Pay' })
    page.click(button, undefined, 5000)
    Date.now = () => 5400
    page.fire('error', {
      message: 'Cannot read properties of undefined',
      filename: '/_next/a.js',
      lineno: 12,
      error: { stack: 'at pay' },
    })
    const sent = page.flush()
    const error = sent.find((event) => event.type === 'error')
    expect(error.error).toEqual({
      message: 'Cannot read properties of undefined',
      source: '/_next/a.js',
      line: 12,
    })
    expect(error.el).toBe('btn001')
    expect(JSON.stringify(error)).not.toContain('at pay')
    expect(sent.filter((event) => event.type === 'friction')).toEqual([
      expect.objectContaining({ kind: 'error', el: 'btn001' }),
    ])
  })

  it('reports the not-found page as friction on the address the visitor asked for', () => {
    const page = bootTracker()
    page.fakeWindow.location.pathname = '/old-pricing'
    page.tracker.initTeleportAnalytics({})
    page.tracker.trackNotFound()
    const sent = page.flush()
    expect(sent[0]).toMatchObject({ type: 'pageview', path: '/old-pricing' })
    expect(sent.find((event) => event.type === 'friction')).toMatchObject({
      kind: 'notfound',
      path: '/old-pricing',
    })
  })
})

describe('tracker v2 — forms, outcomes, leaves', () => {
  it('reports form progress by field name and never a value', () => {
    const page = bootTracker()
    page.tracker.initTeleportAnalytics({})
    page.flush()
    const form = makeElement('form', { 'data-tq-el': 'form01' })
    page.forms.push(form)
    const email = makeElement('input', { name: 'email', value: 'jane@example.com' }, form)
    Date.now = () => 10000
    page.focus(email)
    Date.now = () => 12000
    page.fire('focusout', { target: email })
    page.fire('invalid', { target: email })
    const sent = page.flush().filter((event) => event.type === 'form')
    expect(sent.map((event) => event.kind)).toEqual(['start', 'focus', 'blur', 'error'])
    expect(sent[1]).toMatchObject({ el: 'form01', field: 'email' })
    expect(sent[2].ms).toBe(2000)
    expect(JSON.stringify(sent)).not.toContain('jane@example.com')
  })

  it('reports a started, unsent form as abandoned at the last touched field on leave', () => {
    const page = bootTracker()
    page.tracker.initTeleportAnalytics({})
    page.flush()
    const form = makeElement('form', { 'data-tq-el': 'form02' })
    page.forms.push(form)
    const phone = makeElement('input', { name: 'phone' }, form)
    page.focus(phone)
    page.flush()
    // The pages-router fires routeChangeStart (the leave) before routeChangeComplete.
    page.tracker.trackRouteLeave('/thanks')
    page.fakeWindow.location.pathname = '/thanks'
    page.tracker.trackRouteChange('/thanks')
    const sent = page.flush()
    expect(sent.find((event) => event.type === 'form' && event.kind === 'abandon')).toMatchObject({
      el: 'form02',
      field: 'phone',
    })
    const leave = sent.find((event) => event.type === 'page_leave')
    expect(leave.scrollDwell).toHaveLength(10)
    expect(leave.vc).toBe('d')
  })

  it('stamps the A/B arms of the page on every event, outcome and the visit ids', () => {
    const page = bootTracker()
    page.fakeWindow.__tpExp = { 'hero-1': 'a', 'cta-2': 'b' }
    page.fakeDocument.querySelector = (selector: string) =>
      selector === '[data-tq-exp="hero-1"]' || selector === '[data-tq-exp="cta-2"]' ? {} : null
    page.tracker.initTeleportAnalytics({})
    page.tracker.trackOutcome('lead', { recordId: 'form-9' })
    const sent = page.flush()
    expect(sent.length).toBeGreaterThan(1)
    for (const event of sent) {
      expect(event.exp).toBe('cta-2:b,hero-1:a')
    }
    expect(page.tracker.analyticsIds()?.exp).toBe('cta-2:b,hero-1:a')

    // No experiments on the page: no stamp at all.
    const plain = bootTracker()
    plain.tracker.initTeleportAnalytics({})
    expect(plain.flush().every((event) => !('exp' in event))).toBe(true)
    expect(plain.tracker.analyticsIds()?.exp).toBeNull()
  })

  it('counts a test only once the visitor has seen it, and keeps that arm on later pages', () => {
    const page = bootTracker()
    page.fakeWindow.__tpExp = { 'hero-1': 'a', 'other-1': 'b' }
    page.fakeDocument.querySelector = (selector: string) =>
      selector === '[data-tq-exp="hero-1"]' ? {} : null
    page.tracker.initTeleportAnalytics({})
    expect(page.flush()[0].exp).toBe('hero-1:a')

    page.fakeDocument.querySelector = () => null
    page.tracker.trackOutcome('lead', { recordId: 'form-9' })
    const later = page.flush().find((event) => event.type === 'outcome')
    expect(later.exp).toBe('hero-1:a')
  })

  it('counts one lead per form submit, however many handlers report it', () => {
    const page = bootTracker()
    page.tracker.initTeleportAnalytics({})
    page.flush()
    Date.now = () => 10000
    // The platform's submission handler and a workflow of the same form.
    page.tracker.trackOutcome('lead', { recordId: 'form-9' })
    page.tracker.trackOutcome('lead', { recordId: 'form-9' })
    // Another form on the page is its own lead.
    page.tracker.trackOutcome('lead', { recordId: 'form-10' })
    // The same form sent again, later, is a new lead.
    Date.now = () => 13000
    page.tracker.trackOutcome('lead', { recordId: 'form-9' })
    const sent = page.flush().filter((event) => event.type === 'outcome')
    expect(sent.map((event) => event.rid)).toEqual(['form-9', 'form-10', 'form-9'])
  })

  it('sends browser outcomes, refuses money from the browser, and hands out the visit ids', () => {
    const page = bootTracker()
    page.tracker.initTeleportAnalytics({})
    page.flush()
    page.tracker.trackOutcome('purchase', { value: 100 })
    page.tracker.trackOutcome('booking_made', {})
    page.tracker.trackOutcome('lead', { recordId: 'form-9' })
    page.tracker.trackOutcome('search', { query: 'cake', results: 0 })
    const sent = page.flush().filter((event) => event.type === 'outcome')
    expect(sent.map((event) => event.name)).toEqual(['lead', 'search'])
    expect(sent[0].rid).toBe('form-9')
    expect(sent[1]).toMatchObject({ q: 'cake', results: 0 })

    const ids = page.tracker.analyticsIds()
    expect(ids.sessionId).toBe(sent[0].sessionId)
    expect(ids.path).toBe('/')
    expect(ids.visitorId).toBeNull()
  })

  it('keeps commerce steps but no longer sends the purchase itself', () => {
    const page = bootTracker()
    page.tracker.initTeleportAnalytics({})
    page.flush()
    page.tracker.trackCommerceEvent('add_to_cart', {
      value: 12.5,
      currency: 'EUR',
      items: [{ item_id: 'p-7' }],
    })
    page.tracker.trackCommerceEvent('purchase', { orderId: 'o-1', value: 50 })
    const sent = page.flush().filter((event) => event.type === 'commerce')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ name: 'add_to_cart', rid: 'p-7', value: 12.5, currency: 'EUR' })
  })
})

describe('tracker v2 — the emitted sources', () => {
  it('parses, carries no stray template syntax, and publishes the outcome API', () => {
    const body = TRACKER_SOURCE.replace(/^export\s+/gm, '').replace(/^export \{[^}]*\}\s*$/gm, '')
    expect(() => new Function(body)).not.toThrow()
    expect(TRACKER_SOURCE).not.toContain('`')
    expect(TRACKER_SOURCE).not.toContain('${')
    expect(TRACKER_COMPONENT_SOURCE).toContain(
      'window.tpAnalytics = { track: trackOutcome, ids: analyticsIds }'
    )
    expect(TRACKER_COMPONENT_SOURCE).toContain("const NOT_FOUND_PATHNAME = '/404'")
  })
})

describe('tracker v2 — owner mode draws the heatmap instead of tracking', () => {
  function bootOwner(hash: string) {
    const requests: string[] = []
    const replaced: string[] = []
    // Its own sandbox: owner mode is decided from the address at boot, and
    // what it asks the server is what the test reads.
    const tracker = bootTrackerWithFetch(hash, requests, replaced)
    return { page: { tracker }, requests, replaced }
  }

  function bootTrackerWithFetch(hash: string, requests: string[], replaced: string[]) {
    const body = TRACKER_SOURCE.replace(/^export\s+/gm, '').replace(/^export \{[^}]*\}\s*$/gm, '')
    const fakeWindow = {
      location: {
        hostname: 'shop.example.com',
        pathname: '/pricing',
        search: '?ref=x',
        origin: 'https://shop.example.com',
        hash,
      },
      history: {
        replaceState: (_state: unknown, _title: string, url: string): number => replaced.push(url),
      },
      localStorage: memoryStorage(),
      sessionStorage: memoryStorage(),
      screen: { width: 1440 },
      innerHeight: 900,
      innerWidth: 600,
      scrollY: 0,
      scrollX: 0,
      addEventListener: (): undefined => undefined,
      removeEventListener: (): undefined => undefined,
      getComputedStyle: (): { cursor: string } => ({ cursor: 'auto' }),
      requestAnimationFrame: (fn: () => void): void => fn(),
    }
    const fakeDocument = {
      visibilityState: 'visible',
      referrer: '',
      documentElement: { scrollHeight: 2000, scrollWidth: 1000 },
      body: null,
      addEventListener: (): undefined => undefined,
      querySelector: (): null => null,
      querySelectorAll: (): unknown[] => [],
    }
    const fakeFetch = (url: string): Promise<{ status: number }> => {
      requests.push(url)
      return Promise.resolve({ status: 202 })
    }
    return new Function(
      'process',
      'window',
      'document',
      'navigator',
      'fetch',
      'setInterval',
      'setTimeout',
      'clearTimeout',
      'MutationObserver',
      'PerformanceObserver',
      'performance',
      'Math',
      `${body}\nreturn { initTeleportAnalytics, trackRouteChange, trackOutcome, showOwnerHeatmap }`
    )(
      {
        env: {
          NEXT_PUBLIC_TELEPORT_ANALYTICS_URL: 'https://analytics.example.com/',
          NEXT_PUBLIC_TELEPORT_ANALYTICS_KEY: 'public-key',
        },
      },
      fakeWindow,
      fakeDocument,
      { webdriver: false },
      fakeFetch,
      (): number => 0,
      (): number => 0,
      (): undefined => undefined,
      class {
        observe(): undefined {
          return undefined
        }
      },
      undefined,
      { getEntriesByType: (): unknown[] => [] },
      Math
    )
  }

  it('reads the token from the fragment, strips it, fetches the public map and tracks nothing', async () => {
    const { page, requests, replaced } = bootOwner('#tq-heat=abc%2Fdef')
    page.tracker.initTeleportAnalytics({})
    await Promise.resolve()

    expect(replaced).toEqual(['/pricing?ref=x'])
    expect(requests).toHaveLength(1)
    const url = new URL(requests[0])
    expect(url.origin + url.pathname).toBe(
      'https://analytics.example.com/stats/public/heatmap/public-key'
    )
    expect(url.searchParams.get('token')).toBe('abc/def')
    expect(url.searchParams.get('path')).toBe('/pricing')
    // A 600px window is a phone to the tracker.
    expect(url.searchParams.get('vc')).toBe('m')
    expect(url.searchParams.get('from')).toBeTruthy()
    expect(url.searchParams.get('to')).toBeTruthy()

    // No pageview, no heartbeat, no outcome leaves the page in owner mode.
    page.tracker.trackOutcome('lead', {})
    expect(requests.filter((request) => request.indexOf('/events/') !== -1)).toEqual([])
  })

  it('follows a client-side navigation with the same token', async () => {
    const { page, requests } = bootOwner('#tq-heat=abc')
    page.tracker.initTeleportAnalytics({})
    page.tracker.trackRouteChange('/about')
    await Promise.resolve()
    expect(
      requests.filter((request) => request.indexOf('/stats/public/heatmap/') !== -1)
    ).toHaveLength(2)
  })

  it('does nothing without a token, and never throws on a bad answer', async () => {
    const { page, requests } = bootOwner('')
    page.tracker.initTeleportAnalytics({})
    expect(requests.filter((request) => request.indexOf('/stats/public/') !== -1)).toEqual([])
    await expect(page.tracker.showOwnerHeatmap('')).resolves.toBe(false)
    await expect(page.tracker.showOwnerHeatmap('bad')).resolves.toBe(false)
  })
})
