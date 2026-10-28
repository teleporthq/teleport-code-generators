import { PageTransition } from '@teleporthq/teleport-shared'
import {
  PAGE_TRANSITION_SLIDE_PX,
  pageTransitionCoverColor,
  resolvePageTransitionOptions,
  sanitizePageTransitionCustom,
} from './page-transition-variants'
import { REVEAL_ON_SCREEN_SOURCES } from './reveal-on-screen-source.generated'

export type PageTransitionConfig = PageTransition.PageTransitionConfig

const EASING_CURVES = PageTransition.PAGE_TRANSITION_EASING_CURVES
const LATE_PICTURE_ATTR = 'data-tq-late-picture'
const {
  BACK_ATTR,
  ORIGIN_X,
  ORIGIN_Y,
  morphHelpersSource,
  pageTransitionDissolves,
  viewTransitionPlan,
} = PageTransition

/**
 * `components/tq-page-transition.js` — wraps the mounted page in `_app` so a
 * route change plays the site's transition: the leaving page runs `exit`, the
 * arriving one runs `initial → animate` (AnimatePresence, mode "wait"), or,
 * for a dissolve and a reveal, the arriving page comes in over the leaving one
 * (below).
 *
 * Direction-aware: the browser's back button plays the preset the other way
 * (`reversePageTransitionPreset`), and the Circle reveal grows from the last
 * pointer press. Both are decided at `routeChangeStart`, BEFORE the key
 * changes, so the page about to leave is re-rendered with the right exit.
 *
 * Six things a naive wrapper gets wrong, handled here:
 * - The leaving page is FROZEN in place (position: fixed at its scroll offset)
 *   for its exit, because Next scrolls the window to the top the moment the new
 *   route resolves — otherwise a long page visibly jumps to its own top while
 *   fading out. Frozen, it no longer gives the document a height, so a
 *   scrollbar that takes room vanished at the click and came back when the
 *   arriving page mounted; that room is held while the page is frozen
 *   (`holdScrollbarGutter`).
 * - Only real page changes transition: query-only and hash navigations keep
 *   the same key, so a filter change or an in-page anchor never re-plays it.
 * - `prefers-reduced-motion` renders the page plainly — no wrapper animation.
 * - A dissolve (Fade, Crossfade) fades the arriving page in OVER the leaving
 *   one, which holds still and opaque underneath until the arrival is in.
 *   Played one after the other, the leaving page faded out to the site's bare
 *   background before the arriving one faded in — an empty screen at every
 *   change; faded both at once, the background showed through the two (a
 *   quarter of it half way). The arriving page is laid on the site's ground and
 *   at least a screen tall (`siteGround`), so nothing of the leaving page shows
 *   through its transparent parts or below a short page; the leaving page takes
 *   no input and is hidden from assistive technology meanwhile.
 * - A reveal (Circle, the Wipes) opens the arriving page OVER the leaving one,
 *   which holds still underneath until the reveal has fully opened. Played one
 *   after the other, the leaving page was wiped away to the site's bare
 *   background first — a white sheet between every two pages. Where the
 *   browser has View Transitions the whole change is one (below); elsewhere
 *   the two pages overlap (AnimatePresence "sync"), the arriving page laid
 *   above the frozen one and the leaving page kept in the document until the
 *   arrival's animation completes (`HoldPage`).
 * - A reveal's clip-path is measured on the screen, not on the page, and never
 *   stays on the page once it has played, nor on the first page
 *   (`revealOnScreen`). Measured on a long page, the circle covered the screen
 *   for nearly all of its run and the new page popped in (a flicker); left on
 *   the whole page, the clip broke the fixed header's blur and the pinned
 *   scenes while scrolling.
 * - The arriving page plays once the pictures on its first screen are decoded:
 *   1200 ms at most while the leaving page still holds the screen (a dissolve,
 *   a reveal, a View Transition), 300 ms once it has gone (a slide plays one
 *   page after the other, and the screen is bare meanwhile). Played at once, it
 *   showed its text on a bare ground and its photographs popped in a moment
 *   later — a flicker at every change. A picture still loading when its page
 *   plays fades in once it has loaded, instead of snapping in (`fadeInWhenLoaded`).
 *
 * The first load never animates in (`initial={false}`): a site should appear,
 * not perform, on arrival.
 *
 * Two kinds of navigation are played as a View Transition instead, with the
 * stylesheet the static HTML export plays between its pages
 * (view-transition-css.ts and morph-source.ts in teleport-shared): every page
 * change on a reveal preset, and following a link with a picture in it to a
 * page showing the same picture (a card into its details hero), where the
 * picture flies from one page into the other — which only a View Transition
 * can do. The browser takes a picture of the leaving page at its next frame,
 * so that page stays in the document until then (a prefetched route can
 * resolve sooner), and pictures the arriving page once it is mounted and its
 * first screen's pictures are decoded. A page that opted out, reduced motion
 * and a browser without View Transitions keep the animation above.
 */
