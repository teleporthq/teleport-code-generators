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

const HEARTBEAT_INTERVAL_MS = 15000
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

function trackPageview(isFirstLoad) {
  if (!isTrackingPossible()) {
    return
  }

  pageLoadId = uuid()
  seq = 0
  currentPath = window.location.pathname || '/'
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

export function trackRouteLeave() {
  trackLeave(false)
}

export function trackRouteChange() {
  trackPageview(false)
  sendHeartbeat()
}
`
