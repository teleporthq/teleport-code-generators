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
 * delay — not the lone grid block — matching the canvas renderer. When ANY node it
 * would wrap comes from a runtime <Repeater>/<DataProvider> (build-time opaque, so
 * its items can't be wrapped individually), it degrades to a single GROUP animation
 * rather than wrapping that node in a lone block — that block would sit between the
 * grid/flex container and its items and collapse them into one cell. That holds
 * whether the repeater is the container's only child or sits beside static siblings.
 * Honors prefers-reduced-motion. framer-motion
 * requires React 18 — the Next project plugin bumps react/react-dom accordingly.
 *
 * ## ⛔ A STAGGER MUST NOT ADD A DOM NODE (run c133d485, "How the Appointment Works")
 *
 * The cascade used to wrap every target in its own `<motion.div>`. The canvas does
 * the opposite: `runMotion` writes the tween straight onto the target elements'
 * inline style and adds NOTHING to the tree. So the published DOM gained a box the
 * canvas never had, sitting exactly between a layout container and its items — and
 * every declaration the author aimed at those items stopped reaching the boxes the
 * container was laying out:
 *
 * ```html
 * <div class="process-rail">                    <!-- flex; width: max-content -->
 *   <div class="process-step-card">…</div>  x4  <!-- flex: 0 0 380px -->
 * ```
 *
 * published as `.process-rail > div > .process-step-card`, so the flex items were
 * the anonymous wrappers (`flex: 0 1 auto`), `flex-basis: 380px` reached nothing,
 * each wrapper shrink-wrapped to its copy's max-content — 1500px — and the rail
 * measured 6096px against a 1056px viewport. Measured live on the deployed site.
 * The same wrapper is why `:nth-child()` dies once published (see
 * `bake-structural-pseudo-classes.ts` in the generation service).
 *
 * The cascade is therefore applied IN PLACE: each target is cloned with the
 * animated CSS on its own `style`, driven by a CSS transition whose delay carries
 * the per-index offset. Same curves, same keyframes, same order — and the
 * published tree is the canvas tree. Two shapes fall back to the single group
 * animation rather than re-introducing a wrapper: a target that is not a plain DOM
 * element (a component is free to drop an injected `style`), and a `repeat` other
 * than 0 (a CSS transition plays exactly once).
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
// identically in the canvas, the preview and the published site. The key ORDER
// is the order the canvas composes them in: it has to match \`cssFromState\` in
// the renderer's motion-keyframes exactly, or a staggered card and its canvas
// twin would compose the same values differently. Both the scroll-linked path
// (\`applyScrollState\`) and the in-place stagger (\`cssFromState\`) build on these.
const TRANSFORM_KEYS = ['x', 'y', 'scale', 'rotate']

// The transform family is written as the INDIVIDUAL transform properties
// (translate / scale / rotate) and never as the transform property itself, so
// whatever the author put in transform (a translateX(-50%) centering, a tilt)
// survives the animation and the browser composes the two. Mirrors the canvas.
const withUnit = (value, unit) => (typeof value === 'number' ? value + unit : String(value))

const writeTransformProps = (css, state) => {
  if (state.x !== undefined || state.y !== undefined) {
    css.translate =
      withUnit(state.x !== undefined ? state.x : 0, 'px') +
      ' ' +
      withUnit(state.y !== undefined ? state.y : 0, 'px')
  }
  if (state.scale !== undefined) {
    css.scale = String(state.scale)
  }
  if (state.rotate !== undefined) {
    css.rotate = withUnit(state.rotate, 'deg')
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
  const transformState = {}
  keys.forEach((key) => {
    const fromValue = fromVars[key] !== undefined ? fromVars[key] : toVars[key]
    const toValue = toVars[key] !== undefined ? toVars[key] : fromVars[key]
    const value = interpolateValue(fromValue, toValue, p)
    if (TRANSFORM_KEYS.includes(key)) {
      transformState[key] = value
    } else {
      element.style[key] = String(value)
    }
  })
  const transformCss = {}
  writeTransformProps(transformCss, transformState)
  Object.keys(transformCss).forEach((prop) => {
    element.style[prop] = transformCss[prop]
  })
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
    case 'pop-in':
      return { from: { opacity: 0, scale: 0.6 }, to: { opacity: 1, scale: 1 } }
    case 'rotate-in':
      return { from: { opacity: 0, rotate: -8 }, to: { opacity: 1, rotate: 0 } }
    case 'tilt-in':
      return { from: { opacity: 0, rotate: -10, y: distance }, to: { opacity: 1, rotate: 0, y: 0 } }
    case 'blur-in':
      return { from: { opacity: 0, filter: 'blur(12px)' }, to: { opacity: 1, filter: 'blur(0px)' } }
    case 'blur-up':
      return {
        from: { opacity: 0, y: distance, filter: 'blur(8px)' },
        to: { opacity: 1, y: 0, filter: 'blur(0px)' },
      }
    // Attention loops: rest at the natural state (NO opacity ramp — a looping
    // opacity would strobe) and read as animation only when repeated (mirror).
    case 'pulse':
      return { from: { scale: 1 }, to: { scale: 1.06 } }
    case 'float':
      return { from: { y: 0 }, to: { y: -12 } }
    case 'none':
      return { from: {}, to: {} }
    default:
      return { from: { opacity: 0 }, to: { opacity: 1 } }
  }
}

// Turn a resolved motion state ({ opacity, x, y, scale, rotate, filter, … }) into
// an inline style object: the transform keys become the individual translate /
// scale / rotate properties and every other key passes through as its own CSS
// property. Mirrors the canvas.
const cssFromState = (state) => {
  const css = {}
  writeTransformProps(css, state)
  Object.keys(state).forEach((key) => {
    if (TRANSFORM_KEYS.indexOf(key) !== -1) {
      return
    }
    css[key] = state[key]
  })
  return css
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
// items, cascade THOSE (so cards cascade — not the lone block), keep the wrappers.
//
// Returns null when the descent bottoms out at a single, non-cascadable node — most
// importantly a runtime <Repeater> (array-mapper), which is self-closing at build
// time (props.children is undefined) yet renders many siblings at runtime. Wrapping
// that lone block in a motion.div would drop a single block element BETWEEN a
// grid/flex container and its repeated items and collapse them into one cell. On null
// the caller animates the whole subtree as one group instead — the wrapper then sits
// OUTSIDE the layout container, so the repeated items stay its direct layout children.
//
// ⛔ AND A SIBLING BESIDE THE REPEATER DEFEATED THAT GUARD (run 75860d32,
// "Start by Concern"). The lone-child test only ever fired for a container whose
// ONLY child is the mapper. That page's grid held the mapper AND one static card:
//
//   <div class="collage-grid">            // grid-template-columns: repeat(3, 1fr)
//     {loading && <div class="loading-state"/>}
//     {!loading && <Repeater items={concernStarterSets} …/>}   // 4 cards
//     <div class="collage-item text-pivot"/>
//   </div>
//
// so the array is length 2 at runtime, every branch was wrapped, and the four
// cards landed INSIDE ONE motion.div — one grid cell holding a vertical stack,
// the pivot in the next, and the third column empty for the height of the band.
// The user's read: "4 big cards to the left and only one small card to the
// right … the right part of the page looks really empty."
//
// A repeater among siblings is the SAME defect as a repeater alone, so it takes
// the same remedy: no stagger, one group animation, layout untouched. Losing a
// cascade is a smaller loss than losing the layout.
const mapStaggerTargets = (nodes, wrap, depth) => {
  // Renders MANY siblings at runtime from ONE build-time element: <Repeater>
  // (array-mapper) and <DataProvider> (a table-backed mapper's fetch wrapper).
  // Both keep their content behind a render prop, so props.children is undefined
  // and the descent below can never reach the items to cascade them.
  const rendersManySiblings = (node) =>
    !!node &&
    React.isValidElement(node) &&
    !!node.props &&
    (node.props.renderItem != null || node.props.renderSuccess != null)
  // The cascade is written onto each target's own \`style\`, so a target has to be
  // a plain DOM element: a component owns its rendering and is free to drop an
  // injected style prop (next/link does exactly that), which would leave the item
  // stuck at its resting state. One such target disqualifies the whole cascade —
  // a partial cascade is a page where some cards never appear.
  const stylableInPlace = (node) =>
    !!node && React.isValidElement(node) && typeof node.type === 'string'
  const arr = React.Children.toArray(nodes)
  if (arr.length > 1 || depth >= 3) {
    if (arr.some(rendersManySiblings)) {
      return null
    }
    if (!arr.every(stylableInPlace)) {
      return null
    }
    return arr.map((child, index) => wrap(child, index))
  }
  const only = arr[0]
  if (rendersManySiblings(only)) {
    return null
  }
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

  // The in-place cascade needs its own "the transition may start now" flag for the
  // load trigger: framer's initial/animate pair does that itself, but a CSS
  // transition only runs when the value CHANGES, so the resting state has to be
  // what the first paint (and the SSR html) carries. Flipped on the next frame.
  const [played, setPlayed] = React.useState(false)
  React.useEffect(() => {
    if (trigger !== 'load') {
      return undefined
    }
    const frame = requestAnimationFrame(() => setPlayed(true))
    return () => cancelAnimationFrame(frame)
  }, [trigger])

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

  // A CSS transition plays exactly once, so a repeating stagger keeps the framer
  // path (and its wrapper). Entrance cascades — every stagger the generator has
  // ever emitted — run in place.
  if (Number(stagger) > 0 && repeatCount === 0 && (trigger === 'load' || trigger === 'in-view')) {
    const fromCss = cssFromState(fromVars)
    const toCss = cssFromState(toVars)
    // Transition every property either state touches, so a preset that animates
    // only \`filter\` (blur-in) is covered exactly like one that animates opacity.
    const animatedProps = Object.keys(fromCss).concat(
      Object.keys(toCss).filter((prop) => fromCss[prop] === undefined)
    )
    const easeCss = 'cubic-bezier(' + ease.join(', ') + ')'
    const durationSeconds = Number(duration) || 0.6
    const atRest = trigger === 'load' ? played : revealed

    const styleChild = (child, index) => {
      const delaySeconds = (Number(delay) || 0) + index * Number(stagger)
      const childTransition = animatedProps
        .map(
          (prop) =>
            prop + ' ' + durationSeconds + 's ' + easeCss + ' ' + delaySeconds + 's'
        )
        .join(', ')
      return React.cloneElement(child, {
        key: index,
        style: {
          ...(child.props.style || {}),
          ...(atRest ? toCss : fromCss),
          transition: childTransition,
        },
      })
    }
    const staggerTargets = mapStaggerTargets(children, styleChild, 0)
    // staggerTargets is null when there are no real per-item targets to cascade
    // (e.g. the items render from a runtime <Repeater>, or a target is a component
    // that may drop an injected style). Fall through to the single group animation
    // below so the wrapper stays OUTSIDE the grid/flex container and its repeated
    // items remain direct layout children (no collapsed layout).
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
