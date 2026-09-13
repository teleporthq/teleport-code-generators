// Source of the generated `lib/teleport-analytics.js` — the self-contained,
// dependency-free tracker shipped inside published projects.
//
// Privacy contract (mirrors the analytics-worker):
// - Cookieless by default: no storage at all until the site's own cookie
//   banner consent (`localStorage.cookieConsent === 'accepted'`) exists; the
//   anonymous id is then a random UUID, never derived from personal data.
// - Only pathnames are sent — never query strings or fragments.
// - The tracker self-disables on localhost, for bots (navigator.webdriver)
//   and after repeated 403s (analytics turned off server-side).
export const TRACKER_SOURCE = `/* TeleportHQ first-party analytics tracker. Anonymous, cookieless by default. */
const SERVER_URL = process.env.NEXT_PUBLIC_TELEPORT_ANALYTICS_URL
const PUBLIC_KEY = process.env.NEXT_PUBLIC_TELEPORT_ANALYTICS_KEY

const HEARTBEAT_INTERVAL_MS = 30000
const FLUSH_INTERVAL_MS = 5000
const FLUSH_AT_QUEUE_SIZE = 10
const MAX_BATCH = 25
const RETRY_DELAYS_MS = [1000, 5000, 15000]
const SESSION_WINDOW_MS = 30 * 60 * 1000

let initialized = false
let disabled = false
let forbiddenCount = 0

let sessionId = null
let visitorId = null
let pageLoadId = null
let seq = 0
let currentPath = null
let initialReferrer = null
let utm = null

let visibleSince = null
let visibleAccumMs = 0
let maxScrollPct = 0

let queue = []
let flushTimer = null
let heartbeatTimer = null
let retryAttempt = 0

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function hasConsent() {
  try {
    return window.localStorage.getItem('cookieConsent') === 'accepted'
  } catch (e) {
    return false
  }
}

function isTrackingPossible() {
  if (disabled || typeof window === 'undefined') {
    return false
  }
  if (!SERVER_URL || !PUBLIC_KEY) {
    return false
  }
  // Fail safe: a misconfigured deploy can leave the unresolved
  // "teleporthq.secrets.*" placeholder (or any non-absolute value) baked into
  // these build-time vars. Never fire requests at a non-absolute URL — that
  // would point every beacon at the host site's own origin instead of the
  // analytics API.
  if (SERVER_URL.indexOf('http') !== 0 || PUBLIC_KEY.indexOf('teleporthq.secrets.') === 0) {
    return false
  }
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
    return false
  }
  if (typeof navigator !== 'undefined' && navigator.webdriver) {
    return false
  }
  return true
}

function setupIdentity() {
  if (!hasConsent()) {
    // Consentless mode: nothing is stored on the device. The session id only
    // lives in JS memory; the server stitches sessions via its anonymized
    // daily visitor hash.
    sessionId = uuid()
    visitorId = null
    return
  }

  try {
    visitorId = window.localStorage.getItem('tp_aid')
    if (!visitorId) {
      visitorId = uuid()
      window.localStorage.setItem('tp_aid', visitorId)
    }

    const now = Date.now()
    const storedSession = window.sessionStorage.getItem('tp_sid')
    const storedAt = Number(window.sessionStorage.getItem('tp_sid_t') || 0)

    if (storedSession && now - storedAt < SESSION_WINDOW_MS) {
      sessionId = storedSession
    } else {
      sessionId = uuid()
    }
    window.sessionStorage.setItem('tp_sid', sessionId)
    window.sessionStorage.setItem('tp_sid_t', String(now))
  } catch (e) {
    sessionId = uuid()
    visitorId = null
  }
}

function touchSession() {
  if (visitorId === null) {
    return
  }
  try {
    window.sessionStorage.setItem('tp_sid_t', String(Date.now()))
  } catch (e) {
    /* storage unavailable */
  }
}

function parseUtm() {
  try {
    const params = new URLSearchParams(window.location.search)
    const read = (key) => {
      const value = params.get(key)
      return value ? value.slice(0, 255) : null
    }
    const parsed = {
      source: read('utm_source'),
      medium: read('utm_medium'),
      campaign: read('utm_campaign'),
      term: read('utm_term'),
      content: read('utm_content'),
    }
    const hasAny = Object.keys(parsed).some((key) => parsed[key])
    return hasAny ? parsed : null
  } catch (e) {
    return null
  }
}

function endpoint(suffix) {
  return SERVER_URL.replace(/\\/$/, '') + '/events/' + PUBLIC_KEY + (suffix || '')
}

function markForbidden(status) {
  if (status === 403 || status === 401) {
    forbiddenCount += 1
    if (forbiddenCount >= 3) {
      // Analytics disabled server-side — go silent for this page lifetime
      disabled = true
      queue = []
      if (flushTimer) clearInterval(flushTimer)
      if (heartbeatTimer) clearInterval(heartbeatTimer)
    }
  } else {
    forbiddenCount = 0
  }
}

function sendBatch(events, useBeacon) {
  if (events.length === 0) {
    return Promise.resolve(true)
  }

  const body = JSON.stringify({ events: events })
  const url = endpoint('/batch')

  // text/plain is a CORS-safelisted content type, so the request skips the
  // preflight. That preflight is what makes an application/json beacon fail on
  // page unload (the browser can't complete OPTIONS while the page is dying),
  // and it also doubles every normal batch into OPTIONS+POST. The server reads
  // the JSON body regardless of this content type.
  if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    try {
      const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' })
      return Promise.resolve(navigator.sendBeacon(url, blob))
    } catch (e) {
      /* fall through to fetch */
    }
  }

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: body,
    keepalive: true,
  })
    .then((response) => {
      markForbidden(response.status)
      return response.status < 400
    })
    .catch(() => false)
}

function flush(useBeacon) {
  if (queue.length === 0 || disabled) {
    return
  }

  const batch = queue.slice(0, MAX_BATCH)
  queue = queue.slice(batch.length)

  sendBatch(batch, useBeacon).then((ok) => {
    if (ok) {
      retryAttempt = 0
      return
    }
    if (retryAttempt < RETRY_DELAYS_MS.length && !disabled) {
      // Re-queue once per backoff step, then drop — analytics is lossy-tolerant
      queue = batch.concat(queue)
      const delay = RETRY_DELAYS_MS[retryAttempt]
      retryAttempt += 1
      setTimeout(() => flush(false), delay)
    }
  })
}

function enqueue(event) {
  if (disabled) {
    return
  }
  queue.push(event)
  touchSession()
  if (queue.length >= FLUSH_AT_QUEUE_SIZE) {
    flush(false)
  }
}

function baseEvent(type) {
  seq += 1
  return {
    type: type,
    pageLoadId: pageLoadId,
    seq: seq - 1,
    sessionId: sessionId,
    visitorId: visitorId,
    path: currentPath,
    clientTs: Date.now(),
  }
}

function visibleTimeMs() {
  let total = visibleAccumMs
  if (visibleSince !== null) {
    total += Date.now() - visibleSince
  }
  return Math.max(0, Math.round(total))
}

function resetPageMetrics() {
  visibleAccumMs = 0
  visibleSince = document.visibilityState === 'visible' ? Date.now() : null
  maxScrollPct = 0
}

function currentScrollPct() {
  try {
    const doc = document.documentElement
    const scrollable = doc.scrollHeight - window.innerHeight
    if (scrollable <= 0) {
      return 100
    }
    return Math.min(100, Math.round((window.scrollY / scrollable) * 100))
  } catch (e) {
    return 0
  }
}

function pathnameOf(url) {
  if (typeof url !== 'string' || !url) {
    return null
  }
  return url.split('?')[0].split('#')[0] || '/'
}

// True when a route event resolves to the page we are already tracking. The
// pages-router emits routeChangeStart/Complete for the SAME path during initial
// hydration (and when a link points at the current page), which would otherwise
// double-count the pageview and emit a bogus 0ms page_leave.
function samePathAsCurrent(url) {
  const next = pathnameOf(url)
  return currentPath !== null && next !== null && next === currentPath
}

function trackPageview(isFirstLoad) {
  if (!isTrackingPossible()) {
    return
  }

  const newPath = window.location.pathname || '/'
  // Defensive same-path guard (the route handlers also guard on the router's
  // destination url): never emit a second pageview for the page already shown.
  if (!isFirstLoad && currentPath !== null && newPath === currentPath) {
    return
  }

  pageLoadId = uuid()
  seq = 0
  currentPath = newPath
  resetPageMetrics()

  const event = baseEvent('pageview')
  event.referrer = isFirstLoad ? (document.referrer || null) : null
  event.utm = isFirstLoad ? utm : null
  event.screenW = window.screen && window.screen.width ? window.screen.width : null
  enqueue(event)
}

function trackLeave(useBeacon) {
  if (!isTrackingPossible() || !pageLoadId) {
    return
  }

  const event = baseEvent('page_leave')
  event.timeOnPageMs = visibleTimeMs()
  event.maxScrollPct = maxScrollPct
  enqueue(event)

  if (useBeacon) {
    flush(true)
  }
}

function sendHeartbeat() {
  if (!isTrackingPossible() || document.visibilityState !== 'visible' || !pageLoadId) {
    return
  }

  // Heartbeats go direct (never queued) — a stale heartbeat is worthless.
  // text/plain keeps this preflight-free too (see sendBatch).
  fetch(endpoint('/heartbeat'), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({
      sessionId: sessionId,
      visitorId: visitorId,
      pageLoadId: pageLoadId,
      path: currentPath,
    }),
    keepalive: true,
  })
    .then((response) => markForbidden(response.status))
    .catch(() => undefined)
}

function onClickCapture(domEvent) {
  if (!isTrackingPossible() || !pageLoadId) {
    return
  }

  try {
    const target = domEvent.target && domEvent.target.closest
      ? domEvent.target.closest('a, button, [role="button"], input[type="submit"], [data-tp-event]')
      : null
    if (!target) {
      return
    }

    const namedAttr = target.getAttribute('data-tp-event')
    let href = null
    if (target.tagName === 'A' && target.getAttribute('href')) {
      const raw = target.getAttribute('href')
      if (raw.indexOf('http') === 0) {
        try {
          const parsed = new URL(raw)
          href = parsed.origin === window.location.origin ? parsed.pathname : raw.slice(0, 512)
        } catch (e) {
          href = raw.slice(0, 512)
        }
      } else {
        href = raw.split('?')[0].split('#')[0].slice(0, 512) || null
      }
    }

    const event = baseEvent('click')
    event.click = {
      tag: target.tagName ? target.tagName.toLowerCase().slice(0, 16) : null,
      id: target.id ? target.id.slice(0, 64) : null,
      text: target.textContent ? target.textContent.trim().slice(0, 64) : null,
      href: href,
      name: namedAttr && /^[a-zA-Z0-9_-]{1,64}$/.test(namedAttr) ? namedAttr : null,
    }
    enqueue(event)
  } catch (e) {
    /* never break the host page */
  }
}

export function initTeleportAnalytics() {
  if (initialized || typeof window === 'undefined') {
    return
  }
  initialized = true

  if (!isTrackingPossible()) {
    return
  }

  setupIdentity()
  utm = parseUtm()

  document.addEventListener('click', onClickCapture, true)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      visibleSince = Date.now()
      sendHeartbeat()
    } else {
      if (visibleSince !== null) {
        visibleAccumMs += Date.now() - visibleSince
        visibleSince = null
      }
      flush(true)
    }
  })

  window.addEventListener(
    'scroll',
    () => {
      const pct = currentScrollPct()
      if (pct > maxScrollPct) {
        maxScrollPct = pct
      }
    },
    { passive: true }
  )

  // pagehide covers tab close, navigation away and most mobile terminations.
  // When even this never fires (power loss, process kill), the server's
  // heartbeat window + session finalizer close the visit.
  window.addEventListener('pagehide', () => {
    trackLeave(true)
  })

  flushTimer = setInterval(() => flush(false), FLUSH_INTERVAL_MS)
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)

  trackPageview(true)
  sendHeartbeat()
}

export function trackRouteLeave(url) {
  // A same-path routeChangeStart (hydration) is not a real leave — skip it so we
  // don't enqueue a 0ms page_leave. Genuine end-of-visit goes through pagehide
  // (trackLeave(true)), which is intentionally unconditional.
  if (samePathAsCurrent(url)) {
    return
  }
  trackLeave(false)
}

export function trackRouteChange(url) {
  if (samePathAsCurrent(url)) {
    return
  }
  trackPageview(false)
  sendHeartbeat()
}

// ── Commerce funnel ──────────────────────────────────────────────────────────
// The five steps of a storefront purchase, in the GA4 vocabulary a merchant
// already knows. They are emitted as their own event TYPE rather than as named
// clicks: a page view and a purchase are not clicks, and mixing them into the
// clicks report would make both harder to read.
//
// A FIXED allowlist, not free text. The name becomes a grouping dimension in
// the funnel builder and the daily roll-up, so an unbounded set would let a
// typo (or a compromised page) fan the table out into thousands of one-row
// groups — and a mistyped step is a step that silently never matches.
const COMMERCE_EVENTS = [
  'view_item',
  'add_to_cart',
  'remove_from_cart',
  'begin_checkout',
  'purchase',
]

// Orders already counted, so a shopper refreshing the confirmation page (or
// coming back to it from their history) cannot inflate the conversion number.
// Kept in localStorage because the whole point is to survive a reload; capped
// so a busy device cannot grow it without bound.
const PURCHASE_LEDGER_KEY = 'tp_purchases'
const PURCHASE_LEDGER_MAX = 50

function readPurchaseLedger() {
  try {
    const raw = window.localStorage.getItem(PURCHASE_LEDGER_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    // Private mode, disabled storage, corrupted value: an empty ledger means a
    // duplicate purchase MIGHT be counted, which is a far better failure than
    // throwing inside a checkout.
    return []
  }
}

// True when this order has been counted before. Recording and checking are one
// function so no caller can test without also marking.
function claimPurchase(orderId) {
  if (!orderId) {
    // Without an id there is nothing to dedupe on. Counting it is the honest
    // choice: dropping every anonymous purchase would under-report far more
    // than the occasional refresh over-reports.
    return true
  }
  const ledger = readPurchaseLedger()
  if (ledger.indexOf(orderId) !== -1) {
    return false
  }
  ledger.push(orderId)
  try {
    window.localStorage.setItem(
      PURCHASE_LEDGER_KEY,
      JSON.stringify(ledger.slice(-PURCHASE_LEDGER_MAX))
    )
  } catch (e) {
    /* the event still goes out; only the dedupe is lost */
  }
  return true
}

// Mirror to GA4 / GTM when the merchant configured one. The dataLayer contract
// is GA4's own, so a merchant's existing Ads and GA4 funnels work with no
// tagging work — which is the entire reason to duplicate the event.
function pushToDataLayer(name, detail) {
  try {
    if (typeof window === 'undefined' || !Array.isArray(window.dataLayer)) {
      return
    }
    const payload = { event: name }
    if (detail && detail.currency) {
      payload.currency = detail.currency
    }
    if (detail && detail.value != null) {
      payload.value = detail.value
    }
    if (detail && detail.orderId) {
      payload.transaction_id = detail.orderId
    }
    if (detail && detail.items) {
      payload.items = detail.items
    }
    window.dataLayer.push({ ecommerce: null })
    window.dataLayer.push(payload)
  } catch (e) {
    /* never break the host page */
  }
}

// The one entry point. Safe to call before the tracker has initialised, after
// it has disabled itself, and on a page where analytics was never enabled —
// every one of those is a silent no-op rather than a throw, because the callers
// are checkout and add-to-cart handlers where an exception costs a sale.
export function trackCommerceEvent(name, detail) {
  try {
    if (COMMERCE_EVENTS.indexOf(name) === -1) {
      return
    }
    // The dataLayer mirror runs even when our own tracker is off: the merchant's
    // GA4 property is theirs, and it should not depend on our analytics being
    // enabled.
    pushToDataLayer(name, detail)

    if (!initialized || !isTrackingPossible()) {
      return
    }
    if (name === 'purchase' && !claimPurchase(detail && detail.orderId)) {
      return
    }

    const event = baseEvent('commerce')
    event.name = name
    enqueue(event)
    // Checkout ends in a redirect to a payment provider, which can tear the page
    // down before the 5s flush timer fires. "purchase" and "begin_checkout" are
    // the two events worth losing nothing of.
    if (name === 'purchase' || name === 'begin_checkout') {
      flush(true)
    }
  } catch (e) {
    /* never break a checkout */
  }
}

// ── View-based funnel steps ──────────────────────────────────────────────────
// "view_item", "begin_checkout" and "purchase" are things a page IS, not things
// a shopper clicks — so instead of threading an emit node through three
// different page-load workflows, the page declares what it represents and this
// reports it.
//
// The contract is one attribute set on the page's content wrapper:
//
//   data-tq-commerce-view="view_item"          which step this page is
//   data-tq-commerce-id="<product/order id>"   what it is about
//   data-tq-commerce-value="49.99"             optional monetary value
//   data-tq-commerce-currency="USD"            optional currency
//
// Declarative on purpose: a builder that adds a new page type gets analytics by
// naming the step, with no analytics code to write and nothing to keep in sync.
const COMMERCE_VIEW_ATTR = 'data-tq-commerce-view'

// One report per PAGE LOAD, so a re-render (a variant click, a filter change)
// cannot re-count the same view. Reset by the route-change hook below.
let reportedViewKey = null

function readCommerceViewElement() {
  try {
    return document.querySelector('[' + COMMERCE_VIEW_ATTR + ']')
  } catch (e) {
    return null
  }
}

export function trackCommerceView() {
  try {
    const element = readCommerceViewElement()
    if (!element) {
      return
    }
    const name = element.getAttribute(COMMERCE_VIEW_ATTR)
    if (COMMERCE_EVENTS.indexOf(name) === -1) {
      return
    }
    const id = element.getAttribute('data-tq-commerce-id') || null
    // The path alone is not enough: a details page keeps its route while the
    // shopper switches variant, and two different products share one route
    // template. The id is what makes a second view a genuinely different one.
    const key = name + '|' + (id || currentPath || '')
    if (reportedViewKey === key) {
      return
    }
    reportedViewKey = key

    const rawValue = element.getAttribute('data-tq-commerce-value')
    const value = rawValue != null && rawValue !== '' ? Number(rawValue) : null
    trackCommerceEvent(name, {
      orderId: name === 'purchase' ? id : null,
      currency: element.getAttribute('data-tq-commerce-currency') || null,
      value: value != null && isFinite(value) ? value : null,
    })
  } catch (e) {
    /* never break the host page */
  }
}

// Called by the tracker component after a client-side navigation. The marker
// element only exists once the new page has painted, so the caller defers it.
export function resetCommerceView() {
  reportedViewKey = null
}
`
