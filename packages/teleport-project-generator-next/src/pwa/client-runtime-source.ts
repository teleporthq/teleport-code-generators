import { WebPush } from '@teleporthq/teleport-shared'
import {
  ACTIVATE_UPDATE_MESSAGE,
  INSTALL_BANNER_SNOOZE_DAYS,
  SERVICE_WORKER_COMPONENT_NAME,
  SERVICE_WORKER_PATH,
  VERSION_MESSAGE,
} from './constants'
import { PwaMessages } from './messages'
import { toJsLiteral } from './source-literals'

/** What the page-side runtime is told about the project. */
export interface ClientRuntimeConfig {
  mode: 'app' | 'notify'
  /** The version of the app this page was built for — the worker built with it reports the same. */
  version: string
  appName: string
  shortName: string
  defaultLocale: string
  prefixedLocales: string[]
  /** The code Next.js also serves the default language under (`/en/checkout`). */
  defaultLocalePrefix: string
  /** Manifest URL per locale (app mode). */
  manifests: Record<string, string>
  themeColor: string
  appleTouchIcon: string | null
  /** The icon beside the install banner's text. */
  bannerIcon: string | null
  /**
   * What the iPhone and iPad launch screen shows (app mode): the background
   * colour, and the icon in its middle when the app has one.
   */
  launchScreen: { backgroundColor: string; icon: string | null } | null
  installBanner: boolean
  /** Pages where no banner or update prompt may cover the content (see the worker). */
  networkOnly: string[]
  push: { vapidPublicKey: string; subscriptionsPath: string } | null
}

/**
 * `components/teleport-service-worker.js`, rendered once from `_app`.
 *
 * - Registers `/sw.js` — in production only, never inside a frame (the editor
 *   canvas and preview sandboxes), never on an insecure origin.
 * - App mode: the manifest link and home-screen tags on every page, the
 *   "new version" prompt, the install banner, and the iPhone and iPad launch
 *   screens.
 * - Publishes `window.__teleportServiceWorker` at module evaluation — before
 *   any page renders — which is the only channel the serialized push and
 *   notification workflow nodes have to the registration.
 *
 * Authored as source text (no backslash, no template literal) because this
 * module embeds it in one; the styles are one CSS string in a plain <style>.
 */
