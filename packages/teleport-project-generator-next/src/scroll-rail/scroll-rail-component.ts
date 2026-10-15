/**
 * Generates TqScrollRail — the page-level controller for containers that
 * scroll sideways and opted into rail behaviors (item snapping, wheel
 * driving, hidden scrollbar). Injected once as an _app sibling when any
 * element carries a data-scroll-rail-* attribute. Mirrors the canvas runtime
 * (packages/renderer/src/node-types/scroll-rail-runtime.ts): the CSS is
 * installed once; a vertical wheel gesture over an opted-in rail moves it
 * sideways, handing the gesture back to the page at either edge.
 * NO backticks in this file's comments — it is a template literal.
 */
export const SCROLL_RAIL_ATTR = {
  snap: 'data-scroll-rail-snap',
  wheel: 'data-scroll-rail-wheel',
  scrollbar: 'data-scroll-rail-scrollbar',
}

export const SCROLL_RAIL_ATTRS: string[] = Object.values(SCROLL_RAIL_ATTR)

export const SCROLL_RAIL_CSS =
  '[data-scroll-rail-snap="gentle"] { scroll-snap-type: x proximity; } ' +
  '[data-scroll-rail-snap="firm"] { scroll-snap-type: x mandatory; } ' +
  '[data-scroll-rail-snap] > * { scroll-snap-align: start; } ' +
  '[data-scroll-rail-scrollbar="hidden"] { scrollbar-width: none; -ms-overflow-style: none; } ' +
  '[data-scroll-rail-scrollbar="hidden"]::-webkit-scrollbar { display: none; }'

/** The wheel handler as plain script — shared with the static HTML export. */
export const SCROLL_RAIL_WHEEL_SCRIPT = `(function () {
  var WHEEL_ATTR = '${SCROLL_RAIL_ATTR.wheel}'
  var SNAP_ATTR = '${SCROLL_RAIL_ATTR.snap}'
  var GESTURE_MS = 350
  var lastGestureAt = typeof WeakMap === 'function' ? new WeakMap() : null
  var railWheelDelta = function (deltaX, deltaY, scrollLeft, scrollWidth, clientWidth) {
    if (Math.abs(deltaY) <= Math.abs(deltaX)) { return null }
    var maxScroll = scrollWidth - clientWidth
    if (maxScroll <= 0) { return null }
    if (deltaY < 0 && scrollLeft <= 0) { return null }
    if (deltaY > 0 && scrollLeft >= maxScroll - 1) { return null }
    return deltaY
  }
  var nextSnapTarget = function (offsets, scrollLeft, direction) {
    var sorted = offsets.slice().sort(function (a, b) { return a - b })
    if (direction > 0) {
      for (var i = 0; i < sorted.length; i++) { if (sorted[i] > scrollLeft + 1) { return sorted[i] } }
      return null
    }
    for (var j = sorted.length - 1; j >= 0; j--) { if (sorted[j] < scrollLeft - 1) { return sorted[j] } }
    return null
  }
  document.addEventListener('wheel', function (event) {
    var target = event.target
    var rail = target && target.closest ? target.closest('[' + WHEEL_ATTR + '="true"]') : null
    if (!rail) { return }
    var delta = railWheelDelta(event.deltaX, event.deltaY, rail.scrollLeft, rail.scrollWidth, rail.clientWidth)
    if (delta === null) { return }
    event.preventDefault()
    if (!rail.hasAttribute(SNAP_ATTR)) { rail.scrollLeft += delta; return }
    var now = Date.now()
    var last = lastGestureAt ? (lastGestureAt.get(rail) || 0) : (rail.__tqRailGestureAt || 0)
    if (now - last < GESTURE_MS) { return }
    var padding = parseFloat(window.getComputedStyle(rail).scrollPaddingLeft) || 0
    var railLeft = rail.getBoundingClientRect().left
    var offsets = Array.prototype.map.call(rail.children, function (child) {
      return child.getBoundingClientRect().left - railLeft + rail.scrollLeft - padding
    })
    var next = nextSnapTarget(offsets, rail.scrollLeft, delta > 0 ? 1 : -1)
    if (next === null) { return }
    if (lastGestureAt) { lastGestureAt.set(rail, now) } else { rail.__tqRailGestureAt = now }
    rail.scrollTo({ left: next, behavior: 'smooth' })
  }, { passive: false })
})()`

export const generateScrollRailComponentCode = (): string => {
  return `import React from 'react'

const STYLE_ID = 'tq-scroll-rail-style'
const CSS = '${SCROLL_RAIL_CSS}'
const WHEEL_ATTR = '${SCROLL_RAIL_ATTR.wheel}'
const SNAP_ATTR = '${SCROLL_RAIL_ATTR.snap}'
// Wheel events closer together than this belong to one gesture on a snapping rail.
const GESTURE_MS = 350

// The sideways distance a vertical wheel gesture should move the rail, or
// null when the page should scroll instead (sideways gestures stay native;
// a rail at its edge hands the gesture back).
const railWheelDelta = (deltaX, deltaY, scrollLeft, scrollWidth, clientWidth) => {
  if (Math.abs(deltaY) <= Math.abs(deltaX)) {
    return null
  }
  const maxScroll = scrollWidth - clientWidth
  if (maxScroll <= 0) {
    return null
  }
  if (deltaY < 0 && scrollLeft <= 0) {
    return null
  }
  if (deltaY > 0 && scrollLeft >= maxScroll - 1) {
    return null
  }
  return deltaY
}

// On a snapping rail a free scrollLeft nudge is undone at once (the browser
// re-snaps after every programmatic scroll), so a gesture moves one item: the
// next item edge past the current position in the gesture's direction.
const nextSnapTarget = (offsets, scrollLeft, direction) => {
  const sorted = offsets.slice().sort((a, b) => a - b)
  if (direction > 0) {
    const next = sorted.find((offset) => offset > scrollLeft + 1)
    return next === undefined ? null : next
  }
  const previous = sorted.reverse().find((offset) => offset < scrollLeft - 1)
  return previous === undefined ? null : previous
}

const TqScrollRail = () => {
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
    const lastGestureAt = new WeakMap()
    const onWheel = (event) => {
      const target = event.target
      const rail = target && target.closest ? target.closest('[' + WHEEL_ATTR + '="true"]') : null
      if (!rail) {
        return
      }
      const delta = railWheelDelta(
        event.deltaX,
        event.deltaY,
        rail.scrollLeft,
        rail.scrollWidth,
        rail.clientWidth
      )
      if (delta === null) {
        return
      }
      event.preventDefault()
      if (!rail.hasAttribute(SNAP_ATTR)) {
        rail.scrollLeft += delta
        return
      }
      const now = Date.now()
      if (now - (lastGestureAt.get(rail) || 0) < GESTURE_MS) {
        return
      }
      const padding = parseFloat(window.getComputedStyle(rail).scrollPaddingLeft) || 0
      const railLeft = rail.getBoundingClientRect().left
      const offsets = Array.from(rail.children).map(
        (child) => child.getBoundingClientRect().left - railLeft + rail.scrollLeft - padding
      )
      const next = nextSnapTarget(offsets, rail.scrollLeft, delta > 0 ? 1 : -1)
      if (next === null) {
        return
      }
      lastGestureAt.set(rail, now)
      rail.scrollTo({ left: next, behavior: 'smooth' })
    }
    document.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      document.removeEventListener('wheel', onWheel)
    }
  }, [])
  return null
}

export default TqScrollRail
`
}
