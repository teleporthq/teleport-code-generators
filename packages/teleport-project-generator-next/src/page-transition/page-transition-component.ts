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

export interface PageTransitionConfig {
  preset: string
  duration: number
  easing: string
  skipRoutes?: string[]
  options?: Record<string, string>
  custom?: { arrive?: Record<string, number>; leave?: Record<string, number> }
}

/** The same curves the motion widget plays, so a route transition shares the site's motion character. */
const EASING_CURVES: Record<string, [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  linear: [0, 0, 1, 1],
  spring: [0.34, 1.56, 0.64, 1],
  back: [0.68, -0.6, 0.32, 1.6],
  bounce: [0.22, 1.2, 0.36, 1],
}

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
 * Three things a naive wrapper gets wrong, handled here:
 * - The leaving page is FROZEN in place (position: fixed at its scroll offset)
 *   for its exit, because Next scrolls the window to the top the moment the new
 *   route resolves — otherwise a long page visibly jumps to its own top while
 *   fading out.
 * - Only real page changes transition: query-only and hash navigations keep
 *   the same key, so a filter change or an in-page anchor never re-plays it.
 * - `prefers-reduced-motion` renders the page plainly — no wrapper animation.
 *
 * The first load never animates in (`initial={false}`): a site should appear,
 * not perform, on arrival.
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
  return `import React from 'react'
import { useRouter } from 'next/router'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

${reversePageTransitionPreset.toString()}

${pageTransitionVariants.toString()}

${pageTransitionCover.toString()}

${pageTransitionSkipPattern.toString()}

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
const SKIP_PATTERNS = SKIP_ROUTES.map(pageTransitionSkipPattern)
const isSkippedRoute = (key) => SKIP_PATTERNS.some((pattern) => pattern.test(key))
// The cover family paints its panels in the theme colour the editor chose.
const PANEL_COLOR = '${pageTransitionCoverColor(options.color)}'
const PANEL_BASE = { position: 'fixed', top: 0, bottom: 0, zIndex: 2147483000, pointerEvents: 'none', background: PANEL_COLOR }
const panelBounds = (panel) =>
  panel.side === 'left' ? { left: 0, right: '50%' } : panel.side === 'right' ? { left: '50%', right: 0 } : { left: 0, right: 0 }

const routeKeyOf = (url) => String(url || '').split(/[?#]/)[0]

const TqPageTransition = ({ children }) => {
  const router = useRouter()
  const reducedMotion = useReducedMotion()
  const routeKey = routeKeyOf(router.asPath)
  const routeKeyRef = React.useRef(routeKey)
  routeKeyRef.current = routeKey
  const [frozen, setFrozen] = React.useState(null)
  const [context, setContext] = React.useState(CENTER)
  const [panelPhase, setPanelPhase] = React.useState('idle')
  const pageRef = React.useRef(null)
  const popRef = React.useRef(false)
  const pointerRef = React.useRef(null)
  const variants = React.useMemo(
    () => (context.skip ? INSTANT : pageTransitionVariants(PRESET, SLIDE_PX, context, OPTIONS, CUSTOM || undefined)),
    [context]
  )

  React.useEffect(() => {
    const onPointerDown = (event) => {
      pointerRef.current = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  React.useEffect(() => {
    router.beforePopState(() => {
      popRef.current = true
      return true
    })
    const onRouteChangeStart = (url) => {
      if (routeKeyOf(url) === routeKeyRef.current) {
        return
      }
      const reverse = popRef.current
      popRef.current = false
      // A skipped page appears instantly; leaving it still plays the site's transition.
      const skip = isSkippedRoute(routeKeyOf(url))
      const pointer = reverse || !ORIGIN_FROM_POINTER ? null : pointerRef.current
      const next = pointer
        ? { reverse, skip, originX: pointer.x + 'px', originY: pointer.y + 'px' }
        : { reverse, skip, originX: '50%', originY: '50%' }
      // A reveal clears its clip-path once settled (a permanent clip would cut
      // off fixed descendants on a short page); the exit needs it back as its
      // starting point.
      const settled = pageTransitionVariants(PRESET, SLIDE_PX, next, OPTIONS, CUSTOM || undefined)
      if (settled && settled.animate.clipPath && pageRef.current) {
        pageRef.current.style.clipPath = settled.animate.clipPath
      }
      setContext(next)
      if (PANELS && !skip) {
        setPanelPhase('covering')
      }
      setFrozen({ key: routeKeyRef.current, top: window.scrollY || 0 })
    }
    router.events.on('routeChangeStart', onRouteChangeStart)
    return () => {
      router.events.off('routeChangeStart', onRouteChangeStart)
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
    if (PANELS && panelPhase === 'covering') {
      setPanelPhase('uncovering')
    }
  }

  return (
    <>
    <AnimatePresence mode="wait" initial={false} onExitComplete={onExitComplete}>
      <motion.div
        key={routeKey}
        ref={pageRef}
        initial="initial"
        animate="animate"
        exit="exit"
        variants={variants}
        transition={{ duration: DURATION, ease: EASE }}
        style={frozenStyle}
        onAnimationComplete={(definition) => {
          if (definition === 'animate' && variants.animate.clipPath && pageRef.current) {
            pageRef.current.style.clipPath = ''
          }
        }}
        data-tq-page-transition={routeKey}
      >
        {children}
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
            animate={panelPhase === 'covering' ? panel.cover : panelPhase === 'uncovering' ? panel.away : panel.from}
            transition={panelPhase === 'idle' ? { duration: 0 } : { duration: DURATION, ease: EASE }}
            onAnimationComplete={() => {
              if (panelPhase === 'uncovering') {
                setPanelPhase('idle')
              }
            }}
          />
        ))
      : null}
    </>
  )
}

export default TqPageTransition
`
}