export const buildClientRuntimeSource = (params: {
  config: ClientRuntimeConfig
  messages: Record<string, PwaMessages>
  styles: string
}): string => `import { useCallback, useEffect, useState } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'

const CONFIG = ${toJsLiteral(params.config)}
const MESSAGES = ${toJsLiteral(params.messages)}
const STYLES = ${toJsLiteral(params.styles)}

const WORKER_URL = ${toJsLiteral(SERVICE_WORKER_PATH)}
const GLOBAL_NAME = ${toJsLiteral(WebPush.SERVICE_WORKER_GLOBAL)}
const NOT_CONFIGURED_MESSAGE = ${toJsLiteral(WebPush.NOT_CONFIGURED_MESSAGE)}
const ACTIVATE_UPDATE_MESSAGE = ${toJsLiteral(ACTIVATE_UPDATE_MESSAGE)}
const VERSION_MESSAGE = ${toJsLiteral(VERSION_MESSAGE)}
// How long a worker gets to say which version it is before it is offered anyway.
const VERSION_ANSWER_MS = 3000
const BANNER_DISMISSED_KEY = 'tq-pwa-install-dismissed-at'
const PAGE_VIEWS_KEY = 'tq-pwa-page-views'
const PUSH_SYNCED_KEY = 'tq-pwa-push-synced'
// The install banner waits for the visitor's second page: nobody is asked to
// install a site on the page they landed on.
const BANNER_MIN_PAGE_VIEWS = 2
// The session the page already holds (published by the app's sign-in bridge),
// read to tell whether the saved subscription still belongs to who is signed in.
const AUTH_BRIDGE_GLOBAL = '__teleportNextAuth'
const SESSION_WAIT_MS = 5000
const BANNER_SNOOZE_MS = ${INSTALL_BANNER_SNOOZE_DAYS} * 24 * 60 * 60 * 1000
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000
const UPDATE_OFFER_DELAY_MS = 1000
// iPhone and iPad show a launch image only when one matches the screen exactly,
// so it is drawn on the device: the app's icon on its background colour. It is
// drawn once the page has settled and kept until the next publish.
const LAUNCH_SCREENS_KEY = 'tq-pwa-launch-screens'
const LAUNCH_SCREEN_DELAY_MS = 1500
// The icon's side: a share of the screen's short side, within bounds, in CSS px.
const LAUNCH_ICON_SHARE = 0.3
const LAUNCH_ICON_MIN = 96
const LAUNCH_ICON_MAX = 160
// The corner of a home-screen icon, as a share of its side.
const LAUNCH_ICON_RADIUS = 0.225

function serviceWorkerAvailable() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return false
  }
  if (process.env.NODE_ENV !== 'production' || window.isSecureContext === false) {
    return false
  }
  try {
    return window.self === window.top
  } catch (error) {
    return false
  }
}

let registrationPromise = null

function registerWorker() {
  if (!serviceWorkerAvailable()) {
    return Promise.reject(new Error('Service workers are not available on this page.'))
  }
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker
      .register(WORKER_URL, { scope: '/', updateViaCache: 'none' })
      .then(function () {
        return navigator.serviceWorker.ready
      })
    registrationPromise.catch(function () {
      registrationPromise = null
    })
  }
  return registrationPromise
}

function readStorage(storage, key) {
  try {
    return window[storage].getItem(key)
  } catch (error) {
    return null
  }
}

function writeStorage(storage, key, value) {
  try {
    if (value === null) {
      window[storage].removeItem(key)
    } else {
      window[storage].setItem(key, value)
    }
  } catch (error) {
    // Storage disabled: the banner or the sync simply runs again next time.
  }
}

// Next.js also answers the default language under its own code (/en/checkout).
function withoutLocale(path) {
  const segment = (path.split('/')[1] || '').toLowerCase()
  const locale = CONFIG.prefixedLocales.concat(CONFIG.defaultLocalePrefix).filter(function (candidate) {
    return candidate.toLowerCase() === segment
  })[0]
  return locale ? path.slice(locale.length + 1) || '/' : path
}

function isNetworkOnlyPath(asPath) {
  let path = withoutLocale((asPath || '/').split('?')[0].split('#')[0]).toLowerCase()
  if (path.length > 1 && path.charAt(path.length - 1) === '/') {
    path = path.slice(0, -1)
  }
  return CONFIG.networkOnly.some(function (pattern) {
    return pattern === '/' ? path === '/' : path === pattern || path.indexOf(pattern + '/') === 0
  })
}

function isStandalone() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  } catch (error) {
    return false
  }
}

function isIos() {
  const agent = navigator.userAgent || ''
  return /iphone|ipad|ipod/i.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isIosSafari() {
  const agent = navigator.userAgent || ''
  return isIos() && /safari/i.test(agent) && !/crios|fxios|edgios|opios|gsa/i.test(agent)
}

// Portrait and landscape images in device pixels: an installed app can be
// opened either way up.
function launchScreenLayout() {
  const ratio = window.devicePixelRatio || 1
  const screen = window.screen || { width: 0, height: 0 }
  const short = Math.round(Math.min(screen.width, screen.height) * ratio)
  const long = Math.round(Math.max(screen.width, screen.height) * ratio)
  return {
    ratio: ratio,
    sizes: [
      { orientation: 'portrait', width: short, height: long },
      { orientation: 'landscape', width: long, height: short },
    ],
  }
}

function loadLaunchIcon() {
  return new Promise(function (resolve) {
    if (!CONFIG.launchScreen.icon) {
      resolve(null)
      return
    }
    const image = new window.Image()
    image.onload = function () {
      resolve(image)
    }
    image.onerror = function () {
      resolve(null)
    }
    image.src = CONFIG.launchScreen.icon
  })
}

// toBlob encodes away from the page where the browser can; a link carries the
// image as a data URL.
function canvasToDataUrl(canvas) {
  return new Promise(function (resolve) {
    const direct = function () {
      try {
        resolve(canvas.toDataURL('image/png'))
      } catch (error) {
        resolve(null)
      }
    }
    if (typeof canvas.toBlob !== 'function' || typeof window.FileReader !== 'function') {
      direct()
      return
    }
    canvas.toBlob(function (blob) {
      if (!blob) {
        direct()
        return
      }
      const reader = new window.FileReader()
      reader.onload = function () {
        resolve(typeof reader.result === 'string' ? reader.result : null)
      }
      reader.onerror = direct
      reader.readAsDataURL(blob)
    }, 'image/png')
  })
}

function drawLaunchScreen(icon, size, ratio) {
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) {
    return Promise.resolve(null)
  }
  context.fillStyle = CONFIG.launchScreen.backgroundColor
  context.fillRect(0, 0, size.width, size.height)
  if (icon) {
    const cssSide = Math.min(
      LAUNCH_ICON_MAX,
      Math.max(LAUNCH_ICON_MIN, (Math.min(size.width, size.height) / ratio) * LAUNCH_ICON_SHARE)
    )
    const side = Math.round(cssSide * ratio)
    const x = Math.round((size.width - side) / 2)
    const y = Math.round((size.height - side) / 2)
    const radius = side * LAUNCH_ICON_RADIUS
    context.save()
    context.beginPath()
    context.moveTo(x + radius, y)
    context.arcTo(x + side, y, x + side, y + side, radius)
    context.arcTo(x + side, y + side, x, y + side, radius)
    context.arcTo(x, y + side, x, y, radius)
    context.arcTo(x, y, x + side, y, radius)
    context.closePath()
    context.clip()
    context.drawImage(icon, x, y, side, side)
    context.restore()
  }
  return canvasToDataUrl(canvas)
}

function readLaunchScreens(key) {
  try {
    const stored = JSON.parse(readStorage('localStorage', LAUNCH_SCREENS_KEY) || 'null')
    return stored && stored.key === key && Array.isArray(stored.screens) ? stored.screens : null
  } catch (error) {
    return null
  }
}

function pushSupported() {
  return serviceWorkerAvailable() && 'PushManager' in window && typeof Notification !== 'undefined'
}

function base64UrlToBytes(value) {
  const padded = (value + '==='.slice((value.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(padded)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index++) {
    bytes[index] = raw.charCodeAt(index)
  }
  return bytes
}

// A browser that cannot tell which key a subscription was made with is
// trusted: the app only sends to subscriptions stored under the current key.
function madeWithKey(subscription, key) {
  const current = subscription.options && subscription.options.applicationServerKey
  if (!current) {
    return true
  }
  const bytes = new Uint8Array(current)
  if (bytes.length !== key.length) {
    return false
  }
  for (let index = 0; index < key.length; index++) {
    if (bytes[index] !== key[index]) {
      return false
    }
  }
  return true
}

function describeSubscription(subscription) {
  const json = subscription.toJSON()
  return {
    success: true,
    subscribed: true,
    permission: 'granted',
    endpoint: json.endpoint || '',
    expirationTime: json.expirationTime == null ? null : json.expirationTime,
    keys: { p256dh: (json.keys && json.keys.p256dh) || '', auth: (json.keys && json.keys.auth) || '' },
  }
}

function failure(message, details) {
  return Object.assign({ success: false, error: message }, details)
}

function unsupportedMessage() {
  if (!CONFIG.push) {
    return NOT_CONFIGURED_MESSAGE
  }
  if (isIos() && !isStandalone()) {
    return 'On iPhone and iPad, add this site to the Home Screen and open it from there to turn on notifications.'
  }
  return 'This browser cannot receive push notifications.'
}

function authSecret(subscription) {
  const json = subscription.toJSON()
  return (json.keys && json.keys.auth) || ''
}

// Who is signed in, as the session the page already holds says: '' for a
// visitor, and on a site without sign-in.
async function signedInUserKey() {
  const bridge = window[AUTH_BRIDGE_GLOBAL]
  if (!bridge || typeof bridge.getSession !== 'function') {
    return ''
  }
  let snapshot = bridge.getSession()
  const deadline = Date.now() + SESSION_WAIT_MS
  while (snapshot && snapshot.status === 'loading' && Date.now() < deadline) {
    await new Promise(function (resolve) {
      window.setTimeout(resolve, 100)
    })
    snapshot = bridge.getSession()
  }
  const user = snapshot && snapshot.status === 'authenticated' && snapshot.session ? snapshot.session.user : null
  return user ? String(user.id || user.email || '') : ''
}

function syncMarker(subscription, userKey) {
  return JSON.stringify({ endpoint: subscription.endpoint, user: userKey })
}

// previous is the subscription this one replaces, with its secret — the
// proof that it was this browser's.
async function saveSubscription(subscription, previous, userKey) {
  const response = await fetch(CONFIG.push.subscriptionsPath, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      previousEndpoint: previous ? previous.endpoint : null,
      previousAuth: previous ? previous.auth : null,
      applicationServerKey: CONFIG.push.vapidPublicKey,
    }),
  })
  if (!response.ok) {
    const data = await response.json().catch(function () {
      return null
    })
    throw new Error((data && data.error) || 'The subscription could not be saved (HTTP ' + response.status + ').')
  }
  writeStorage('sessionStorage', PUSH_SYNCED_KEY, syncMarker(subscription, userKey))
}

// The browser's subscription when it was made with the project's CURRENT key.
async function subscriptionWithCurrentKey(registration) {
  const existing = await registration.pushManager.getSubscription()
  return existing && madeWithKey(existing, base64UrlToBytes(CONFIG.push.vapidPublicKey)) ? existing : null
}

// Returns a subscription made with the project's CURRENT key, replacing one
// made with a key that has since been regenerated; created when it is new.
async function currentSubscription(registration, create) {
  const key = base64UrlToBytes(CONFIG.push.vapidPublicKey)
  const existing = await registration.pushManager.getSubscription()
  if (existing && madeWithKey(existing, key)) {
    return { subscription: existing, previous: null, created: false }
  }
  if (!existing && !create) {
    return { subscription: null, previous: null, created: false }
  }
  const previous = existing ? { endpoint: existing.endpoint, auth: authSecret(existing) } : null
  if (existing) {
    await existing.unsubscribe().catch(function () {})
  }
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  return { subscription: subscription, previous: previous, created: true }
}

async function subscribeToPush() {
  if (!CONFIG.push || !pushSupported()) {
    return failure(unsupportedMessage(), {
      subscribed: false,
      permission: typeof Notification === 'undefined' ? 'default' : Notification.permission,
    })
  }
  try {
    let permission = Notification.permission
    if (permission === 'default') {
      permission = await Notification.requestPermission()
    }
    if (permission !== 'granted') {
      return failure('Notifications are blocked for this site. Allow them in the browser settings to subscribe.', {
        subscribed: false,
        permission: permission,
      })
    }
    const registration = await registerWorker()
    const result = await currentSubscription(registration, true)
    try {
      await saveSubscription(result.subscription, result.previous, await signedInUserKey())
    } catch (error) {
      // A subscription made just now that the app could not store would look
      // subscribed while no notification can reach it.
      if (result.created) {
        await result.subscription.unsubscribe().catch(function () {})
      }
      throw error
    }
    return describeSubscription(result.subscription)
  } catch (error) {
    return failure((error && error.message) || 'The push subscription failed.', {
      subscribed: false,
      permission: Notification.permission,
    })
  }
}

async function unsubscribeFromPush() {
  if (!CONFIG.push) {
    return failure(unsupportedMessage(), { unsubscribed: false })
  }
  if (!pushSupported()) {
    return { success: true, unsubscribed: false }
  }
  try {
    const registration = await registerWorker()
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      return { success: true, unsubscribed: false }
    }
    const endpoint = subscription.endpoint
    const auth = authSecret(subscription)
    await subscription.unsubscribe()
    writeStorage('sessionStorage', PUSH_SYNCED_KEY, null)
    await fetch(CONFIG.push.subscriptionsPath, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: endpoint, auth: auth }),
    }).catch(function () {
      // The stored copy is removed the first time a send reaches the dead endpoint.
    })
    return { success: true, unsubscribed: true }
  } catch (error) {
    return failure((error && error.message) || 'The push subscription could not be removed.', { unsubscribed: false })
  }
}

async function getPushSubscription() {
  const permission = typeof Notification === 'undefined' ? 'default' : Notification.permission
  if (!CONFIG.push || !pushSupported()) {
    return { success: true, supported: false, permission: permission, subscribed: false, endpoint: '' }
  }
  try {
    const registration = await registerWorker()
    const subscription = await subscriptionWithCurrentKey(registration)
    const subscribed = !!subscription && permission === 'granted'
    return { success: true, supported: true, permission: permission, subscribed: subscribed, endpoint: subscribed ? subscription.endpoint : '' }
  } catch (error) {
    return { success: true, supported: false, permission: permission, subscribed: false, endpoint: '' }
  }
}

// Chrome on Android refuses the page-level Notification constructor; a
// notification shown by the worker works everywhere and returns the visitor to
// this page when clicked.
async function showNotification(title, options) {
  const registration = await registerWorker()
  await registration.showNotification(title, Object.assign({}, options, { data: { url: window.location.href } }))
}

if (typeof window !== 'undefined') {
  window[GLOBAL_NAME] = {
    register: registerWorker,
    showNotification: showNotification,
    push: CONFIG.push
      ? { subscribe: subscribeToPush, unsubscribe: unsubscribeFromPush, getSubscription: getPushSubscription }
      : null,
  }
}

// The version a worker says it was built for; null when it does not answer.
function workerVersion(worker) {
  return new Promise(function (resolve) {
    let channel
    try {
      channel = new MessageChannel()
    } catch (error) {
      resolve(null)
      return
    }
    const timer = window.setTimeout(function () {
      resolve(null)
    }, VERSION_ANSWER_MS)
    channel.port1.onmessage = function (event) {
      window.clearTimeout(timer)
      resolve(event.data && typeof event.data.version === 'string' ? event.data.version : null)
    }
    worker.postMessage({ type: VERSION_MESSAGE }, [channel.port2])
  })
}

function useWorkerUpdate() {
  const [waitingWorker, setWaitingWorker] = useState(null)

  useEffect(function () {
    if (CONFIG.mode !== 'app' || !serviceWorkerAvailable()) {
      return undefined
    }
    let active = true
    let registration = null
    let lastCheck = Date.now()

    // The worker takes over by itself when nothing was cached before it, so an
    // "installed" worker is only considered once it is still waiting a moment
    // later. Pages load from the network, so a page that shows up with a
    // waiting worker built for its own version is already current: that worker
    // takes over quietly. Only a page loaded before the publish is offered the
    // refresh.
    const stillWaiting = function (worker) {
      return active && registration && registration.waiting === worker && !!navigator.serviceWorker.controller
    }
    const offer = function (worker) {
      window.setTimeout(function () {
        if (!stillWaiting(worker)) {
          return
        }
        workerVersion(worker).then(function (version) {
          if (!stillWaiting(worker)) {
            return
          }
          if (version === CONFIG.version) {
            worker.postMessage({ type: ACTIVATE_UPDATE_MESSAGE })
          } else {
            setWaitingWorker(worker)
          }
        })
      }, UPDATE_OFFER_DELAY_MS)
      // A newer publish replaced it before the visitor answered: that one is offered instead.
      worker.addEventListener('statechange', function () {
        if (active && worker.state === 'redundant') {
          setWaitingWorker(function (current) {
            return current === worker ? null : current
          })
        }
      })
    }
    const track = function () {
      const worker = registration && registration.installing
      if (!worker) {
        return
      }
      worker.addEventListener('statechange', function () {
        if (worker.state === 'installed') {
          offer(worker)
        }
      })
    }
    const checkForUpdate = function () {
      if (document.visibilityState !== 'visible' || !registration || Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) {
        return
      }
      lastCheck = Date.now()
      registration.update().catch(function () {})
    }

    registerWorker()
      .then(function (ready) {
        if (!active) {
          return
        }
        registration = ready
        if (ready.waiting) {
          offer(ready.waiting)
        }
        ready.addEventListener('updatefound', track)
      })
      .catch(function () {})
    document.addEventListener('visibilitychange', checkForUpdate)

    return function () {
      active = false
      document.removeEventListener('visibilitychange', checkForUpdate)
      if (registration) {
        registration.removeEventListener('updatefound', track)
      }
    }
  }, [])

  const apply = useCallback(function () {
    if (!waitingWorker) {
      return
    }
    // Another open tab already applied it: this page only has to reload.
    if (waitingWorker.state === 'activating' || waitingWorker.state === 'activated') {
      window.location.reload()
      return
    }
    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!reloading) {
        reloading = true
        window.location.reload()
      }
    })
    waitingWorker.postMessage({ type: ACTIVATE_UPDATE_MESSAGE })
  }, [waitingWorker])

  const dismiss = useCallback(function () {
    setWaitingWorker(null)
  }, [])

  return { available: !!waitingWorker, apply: apply, dismiss: dismiss }
}

// Pages this visitor has viewed, across visits, counted up to what the banner
// waits for — and in memory too, for a browser that keeps no storage.
let pageViewsThisLoad = 0
function usePageViews(counting, asPath) {
  const [views, setViews] = useState(0)

  useEffect(function () {
    if (!counting) {
      return
    }
    pageViewsThisLoad += 1
    const stored = Number(readStorage('localStorage', PAGE_VIEWS_KEY) || 0)
    const counted = Math.min(Math.max(stored + 1, pageViewsThisLoad), BANNER_MIN_PAGE_VIEWS)
    writeStorage('localStorage', PAGE_VIEWS_KEY, String(counted))
    setViews(counted)
  }, [counting, asPath])

  return views
}

function useInstallBanner() {
  const [promptEvent, setPromptEvent] = useState(null)
  const [iosHint, setIosHint] = useState(false)

  useEffect(function () {
    if (CONFIG.mode !== 'app' || !CONFIG.installBanner || isStandalone()) {
      return undefined
    }
    const dismissedAt = Number(readStorage('localStorage', BANNER_DISMISSED_KEY) || 0)
    if (dismissedAt && Date.now() - dismissedAt < BANNER_SNOOZE_MS) {
      return undefined
    }
    const onBeforeInstallPrompt = function (event) {
      event.preventDefault()
      setPromptEvent(event)
    }
    const onInstalled = function () {
      setPromptEvent(null)
      setIosHint(false)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    if (isIosSafari()) {
      setIosHint(true)
    }
    return function () {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const snooze = useCallback(function () {
    writeStorage('localStorage', BANNER_DISMISSED_KEY, String(Date.now()))
    setPromptEvent(null)
    setIosHint(false)
  }, [])

  const install = useCallback(function () {
    if (!promptEvent) {
      return
    }
    const event = promptEvent
    setPromptEvent(null)
    event.prompt()
    Promise.resolve(event.userChoice)
      .then(function (choice) {
        if (!choice || choice.outcome !== 'accepted') {
          writeStorage('localStorage', BANNER_DISMISSED_KEY, String(Date.now()))
        }
      })
      .catch(function () {})
  }, [promptEvent])

  return { visible: !!promptEvent || iosHint, ios: !promptEvent && iosHint, install: install, snooze: snooze }
}

// Only iPhone and iPad read these, at the moment the site is added to the home
// screen; every other browser takes its launch screen from the manifest.
function useLaunchScreens() {
  const [screens, setScreens] = useState([])

  useEffect(function () {
    if (CONFIG.mode !== 'app' || !CONFIG.launchScreen || !isIos() || isStandalone()) {
      return undefined
    }
    const layout = launchScreenLayout()
    if (!layout.sizes[0].width || !layout.sizes[0].height) {
      return undefined
    }
    const key = [CONFIG.version, layout.sizes[0].width, layout.sizes[0].height].join('|')
    const stored = readLaunchScreens(key)
    if (stored) {
      setScreens(stored)
      return undefined
    }
    let active = true
    const timer = window.setTimeout(function () {
      loadLaunchIcon()
        .then(function (icon) {
          return Promise.all(
            layout.sizes.map(function (size) {
              return drawLaunchScreen(icon, size, layout.ratio).then(function (href) {
                return href ? { orientation: size.orientation, href: href } : null
              })
            })
          )
        })
        .then(function (drawn) {
          const ready = drawn.filter(Boolean)
          if (!active || ready.length === 0) {
            return
          }
          writeStorage('localStorage', LAUNCH_SCREENS_KEY, JSON.stringify({ key: key, screens: ready }))
          setScreens(ready)
        })
        .catch(function () {})
    }, LAUNCH_SCREEN_DELAY_MS)
    return function () {
      active = false
      window.clearTimeout(timer)
    }
  }, [])

  return screens
}

// Keeps a visitor's existing subscription on the project's current key and
// linked to whoever is signed in; never subscribes anyone by itself.
function usePushSubscriptionSync() {
  useEffect(function () {
    if (!CONFIG.push || !pushSupported() || Notification.permission !== 'granted') {
      return undefined
    }
    // Saved again whenever the browser, its key or the signed-in user differs
    // from the last save in this tab — a sign-in through Google, which reloads
    // the page, included.
    const sync = function (force) {
      registerWorker()
        .then(function (registration) {
          return currentSubscription(registration, false)
        })
        .then(async function (result) {
          if (!result.subscription) {
            return undefined
          }
          const userKey = await signedInUserKey()
          const synced = readStorage('sessionStorage', PUSH_SYNCED_KEY) === syncMarker(result.subscription, userKey)
          if (synced && !force && !result.previous) {
            return undefined
          }
          return saveSubscription(result.subscription, result.previous, userKey)
        })
        .catch(function () {})
    }
    const onUserChanged = function () {
      sync(true)
    }
    sync(false)
    window.addEventListener('teleport:auth-user-changed', onUserChanged)
    return function () {
      window.removeEventListener('teleport:auth-user-changed', onUserChanged)
    }
  }, [])
}

function UpdatePrompt(props) {
  return (
    <div className="tq-pwa-toast" role="status" aria-live="polite">
      <p className="tq-pwa-toast-text">{props.messages.updateBody}</p>
      <div className="tq-pwa-actions">
        <button type="button" className="tq-pwa-secondary" onClick={props.onDismiss}>
          {props.messages.dismissAction}
        </button>
        <button type="button" className="tq-pwa-primary" onClick={props.onApply}>
          {props.messages.updateAction}
        </button>
      </div>
    </div>
  )
}

function InstallBanner(props) {
  // split/join, not replace: a "$" in the app's name must stay as typed.
  const title = props.messages.installTitle.split('{app}').join(CONFIG.shortName)
  return (
    <div className="tq-pwa-toast" role="region" aria-label={title}>
      {CONFIG.bannerIcon ? <img className="tq-pwa-icon" src={CONFIG.bannerIcon} alt="" width="40" height="40" /> : null}
      <div className="tq-pwa-copy">
        <p className="tq-pwa-title">{title}</p>
        <p className="tq-pwa-toast-text">{props.ios ? props.messages.iosInstallBody : props.messages.installBody}</p>
      </div>
      <div className="tq-pwa-actions">
        <button type="button" className="tq-pwa-secondary" onClick={props.onDismiss}>
          {props.messages.dismissAction}
        </button>
        {props.ios ? null : (
          <button type="button" className="tq-pwa-primary" onClick={props.onInstall}>
            {props.messages.installAction}
          </button>
        )}
      </div>
    </div>
  )
}

export default function ${SERVICE_WORKER_COMPONENT_NAME}() {
  const router = useRouter()
  const update = useWorkerUpdate()
  const banner = useInstallBanner()
  const pageViews = usePageViews(CONFIG.mode === 'app' && CONFIG.installBanner, router ? router.asPath : '/')
  const launchScreens = useLaunchScreens()
  usePushSubscriptionSync()

  if (CONFIG.mode !== 'app') {
    return null
  }

  const locale = (router && router.locale) || CONFIG.defaultLocale
  const messages = MESSAGES[locale] || MESSAGES[CONFIG.defaultLocale]
  const quietPage = isNetworkOnlyPath(router ? router.asPath : '/')
  const showBanner = banner.visible && pageViews >= BANNER_MIN_PAGE_VIEWS

  return (
    <>
      <Head>
        <link key="tq-pwa-manifest" rel="manifest" href={CONFIG.manifests[locale] || CONFIG.manifests[CONFIG.defaultLocale]} crossOrigin="use-credentials" />
        <meta key="tq-pwa-theme-color" name="theme-color" content={CONFIG.themeColor} />
        <meta key="tq-pwa-capable" name="mobile-web-app-capable" content="yes" />
        <meta key="tq-pwa-apple-capable" name="apple-mobile-web-app-capable" content="yes" />
        <meta key="tq-pwa-apple-title" name="apple-mobile-web-app-title" content={CONFIG.shortName} />
        <meta key="tq-pwa-apple-status-bar" name="apple-mobile-web-app-status-bar-style" content="default" />
        {CONFIG.appleTouchIcon ? <link key="tq-pwa-apple-icon" rel="apple-touch-icon" href={CONFIG.appleTouchIcon} /> : null}
        {launchScreens.map(function (screen) {
          return (
            <link
              key={'tq-pwa-launch-' + screen.orientation}
              rel="apple-touch-startup-image"
              media={'(orientation: ' + screen.orientation + ')'}
              href={screen.href}
            />
          )
        })}
      </Head>
      {!quietPage && (update.available || showBanner) ? <style dangerouslySetInnerHTML={{ __html: STYLES }} /> : null}
      {!quietPage && update.available ? (
        <UpdatePrompt messages={messages} onApply={update.apply} onDismiss={update.dismiss} />
      ) : null}
      {!quietPage && !update.available && showBanner ? (
        <InstallBanner messages={messages} ios={banner.ios} onInstall={banner.install} onDismiss={banner.snooze} />
      ) : null}
    </>
  )
}
`
