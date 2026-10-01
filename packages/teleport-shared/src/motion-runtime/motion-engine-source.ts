/**
 * The element-motion engine as SOURCE TEXT: easing curves, the preset table, the
 * from/to state helpers and the viewport-fraction maths. Plain JavaScript with
 * no framework in it, shared word for word by the two exports:
 *
 *   - the Next export wraps it in the TqMotion React component (framer-motion
 *     plays the entrance and supplies the scroll progress);
 *   - the HTML export wraps it in a vanilla controller (the Web Animations API
 *     plays the entrance, a scroll listener supplies the progress).
 *
 * One copy means a new preset reaches both exports at once. It mirrors the
 * canvas renderer's motion-keyframes module. (No backticks in the engine's own
 * comments unless escaped: it is a template literal.)
 */
export const motionEngineSource = (): string => `const EASINGS = {
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

// Composed filters (blur(10px) grayscale(1) -> blur(0px) grayscale(0))
// interpolate function-by-function when both sides carry the same sequence —
// mirrors the canvas contract.
const FILTER_LIST_RE = /^(?:[a-z-]+\\(\\s*-?\\d*\\.?\\d+(?:px|deg|%)?\\s*\\)\\s*)+$/
const FILTER_FN_RE = /([a-z-]+)\\(\\s*(-?\\d*\\.?\\d+)(px|deg|%)?\\s*\\)/g

const interpolateFilter = (from, to, p) => {
  if (!FILTER_LIST_RE.test(from.trim()) || !FILTER_LIST_RE.test(to.trim())) {
    return null
  }
  const fromFns = Array.from(from.matchAll(FILTER_FN_RE))
  const toFns = Array.from(to.matchAll(FILTER_FN_RE))
  if (fromFns.length !== toFns.length || fromFns.length === 0) {
    return null
  }
  const parts = []
  for (let index = 0; index < fromFns.length; index++) {
    const fn = fromFns[index][1]
    const unit = fromFns[index][3] || ''
    if (fn !== toFns[index][1] || unit !== (toFns[index][3] || '')) {
      return null
    }
    const value =
      parseFloat(fromFns[index][2]) +
      (parseFloat(toFns[index][2]) - parseFloat(fromFns[index][2])) * p
    parts.push(fn + '(' + value + unit + ')')
  }
  return parts.join(' ')
}

const interpolateValue = (from, to, p) => {
  if (typeof from === 'number' && typeof to === 'number') {
    return from + (to - from) * p
  }
  if (typeof from === 'string' && typeof to === 'string') {
    const filter = interpolateFilter(from, to, p)
    if (filter !== null) {
      return filter
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
    case 'drop-in':
      return {
        from: { opacity: 0, y: -distance, scale: 1.05 },
        to: { opacity: 1, y: 0, scale: 1 },
      }
    case 'swing-in':
      return { from: { opacity: 0, rotate: -20, y: distance }, to: { opacity: 1, rotate: 0, y: 0 } }
    case 'spin-in':
      return {
        from: { opacity: 0, rotate: -180, scale: 0.6 },
        to: { opacity: 1, rotate: 0, scale: 1 },
      }
    case 'blur-zoom':
      return {
        from: { opacity: 0, scale: 1.35, filter: 'blur(10px)' },
        to: { opacity: 1, scale: 1, filter: 'blur(0px)' },
      }
    case 'zoom-out':
      return { from: { opacity: 0, scale: 1.4 }, to: { opacity: 1, scale: 1 } }
    case 'develop':
      return {
        from: { opacity: 0, filter: 'blur(6px) grayscale(1)' },
        to: { opacity: 1, filter: 'blur(0px) grayscale(0)' },
      }
    case 'glow-in':
      return {
        from: { opacity: 0, filter: 'brightness(1.8) saturate(0.4)' },
        to: { opacity: 1, filter: 'brightness(1) saturate(1)' },
      }
    // Attention loops: rest at the natural state (NO opacity ramp — a looping
    // opacity would strobe) and read as animation only when repeated (mirror).
    case 'pulse':
      return { from: { scale: 1 }, to: { scale: 1.06 } }
    case 'float':
      return { from: { y: 0 }, to: { y: -12 } }
    case 'spin':
      return { from: { rotate: 0 }, to: { rotate: 360 } }
    case 'wobble':
      return { from: { rotate: -3 }, to: { rotate: 3 } }
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
}`
