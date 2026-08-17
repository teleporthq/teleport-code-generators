/**
 * Generates the TqMotion wrapper around framer-motion. Motion is a CONTAINER
 * widget: it renders its children inside a `<motion.div>` and animates them
 * according to the same semantic contract used by the SolidJS canvas renderer
 * (see packages/renderer motion-runtime) — preset/easing/keyframe logic is kept
 * identical so the published site matches the canvas.
 *
 * Triggers: on-load (initial/animate), in-view (useInView-driven + a standing
 * in-viewport failsafe so content is never trapped at opacity:0 — any element
 * that is genuinely on screen reveals even if the IntersectionObserver never
 * reports it), scroll (scroll-linked: useScroll progress — windowed by
 * scrollOffset, optionally useSpring-smoothed by scrub — interpolates the FULL
 * from/to state onto the element, matching the canvas runtime), hover
 * (whileHover), tap (whileTap). `stagger` descends through grid/list wrappers to the real
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
import { motion, useInView, useMotionValueEvent, useReducedMotion, useScroll, useSpring } from 'framer-motion'

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

// Mirrors the canvas renderer's motion-keyframes helpers so a scroll-linked
// element interpolates EVERY from/to property (x/y/scale/rotate/opacity/filter)
// identically in the canvas, the preview and the published site.
const TRANSFORM_KEYS = ['x', 'y', 'scale', 'rotate']

const transformComponent = (key, value) => {
  const numeric = typeof value === 'number'
  switch (key) {
    case 'x':
      return 'translateX(' + (numeric ? value + 'px' : value) + ')'
    case 'y':
      return 'translateY(' + (numeric ? value + 'px' : value) + ')'
    case 'scale':
      return 'scale(' + value + ')'
    case 'rotate':
      return 'rotate(' + (numeric ? value + 'deg' : value) + ')'
    default:
      return ''
  }
}

const BLUR_RE = /^blur\\(([\\d.]+)px\\)$/

const interpolateValue = (from, to, p) => {
  if (typeof from === 'number' && typeof to === 'number') {
    return from + (to - from) * p
  }
  if (typeof from === 'string' && typeof to === 'string') {
    const f = BLUR_RE.exec(from)
    const t = BLUR_RE.exec(to)
    if (f && t) {
      const value = parseFloat(f[1]) + (parseFloat(t[1]) - parseFloat(f[1])) * p
      return 'blur(' + value + 'px)'
    }
  }
  return p >= 1 ? to : from
}

const applyScrollState = (element, fromVars, toVars, p) => {
  if (!element) {
    return
  }
  const keys = new Set([...Object.keys(fromVars), ...Object.keys(toVars)])
  const transformParts = []
  keys.forEach((key) => {
    const fromValue = fromVars[key] !== undefined ? fromVars[key] : toVars[key]
    const toValue = toVars[key] !== undefined ? toVars[key] : fromVars[key]
    const value = interpolateValue(fromValue, toValue, p)
    if (TRANSFORM_KEYS.includes(key)) {
      transformParts.push(transformComponent(key, value))
    } else {
      element.style[key] = String(value)
    }
  })
  if (transformParts.length > 0) {
    element.style.transform = transformParts.join(' ')
  }
}

// useScroll offset pairs per motion-scroll-offset mode — mirrors the canvas
// runtime's scrollProgressForOffset semantics.
const SCROLL_OFFSET_RANGES = {
  pass: ['start end', 'end start'],
  contained: ['start start', 'end end'],
  enter: ['start end', 'start start'],
  exit: ['end end', 'end start'],
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

// How much of the element is inside the viewport right now, as a 0..1 fraction
// of its own area — the same quantity IntersectionObserver thresholds on, so the
// failsafe below can apply exactly the threshold useInView was given.
const visibleFraction = (rect, vh, vw) => {
  const height = rect.bottom - rect.top
  const width = rect.right - rect.left
  if (height <= 0 || width <= 0) {
    return 0
  }
  const visibleHeight = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0))
  const visibleWidth = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0))
  return (visibleHeight * visibleWidth) / (height * width)
}

// The largest fraction this element could EVER have on screen. An element taller
// than the viewport can never be 60% visible, so an inViewAmount above that is
// unsatisfiable and would hold the content at opacity 0 permanently. Clamping to
// what is physically reachable turns "impossible" into "as visible as it gets".
const reachableFraction = (rect, vh, vw) => {
  const height = rect.bottom - rect.top
  const width = rect.right - rect.left
  if (height <= 0 || width <= 0) {
    return 0
  }
  return Math.min(1, vh / height) * Math.min(1, vw / width)
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
  scrub = 0,
  scrollOffset = 'pass',
  style,
  children,
  ...rest
}) => {
  const ref = React.useRef(null)
  const shouldReduceMotion = useReducedMotion()

  // in-view reveal is driven by useInView + a STANDING in-viewport failsafe, so
  // a reveal can never trap content at opacity:0.
  //
  // This used to be a single setTimeout that checked once, roughly a second
  // after mount. That only ever rescued content which happened to be on screen
  // at that instant: everything below the fold got its one check while
  // off-screen, saw itself invisible, and was never checked again. From then on
  // the IntersectionObserver was the only thing that could reveal it, so one
  // missed callback left an entire section at opacity 0 permanently — a
  // 2162px-tall product grid sat invisible while dead-centre in the viewport,
  // 41% on screen, for as long as anyone cared to wait.
  //
  // The check now stands for the element's lifetime, coalesced into a frame and
  // passive so scrolling stays cheap, and it applies the SAME threshold
  // useInView was given. It therefore fires exactly when the observer should
  // have and never earlier — an animation's timing is unchanged when the
  // observer works, which is almost always.
  const inView = useInView(ref, { once: Boolean(inViewOnce), amount: Number(inViewAmount) || 0.3 })
  const [forceReveal, setForceReveal] = React.useState(false)
  const revealed = inView || forceReveal
  const revealedRef = React.useRef(false)
  React.useEffect(() => {
    revealedRef.current = revealed
  }, [revealed])

  React.useEffect(() => {
    if (trigger !== 'in-view') {
      return undefined
    }
    const once = Boolean(inViewOnce)
    const amount = Number(inViewAmount) || 0.3
    let frame = 0

    const check = () => {
      // Already done: nothing to measure, so a revealed element costs nothing
      // per scroll frame beyond this comparison.
      if (once && revealedRef.current) {
        return
      }
      const el = ref.current
      if (!el || typeof el.getBoundingClientRect !== 'function') {
        return
      }
      const rect = el.getBoundingClientRect()
      const vh = window.innerHeight || document.documentElement.clientHeight || 0
      const vw = window.innerWidth || document.documentElement.clientWidth || 0
      const fraction = visibleFraction(rect, vh, vw)
      const threshold = Math.min(amount, reachableFraction(rect, vh, vw) * 0.9)
      const visible = fraction > 0 && fraction >= threshold
      // With inViewOnce the reveal latches; without it, visibility is tracked
      // both ways so the author's repeat-on-re-entry behaviour is preserved.
      setForceReveal(function (previous) {
        return once ? previous || visible : visible
      })
    }

    const schedule = () => {
      if (frame) {
        return
      }
      frame = requestAnimationFrame(function () {
        frame = 0
        check()
      })
    }

    const timeoutId = setTimeout(check, (Number(duration) || 0.6) * 1000 + 600)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    return () => {
      clearTimeout(timeoutId)
      if (frame) {
        cancelAnimationFrame(frame)
      }
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [trigger, inViewOnce, inViewAmount, duration])

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

  // Scroll-linked motion is one trigger out of five, but the hooks have to run
  // on every render. Passing a target when we are not going to use it makes
  // framer measure this element against the scroll container on every scroll
  // frame — and warn about the container being position:static — once per
  // motion node on the page. Targetless useScroll shares one window listener
  // and measures nothing.
  const scrollOptions =
    trigger === 'scroll'
      ? { target: ref, offset: SCROLL_OFFSET_RANGES[scrollOffset] || SCROLL_OFFSET_RANGES.pass }
      : {}
  const { scrollYProgress } = useScroll(scrollOptions)
  const scrubSeconds = Number(scrub) || 0
  const smoothedProgress = useSpring(scrollYProgress, {
    duration: Math.max(1, scrubSeconds * 1000),
    bounce: 0,
  })
  const scrollProgress = scrubSeconds > 0 ? smoothedProgress : scrollYProgress
  // Progress writes styles straight to the DOM node (no re-render per frame),
  // interpolating the FULL from/to state — not just y — exactly like the
  // canvas runtime does.
  useMotionValueEvent(scrollProgress, 'change', (p) => {
    if (trigger === 'scroll' && !shouldReduceMotion) {
      applyScrollState(ref.current, fromVars, toVars, p)
    }
  })
  React.useEffect(() => {
    if (trigger === 'scroll' && !shouldReduceMotion) {
      applyScrollState(ref.current, fromVars, toVars, scrollProgress.get())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, shouldReduceMotion])

  if (shouldReduceMotion) {
    return (
      <div ref={ref} style={style} {...rest}>
        {children}
      </div>
    )
  }

  if (trigger === 'scroll') {
    return (
      <div ref={ref} style={style} {...rest}>
        {children}
      </div>
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
      // motion.div (animation-less), NOT a plain div: this branch and the group
      // fall-through below must render the SAME outer element type. A page whose
      // loading conditional resolves can flip which branch runs — with differing
      // types React REMOUNTS the outer element, and framer's useInView keeps
      // observing the detached original, so the group variant below could never
      // reveal (the trapped-at-opacity-0 "Making Process" defect). A constant
      // element type keeps the same DOM node across the swap and the observer live.
      return (
        <motion.div ref={ref} style={style} {...rest}>
          {staggerTargets}
        </motion.div>
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
