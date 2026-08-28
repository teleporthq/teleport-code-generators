/**
 * Generates TqSnapIntoView — the page-level "Snap into view" controller,
 * injected once as an _app sibling when any element in the project carries
 * data-snap-into-view (gentle | firm; "true" = gentle). Mirrors the canvas
 * preview runtime
 * (packages/renderer/src/node-types/snap-into-view-runtime.ts):
 *  1. CSS proximity snapping for the near zone (native, never traps).
 *  2. ONE rest-triggered settle across every opted-in element — the nearest
 *     top edge within reach wins, so several snapping sections never compete;
 *     never inside the run of an element taller than the screen (a pinned
 *     scene), never mid-scroll, never under reduced motion.
 * NO backticks in this file's comments — it is a template literal.
 */
export const SNAP_INTO_VIEW_ATTR = 'data-snap-into-view'

export const generateSnapIntoViewComponentCode = (): string => {
  return `import React from 'react'

const SNAP_ATTR = '${SNAP_INTO_VIEW_ATTR}'
// The attribute value is the strength: gentle settles only near the top edge,
// firm lands whenever the top edge is on screen. "true" reads as gentle.
const REACH_BY_STRENGTH = { gentle: 0.55, firm: 1 }
const REST_MS = 160
const STYLE_ID = 'tq-snap-into-view-style'
const CSS =
  'html { scroll-snap-type: y proximity; } ' +
  '[' + SNAP_ATTR + '="true"], [' + SNAP_ATTR + '="gentle"], [' + SNAP_ATTR + '="firm"]' +
  ' { scroll-snap-align: start; }'

const strengthOf = (value) => {
  if (value === 'true' || value === 'gentle') {
    return 'gentle'
  }
  if (value === 'firm') {
    return 'firm'
  }
  return null
}

const collectCandidates = () =>
  Array.from(document.querySelectorAll('[' + SNAP_ATTR + ']')).flatMap((element) => {
    const strength = strengthOf(element.getAttribute(SNAP_ATTR))
    if (!strength) {
      return []
    }
    const rect = element.getBoundingClientRect()
    return [{ top: rect.top, bottom: rect.bottom, reach: REACH_BY_STRENGTH[strength] }]
  })

// The settle distance for a resting scroll, or null when nothing should move:
// the nearest opted-in top edge within its reach wins; an element covering the
// whole viewport means the visitor is inside its run.
const pickSnapDelta = (rects, viewportHeight) => {
  const vh = Math.max(1, viewportHeight)
  if (rects.some((rect) => rect.top < 0 && rect.bottom > vh)) {
    return null
  }
  let best = null
  for (const rect of rects) {
    const distance = Math.abs(rect.top)
    if (distance < 2 || distance > vh * rect.reach) {
      continue
    }
    if (best === null || distance < Math.abs(best)) {
      best = rect.top
    }
  }
  return best
}

const TqSnapIntoView = () => {
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined
    }
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      return undefined
    }
    let timer = 0
    const settle = () => {
      const delta = pickSnapDelta(collectCandidates(), window.innerHeight || 1)
      if (delta !== null) {
        window.scrollBy({ top: delta, behavior: 'smooth' })
      }
    }
    const onScroll = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(settle, REST_MS)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.clearTimeout(timer)
    }
  }, [])
  return null
}

export default TqSnapIntoView
`
}
