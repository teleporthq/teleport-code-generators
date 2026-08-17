/**
 * Generates the TqScrollScene wrapper. A Scroll Scene is a CONTAINER widget:
 * a tall TRACK (sceneLength) with a `position: sticky` STAGE pinned inside it.
 * The track's pass-through progress (framer-motion useScroll, optionally
 * useSpring-smoothed by `scrub`) drives every descendant carrying a
 * `data-scroll-bind` attribute — multi-keyframe property lanes applied by DOM
 * QUERY with a MutationObserver, so items rendered later (a runtime
 * <Repeater>'s children) are picked up and React child introspection is never
 * involved. Lane parsing/presets/interpolation mirror the canvas renderer's
 * scroll-scene-lanes module verbatim so the canvas and the published site
 * behave identically.
 *
 * Guardrails baked in: compositor-only lane properties, prefers-reduced-motion
 * ('final' settles on the end state, 'static' stays put), progress exposed as
 * --scene-progress only when exposeProgress is set, and a dev-only warning
 * when an ancestor's overflow silently disables the sticky pinning.
 */
export const generateScrollSceneComponentCode = (): string => {
  return `import React from 'react'
import { useMotionValueEvent, useReducedMotion, useScroll, useSpring } from 'framer-motion'

const SCROLL_BIND_ATTR = 'data-scroll-bind'

const LANE_PROPS = ['x', 'y', 'scale', 'rotate', 'opacity', 'blur']

const LANE_PRESETS = {
  'depth-1': [{ prop: 'y', at: [0, 1], values: [40, -40] }],
  'depth-2': [{ prop: 'y', at: [0, 1], values: [80, -80] }],
  'depth-3': [{ prop: 'y', at: [0, 1], values: [140, -140] }],
  'fade-window': [{ prop: 'opacity', at: [0, 0.15, 0.85, 1], values: [0, 1, 1, 0] }],
  'rail-x': [{ prop: 'x', at: [0, 1], values: [0, -100], unit: '%' }],
  'zoom-through': [{ prop: 'scale', at: [0, 1], values: [0.85, 1.1] }],
  'unblur-in': [{ prop: 'blur', at: [0, 0.3], values: [10, 0] }],
}

const isValidLane = (lane) => {
  if (!lane || typeof lane !== 'object' || !LANE_PROPS.includes(lane.prop)) {
    return false
  }
  if (!Array.isArray(lane.at) || !Array.isArray(lane.values)) {
    return false
  }
  if (lane.at.length < 2 || lane.at.length !== lane.values.length) {
    return false
  }
  const numbers = (list) => list.every((entry) => typeof entry === 'number' && isFinite(entry))
  if (!numbers(lane.at) || !numbers(lane.values)) {
    return false
  }
  for (let index = 1; index < lane.at.length; index++) {
    if (lane.at[index] < lane.at[index - 1]) {
      return false
    }
  }
  return lane.unit === undefined || lane.unit === 'px' || lane.unit === '%'
}

const parseScrollBind = (value) => {
  const raw = String(value || '').trim()
  if (!raw) {
    return []
  }
  if (LANE_PRESETS[raw]) {
    return LANE_PRESETS[raw].map((lane) => ({ ...lane }))
  }
  if (!raw.startsWith('[')) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isValidLane) : []
  } catch (e) {
    return []
  }
}

const laneValueAt = (lane, p) => {
  const at = lane.at
  const values = lane.values
  if (p <= at[0]) {
    return values[0]
  }
  if (p >= at[at.length - 1]) {
    return values[values.length - 1]
  }
  for (let index = 1; index < at.length; index++) {
    if (p <= at[index]) {
      const span = at[index] - at[index - 1]
      const local = span === 0 ? 1 : (p - at[index - 1]) / span
      return values[index - 1] + (values[index] - values[index - 1]) * local
    }
  }
  return values[values.length - 1]
}

const applyLanesAt = (element, lanes, p) => {
  const transformParts = []
  for (const lane of lanes) {
    const value = laneValueAt(lane, p)
    switch (lane.prop) {
      case 'x':
        transformParts.push('translateX(' + value + (lane.unit || 'px') + ')')
        break
      case 'y':
        transformParts.push('translateY(' + value + (lane.unit || 'px') + ')')
        break
      case 'scale':
        transformParts.push('scale(' + value + ')')
        break
      case 'rotate':
        transformParts.push('rotate(' + value + 'deg)')
        break
      case 'opacity':
        element.style.opacity = String(value)
        break
      case 'blur':
        element.style.filter = 'blur(' + value + 'px)'
        break
    }
  }
  if (transformParts.length > 0) {
    element.style.transform = transformParts.join(' ')
  }
}

const collectBound = (track) => {
  const bound = []
  track.querySelectorAll('[' + SCROLL_BIND_ATTR + ']').forEach((element) => {
    const lanes = parseScrollBind(element.getAttribute(SCROLL_BIND_ATTR))
    if (lanes.length > 0) {
      bound.push({ element, lanes })
    }
  })
  return bound
}

const normalizeSceneLength = (value) => {
  const match = /^(\\d{2,4})vh$/.exec(String(value || '').trim())
  if (!match) {
    return '300vh'
  }
  return Math.min(800, Math.max(100, Number(match[1]))) + 'vh'
}

const TqScrollScene = ({
  sceneLength = '300vh',
  pin = true,
  scrub = 0.3,
  reducedMotion = 'final',
  exposeProgress = false,
  style,
  children,
  ...rest
}) => {
  const trackRef = React.useRef(null)
  const boundRef = React.useRef([])
  const progressRef = React.useRef(0)
  const shouldReduceMotion = useReducedMotion()

  const applyAll = React.useCallback(
    (p) => {
      progressRef.current = p
      for (const child of boundRef.current) {
        try {
          applyLanesAt(child.element, child.lanes, p)
        } catch (e) {
          // a broken binding must never break the page
        }
      }
      if (exposeProgress && trackRef.current) {
        trackRef.current.style.setProperty('--scene-progress', String(Math.round(p * 1000) / 1000))
      }
    },
    [exposeProgress]
  )

  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: pin ? ['start start', 'end end'] : ['start end', 'end start'],
  })
  const scrubSeconds = Number(scrub) || 0
  const smoothed = useSpring(scrollYProgress, {
    duration: Math.max(1, scrubSeconds * 1000),
    bounce: 0,
  })
  const progress = scrubSeconds > 0 ? smoothed : scrollYProgress

  useMotionValueEvent(progress, 'change', (p) => {
    if (!shouldReduceMotion) {
      applyAll(p)
    }
  })

  React.useEffect(() => {
    const track = trackRef.current
    if (!track) {
      return undefined
    }
    boundRef.current = collectBound(track)

    if (shouldReduceMotion) {
      applyAll(reducedMotion === 'static' ? 0 : 1)
      return undefined
    }

    applyAll(progress.get())

    // Repeater items render after mount — refresh the bound set on subtree
    // changes and re-apply so late children join at the current frame.
    const observer = new MutationObserver(() => {
      boundRef.current = collectBound(track)
      applyAll(progressRef.current)
    })
    observer.observe(track, { childList: true, subtree: true })

    if (process.env.NODE_ENV !== 'production' && pin) {
      let ancestor = track.parentElement
      while (ancestor && ancestor !== document.body) {
        const overflow = getComputedStyle(ancestor)
        if (
          [overflow.overflow, overflow.overflowX, overflow.overflowY].some(
            (value) => value && value !== 'visible'
          )
        ) {
          console.warn(
            '[TqScrollScene] ancestor with overflow "' +
              overflow.overflow +
              '" disables sticky pinning — the scene will scroll instead of pin:',
            ancestor
          )
          break
        }
        ancestor = ancestor.parentElement
      }
    }

    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldReduceMotion, reducedMotion, pin, applyAll])

  const trackStyle = pin
    ? { ...(style || {}), height: normalizeSceneLength(sceneLength), position: 'relative' }
    : style

  return (
    <div ref={trackRef} style={trackStyle} {...rest}>
      {pin ? (
        <div style={{ position: 'sticky', top: 0, height: '100vh' }} data-scene-stage>
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  )
}

export default TqScrollScene
`
}
