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

const LANE_PROPS = [
  'x',
  'y',
  'scale',
  'rotate',
  'rotate-x',
  'rotate-y',
  'opacity',
  'blur',
  'grayscale',
  'saturate',
  'brightness',
]

const LANE_PRESETS = {
  'depth-1': [{ prop: 'y', at: [0, 1], values: [40, -40] }],
  'depth-2': [{ prop: 'y', at: [0, 1], values: [80, -80] }],
  'depth-3': [{ prop: 'y', at: [0, 1], values: [140, -140] }],
  'fade-window': [{ prop: 'opacity', at: [0, 0.15, 0.85, 1], values: [0, 1, 1, 0] }],
  'rail-x': [{ prop: 'x', at: [0, 1], values: [0, -100], unit: '%' }],
  'zoom-through': [{ prop: 'scale', at: [0, 1], values: [0.85, 1.1] }],
  'unblur-in': [{ prop: 'blur', at: [0, 0.3], values: [10, 0] }],
  'rise-in': [
    { prop: 'y', at: [0, 0.35], values: [70, 0] },
    { prop: 'opacity', at: [0, 0.3], values: [0, 1] },
  ],
  'ghost-out': [
    { prop: 'opacity', at: [0.7, 1], values: [1, 0] },
    { prop: 'blur', at: [0.7, 1], values: [0, 8] },
  ],
  'color-in': [{ prop: 'grayscale', at: [0, 0.45], values: [1, 0] }],
  'sun-up': [{ prop: 'brightness', at: [0, 0.4], values: [0.35, 1] }],
  'fade-to-mono': [
    { prop: 'grayscale', at: [0.6, 1], values: [0, 1] },
    { prop: 'saturate', at: [0.6, 1], values: [1, 0.6] },
  ],
  'crash-zoom': [
    { prop: 'scale', at: [0, 0.25], values: [1.6, 1] },
    { prop: 'opacity', at: [0, 0.15], values: [0, 1] },
  ],
  'tilt-reveal': [
    { prop: 'rotate-x', at: [0, 0.4], values: [35, 0] },
    { prop: 'opacity', at: [0, 0.3], values: [0, 1] },
  ],
  'spin-in': [
    { prop: 'rotate', at: [0, 0.35], values: [-90, 0] },
    { prop: 'opacity', at: [0, 0.25], values: [0, 1] },
  ],
  breathe: [{ prop: 'scale', at: [0, 0.5, 1], values: [0.98, 1.03, 0.98] }],
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

const FILTER_PROP_ORDER = ['blur', 'grayscale', 'saturate', 'brightness']

const applyLanesAt = (element, lanes, p) => {
  const transformParts = []
  const filterByProp = {}
  let needsPerspective = false
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
      case 'rotate-x':
        needsPerspective = true
        transformParts.push('rotateX(' + value + 'deg)')
        break
      case 'rotate-y':
        needsPerspective = true
        transformParts.push('rotateY(' + value + 'deg)')
        break
      case 'opacity':
        element.style.opacity = String(value)
        break
      case 'blur':
        filterByProp.blur = 'blur(' + value + 'px)'
        break
      case 'grayscale':
        filterByProp.grayscale = 'grayscale(' + value + ')'
        break
      case 'saturate':
        filterByProp.saturate = 'saturate(' + value + ')'
        break
      case 'brightness':
        filterByProp.brightness = 'brightness(' + value + ')'
        break
    }
  }
  if (needsPerspective) {
    transformParts.unshift('perspective(900px)')
  }
  if (transformParts.length > 0) {
    element.style.transform = transformParts.join(' ')
  }
  const filterParts = FILTER_PROP_ORDER.map((prop) => filterByProp[prop]).filter(Boolean)
  if (filterParts.length > 0) {
    element.style.filter = filterParts.join(' ')
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
  layout = 'flow',
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

  // layout='chapters': pin every REAL grid item of the stage into the same
  // cell. The CSS child rule handles plain children; this pass additionally
  // descends through display:contents wrappers (whose children — not they —
  // are the grid items), pierces open shadow roots/slots, and re-runs when a
  // not-yet-upgraded web component defines (pre-upgrade its
  // :host{display:contents} doesn't exist, so it reads as a box and upgrades
  // fire no mutation). Mirrors the editor runtime.
  const restackRef = React.useRef(null)
  const awaitedTagsRef = React.useRef(null)
  if (awaitedTagsRef.current === null) {
    awaitedTagsRef.current = new Set()
  }
  const restack = React.useCallback(() => {
    if (layout !== 'chapters' || !trackRef.current) {
      return
    }
    const stage = trackRef.current.querySelector(':scope > [data-scene-stage]')
    if (!stage) {
      return
    }
    const place = (el) => {
      // Duck-typed, never instanceof — mirrors the editor runtime, where
      // canvas elements belong to another realm and instanceof always fails.
      if (!el || el.nodeType !== 1 || el.tagName === 'STYLE') {
        return
      }
      if (!el.style || typeof el.style.removeProperty !== 'function') {
        return
      }
      let display = ''
      try {
        display = getComputedStyle(el).display
      } catch (e) {
        // detached node — skip
      }
      if (display === 'contents') {
        // A pre-upgrade pass may have pinned this wrapper as a box — clean up.
        if (el.style.gridArea) {
          el.style.removeProperty('grid-area')
        }
        if (el.shadowRoot) {
          Array.from(el.shadowRoot.children).forEach(place)
          return
        }
        if (typeof el.assignedElements === 'function') {
          const assigned = el.assignedElements({ flatten: true })
          ;(assigned.length > 0 ? assigned : Array.from(el.children)).forEach(place)
          return
        }
        Array.from(el.children).forEach(place)
        return
      }
      const tag = el.tagName.toLowerCase()
      if (
        tag.includes('-') &&
        typeof customElements !== 'undefined' &&
        !customElements.get(tag) &&
        !awaitedTagsRef.current.has(tag)
      ) {
        awaitedTagsRef.current.add(tag)
        customElements
          .whenDefined(tag)
          .then(() => restackRef.current && restackRef.current())
          .catch(() => undefined)
      }
      el.style.gridArea = '1 / 1'
    }
    Array.from(stage.children).forEach(place)
  }, [layout])
  restackRef.current = restack

  React.useEffect(() => {
    const track = trackRef.current
    if (!track) {
      return undefined
    }
    boundRef.current = collectBound(track)
    restack()

    if (shouldReduceMotion) {
      applyAll(reducedMotion === 'static' ? 0 : 1)
      return undefined
    }

    applyAll(progress.get())

    // Repeater items render after mount, and bindings may be rewritten in
    // place on existing elements (attribute-only mutations) — watch both,
    // mirroring the editor runtime. The attributeFilter keeps our own style
    // writes from feeding back into the observer.
    const observer = new MutationObserver(() => {
      boundRef.current = collectBound(track)
      restack()
      applyAll(progressRef.current)
    })
    observer.observe(track, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-scroll-bind'],
    })

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
  }, [shouldReduceMotion, reducedMotion, pin, applyAll, restack])

  // MIN-heights, never exact heights — mirrors the canvas renderer: an exact
  // height turned any content taller than one screen into an overflow the next
  // section painted straight over. A minimum keeps the full-screen chapter look
  // for short content and extends the stage for tall content.
  const trackStyle = pin
    ? { ...(style || {}), minHeight: normalizeSceneLength(sceneLength), position: 'relative' }
    : style

  return (
    // data-scene-track: the discovery hook for scene-aware widgets (TqScrollVideo
    // finds its driving scene with closest('[data-scene-track]')).
    <div ref={trackRef} style={trackStyle} data-scene-track {...rest}>
      {pin ? (
        <div
          style={{
            position: 'sticky',
            top: 0,
            minHeight: '100vh',
            // Travelling lanes (rail-x, rise-in, crash-zoom) must not spill a
            // scrollbar onto the page; overflow on the sticky element itself
            // never disables pinning. isolation keeps scene-internal stacking
            // from fighting the page. Mirrors the canvas renderer.
            overflow: 'hidden',
            isolation: 'isolate',
            // layout='chapters': the stage IS the centering grid and every
            // direct child stacks in the same cell (rule below) — the
            // scrollytelling shape with zero hand-written wrapper styles.
            ...(layout === 'chapters' ? { display: 'grid', placeItems: 'center' } : {}),
          }}
          data-scene-stage
          data-scene-layout={layout === 'chapters' ? 'chapters' : undefined}
        >
          {layout === 'chapters' ? (
            // dangerouslySetInnerHTML, NOT a text child: React SSR escapes text
            // inside <style> ('>' -> '&gt;'), and style is a raw-text element so
            // the browser never decodes it — the selector would break on the
            // server AND hydration would fail on the text mismatch.
            <style
              dangerouslySetInnerHTML={{
                __html:
                  '[data-scene-stage][data-scene-layout="chapters"] > :not(style) { grid-area: 1 / 1; }',
              }}
            />
          ) : null}
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
