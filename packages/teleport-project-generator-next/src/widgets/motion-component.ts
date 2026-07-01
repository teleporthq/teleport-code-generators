/**
 * Generates the TqMotion wrapper around framer-motion. Motion is a CONTAINER
 * widget: it renders its children inside a `<motion.div>` and animates them
 * according to the same semantic contract used by the SolidJS canvas renderer
 * (see packages/renderer motion-runtime) — preset/easing/keyframe logic is kept
 * identical so the published site matches the canvas.
 *
 * Triggers: on-load (initial/animate), in-view (useInView-driven + a timed
 * in-viewport failsafe so content is never trapped at opacity:0 — a top hero that
 * misses the IntersectionObserver still reveals), scroll (scroll-linked parallax
 * via useScroll/useTransform), hover (whileHover),
 * tap (whileTap). `stagger` descends through grid/list wrappers to the real
 * repeated items (e.g. <array-mapper> cards) and cascades THOSE with a per-child
 * delay — not the lone grid block — matching the canvas renderer. When the repeated
 * items come from a runtime <Repeater> (build-time opaque, so they can't be wrapped
 * individually), it degrades to a single GROUP animation rather than wrapping the
 * Repeater in a lone block — that block would sit between the grid/flex container and
 * its items and collapse the layout. Honors prefers-reduced-motion. framer-motion
 * requires React 18 — the Next project plugin bumps react/react-dom accordingly.
 */