export const generatePageTransitionComponentCode = (config: PageTransitionConfig): string => {
  const curve = EASING_CURVES[config.easing] || EASING_CURVES['ease-out']
  const duration = Number.isFinite(config.duration) && config.duration > 0 ? config.duration : 0.35
  const skipRoutes = Array.isArray(config.skipRoutes)
    ? config.skipRoutes.filter((route) => typeof route === 'string' && route.length > 0)
    : []
  const preset = String(config.preset).replace(/[^a-z-]/g, '')
  const chosen =
    config.options && typeof config.options === 'object'
      ? Object.fromEntries(
          Object.entries(config.options).filter(([, value]) => typeof value === 'string')
        )
      : undefined
  const options = resolvePageTransitionOptions(preset, chosen)
  // "Design your own" carries its states in the UIDL; duration and easing already sit in their own fields.
  const custom =
    preset === 'custom'
      ? sanitizePageTransitionCustom({
          durationSeconds: duration,
          easing: config.easing,
          arrive: config.custom?.arrive as never,
          leave: config.custom?.leave as never,
        })
      : null
  // What plays as a View Transition here: every reveal, and the flight when the
  // author kept it on; a slide with the flight off needs no stylesheet at all.
  const plan = viewTransitionPlan(config, { crossDocument: false })
  const vtCss = plan && (plan.revealsOver || plan.flies) ? plan.css : ''
  const flies = !!plan && plan.flies
  const dissolves = pageTransitionDissolves(preset)
  // A late picture waits unseen, then fades in the way its page did.
  const fadeIn = `opacity ${duration}s cubic-bezier(${curve.join(', ')})`
  const latePictureCss =
    `[${LATE_PICTURE_ATTR}="loading"] { opacity: 0 !important; }\n` +
    `[${LATE_PICTURE_ATTR}="in"] { transition: ${fadeIn} !important; }`
  return `import React from 'react'
import { useRouter } from 'next/router'
import { AnimatePresence, motion, usePresence } from 'framer-motion'

${PageTransition.PAGE_TRANSITION_HELPER_SOURCES.reversePageTransitionPreset}

${PageTransition.PAGE_TRANSITION_HELPER_SOURCES.pageTransitionVariants}

${PageTransition.PAGE_TRANSITION_HELPER_SOURCES.pageTransitionCover}

${PageTransition.PAGE_TRANSITION_HELPER_SOURCES.pageTransitionSkipPattern}

${REVEAL_ON_SCREEN_SOURCES.revealOnScreen}

${morphHelpersSource()}

const PRESET = '${preset}'
// The preset's choices, resolved to words the variants understand.
const OPTIONS = ${JSON.stringify(options)}
const CUSTOM = ${JSON.stringify(custom)}
const ORIGIN_FROM_POINTER = ${options.origin !== 'center'}
const DURATION = ${duration}
const EASE = [${curve.join(', ')}]
const SLIDE_PX = ${PAGE_TRANSITION_SLIDE_PX}
const CENTER = { reverse: false, skip: false, originX: '50%', originY: '50%' }
const PANELS = pageTransitionCover(PRESET)
// Pages that opted out: they appear instantly; leaving them still plays.
const SKIP_ROUTES = ${JSON.stringify(skipRoutes)}
const INSTANT = { initial: {}, animate: {}, exit: {} }
// A reveal (Circle, the Wipes): the arriving page opens over the leaving one.
const REVEAL = (() => {
  const variants = pageTransitionVariants(PRESET, SLIDE_PX, CENTER, OPTIONS, CUSTOM || undefined)
  return !!(variants && variants.animate.clipPath)
})()
// Every page change plays frame by frame, framer writing each value onto the
// page. Run by the browser (framer's default for opacity, clip-path and
// filter), an animation ends one frame before framer writes its last value,
// and for that frame the page shows where it started: a reveal blinks away as
// it completes, a page faded in over the leaving one turns clear and the
// leaving page flashes back, a page that has left shows again. An onUpdate
// handler, even one that does nothing, keeps the animation in framer's own loop.
const stepByFrame = () => {}
// A dissolve (Fade, Crossfade): the arriving page fades in over the leaving
// one, which has no exit of its own — it holds still until the arrival is in.
const DISSOLVE = ${dissolves}
const dissolveOver = (variants) => (DISSOLVE && variants ? Object.assign({}, variants, { exit: {} }) : variants)
// The two pages overlap for a dissolve, and for a reveal without View
// Transitions: the arriving page is laid above the frozen one (a positioned box
// would paint on top of it), at least a screen tall and on the site's ground.
const OVERLAP = REVEAL || DISSOLVE
const OVER = { position: 'relative', zIndex: 1, minHeight: '100vh' }
// Until it plays, the arriving page lies unseen over the leaving one: a click
// there must not land on it.
const UNSEEN = { pointerEvents: 'none' }
const SKIP_PATTERNS = SKIP_ROUTES.map(pageTransitionSkipPattern)
const isSkippedRoute = (key) => SKIP_PATTERNS.some((pattern) => pattern.test(key))
// The cover family paints its panels in the theme colour the editor chose.
const PANEL_COLOR = '${pageTransitionCoverColor(options.color)}'
const PANEL_BASE = { position: 'fixed', top: 0, bottom: 0, zIndex: 2147483000, pointerEvents: 'none', background: PANEL_COLOR }
const panelBounds = (panel) =>
  panel.side === 'left' ? { left: 0, right: '50%' } : panel.side === 'right' ? { left: '50%', right: 0 } : { left: 0, right: 0 }

const routeKeyOf = (url) => String(url || '').split(/[?#]/)[0]

// The page changes played as a View Transition (a reveal; a flying picture), as
// the static export plays them.
const VT_CSS = ${JSON.stringify(vtCss)}
const FLIES = ${flies}
// A page that takes longer than this to arrive switches without the transition.
const ARRIVAL_WAIT_MS = 3000
// An arriving picture still loading is waited for this long, so the flight lands on it.
const MORPH_DECODE_MS = 300
// The arriving page waits this long at most for the pictures on its first
// screen while the leaving page still holds the screen (the two overlap, or the
// browser holds its picture for a View Transition)...
const PICTURE_WAIT_MS = 1200
// ...and this long once the leaving page has gone: the screen is bare meanwhile.
const BARE_PICTURE_WAIT_MS = 300
// A picture still loading when its page plays fades in once it has loaded
// (fadeInWhenLoaded); one still loading after this is shown as it is.
const LATE_PICTURE_WAIT_MS = 5000
const LATE_PICTURE_ATTR = '${LATE_PICTURE_ATTR}'
const LATE_PICTURE_CSS = ${JSON.stringify(latePictureCss)}
const prefersLessMotion = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
// A scrollbar that takes room (Windows, a Mac with a mouse) stays while the
// leaving page is frozen. Frozen, that page no longer gives the document a
// height, so its scrollbar vanished at the click and came back when the
// arriving page mounted: the page jolted sideways by the scrollbar's width, and
// back. Held with overflow-y: scroll, which keeps the scrollbar's track on
// screen in every browser. Measured before the freeze; returns what puts <html>
// back exactly as it was, or null when the scrollbar takes no room.
const holdScrollbarGutter = () => {
  const root = document.documentElement
  if (window.innerWidth - root.clientWidth <= 0) {
    return null
  }
  const own = root.style.getPropertyValue('overflow-y')
  const ownPriority = root.style.getPropertyPriority('overflow-y')
  root.style.setProperty('overflow-y', 'scroll', 'important')
  return () => {
    if (own) {
      root.style.setProperty('overflow-y', own, ownPriority)
    } else {
      root.style.removeProperty('overflow-y')
    }
  }
}
// Sets one property of an element's own style; returns what puts it back
// exactly as it was.
const holdStyle = (element, name, value) => {
  const own = element.style.getPropertyValue(name)
  const ownPriority = element.style.getPropertyPriority(name)
  element.style.setProperty(name, value, 'important')
  return () => {
    if (own) {
      element.style.setProperty(name, own, ownPriority)
    } else {
      element.style.removeProperty(name)
    }
  }
}
// The colour the site paints behind its pages: <html>'s background, else
// <body>'s (the browser paints the canvas with it), else the browser's own. A
// page laid over a leaving one is painted on it, so its transparent parts show
// what they will show once the page is alone, not the page underneath.
const siteGround = () => {
  const painted = (element) => {
    const color = element ? window.getComputedStyle(element).backgroundColor : ''
    return color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)' ? color : ''
  }
  return painted(document.documentElement) || painted(document.body) || 'Canvas'
}
// The page in the document for a route key, if any (a leaving page stays in it
// while the two pages overlap).
const pageIn = (key) =>
  Array.prototype.find.call(
    document.querySelectorAll('[data-tq-page-transition]'),
    (node) => node.getAttribute('data-tq-page-transition') === key
  ) || null
// A page held under the one laid over it takes no input and is hidden from
// assistive technology: inert, or aria-hidden where the browser has no inert.
const setLeaving = (node, leaving) => {
  if (!node) {
    return
  }
  if ('inert' in node) {
    node.inert = leaving
  } else if (leaving) {
    node.setAttribute('aria-hidden', 'true')
  } else {
    node.removeAttribute('aria-hidden')
  }
}
// Runs before the browser paints; the server, which paints nothing, gets the
// ordinary effect (React warns about a layout effect there).
const useBeforePaintEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect
// Settles once the pictures on the arriving page's first screen are decoded, or
// after waitMs (an image the page asks to decode off the main thread paints a
// few frames after the rest of the page), with the pictures still loading.
const picturesReady = (node, waitMs) => {
  const pictures = Array.prototype.filter.call(node.querySelectorAll('img'), (image) => {
    const box = image.getBoundingClientRect()
    return box.bottom > 0 && box.top < window.innerHeight && typeof image.decode === 'function'
  })
  return Promise.race([
    Promise.all(pictures.map((image) => image.decode().catch(() => {}))),
    new Promise((resolve) => setTimeout(resolve, waitMs)),
  ]).then(() => pictures.filter((image) => !image.complete))
}
// A picture still loading when its page plays stays unseen until it has
// loaded, then fades in: shown as it loaded, it snapped in over the page in a
// single frame. One that fails is shown at once, as it would be anyway, and
// none stays unseen past LATE_PICTURE_WAIT_MS.
const fadeInWhenLoaded = (image) => {
  image.setAttribute(LATE_PICTURE_ATTR, 'loading')
  const show = (event) => {
    image.removeEventListener('load', show)
    image.removeEventListener('error', show)
    clearTimeout(giveUp)
    if (event && event.type === 'load') {
      image.setAttribute(LATE_PICTURE_ATTR, 'in')
      setTimeout(() => image.removeAttribute(LATE_PICTURE_ATTR), DURATION * 1000 + 100)
    } else {
      image.removeAttribute(LATE_PICTURE_ATTR)
    }
  }
  const giveUp = setTimeout(show, LATE_PICTURE_WAIT_MS)
  image.addEventListener('load', show)
  image.addEventListener('error', show)
}

// Keeps the leaving page in the document while it is still needed: until the
// browser has pictured it (a View Transition), or until the page laid over it
// has fully come in (the two pages overlap) — or, should that arrival never
// complete, a little after its time.
const HoldPage = ({ pageKey, changeRef, overlapRef }) => {
  const [isPresent, safeToRemove] = usePresence()
  React.useEffect(() => {
    if (isPresent) {
      return
    }
    const change = changeRef.current
    const overlap = overlapRef.current
    if (change && change.leavingKey === pageKey) {
      change.captured.then(safeToRemove)
    } else if (overlap && overlap.leavingKey === pageKey) {
      setLeaving(pageIn(pageKey), true)
      overlap.opened.then(safeToRemove)
      setTimeout(overlap.finish, DURATION * 1000 + PICTURE_WAIT_MS + 1000)
    } else {
      safeToRemove()
    }
  }, [isPresent])
  return null
}

const TqPageTransition = ({ children }) => {
  const router = useRouter()
  const routeKey = routeKeyOf(router.asPath)
  const routeKeyRef = React.useRef(routeKey)
  routeKeyRef.current = routeKey
  const [frozen, setFrozen] = React.useState(null)
  const [context, setContext] = React.useState(CENTER)
  const [panelPhase, setPanelPhase] = React.useState('idle')
  // The page laid over the leaving one while the two overlap, and the ground it is painted on.
  const [over, setOver] = React.useState(null)
  // The page whose arrival may play: the first page at once, every later one
  // once its first screen's pictures are ready.
  const [readyKey, setReadyKey] = React.useState(routeKey)
  const readyKeyRef = React.useRef(routeKey)
  const pageRef = React.useRef(null)
  const popRef = React.useRef(false)
  const pointerRef = React.useRef(null)
  const clickedRef = React.useRef(null)
  const changeRef = React.useRef(null)
  const overlapRef = React.useRef(null)
  // Puts back the scrollbar room held for the frozen page (holdScrollbarGutter).
  const gutterRef = React.useRef(null)
  // Puts back <html>'s scroll-behavior, held instant through a View Transition's page change.
  const scrollRef = React.useRef(null)
  const variants = React.useMemo(
    () =>
      context.skip || context.morph
        ? INSTANT
        : dissolveOver(
            revealOnScreen(pageTransitionVariants(PRESET, SLIDE_PX, context, OPTIONS, CUSTOM || undefined), context.screen)
          ),
    [context]
  )

  // The arriving page is in the document: wait for the pictures on its first
  // screen (and, in a View Transition, for its twin of the flying picture),
  // then let it play — or let the browser picture the new state.
  const setPage = React.useCallback((node) => {
    // A page that goes after the next one has mounted (the two overlapped)
    // leaves the ref to the page still in the document, not to nothing.
    pageRef.current = node || pageIn(routeKeyRef.current)
    const key = node ? node.getAttribute('data-tq-page-transition') : null
    if (key === null || key === readyKeyRef.current) {
      return
    }
    readyKeyRef.current = key
    const change = changeRef.current
    const landing = change && !change.landed && node !== change.leaving ? change : null
    let twin = null
    if (landing) {
      landing.landed = true
      tqMorphClear()
      twin = landing.src ? tqMorphTarget(landing.src) : null
      if (twin) {
        twin.style.viewTransitionName = TQ_MORPH_NAME
      }
    }
    const twinReady =
      twin && !twin.complete && typeof twin.decode === 'function'
        ? Promise.race([
            twin.decode().catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, MORPH_DECODE_MS)),
          ])
        : Promise.resolve()
    const overlap = overlapRef.current
    const held = !!landing || !!(overlap && overlap.arrivingKey === key)
    Promise.all([picturesReady(node, held ? PICTURE_WAIT_MS : BARE_PICTURE_WAIT_MS), twinReady]).then(([loading]) => {
      // A later page may have arrived meanwhile; this one's turn has passed.
      if (readyKeyRef.current === key) {
        // The flight lands on its twin as it is; a page shown at once shows its pictures at once.
        if (!prefersLessMotion() && !isSkippedRoute(key)) {
          loading.filter((image) => image !== twin).forEach(fadeInWhenLoaded)
        }
        setReadyKey(key)
        setPanelPhase((phase) => (phase === 'covered' ? 'uncovering' : phase))
      }
      if (landing) {
        landing.arrive()
      }
    })
  }, [])

  React.useEffect(() => {
    const onPointerDown = (event) => {
      pointerRef.current = { x: event.clientX, y: event.clientY }
    }
    const onClick = (event) => {
      clickedRef.current = event.target && event.target.closest ? event.target.closest('a[href]') : null
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('click', onClick, true)
    }
  }, [])

  React.useEffect(() => {
    router.beforePopState(() => {
      popRef.current = true
      return true
    })
    const root = document.documentElement
    const abandon = (change) => {
      if (!change.landed) {
        change.landed = true
        change.transition.skipTransition()
        change.arrive()
      }
    }
    // A change that does not overlap lets a page still held from the last one
    // go at once, instead of leaving it over the page that appears.
    const letHeldPageGo = () => {
      if (overlapRef.current) {
        overlapRef.current.finish()
      }
    }
    // The page change as a View Transition: every reveal, and a picture in the
    // followed link that the next page shows too (going forward only).
    const startViewChange = (url, pointer, reverse) => {
      if (!VT_CSS || !pageRef.current || typeof document.startViewTransition !== 'function' || prefersLessMotion()) {
        return false
      }
      const image = FLIES && !reverse ? tqMorphSource(url, clickedRef.current) : null
      if (!image && !REVEAL) {
        return false
      }
      const change = { leavingKey: routeKeyRef.current, leaving: pageRef.current, src: image ? image.currentSrc || image.src : null, landed: false }
      change.captured = new Promise((resolve) => {
        change.onCaptured = resolve
      })
      const arrived = new Promise((resolve) => {
        change.arrive = resolve
      })
      tqMorphClear()
      if (image) {
        image.style.viewTransitionName = TQ_MORPH_NAME
      }
      if (reverse) {
        root.setAttribute('${BACK_ATTR}', 'back')
      }
      if (pointer) {
        root.style.setProperty('${ORIGIN_X}', pointer.x + 'px')
        root.style.setProperty('${ORIGIN_Y}', pointer.y + 'px')
      }
      // Nothing is frozen here, so Next's scroll to the arriving page's top
      // follows the site's smooth scrolling (kept for its in-page anchors): the
      // page arrived at the leaving one's offset and glided up through itself.
      // A change replacing one still playing finds the scroll already held.
      if (!scrollRef.current) {
        scrollRef.current = holdStyle(root, 'scroll-behavior', 'auto')
      }
      const settle = () => {
        if (changeRef.current === change) {
          changeRef.current = null
          tqMorphClear()
          root.removeAttribute('${BACK_ATTR}')
          root.style.removeProperty('${ORIGIN_X}')
          root.style.removeProperty('${ORIGIN_Y}')
          if (scrollRef.current) {
            scrollRef.current()
            scrollRef.current = null
          }
        }
      }
      changeRef.current = change
      try {
        change.transition = document.startViewTransition(() => {
          change.onCaptured()
          return arrived
        })
      } catch (error) {
        settle()
        return false
      }
      change.transition.ready.catch(() => {})
      change.transition.finished.then(settle, settle)
      setTimeout(() => abandon(change), ARRIVAL_WAIT_MS)
      return true
    }
    const onRouteChangeStart = (url) => {
      if (routeKeyOf(url) === routeKeyRef.current) {
        return
      }
      const reverse = popRef.current
      popRef.current = false
      // A skipped page appears instantly; leaving it still plays the site's transition.
      // A visitor who asks for less motion gets every page that way. It is read
      // here, never while rendering: the server cannot know it, and a first render
      // that differs from the server's makes React throw the page away.
      const skip = prefersLessMotion() || isSkippedRoute(routeKeyOf(url))
      const pointer = reverse || !ORIGIN_FROM_POINTER ? null : pointerRef.current
      // A reveal is measured on this screen (revealOnScreen); without a press it
      // grows from the screen's centre, not the page's.
      const screen = { width: window.innerWidth, height: window.innerHeight }
      const origin = pointer || { x: screen.width / 2, y: screen.height / 2 }
      const next = { reverse, skip, originX: origin.x + 'px', originY: origin.y + 'px', screen }
      // Back to a page that has not gone yet (the two pages overlapped): it is
      // still in the document, pictures and all, so it plays at once and takes
      // input again.
      const returning = pageIn(routeKeyOf(url))
      if (returning) {
        setLeaving(returning, false)
        readyKeyRef.current = routeKeyOf(url)
        setReadyKey(readyKeyRef.current)
      }
      if (!skip && startViewChange(url, pointer, reverse)) {
        letHeldPageGo()
        setContext(Object.assign({}, next, { morph: true }))
        return
      }
      setContext(next)
      if (PANELS && !skip) {
        setPanelPhase('covering')
      }
      if (OVERLAP && !skip) {
        // The two pages overlap: the leaving page is held under the arriving
        // one until that has fully come in (HoldPage).
        const overlap = { leavingKey: routeKeyRef.current, arrivingKey: routeKeyOf(url) }
        overlap.opened = new Promise((resolve) => {
          overlap.open = resolve
        })
        overlap.finish = () => {
          overlap.open()
          if (overlapRef.current === overlap) {
            overlapRef.current = null
            setOver(null)
          }
        }
        overlapRef.current = overlap
        setOver({ key: overlap.arrivingKey, ground: siteGround() })
      } else {
        letHeldPageGo()
      }
      // A change replacing a cancelled one finds the page still frozen and the
      // room still held: held again, the hold would take the first hold's
      // overflow-y for the page's own and leave it on <html>.
      if (!gutterRef.current) {
        gutterRef.current = holdScrollbarGutter()
      }
      setFrozen({ key: routeKeyRef.current, top: window.scrollY || 0 })
    }
    const onRouteChangeError = () => {
      if (changeRef.current) {
        abandon(changeRef.current)
      }
    }
    router.events.on('routeChangeStart', onRouteChangeStart)
    router.events.on('routeChangeError', onRouteChangeError)
    return () => {
      router.events.off('routeChangeStart', onRouteChangeStart)
      router.events.off('routeChangeError', onRouteChangeError)
      router.beforePopState(() => true)
    }
  }, [router])

  // The room goes back before the paint of the commit that ends the freeze: that
  // commit mounts the arriving page (when the two overlap, lets the leaving page go), so
  // the scrollbar passes straight to the page left in the document. A cancelled
  // change leaves its page frozen until the change replacing it has played, so
  // the room stays with it: Next starts that change a few awaits after the error.
  const releaseGutter = () => {
    if (gutterRef.current) {
      gutterRef.current()
      gutterRef.current = null
    }
  }
  useBeforePaintEffect(() => {
    if (!frozen) {
      releaseGutter()
    }
  }, [frozen])
  React.useEffect(() => releaseGutter, [])

  if (!variants) {
    return children
  }

  const frozenStyle =
    frozen && frozen.key === routeKey
      ? { position: 'fixed', top: -frozen.top, left: 0, right: 0 }
      : undefined
  const overStyle =
    over && over.key === routeKey
      ? Object.assign({ backgroundColor: over.ground }, OVER, readyKey === routeKey ? null : UNSEEN)
      : undefined
  const pageStyle = frozenStyle || overStyle

  const onExitComplete = () => {
    setFrozen(null)
    // The panels open once the arriving page's pictures are ready (setPage).
    if (PANELS && panelPhase === 'covering') {
      setPanelPhase('covered')
    }
  }
  // The page laid over the leaving one has fully come in: let the leaving page go.
  const onPageAnimationComplete = (definition) => {
    const overlap = overlapRef.current
    if (definition === 'animate' && overlap && overlap.arrivingKey === routeKey) {
      overlap.finish()
    }
  }

  return (
    <>
    <AnimatePresence mode={context.morph || !OVERLAP ? 'wait' : 'sync'} initial={false} onExitComplete={onExitComplete}>
      <motion.div
        key={routeKey}
        ref={setPage}
        initial="initial"
        animate={readyKey === routeKey ? 'animate' : 'initial'}
        exit="exit"
        variants={variants}
        transition={{ duration: DURATION, ease: EASE }}
        onUpdate={stepByFrame}
        onAnimationComplete={onPageAnimationComplete}
        style={pageStyle}
        data-tq-page-transition={routeKey}
      >
        {children}
        {VT_CSS || OVERLAP ? <HoldPage pageKey={routeKey} changeRef={changeRef} overlapRef={overlapRef} /> : null}
      </motion.div>
    </AnimatePresence>
    {PANELS
      ? PANELS.map((panel, index) => (
          <motion.div
            key={index}
            aria-hidden="true"
            data-tq-page-transition-panel={index}
            style={Object.assign({}, PANEL_BASE, panelBounds(panel))}
            initial={panel.from}
            animate={panelPhase === 'covering' || panelPhase === 'covered' ? panel.cover : panelPhase === 'uncovering' ? panel.away : panel.from}
            transition={panelPhase === 'idle' ? { duration: 0 } : { duration: DURATION, ease: EASE }}
            onAnimationComplete={() => {
              if (panelPhase === 'uncovering') {
                setPanelPhase('idle')
              }
            }}
          />
        ))
      : null}
    {VT_CSS ? <style dangerouslySetInnerHTML={{ __html: VT_CSS }} /> : null}
    <style dangerouslySetInnerHTML={{ __html: LATE_PICTURE_CSS }} />
    </>
  )
}

export default TqPageTransition
`
}
