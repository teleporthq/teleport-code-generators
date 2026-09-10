import { UIDLUtils } from '@teleporthq/teleport-shared'
import { ProjectPlugin, ProjectPluginStructure, UIDLElement } from '@teleporthq/teleport-types'
import { appendGlobalCss, appendPageScript } from './global-css'

/**
 * Scroll-rail behaviors for the static HTML export: item snapping and the
 * hidden scrollbar are CSS (appended to the global stylesheet), the wheel
 * driving is one small inline script per page — only when a rail opted in.
 * Mirrors the Next TqScrollRail controller.
 */
export const SCROLL_RAIL_ATTR = {
  snap: 'data-scroll-rail-snap',
  wheel: 'data-scroll-rail-wheel',
  scrollbar: 'data-scroll-rail-scrollbar',
}

export const SCROLL_RAIL_CSS =
  '[data-scroll-rail-snap="gentle"] {\n  scroll-snap-type: x proximity;\n}\n' +
  '[data-scroll-rail-snap="firm"] {\n  scroll-snap-type: x mandatory;\n}\n' +
  '[data-scroll-rail-snap] > * {\n  scroll-snap-align: start;\n}\n' +
  '[data-scroll-rail-scrollbar="hidden"] {\n  scrollbar-width: none;\n  -ms-overflow-style: none;\n}\n' +
  '[data-scroll-rail-scrollbar="hidden"]::-webkit-scrollbar {\n  display: none;\n}\n'

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

const railUsage = (uidl: ProjectPluginStructure['uidl']): { any: boolean; wheel: boolean } => {
  const usage = { any: false, wheel: false }
  const visit = (element: UIDLElement) => {
    const attrs = element.attrs || {}
    if (Object.values(SCROLL_RAIL_ATTR).some((attr) => attrs[attr] !== undefined)) {
      usage.any = true
    }
    const wheel = attrs[SCROLL_RAIL_ATTR.wheel] as { content?: unknown } | undefined
    if (wheel && String(wheel.content) === 'true') {
      usage.wheel = true
    }
  }
  UIDLUtils.traverseElements(uidl.root.node, visit)
  Object.values(uidl.components || {}).forEach((component) => {
    UIDLUtils.traverseElements(component.node, visit)
  })
  return usage
}

export class ProjectPluginScrollRail implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const usage = railUsage(structure.uidl)
    if (!usage.any) {
      return structure
    }
    appendGlobalCss(structure, SCROLL_RAIL_CSS)
    if (usage.wheel) {
      appendPageScript(structure, SCROLL_RAIL_WHEEL_SCRIPT)
    }
    return structure
  }
}

export const pluginScrollRail = new ProjectPluginScrollRail()
