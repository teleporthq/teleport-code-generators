import { PageTransition } from '@teleporthq/teleport-shared'
import {
  PAGE_TRANSITION_SLIDE_PX,
  pageTransitionCover,
  pageTransitionCoverColor,
  pageTransitionSkipPattern,
  pageTransitionVariants,
  resolvePageTransitionOptions,
  reversePageTransitionPreset,
  sanitizePageTransitionCustom,
} from './page-transition-variants'
import { revealOnScreen } from './reveal-on-screen'

export type PageTransitionConfig = PageTransition.PageTransitionConfig

const EASING_CURVES = PageTransition.PAGE_TRANSITION_EASING_CURVES
const { ORIGIN_X, ORIGIN_Y, morphHelpersSource, viewTransitionPlan } = PageTransition

/**
 * `components/tq-page-transition.js` — wraps the mounted page in `_app` so a
 * route change plays the site's transition: the leaving page runs `exit`, the
 * arriving one runs `initial → animate` (AnimatePresence, mode "wait").
 *
 * Direction-aware: the browser's back button plays the preset the other way
 * (`reversePageTransitionPreset`), and the Circle reveal grows from the last
 * pointer press. Both are decided at `routeChangeStart`, BEFORE the key
 * changes, so the page about to leave is re-rendered with the right exit.
 *
 * Five things a naive wrapper gets wrong, handled here:
 * - The leaving page is FROZEN in place (position: fixed at its scroll offset)
 *   for its exit, because Next scrolls the window to the top the moment the new
 *   route resolves — otherwise a long page visibly jumps to its own top while
 *   fading out.
 * - Only real page changes transition: query-only and hash navigations keep
 *   the same key, so a filter change or an in-page anchor never re-plays it.
 * - `prefers-reduced-motion` renders the page plainly — no wrapper animation.
 * - A reveal's clip-path (Circle, the Wipes) is measured on the screen, not on
 *   the page, and never stays on the page once it has played, nor on the first
 *   page (`revealOnScreen`). Measured on a long page, the circle covered the
 *   screen for nearly all of its run and the new page popped in (a flicker);
 *   left on the whole page, the clip broke the fixed header's blur and the
 *   pinned scenes while scrolling.
 * - The arriving page plays once the pictures on its first screen are decoded
 *   (300 ms at most). Played at once, it showed its text on a bare ground and
 *   its photographs popped in a moment later — a flicker at every change.
 *
 * The first load never animates in (`initial={false}`): a site should appear,
 * not perform, on arrival.
 *
 * One navigation is played differently: following a link with a picture in
 * it to a page showing the same picture (a card into its details hero). The
 * picture flies from one page into the other, which only a View Transition can
 * do, so that change is one, playing the stylesheet the static HTML export
 * plays between its pages (view-transition-css.ts and morph-source.ts in
 * teleport-shared): the page leaves and arrives as the preset says, the picture
 * flies across both halves. The browser takes a picture of the leaving page at
 * its next frame, so that page stays in the document until then (a prefetched
 * route can resolve sooner), and the arriving page is pictured once it is
 * mounted. Going back, a page that opted out, reduced motion and a browser
 * without View Transitions keep the animation above.
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
  // Only the flight plays as a View Transition here; turned off, nothing needs one.
  const morphPlan =
    config.flyingPictures === false ? null : viewTransitionPlan(config, { crossDocument: false })
  return `import React from 'react'
import { useRouter } from 'next/router'
import { AnimatePresence, motion, usePresence, useReducedMotion } from 'framer-motion'

${reversePageTransitionPreset.toString()}

${pageTransitionVariants.toString()}

${pageTransitionCover.toString()}

${pageTransitionSkipPattern.toString()}

${revealOnScreen.toString()}

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
// A reveal runs frame by frame, writing each clip-path onto the page: run by the
// browser (framer's default for clip-path), the animation ends one frame before
// framer writes its last value, and for that frame the page shows its starting
// clip — the whole page blinks away as the reveal completes.
const REVEAL = (() => {
  const variants = pageTransitionVariants(PRESET, SLIDE_PX, CENTER, OPTIONS, CUSTOM || undefined)
  return !!(variants && variants.animate.clipPath)
})()
const stepByFrame = () => {}
const SKIP_PATTERNS = SKIP_ROUTES.map(pageTransitionSkipPattern)
const isSkippedRoute = (key) => SKIP_PATTERNS.some((pattern) => pattern.test(key))
// The cover family paints its panels in the theme colour the editor chose.
const PANEL_COLOR = '${pageTransitionCoverColor(options.color)}'
const PANEL_BASE = { position: 'fixed', top: 0, bottom: 0, zIndex: 2147483000, pointerEvents: 'none', background: PANEL_COLOR }
const panelBounds = (panel) =>
  panel.side === 'left' ? { left: 0, right: '50%' } : panel.side === 'right' ? { left: '50%', right: 0 } : { left: 0, right: 0 }

const routeKeyOf = (url) => String(url || '').split(/[?#]/)[0]

// The page change with a flying picture, as the static export plays it.
const MORPH_CSS = ${JSON.stringify(morphPlan ? morphPlan.css : '')}
// A page that takes longer than this to arrive switches without the flight.
const MORPH_WAIT_MS = 3000
// An arriving picture still loading is waited for this long, so the flight lands on it.
const MORPH_DECODE_MS = 300
// The arriving page waits this long at most for the pictures on its first screen.
const PICTURE_WAIT_MS = 300
const prefersLessMotion = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
// Settles once the pictures on the arriving page's first screen are decoded, or
// after PICTURE_WAIT_MS: an image the page asks to decode off the main thread
// paints a few frames after the rest of the page.
const picturesReady = (node) => {
  const pictures = Array.prototype.filter.call(node.querySelectorAll('img'), (image) => {
    const box = image.getBoundingClientRect()
    return box.bottom > 0 && box.top < window.innerHeight && typeof image.decode === 'function'
  })
  return Promise.race([
    Promise.all(pictures.map((image) => image.decode().catch(() => {}))),
    new Promise((resolve) => setTimeout(resolve, PICTURE_WAIT_MS)),
  ])
}

// Keeps the leaving page in the document until the browser has pictured it.
const HoldForMorph = ({ pageKey, morphRef }) => {
  const [isPresent, safeToRemove] = usePresence()
  React.useEffect(() => {
    if (isPresent) {
      return
    }
    const morph = morphRef.current
    if (morph && morph.leavingKey === pageKey) {
      morph.captured.then(safeToRemove)
    } else {
      safeToRemove()
    }
  }, [isPresent])
  return null
}

const TqPageTransition = ({ children }) => {
  const router = useRouter()
  const reducedMotion = useReducedMotion()
  const routeKey = routeKeyOf(router.asPath)
  const routeKeyRef = React.useRef(routeKey)
  routeKeyRef.current = routeKey
  const [frozen, setFrozen] = React.useState(null)
  const [context, setContext] = React.useState(CENTER)
  const [panelPhase, setPanelPhase] = React.useState('idle')
  // The page whose arrival may play: the first page at once, every later one
  // once its first screen's pictures are ready.
  const [readyKey, setReadyKey] = React.useState(routeKey)
  const readyKeyRef = React.useRef(routeKey)
  const pageRef = React.useRef(null)
  const popRef = React.useRef(false)
  const pointerRef = React.useRef(null)
  const clickedRef = React.useRef(null)
  const morphRef = React.useRef(null)
  const variants = React.useMemo(
    () =>
      context.skip || context.morph
        ? INSTANT
        : revealOnScreen(pageTransitionVariants(PRESET, SLIDE_PX, context, OPTIONS, CUSTOM || undefined), context.screen),
    [context]
  )

  // The arriving page is in the document: name its twin of the flying picture
  // and let the browser picture the new state.
  const setPage = React.useCallback((node) => {
    pageRef.current = node
    const key = node ? node.getAttribute('data-tq-page-transition') : null
    if (key !== null && key !== readyKeyRef.current) {
      readyKeyRef.current = key
      picturesReady(node).then(() => {
        // A later page may have arrived meanwhile; this one's turn has passed.
        if (readyKeyRef.current === key) {
          setReadyKey(key)
          setPanelPhase((phase) => (phase === 'covered' ? 'uncovering' : phase))
        }
      })
    }
    const morph = morphRef.current
    if (!node || !morph || morph.landed || node === morph.leaving) {
      return
    }
    morph.landed = true
    tqMorphClear()
    const target = tqMorphTarget(morph.src)
    if (!target) {
      morph.arrive()
      return
    }
    target.style.viewTransitionName = TQ_MORPH_NAME
    if (target.complete || typeof target.decode !== 'function') {
      morph.arrive()
      return
    }
    Promise.race([
      target.decode().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, MORPH_DECODE_MS)),
    ]).then(morph.arrive)
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
    const abandonMorph = (morph) => {
      if (!morph.landed) {
        morph.landed = true
        morph.transition.skipTransition()
        morph.arrive()
      }
    }
    const startMorph = (url, pointer) => {
      if (!MORPH_CSS || !pageRef.current || typeof document.startViewTransition !== 'function' || prefersLessMotion()) {
        return false
      }
      const image = tqMorphSource(url, clickedRef.current)
      if (!image) {
        return false
      }
      const morph = { leavingKey: routeKeyRef.current, leaving: pageRef.current, src: image.currentSrc || image.src, landed: false }
      morph.captured = new Promise((resolve) => {
        morph.onCaptured = resolve
      })
      const arrived = new Promise((resolve) => {
        morph.arrive = resolve
      })
      tqMorphClear()
      image.style.viewTransitionName = TQ_MORPH_NAME
      if (pointer) {
        root.style.setProperty('${ORIGIN_X}', pointer.x + 'px')
        root.style.setProperty('${ORIGIN_Y}', pointer.y + 'px')
      }
      const settle = () => {
        if (morphRef.current === morph) {
          morphRef.current = null
          tqMorphClear()
          root.style.removeProperty('${ORIGIN_X}')
          root.style.removeProperty('${ORIGIN_Y}')
        }
      }
      morphRef.current = morph
      try {
        morph.transition = document.startViewTransition(() => {
          morph.onCaptured()
          return arrived
        })
      } catch (error) {
        settle()
        return false
      }
      morph.transition.ready.catch(() => {})
      morph.transition.finished.then(settle, settle)
      setTimeout(() => abandonMorph(morph), MORPH_WAIT_MS)
      return true
    }
    const onRouteChangeStart = (url) => {
      if (routeKeyOf(url) === routeKeyRef.current) {
        return
      }
      const reverse = popRef.current
      popRef.current = false
      // A skipped page appears instantly; leaving it still plays the site's transition.
      const skip = isSkippedRoute(routeKeyOf(url))
      const pointer = reverse || !ORIGIN_FROM_POINTER ? null : pointerRef.current
      // A reveal is measured on this screen (revealOnScreen); without a press it
      // grows from the screen's centre, not the page's.
      const screen = { width: window.innerWidth, height: window.innerHeight, top: window.scrollY || 0 }
      const origin = pointer || { x: screen.width / 2, y: screen.height / 2 }
      const next = { reverse, skip, originX: origin.x + 'px', originY: origin.y + 'px', screen }
      if (!reverse && !skip && startMorph(url, pointer)) {
        setContext(Object.assign({}, next, { morph: true }))
        return
      }
      setContext(next)
      if (PANELS && !skip) {
        setPanelPhase('covering')
      }
      setFrozen({ key: routeKeyRef.current, top: window.scrollY || 0 })
    }
    const onRouteChangeError = () => {
      if (morphRef.current) {
        abandonMorph(morphRef.current)
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

  if (reducedMotion || !variants) {
    return children
  }

  const frozenStyle =
    frozen && frozen.key === routeKey
      ? { position: 'fixed', top: -frozen.top, left: 0, right: 0 }
      : undefined

  const onExitComplete = () => {
    setFrozen(null)
    // The panels open once the arriving page's pictures are ready (setPage).
    if (PANELS && panelPhase === 'covering') {
      setPanelPhase('covered')
    }
  }

  return (
    <>
    <AnimatePresence mode="wait" initial={false} onExitComplete={onExitComplete}>
      <motion.div
        key={routeKey}
        ref={setPage}
        initial="initial"
        animate={readyKey === routeKey ? 'animate' : 'initial'}
        exit="exit"
        variants={variants}
        transition={{ duration: DURATION, ease: EASE }}
        onUpdate={REVEAL ? stepByFrame : undefined}
        style={frozenStyle}
        data-tq-page-transition={routeKey}
      >
        {children}
        {MORPH_CSS ? <HoldForMorph pageKey={routeKey} morphRef={morphRef} /> : null}
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
    {MORPH_CSS ? <style dangerouslySetInnerHTML={{ __html: MORPH_CSS }} /> : null}
    </>
  )
}

export default TqPageTransition
`
}