export const generateMotionComponentCode = (): string => {
  return `import React from 'react'
import { motion, useInView, useReducedMotion, useScroll, useTransform } from 'framer-motion'

const EASINGS = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  linear: [0, 0, 1, 1],
  spring: [0.34, 1.56, 0.64, 1],
  back: [0.68, -0.6, 0.32, 1.6],
  bounce: [0.22, 1.2, 0.36, 1],
}

const presetStates = (preset, distance) => {
  switch (preset) {
    case 'fade-in':
      return { from: { opacity: 0 }, to: { opacity: 1 } }
    case 'slide-up':
      return { from: { opacity: 0, y: distance }, to: { opacity: 1, y: 0 } }
    case 'slide-down':
      return { from: { opacity: 0, y: -distance }, to: { opacity: 1, y: 0 } }
    case 'slide-left':
      return { from: { opacity: 0, x: distance }, to: { opacity: 1, x: 0 } }
    case 'slide-right':
      return { from: { opacity: 0, x: -distance }, to: { opacity: 1, x: 0 } }
    case 'scale-in':
      return { from: { opacity: 0, scale: 0.8 }, to: { opacity: 1, scale: 1 } }
    case 'zoom-in':
      return { from: { opacity: 0, scale: 0.5 }, to: { opacity: 1, scale: 1 } }
    case 'rotate-in':
      return { from: { opacity: 0, rotate: -8 }, to: { opacity: 1, rotate: 0 } }
    case 'blur-in':
      return { from: { opacity: 0, filter: 'blur(12px)' }, to: { opacity: 1, filter: 'blur(0px)' } }
    case 'none':
      return { from: {}, to: {} }
    default:
      return { from: { opacity: 0 }, to: { opacity: 1 } }
  }
}

const buildAnimProps = (trigger, fromVars, toVars, transition, revealed) => {
  switch (trigger) {
    case 'load':
      return { initial: fromVars, animate: toVars, transition }
    case 'in-view':
      // Driven by "revealed" (useInView OR the timed in-viewport failsafe) rather
      // than a passive viewport-gated prop, so an already-in-view element (e.g. a
      // top hero whose observer misses the initial intersection) can never stay hidden.
      return { initial: fromVars, animate: revealed ? toVars : fromVars, transition }
    case 'hover':
      return { whileHover: toVars, transition }
    case 'tap':
      return { whileTap: toVars, transition }
    default:
      return { initial: fromVars, animate: toVars, transition }
  }
}

// Find the elements a stagger should cascade across. Content is usually wrapped as
// <TqMotion><div class="grid">{items.map(...)}</div></TqMotion>, so the only child
// is a grid wrapper. Descend through single-child wrappers to the real repeated
// items, wrap THOSE (so cards cascade — not the lone block), and keep the wrappers.
//
// Returns null when the descent bottoms out at a single, non-cascadable node — most
// importantly a runtime <Repeater> (array-mapper), which is self-closing at build
// time (props.children is undefined) yet renders many siblings at runtime. Wrapping
// that lone block in a motion.div would drop a single block element BETWEEN a
// grid/flex container and its repeated items and collapse them into one cell. On null
// the caller animates the whole subtree as one group instead — the wrapper then sits
// OUTSIDE the layout container, so the repeated items stay its direct layout children.
const mapStaggerTargets = (nodes, wrap, depth) => {
  const arr = React.Children.toArray(nodes)
  if (arr.length > 1 || depth >= 3) {
    return arr.map((child, index) => wrap(child, index))
  }
  const only = arr[0]
  if (only && React.isValidElement(only) && only.props && only.props.children != null) {
    const inner = mapStaggerTargets(only.props.children, wrap, depth + 1)
    if (inner == null) {
      return null
    }
    return React.cloneElement(only, {}, inner)
  }
  return null
}

const TqMotion = ({
  preset = 'fade-in',
  trigger = 'in-view',
  duration = 0.6,
  delay = 0,
  easing = 'ease-out',
  repeat = 0,
  repeatType = 'loop',
  inViewOnce = true,
  inViewAmount = 0.3,
  stagger = 0,
  distance = 40,
  from = null,
  to = null,
  style,
  children,
  ...rest
}) => {
  const ref = React.useRef(null)
  const shouldReduceMotion = useReducedMotion()

  // in-view reveal is driven by useInView + a timed in-viewport failsafe so a
  // reveal can NEVER trap content at opacity:0 (a top hero already in view can
  // miss the observer's initial callback). Below-the-fold elements still wait.
  const inView = useInView(ref, { once: Boolean(inViewOnce), amount: Number(inViewAmount) || 0.3 })
  const [forceReveal, setForceReveal] = React.useState(false)
  React.useEffect(() => {
    if (trigger !== 'in-view') {
      return undefined
    }
    const timeoutId = setTimeout(() => {
      const el = ref.current
      if (!el || typeof el.getBoundingClientRect !== 'function') {
        return
      }
      const rect = el.getBoundingClientRect()
      const vh = window.innerHeight || document.documentElement.clientHeight || 0
      const vw = window.innerWidth || document.documentElement.clientWidth || 0
      const visible = rect.top < vh && rect.bottom > 0 && rect.left < vw && rect.right > 0
      if (visible) {
        setForceReveal(true)
      }
    }, (Number(duration) || 0.6) * 1000 + 600)
    return () => clearTimeout(timeoutId)
  }, [])
  const revealed = inView || forceReveal

  const dist = Number(distance) || 0
  const base = presetStates(preset, dist)
  const fromVars = { ...base.from, ...(from || {}) }
  const toVars = { ...base.to, ...(to || {}) }

  const ease = EASINGS[easing] || EASINGS['ease-out']
  const repeatCount = Number(repeat) < 0 ? Infinity : Number(repeat) || 0
  const transition = {
    duration: Number(duration) || 0.6,
    delay: Number(delay) || 0,
    ease,
    repeat: repeatCount,
    repeatType,
  }

  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const yFrom = typeof fromVars.y === 'number' ? fromVars.y : dist
  const yTo = typeof toVars.y === 'number' ? toVars.y : -dist
  const parallaxY = useTransform(scrollYProgress, [0, 1], [yFrom, yTo])

  if (shouldReduceMotion) {
    return (
      <div ref={ref} style={style} {...rest}>
        {children}
      </div>
    )
  }

  if (trigger === 'scroll') {
    return (
      <motion.div ref={ref} style={{ ...(style || {}), y: parallaxY }} {...rest}>
        {children}
      </motion.div>
    )
  }

  if (Number(stagger) > 0 && (trigger === 'load' || trigger === 'in-view')) {
    const wrapChild = (child, index) => {
      const childTransition = { ...transition, delay: (Number(delay) || 0) + index * Number(stagger) }
      const childProps = buildAnimProps(trigger, fromVars, toVars, childTransition, revealed)
      return (
        <motion.div key={index} {...childProps}>
          {child}
        </motion.div>
      )
    }
    const staggerTargets = mapStaggerTargets(children, wrapChild, 0)
    // staggerTargets is null when there are no real per-item targets to cascade
    // (e.g. the items render from a runtime <Repeater>). Fall through to the single
    // group animation below so the wrapper stays OUTSIDE the grid/flex container and
    // its repeated items remain direct layout children (no collapsed layout).
    if (staggerTargets != null) {
      return (
        <div ref={ref} style={style} {...rest}>
          {staggerTargets}
        </div>
      )
    }
  }

  const animProps = buildAnimProps(trigger, fromVars, toVars, transition, revealed)

  return (
    <motion.div ref={ref} style={style} {...animProps} {...rest}>
      {children}
    </motion.div>
  )
}

export default TqMotion
`
}
