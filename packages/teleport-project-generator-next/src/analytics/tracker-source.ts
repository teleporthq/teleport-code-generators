// Source of the generated `lib/teleport-analytics.js` — the self-contained,
// dependency-free tracker shipped inside published projects.
//
// Privacy contract (mirrors the analytics-worker):
// - Cookieless by default: no storage at all until the site's own cookie
//   banner consent (`localStorage.cookieConsent === 'accepted'`) exists; the
//   anonymous id is then a random UUID, never derived from personal data.
// - Only pathnames are sent — never query strings or fragments. The one
//   exception is the on-site search box (the typed words, capped). The landing
//   pageview also names its query parameters, never their values, so a buyer
//   back from their bank or wallet stays in the visit they shopped in.
// - Never a typed value: form progress carries field NAMES only; clicks carry
//   the text of buttons and links only; errors carry a message, never a stack.
// - The tracker self-disables on localhost, for bots (navigator.webdriver)
//   and after repeated 403s (analytics turned off server-side).
//
// ⛔ ONE TEMPLATE LITERAL: no backtick and no `${` may appear in the emitted
// source (tests check both) — concatenate with `+`.
export const TRACKER_SOURCE = `/* TeleportHQ first-party analytics tracker. Anonymous, cookieless by default. */
const SERVER_URL = process.env.NEXT_PUBLIC_TELEPORT_ANALYTICS_URL
const PUBLIC_KEY = process.env.NEXT_PUBLIC_TELEPORT_ANALYTICS_KEY

const HEARTBEAT_INTERVAL_MS = 30000
const FLUSH_INTERVAL_MS = 5000
const FLUSH_AT_QUEUE_SIZE = 10
const MAX_BATCH = 25
const RETRY_DELAYS_MS = [1000, 5000, 15000]
const SESSION_WINDOW_MS = 30 * 60 * 1000

// Tracker v2 budgets (see the Growth spec, "Tracker v2 contract").
const CLICK_FULL_PER_PAGE = 40
const RAGE_WINDOW_MS = 700
const RAGE_RADIUS_PX = 30
const RAGE_CLICKS = 3
const DEAD_CLICK_WAIT_MS = 500
const ERROR_AFTER_CLICK_MS = 1000
const FRICTION_PER_PAGE = 10
const ERRORS_PER_PAGE = 5
const FOLD_SAMPLE_RATE = 0.05
const FOLD_ELEMENTS_MAX = 10
const SCROLL_BANDS = 10
const VITALS_SEND_AFTER_MS = 10000
const SEARCH_DEBOUNCE_MS = 1000
const SEARCH_MIN_CHARS = 2

const INTERACTIVE_SELECTOR =
  'a, button, [role="button"], input[type="submit"], [data-tp-event], [data-tp-track]'
const ELEMENT_MARKER_ATTR = 'data-tq-el'
const CTA_SELECTOR = 'button, input[type="submit"], [data-tq-cta]'
const SEARCH_INPUT_SELECTOR = 'input[data-tq-search-for]'

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
let landingQueryKeys = []
// Pages the owner keeps out of analytics (admin-panel pages by default), as
// path patterns baked in at publish time, and the site's locales so a prefixed
// address matches the same list.
let excludedPaths = []
let siteLocales = []

let visibleSince = null
let visibleAccumMs = 0
let maxScrollPct = 0

let queue = []
let flushTimer = null
let heartbeatTimer = null
let retryAttempt = 0

// ── Per page load state (reset by resetPageMetrics) ──────────────────────────
let clicksThisPage = 0
let frictionThisPage = 0
let errorsThisPage = 0
let recentClicks = []
let rageReported = false
let lastClickEl = null
let lastClickAt = 0
let lastClickPath = null
let scrollDwell = []
let currentBand = 0
let bandSince = null
let formsStarted = {}
let formsSubmitted = {}
let vitalsSent = false
let vitalsTimer = null
let vitals = { lcp: null, inp: null, cls: null, ttfb: null }
let mutationCount = 0
let mutationObserver = null
let searchTimers = {}

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
    visitorId = readOrCreateVisitorId()

    const now = Date.now()
    const storedSession = window.sessionStorage.getItem('tp_sid')
    const storedAt = Number(window.sessionStorage.getItem('tp_sid_t') || 0)

    if (storedSession && now - storedAt < SESSION_WINDOW_MS) {
      sessionId = storedSession
    } else {
      sessionId = uuid()
    }
    storeSession(now)
  } catch (e) {
    sessionId = uuid()
    visitorId = null
  }
}

function readOrCreateVisitorId() {
  let id = window.localStorage.getItem('tp_aid')
  if (!id) {
    id = uuid()
    window.localStorage.setItem('tp_aid', id)
  }
  return id
}

function storeSession(now) {
  window.sessionStorage.setItem('tp_sid', sessionId)
  window.sessionStorage.setItem('tp_sid_t', String(now))
}

// The cookie banner's Accept click writes the consent while the tracker is
// already running, so identity is re-checked before every send instead of only
// at boot. The visit that accepted is then the one recognised as the visitor's
// first, and the running session continues under the persistent id (the server
// upgrades it instead of opening a second one). A consent that disappears stops
// the persistent id at once, in a fresh anonymous session so nothing sent
// afterwards joins the consented one.
function syncConsentIdentity() {
  const consented = hasConsent()
  if (consented === (visitorId !== null)) {
    return
  }

  if (!consented) {
    sessionId = uuid()
    visitorId = null
    return
  }

  try {
    visitorId = readOrCreateVisitorId()
    storeSession(Date.now())
  } catch (e) {
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

// The landing address's query parameter NAMES, never their values: a buyer
// back from their bank or wallet lands on one whose names say so
// (payment=success, payment_intent with redirect_status), and the server then
// keeps them in the visit they shopped in. Shaped and capped the way the server
// accepts them, so no name can carry an "=", "@", "/" or a space.
const QUERY_KEY_PATTERN = /^[A-Za-z0-9_.[\\]-]{1,64}$/
const MAX_QUERY_KEYS = 20

function parseQueryKeys() {
  const keys = []
  try {
    new URLSearchParams(window.location.search).forEach((_value, key) => {
      if (
        keys.length < MAX_QUERY_KEYS &&
        keys.indexOf(key) === -1 &&
        QUERY_KEY_PATTERN.test(key)
      ) {
        keys.push(key)
      }
    })
  } catch (e) {
    /* an address the browser cannot read names nothing */
  }
  return keys
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

// Arms the visitor has actually seen. The head script assigns every experiment
// in the project (so the arm is stable before the element is on screen) and
// publishes window.__tpExp. Counting a session for a test the visitor never
// saw would dilute the result, so the stamp is only experiments whose element
// is on this page, plus ones they saw earlier — a checkout page still carries
// the arm of the hero that led there. "id:a,id2:b", tests on this page first.
const EXPERIMENT_SEEN_KEY = 'tq_exp_seen'
const EXPERIMENT_ID_PATTERN = /^[a-z0-9_-]{1,32}$/

function readSeenExperiments() {
  try {
    const raw = window.localStorage.getItem(EXPERIMENT_SEEN_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }
    return parsed
  } catch (e) {
    return {}
  }
}

function experimentIsOnPage(id) {
  try {
    return !!document.querySelector('[data-tq-exp="' + id + '"]')
  } catch (e) {
    return false
  }
}

function experimentStamp() {
  try {
    const assigned = typeof window !== 'undefined' ? window.__tpExp : null
    if (!assigned || typeof assigned !== 'object') {
      return ''
    }
    const seen = readSeenExperiments()
    const ids = Object.keys(assigned).sort()
    const onPage = []
    const earlier = []
    const nextSeen = {}
    let changed = false
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      if (!EXPERIMENT_ID_PATTERN.test(id)) {
        continue
      }
      const arm = assigned[id]
      if (arm !== 'a' && arm !== 'b') {
        continue
      }
      if (experimentIsOnPage(id)) {
        nextSeen[id] = arm
        if (seen[id] !== arm) {
          changed = true
        }
        onPage.push(id + ':' + arm)
      } else if (seen[id] === 'a' || seen[id] === 'b') {
        nextSeen[id] = seen[id]
        earlier.push(id + ':' + seen[id])
      }
    }
    if (changed || Object.keys(seen).length !== Object.keys(nextSeen).length) {
      try {
        window.localStorage.setItem(EXPERIMENT_SEEN_KEY, JSON.stringify(nextSeen))
      } catch (e) {
        /* private mode: the arm still rides on this page's events */
      }
    }
    return onPage.concat(earlier).join(',')
  } catch (e) {
    return ''
  }
}

function baseEvent(type) {
  syncConsentIdentity()
  seq += 1
  const event = {
    type: type,
    pageLoadId: pageLoadId,
    seq: seq - 1,
    sessionId: sessionId,
    visitorId: visitorId,
    path: currentPath,
    clientTs: Date.now(),
  }
  // Every event and outcome of a page under an A/B test says which arm it saw.
  const exp = experimentStamp()
  if (exp) {
    event.exp = exp
  }
  return event
}

// The viewport class the editor's breakpoints use: phone, tablet, desktop.
function viewportClass() {
  try {
    const width = window.innerWidth || (window.screen && window.screen.width) || 0
    return width < 768 ? 'm' : width < 1024 ? 't' : 'd'
  } catch (e) {
    return 'd'
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
  clicksThisPage = 0
  frictionThisPage = 0
  errorsThisPage = 0
  recentClicks = []
  rageReported = false
  lastClickEl = null
  lastClickAt = 0
  scrollDwell = []
  for (let i = 0; i < SCROLL_BANDS; i++) {
    scrollDwell.push(0)
  }
  currentBand = currentScrollBand()
  bandSince = visibleSince
  formsStarted = {}
  formsSubmitted = {}
  vitalsSent = false
  vitals = { lcp: null, inp: null, cls: null, ttfb: null }
  if (vitalsTimer) {
    clearTimeout(vitalsTimer)
    vitalsTimer = null
  }
}

function documentHeight() {
  try {
    const doc = document.documentElement
    return Math.max(doc.scrollHeight || 0, window.innerHeight || 0, 1)
  } catch (e) {
    return 1
  }
}

function documentWidth() {
  try {
    const doc = document.documentElement
    return Math.max(doc.scrollWidth || 0, window.innerWidth || 0, 1)
  } catch (e) {
    return 1
  }
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

// Which tenth of the document the middle of the viewport is in.
function currentScrollBand() {
  try {
    const middle = (window.scrollY || 0) + (window.innerHeight || 0) / 2
    const band = Math.floor((middle / documentHeight()) * SCROLL_BANDS)
    return Math.max(0, Math.min(SCROLL_BANDS - 1, band))
  } catch (e) {
    return 0
  }
}

// Closes the dwell of the band the viewport has been on and opens the next.
function settleScrollBand(nextBand) {
  const now = Date.now()
  if (bandSince !== null && scrollDwell.length === SCROLL_BANDS) {
    scrollDwell[currentBand] += Math.max(0, now - bandSince)
  }
  currentBand = nextBand
  bandSince = document.visibilityState === 'visible' ? now : null
}

function pathnameOf(url) {
  if (typeof url !== 'string' || !url) {
    return null
  }
  return url.split('?')[0].split('#')[0] || '/'
}

// ── Pages kept out of analytics ──────────────────────────────────────────────
// The address without query, fragment, trailing slash or locale prefix, so
// "/fr/admin-panel/orders/" is judged as "/admin-panel/orders".
function normalizeTrackedPath(path) {
  let clean = pathnameOf(path) || '/'
  while (clean.length > 1 && clean.charAt(clean.length - 1) === '/') {
    clean = clean.slice(0, -1)
  }
  const firstSegment = clean.split('/')[1]
  if (firstSegment && siteLocales.indexOf(firstSegment) !== -1) {
    clean = clean.slice(firstSegment.length + 1) || '/'
  }
  return clean
}

// A pattern ending in "*" matches by prefix (a dynamic page "/products/[id]" is
// published as "/products/*"); any other pattern matches exactly.
function pathMatchesPattern(path, pattern) {
  if (typeof pattern !== 'string' || !pattern) {
    return false
  }
  if (pattern.charAt(pattern.length - 1) === '*') {
    return path.indexOf(pattern.slice(0, -1)) === 0
  }
  return path === normalizeTrackedPath(pattern)
}

function isPathExcluded(path) {
  if (excludedPaths.length === 0) {
    return false
  }
  const normalized = normalizeTrackedPath(path)
  for (let i = 0; i < excludedPaths.length; i++) {
    if (pathMatchesPattern(normalized, excludedPaths[i])) {
      return true
    }
  }
  return false
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

  if (isPathExcluded(newPath)) {
    // No page identity on a page kept out of analytics: clicks, scroll,
    // heartbeats, leaves and commerce steps all stay silent (they guard on
    // pageLoadId) until the visitor reaches a tracked page.
    currentPath = newPath
    pageLoadId = null
    return
  }

  pageLoadId = uuid()
  seq = 0
  currentPath = newPath
  resetPageMetrics()

  const event = baseEvent('pageview')
  event.referrer = isFirstLoad ? (document.referrer || null) : null
  event.utm = isFirstLoad ? utm : null
  if (isFirstLoad && landingQueryKeys.length > 0) {
    event.queryKeys = landingQueryKeys
  }
  event.screenW = window.screen && window.screen.width ? window.screen.width : null
  event.vc = viewportClass()
  enqueue(event)

  scheduleVitals()
  sampleFold()
}

function trackLeave(useBeacon) {
  if (!isTrackingPossible() || !pageLoadId) {
    return
  }

  settleScrollBand(currentBand)
  sendVitals()
  reportAbandonedForms()

  const event = baseEvent('page_leave')
  event.timeOnPageMs = visibleTimeMs()
  event.maxScrollPct = maxScrollPct
  event.scrollDwell = scrollDwell.slice(0, SCROLL_BANDS)
  event.vc = viewportClass()
  enqueue(event)

  if (useBeacon) {
    flush(true)
  }
}

function sendHeartbeat() {
  if (!isTrackingPossible() || document.visibilityState !== 'visible' || !pageLoadId) {
    return
  }
  syncConsentIdentity()

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

// ── Element identity ─────────────────────────────────────────────────────────
// The marker the editor stamped at publish on the elements that matter.
function markerOf(element) {
  try {
    const marked = element && element.closest ? element.closest('[' + ELEMENT_MARKER_ATTR + ']') : null
    if (!marked) {
      return { el: null, element: null }
    }
    const value = marked.getAttribute(ELEMENT_MARKER_ATTR)
    return value && /^[a-z0-9]{6,8}$/.test(value) ? { el: value, element: marked } : { el: null, element: null }
  } catch (e) {
    return { el: null, element: null }
  }
}

function elementPoint(domEvent, markedElement) {
  try {
    const point = {
      ex: null,
      ey: null,
      px: Math.round(((window.scrollX || 0) + domEvent.clientX) / documentWidth() * 1000) / 1000,
      py: Math.round(((window.scrollY || 0) + domEvent.clientY) / documentHeight() * 1000) / 1000,
      vw: window.innerWidth || null,
      vh: window.innerHeight || null,
    }
    if (markedElement && markedElement.getBoundingClientRect) {
      const rect = markedElement.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        point.ex = Math.round(((domEvent.clientX - rect.left) / rect.width) * 1000) / 1000
        point.ey = Math.round(((domEvent.clientY - rect.top) / rect.height) * 1000) / 1000
      }
    }
    return point
  } catch (e) {
    return null
  }
}

function hrefOf(target) {
  if (!target || target.tagName !== 'A' || !target.getAttribute('href')) {
    return null
  }
  const raw = target.getAttribute('href')
  if (raw.indexOf('http') === 0) {
    try {
      const parsed = new URL(raw)
      return parsed.origin === window.location.origin ? parsed.pathname : raw.slice(0, 512)
    } catch (e) {
      return raw.slice(0, 512)
    }
  }
  return raw.split('?')[0].split('#')[0].slice(0, 512) || null
}

// ── Friction ─────────────────────────────────────────────────────────────────
function emitFriction(kind, el, point) {
  if (frictionThisPage >= FRICTION_PER_PAGE || !pageLoadId) {
    return
  }
  frictionThisPage += 1
  const event = baseEvent('friction')
  event.kind = kind
  event.el = el
  event.vc = viewportClass()
  if (point) {
    event.point = point
  }
  enqueue(event)
}

// Three clicks within the window and the radius: the visitor is hammering
// something that does not answer. Reported once per cluster.
function detectRage(domEvent, el, point) {
  const now = Date.now()
  recentClicks.push({ t: now, x: domEvent.clientX, y: domEvent.clientY })
  recentClicks = recentClicks.filter((click) => now - click.t <= RAGE_WINDOW_MS)
  if (recentClicks.length < RAGE_CLICKS) {
    rageReported = false
    return
  }
  const first = recentClicks[0]
  const nearby = recentClicks.every(
    (click) => Math.abs(click.x - first.x) <= RAGE_RADIUS_PX && Math.abs(click.y - first.y) <= RAGE_RADIUS_PX
  )
  if (nearby && !rageReported) {
    rageReported = true
    emitFriction('rage', el, point)
  }
  if (!nearby) {
    rageReported = false
  }
}

function looksClickable(target) {
  try {
    if (target.closest && target.closest(INTERACTIVE_SELECTOR)) {
      return true
    }
    const style = window.getComputedStyle ? window.getComputedStyle(target) : null
    return !!style && style.cursor === 'pointer'
  } catch (e) {
    return false
  }
}

// A click that changed nothing: no navigation, no focus change and no DOM
// mutation anywhere on the page within the wait. Mutations are counted
// page-wide, not under the clicked node, because the thing a click opens (a
// menu, a dialog) usually lives elsewhere in the tree — and the clicked node
// itself may be gone by then.
function scheduleDeadCheck(el, point) {
  const pathBefore = window.location.pathname
  const focusBefore = document.activeElement
  const mutationsBefore = mutationCount
  setTimeout(() => {
    try {
      if (!pageLoadId || window.location.pathname !== pathBefore) {
        return
      }
      if (document.activeElement !== focusBefore) {
        return
      }
      if (mutationCount !== mutationsBefore) {
        return
      }
      emitFriction('dead', el, point)
    } catch (e) {
      /* never break the host page */
    }
  }, DEAD_CLICK_WAIT_MS)
}

function startMutationObserver() {
  try {
    if (mutationObserver || typeof MutationObserver === 'undefined' || !document.body) {
      return
    }
    mutationObserver = new MutationObserver(() => {
      mutationCount += 1
    })
    mutationObserver.observe(document.body, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
    })
  } catch (e) {
    /* observer unavailable */
  }
}

function onClickCapture(domEvent) {
  if (!isTrackingPossible() || !pageLoadId) {
    return
  }

  try {
    const target = domEvent.target
    if (!target || !target.closest) {
      return
    }
    const interactive = target.closest(INTERACTIVE_SELECTOR)
    const marker = markerOf(target)
    const point = elementPoint(domEvent, marker.element)

    lastClickEl = marker.el
    lastClickAt = Date.now()
    lastClickPath = currentPath

    detectRage(domEvent, marker.el, point)
    if (looksClickable(target)) {
      scheduleDeadCheck(marker.el, point)
    }

    clicksThisPage += 1
    // Past the per-page budget only every other non-interactive click is
    // kept; interactive ones always are (they are what the reports name).
    if (!interactive && clicksThisPage > CLICK_FULL_PER_PAGE && clicksThisPage % 2 === 1) {
      return
    }

    const source = interactive || target
    const namedAttr = source.getAttribute ? source.getAttribute('data-tp-event') : null

    const event = baseEvent('click')
    event.el = marker.el
    event.vc = viewportClass()
    event.point = point
    event.click = {
      tag: source.tagName ? source.tagName.toLowerCase().slice(0, 16) : null,
      id: interactive && source.id ? source.id.slice(0, 64) : null,
      // The clicked element's own classes only, space-separated and capped, so a
      // funnel step can match ".add-to-cart" or "button.cta" (classList covers
      // SVG elements too, where className is not a string).
      cls:
        interactive && source.classList && source.classList.length
          ? Array.prototype.slice.call(source.classList).join(' ').slice(0, 255)
          : null,
      // Text only for interactive elements: a button's label is the owner's
      // copy; a paragraph's text could be anything the visitor is reading.
      text: interactive && source.textContent ? source.textContent.trim().slice(0, 64) : null,
      href: interactive ? hrefOf(source) : null,
      name: namedAttr && /^[a-zA-Z0-9_-]{1,64}$/.test(namedAttr) ? namedAttr : null,
    }
    enqueue(event)
  } catch (e) {
    /* never break the host page */
  }
}

// ── Forms (names only, never values) ─────────────────────────────────────────
function formOf(target) {
  try {
    return target && target.closest ? target.closest('form') : null
  } catch (e) {
    return null
  }
}

function formKey(form) {
  const marker = markerOf(form)
  return marker.el || form.id || form.getAttribute('name') || 'form'
}

function fieldName(target) {
  try {
    const name = target.getAttribute('name') || target.id || markerOf(target).el
    return name ? String(name).slice(0, 64) : null
  } catch (e) {
    return null
  }
}

function emitForm(kind, form, field) {
  if (!pageLoadId) {
    return
  }
  const key = formKey(form)
  const event = baseEvent('form')
  event.kind = kind
  event.el = markerOf(form).el
  event.vc = viewportClass()
  if (field) {
    event.field = field
  }
  if (formsStarted[key]) {
    event.ms = Math.max(0, Date.now() - formsStarted[key])
  }
  enqueue(event)
}

function onFocusIn(domEvent) {
  if (!isTrackingPossible() || !pageLoadId) {
    return
  }
  try {
    const form = formOf(domEvent.target)
    if (!form) {
      return
    }
    const key = formKey(form)
    if (!formsStarted[key]) {
      formsStarted[key] = Date.now()
      emitForm('start', form, null)
    }
    const field = fieldName(domEvent.target)
    if (field) {
      emitForm('focus', form, field)
    }
  } catch (e) {
    /* never break the host page */
  }
}

function onFocusOut(domEvent) {
  if (!isTrackingPossible() || !pageLoadId) {
    return
  }
  try {
    const form = formOf(domEvent.target)
    const field = form ? fieldName(domEvent.target) : null
    if (form && field && formsStarted[formKey(form)]) {
      emitForm('blur', form, field)
    }
  } catch (e) {
    /* never break the host page */
  }
}

function onInvalid(domEvent) {
  if (!isTrackingPossible() || !pageLoadId) {
    return
  }
  try {
    const form = formOf(domEvent.target)
    const field = form ? fieldName(domEvent.target) : null
    if (form && field) {
      emitForm('error', form, field)
    }
  } catch (e) {
    /* never break the host page */
  }
}

function onSubmitCapture(domEvent) {
  if (!isTrackingPossible() || !pageLoadId) {
    return
  }
  try {
    const form = domEvent.target && domEvent.target.tagName === 'FORM' ? domEvent.target : null
    if (!form) {
      return
    }
    const key = formKey(form)
    if (!formsStarted[key]) {
      formsStarted[key] = Date.now()
    }
    formsSubmitted[key] = true
    emitForm('submit', form, null)
    flush(false)
  } catch (e) {
    /* never break the host page */
  }
}

// On leave: every form that was started and never sent is an abandon, named
// after the field the visitor touched last.
function reportAbandonedForms() {
  try {
    const forms = document.querySelectorAll ? document.querySelectorAll('form') : []
    for (let i = 0; i < forms.length; i++) {
      const form = forms[i]
      const key = formKey(form)
      if (formsStarted[key] && !formsSubmitted[key]) {
        const active = document.activeElement
        const field = active && formOf(active) === form ? fieldName(active) : null
        emitForm('abandon', form, field)
      }
    }
  } catch (e) {
    /* never break the host page */
  }
}

// ── Speed as the visitor saw it ──────────────────────────────────────────────
function observeVitals() {
  if (typeof PerformanceObserver === 'undefined') {
    return
  }
  const observe = (type, handler, options) => {
    try {
      const observer = new PerformanceObserver((list) => {
        try {
          handler(list.getEntries())
        } catch (e) {
          /* ignore */
        }
      })
      observer.observe(Object.assign({ type: type, buffered: true }, options || {}))
    } catch (e) {
      /* this entry type is not supported here */
    }
  }
  observe('largest-contentful-paint', (entries) => {
    const last = entries[entries.length - 1]
    if (last) {
      vitals.lcp = Math.round(last.startTime)
    }
  })
  observe('layout-shift', (entries) => {
    for (let i = 0; i < entries.length; i++) {
      if (!entries[i].hadRecentInput) {
        vitals.cls = Math.round(((vitals.cls || 0) + entries[i].value) * 1000) / 1000
      }
    }
  })
  observe(
    'event',
    (entries) => {
      for (let i = 0; i < entries.length; i++) {
        const duration = Math.round(entries[i].duration)
        if (vitals.inp === null || duration > vitals.inp) {
          vitals.inp = duration
        }
      }
    },
    { durationThreshold: 40 }
  )
  try {
    const navigation = performance.getEntriesByType('navigation')[0]
    if (navigation && navigation.responseStart) {
      vitals.ttfb = Math.round(navigation.responseStart)
    }
  } catch (e) {
    /* no navigation timing */
  }
}

function scheduleVitals() {
  if (vitalsTimer) {
    clearTimeout(vitalsTimer)
  }
  vitalsTimer = setTimeout(sendVitals, VITALS_SEND_AFTER_MS)
}

function sendVitals() {
  if (vitalsSent || !pageLoadId) {
    return
  }
  if (vitals.lcp === null && vitals.inp === null && vitals.cls === null && vitals.ttfb === null) {
    return
  }
  vitalsSent = true
  const event = baseEvent('vitals')
  event.vitals = { lcp: vitals.lcp, inp: vitals.inp, cls: vitals.cls, ttfb: vitals.ttfb }
  event.vc = viewportClass()
  enqueue(event)
}

// ── Script errors (message only, never a stack) ──────────────────────────────
function reportError(message, source, line) {
  if (!isTrackingPossible() || !pageLoadId || errorsThisPage >= ERRORS_PER_PAGE) {
    return
  }
  errorsThisPage += 1
  const now = Date.now()
  const afterClick = lastClickAt && now - lastClickAt <= ERROR_AFTER_CLICK_MS && lastClickPath === currentPath
  const event = baseEvent('error')
  event.error = {
    message: String(message || 'Error').slice(0, 200),
    source: source ? String(source).slice(0, 255) : null,
    line: typeof line === 'number' ? line : null,
  }
  event.el = afterClick ? lastClickEl : null
  event.vc = viewportClass()
  enqueue(event)
  if (afterClick) {
    emitFriction('error', lastClickEl, null)
  }
}

function onWindowError(domEvent) {
  try {
    reportError(domEvent && domEvent.message, domEvent && domEvent.filename, domEvent && domEvent.lineno)
  } catch (e) {
    /* never break the host page */
  }
}

function onUnhandledRejection(domEvent) {
  try {
    const reason = domEvent && domEvent.reason
    reportError(reason && reason.message ? reason.message : String(reason), null, null)
  } catch (e) {
    /* never break the host page */
  }
}

// ── Where the calls to action sit on first paint (1 page load in 20) ─────────
function sampleFold() {
  if (Math.random() >= FOLD_SAMPLE_RATE) {
    return
  }
  const loadId = pageLoadId
  const measure = () => {
    try {
      if (pageLoadId !== loadId || !document.querySelectorAll) {
        return
      }
      const elements = document.querySelectorAll(CTA_SELECTOR)
      const vh = window.innerHeight || 1
      let emitted = 0
      for (let i = 0; i < elements.length && emitted < FOLD_ELEMENTS_MAX; i++) {
        const marker = markerOf(elements[i])
        if (!marker.el || marker.element !== elements[i]) {
          continue
        }
        const rect = elements[i].getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) {
          continue
        }
        const event = baseEvent('fold')
        event.el = marker.el
        event.y = Math.max(0, Math.min(300, Math.round(((rect.top + (window.scrollY || 0)) / vh) * 100)))
        event.vc = viewportClass()
        enqueue(event)
        emitted += 1
      }
    } catch (e) {
      /* never break the host page */
    }
  }
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => window.requestAnimationFrame(measure))
  } else {
    setTimeout(measure, 0)
  }
}

// ── Outcomes (what the visit produced) ───────────────────────────────────────
// Money outcomes (purchase, booking_made) are never sent from the browser —
// the site's server reports them with its own key — so a visitor can neither
// invent revenue nor block it.
const SERVER_ONLY_OUTCOMES = ['purchase', 'booking_made']
const FLUSH_NOW_OUTCOMES = ['lead', 'signup', 'newsletter', 'booking_blocked']

// One submit of a form is one lead, however many handlers report it: the
// platform's own submission handler AND every workflow bound to the form
// (Growth's "save the sender as a contact", the owner's own) each call this on
// the same submit. The same form within this window is the same submit.
const LEAD_DEDUPE_MS = 2000
const lastLeadAt = {}

function claimLead(formId) {
  if (!formId) {
    return true
  }
  const now = Date.now()
  const previous = lastLeadAt[formId]
  if (previous != null && now - previous < LEAD_DEDUPE_MS) {
    return false
  }
  lastLeadAt[formId] = now
  return true
}

function trackOutcome(name, detail) {
  try {
    if (typeof name !== 'string' || !name || SERVER_ONLY_OUTCOMES.indexOf(name) !== -1) {
      return
    }
    if (!initialized || !isTrackingPossible() || !pageLoadId) {
      return
    }
    const info = detail && typeof detail === 'object' ? detail : {}
    if (name === 'lead' && !claimLead(info.recordId != null ? String(info.recordId) : info.rid != null ? String(info.rid) : '')) {
      return
    }
    const event = baseEvent('outcome')
    event.name = name
    if (info.value != null) event.value = info.value
    if (info.currency) event.currency = info.currency
    if (info.outcomeId || info.id) event.outcomeId = String(info.outcomeId || info.id)
    if (info.recordId != null || info.rid != null) event.rid = String(info.recordId != null ? info.recordId : info.rid)
    if (info.query != null || info.q != null) event.q = String(info.query != null ? info.query : info.q).slice(0, 64)
    if (info.results != null) event.results = info.results
    enqueue(event)
    if (FLUSH_NOW_OUTCOMES.indexOf(name) !== -1) {
      flush(true)
    }
  } catch (e) {
    /* never break the host page */
  }
}

// The ids a workflow stamps on its trigger context, so a server segment that
// reports an order can attribute it to this very visit.
function analyticsIds() {
  if (!initialized || !isTrackingPossible()) {
    return null
  }
  syncConsentIdentity()
  return {
    sessionId: sessionId,
    visitorId: visitorId,
    pageLoadId: pageLoadId,
    path: currentPath,
    // The arm of the page the order or booking was placed from, so a server
    // outcome counts for the same experiment as the clicks that led to it.
    exp: experimentStamp() || null,
  }
}

// ── On-site search (the typed words, debounced; results when the box says) ───
function onSearchInput(domEvent) {
  if (!isTrackingPossible() || !pageLoadId) {
    return
  }
  try {
    const input = domEvent.target
    if (!input || !input.matches || !input.matches(SEARCH_INPUT_SELECTOR)) {
      return
    }
    const key = input.getAttribute('data-tq-search-for') || 'search'
    if (searchTimers[key]) {
      clearTimeout(searchTimers[key])
    }
    searchTimers[key] = setTimeout(() => {
      try {
        const query = String(input.value || '').trim()
        if (query.length < SEARCH_MIN_CHARS) {
          return
        }
        const resultsAttr = input.getAttribute('data-tq-search-results')
        const results = resultsAttr != null && resultsAttr !== '' && isFinite(Number(resultsAttr)) ? Number(resultsAttr) : null
        trackOutcome('search', { query: query, results: results })
      } catch (e) {
        /* never break the host page */
      }
    }, SEARCH_DEBOUNCE_MS)
  } catch (e) {
    /* never break the host page */
  }
}

// ── Owner mode: the published page with the owner's heatmap drawn on it ─────
// The editor's "View on live site" opens the page with a short-lived, signed
// token in the fragment. The fragment never reaches any server; the token is
// read once and removed from the address; nothing is tracked for this view
// (the owner's own clicks would pollute the map); and the map is fetched from
// the public heatmap route and drawn over the page, for the viewport class the
// owner is looking at — resize the window to see the phone map.
const HEAT_HASH_PREFIX = '#tq-heat='
const HEAT_RANGE_DAYS = 30
const HEAT_DENSITY_WIDTH = 600
const HEAT_DENSITY_MAX_HEIGHT = 6000
const HEAT_SPOT_RADIUS = 18
const HEAT_LABELED_SHARE_MIN = 1
const HEAT_BANDS = 10
const HEAT_Z_INDEX = 2147483000
const HEAT_RELAYOUT_MS = 200
const HEAT_ROOT_ATTR = 'data-tq-heatmap'

let ownerHeatmapToken = null
let ownerHeatmap = null

function readOwnerHeatmapToken() {
  try {
    const hash = window.location.hash || ''
    if (hash.indexOf(HEAT_HASH_PREFIX) !== 0) {
      return null
    }
    const token = decodeURIComponent(hash.slice(HEAT_HASH_PREFIX.length))
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
    return token || null
  } catch (e) {
    return null
  }
}

function heatmapUrl(token, path, vc) {
  const to = new Date()
  const from = new Date(to.getTime() - HEAT_RANGE_DAYS * 86400000)
  let tz = 'UTC'
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch (e) {
    /* UTC */
  }
  return (
    SERVER_URL.replace(/\\/$/, '') +
    '/stats/public/heatmap/' +
    PUBLIC_KEY +
    '?token=' +
    encodeURIComponent(token) +
    '&path=' +
    encodeURIComponent(path) +
    '&vc=' +
    vc +
    '&from=' +
    encodeURIComponent(from.toISOString()) +
    '&to=' +
    encodeURIComponent(to.toISOString()) +
    '&tz=' +
    encodeURIComponent(tz)
  )
}

// Cool to hot — blue, green, yellow, red — by the summed alpha, 0–1.
const HEAT_RAMP = [
  [0, 59, 130, 246],
  [0.35, 34, 197, 94],
  [0.65, 250, 204, 21],
  [1, 239, 68, 68],
]

function heatRampColor(value) {
  const v = Math.max(0, Math.min(1, value))
  for (let i = 1; i < HEAT_RAMP.length; i++) {
    const upper = HEAT_RAMP[i]
    if (v <= upper[0]) {
      const lower = HEAT_RAMP[i - 1]
      const span = upper[0] - lower[0]
      const t = span > 0 ? (v - lower[0]) / span : 0
      return [
        Math.round(lower[1] + (upper[1] - lower[1]) * t),
        Math.round(lower[2] + (upper[2] - lower[2]) * t),
        Math.round(lower[3] + (upper[3] - lower[3]) * t),
      ]
    }
  }
  const last = HEAT_RAMP[HEAT_RAMP.length - 1]
  return [last[1], last[2], last[3]]
}

// The alpha one spot adds: strong for a few points, fainter as they pile up.
function heatSpotAlpha(count) {
  if (count <= 0) {
    return 0
  }
  return Math.min(0.6, Math.max(0.04, 3 / Math.sqrt(count)))
}

function drawHeatDensity(canvas, points, width, height) {
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const context = canvas.getContext('2d')
  if (!context) {
    return
  }
  context.clearRect(0, 0, canvas.width, canvas.height)
  if (!points.length) {
    return
  }
  const alpha = heatSpotAlpha(points.length)
  const radius = HEAT_SPOT_RADIUS
  for (let i = 0; i < points.length; i++) {
    const x = (points[i].px / 1000) * canvas.width
    const y = (points[i].py / 1000) * canvas.height
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(0, 'rgba(0, 0, 0, ' + alpha + ')')
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    context.fillStyle = gradient
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  }
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const data = image.data
  for (let offset = 0; offset < data.length; offset += 4) {
    const summed = data[offset + 3] / 255
    if (summed === 0) {
      continue
    }
    const rgb = heatRampColor(summed)
    data[offset] = rgb[0]
    data[offset + 1] = rgb[1]
    data[offset + 2] = rgb[2]
    data[offset + 3] = Math.round(Math.min(1, 0.15 + summed * 0.85) * 255)
  }
  context.putImageData(image, 0, 0)
}

function heatNode(tag, cssText, text) {
  const node = document.createElement(tag)
  node.style.cssText = cssText
  if (text) {
    node.textContent = text
  }
  return node
}

function heatButton(label, onClick) {
  const button = heatNode(
    'button',
    'pointer-events:auto;border:1px solid #9ca3af;background:#fff;color:#111827;border-radius:6px;padding:4px 10px;font:12px/1.2 system-ui,sans-serif;cursor:pointer',
    label
  )
  button.type = 'button'
  button.addEventListener('click', onClick)
  return button
}

function removeOwnerHeatmap() {
  if (!ownerHeatmap) {
    return
  }
  try {
    if (ownerHeatmap.root.parentNode) {
      ownerHeatmap.root.parentNode.removeChild(ownerHeatmap.root)
    }
    if (ownerHeatmap.legend.parentNode) {
      ownerHeatmap.legend.parentNode.removeChild(ownerHeatmap.legend)
    }
    window.removeEventListener('resize', ownerHeatmap.onResize)
  } catch (e) {
    /* nothing to undo */
  }
  ownerHeatmap = null
}

function vcLabel(vc) {
  return vc === 'm' ? 'Mobile' : vc === 't' ? 'Tablet' : 'Desktop'
}

// Lays the map out over the document: the density canvas (or the scroll
// bands), and a labelled box on every element with a share of the clicks.
// Runs again, debounced, when the window resizes.
function layoutOwnerHeatmap() {
  const state = ownerHeatmap
  if (!state) {
    return
  }
  const width = documentWidth()
  const height = documentHeight()
  const root = state.root
  root.style.width = width + 'px'
  root.style.height = height + 'px'
  while (root.firstChild) {
    root.removeChild(root.firstChild)
  }

  if (state.mode === 'clicks') {
    const canvas = heatNode('canvas', 'position:absolute;inset:0;width:100%;height:100%')
    root.appendChild(canvas)
    const ratio = height / Math.max(1, width)
    drawHeatDensity(
      canvas,
      state.data.points,
      HEAT_DENSITY_WIDTH,
      Math.min(HEAT_DENSITY_MAX_HEIGHT, Math.max(1, HEAT_DENSITY_WIDTH * ratio))
    )
    const elements = state.data.elements || []
    const scrollX = window.scrollX || 0
    const scrollY = window.scrollY || 0
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i]
      if (element.share < HEAT_LABELED_SHARE_MIN) {
        continue
      }
      const target = document.querySelector('[' + ELEMENT_MARKER_ATTR + '="' + element.el + '"]')
      if (!target) {
        continue
      }
      const rect = target.getBoundingClientRect()
      const warning = element.rage > 0 || element.dead > 0
      const color = warning ? '#d97706' : '#2563eb'
      const box = heatNode(
        'div',
        'position:absolute;box-sizing:border-box;border:2px solid ' +
          color +
          ';left:' +
          (rect.left + scrollX) +
          'px;top:' +
          (rect.top + scrollY) +
          'px;width:' +
          rect.width +
          'px;height:' +
          rect.height +
          'px'
      )
      const label =
        element.share.toFixed(element.share < 10 ? 1 : 0) +
        '% · ' +
        element.clicks +
        ' clicks' +
        (element.rage > 0 ? ' · ' + element.rage + ' rage' : '') +
        (element.dead > 0 ? ' · ' + element.dead + ' dead' : '')
      box.appendChild(
        heatNode(
          'span',
          'position:absolute;left:-2px;top:0;transform:translateY(-100%);padding:2px 8px;border-radius:4px 4px 0 0;background:' +
            color +
            ';color:#fff;font:12px/1.4 system-ui,sans-serif;white-space:nowrap',
          label
        )
      )
      root.appendChild(box)
    }
  } else {
    const bands = state.data.scroll || []
    const reached = []
    for (let i = 0; i < HEAT_BANDS; i++) {
      reached.push(0)
    }
    for (let i = 0; i < bands.length; i++) {
      if (bands[i].band >= 0 && bands[i].band < HEAT_BANDS) {
        reached[bands[i].band] = bands[i].reachedPct
      }
    }
    for (let i = 0; i < HEAT_BANDS; i++) {
      const band = heatNode(
        'div',
        'position:absolute;left:0;right:0;top:' +
          (i * 100) / HEAT_BANDS +
          '%;height:' +
          100 / HEAT_BANDS +
          '%;border-top:1px dashed rgba(255,255,255,0.6);background:rgba(239,68,68,' +
          (0.08 + (reached[i] / 100) * 0.42) +
          ')'
      )
      band.appendChild(
        heatNode(
          'span',
          'position:absolute;top:6px;right:10px;padding:2px 8px;border-radius:4px;background:#111827;color:#f9fafb;font:12px/1.4 system-ui,sans-serif;white-space:nowrap',
          Math.round(reached[i]) + '% reach here'
        )
      )
      root.appendChild(band)
    }
  }
}

function renderOwnerHeatmap(data, vc) {
  removeOwnerHeatmap()
  if (!document.body) {
    return
  }
  const root = heatNode(
    'div',
    'position:absolute;left:0;top:0;pointer-events:none;z-index:' + HEAT_Z_INDEX
  )
  root.setAttribute(HEAT_ROOT_ATTR, '')
  const legend = heatNode(
    'div',
    'position:fixed;left:12px;top:12px;display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;background:rgba(17,24,39,0.92);color:#f9fafb;font:12px/1.4 system-ui,sans-serif;z-index:' +
      (HEAT_Z_INDEX + 1) +
      ';pointer-events:auto;box-shadow:0 2px 8px rgba(0,0,0,0.3)'
  )
  legend.setAttribute(HEAT_ROOT_ATTR, 'legend')
  const text = heatNode('span', '')
  const toggle = heatButton('', function () {
    if (!ownerHeatmap) {
      return
    }
    ownerHeatmap.mode = ownerHeatmap.mode === 'clicks' ? 'scroll' : 'clicks'
    updateLegend()
    layoutOwnerHeatmap()
  })
  const close = heatButton('Close', removeOwnerHeatmap)
  legend.appendChild(text)
  legend.appendChild(toggle)
  legend.appendChild(close)

  let resizeTimer = null
  const onResize = function () {
    if (resizeTimer) {
      clearTimeout(resizeTimer)
    }
    resizeTimer = setTimeout(layoutOwnerHeatmap, HEAT_RELAYOUT_MS)
  }

  ownerHeatmap = { root: root, legend: legend, data: data, mode: 'clicks', onResize: onResize }

  function updateLegend() {
    const clicks = (data.points || []).length
    const sample = data.sampleRate < 1 ? ' (' + Math.round(data.sampleRate * 100) + '% sample)' : ''
    text.textContent =
      (ownerHeatmap.mode === 'clicks' ? 'Clicks' : 'Scroll') +
      ' · ' +
      vcLabel(vc) +
      ' · Last ' +
      HEAT_RANGE_DAYS +
      ' days · ' +
      (clicks ? clicks + ' clicks' + sample : 'no clicks yet') +
      ' · resize the window for another device'
    toggle.textContent = ownerHeatmap.mode === 'clicks' ? 'Show scroll' : 'Show clicks'
  }

  updateLegend()
  document.body.appendChild(root)
  document.body.appendChild(legend)
  window.addEventListener('resize', onResize)
  layoutOwnerHeatmap()
}

// Fetches this page's map for the viewport class in use and draws it.
// Resolves false when there is nothing to draw (no token, bad token, the
// owner looking at a page the site never served) and never throws.
export function showOwnerHeatmap(token) {
  if (typeof window === 'undefined' || !token || !SERVER_URL || !PUBLIC_KEY) {
    return Promise.resolve(false)
  }
  const vc = viewportClass()
  const path = window.location.pathname || '/'
  return fetch(heatmapUrl(token, path, vc), { method: 'GET' })
    .then(function (response) {
      if (!response || response.status >= 400 || typeof response.json !== 'function') {
        throw new Error('heatmap unavailable')
      }
      return response.json()
    })
    .then(function (data) {
      renderOwnerHeatmap(data, vc)
      return true
    })
    .catch(function () {
      return false
    })
}

export function initTeleportAnalytics(options) {
  if (initialized || typeof window === 'undefined') {
    return
  }
  initialized = true

  if (options && Array.isArray(options.excludedPaths)) {
    excludedPaths = options.excludedPaths
  }
  if (options && Array.isArray(options.locales)) {
    siteLocales = options.locales
  }

  ownerHeatmapToken = readOwnerHeatmapToken()
  if (ownerHeatmapToken) {
    // The owner reading the map is not a visit: nothing is tracked for this
    // view, and the map is drawn instead.
    disabled = true
    showOwnerHeatmap(ownerHeatmapToken)
    return
  }

  if (!isTrackingPossible()) {
    return
  }

  setupIdentity()
  utm = parseUtm()
  observeVitals()
  startMutationObserver()
  landingQueryKeys = parseQueryKeys()

  document.addEventListener('click', onClickCapture, true)
  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('focusout', onFocusOut, true)
  document.addEventListener('invalid', onInvalid, true)
  document.addEventListener('submit', onSubmitCapture, true)
  document.addEventListener('input', onSearchInput, true)
  window.addEventListener('error', onWindowError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      visibleSince = Date.now()
      bandSince = visibleSince
      sendHeartbeat()
    } else {
      if (visibleSince !== null) {
        visibleAccumMs += Date.now() - visibleSince
        visibleSince = null
      }
      settleScrollBand(currentBand)
      sendVitals()
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
      const band = currentScrollBand()
      if (band !== currentBand) {
        settleScrollBand(band)
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
  if (ownerHeatmapToken) {
    // Owner mode follows the owner from page to page: the map of the page
    // they just opened, with the same token while it lasts.
    showOwnerHeatmap(ownerHeatmapToken)
    return
  }
  trackPageview(false)
  sendHeartbeat()
}

// The site's not-found page announced itself (the tracker component sees the
// router on "/404"): the address the visitor asked for is a missing page.
export function trackNotFound() {
  try {
    if (!isTrackingPossible() || !pageLoadId) {
      return
    }
    emitFriction('notfound', null, null)
  } catch (e) {
    /* never break the host page */
  }
}

export { trackOutcome, analyticsIds }

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

// The record a commerce step is about: the product id of the first line, or
// an explicit record id.
function commerceRecordId(detail) {
  if (!detail) {
    return null
  }
  if (detail.recordId != null) {
    return String(detail.recordId)
  }
  if (Array.isArray(detail.items) && detail.items[0] && detail.items[0].item_id != null) {
    return String(detail.items[0].item_id)
  }
  return null
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

    // No pageLoadId: the shopper is on a page kept out of analytics.
    if (!initialized || !isTrackingPossible() || !pageLoadId) {
      return
    }
    if (name === 'purchase') {
      // Money is reported by the site's server (analytics-track-outcome in the
      // checkout workflow), never by the browser. The ledger still runs so a
      // refreshed confirmation page cannot re-push to the merchant's dataLayer.
      claimPurchase(detail && detail.orderId)
      return
    }

    const event = baseEvent('commerce')
    event.name = name
    event.rid = commerceRecordId(detail)
    if (detail && detail.value != null) event.value = detail.value
    if (detail && detail.currency) event.currency = detail.currency
    event.vc = viewportClass()
    enqueue(event)
    // Checkout ends in a redirect to a payment provider, which can tear the page
    // down before the 5s flush timer fires. "begin_checkout" is worth losing
    // nothing of.
    if (name === 'begin_checkout') {
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
      recordId: name === 'purchase' ? null : id,
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
