import {
  LIST_CHROME_ATTR,
  LOAD_MORE_CONTROL_VALUE,
  PAGINATION_ATTR,
  PAGINATION_CONTROL_ATTR,
} from './constants'

/**
 * Source of the generated `utils/pagination-scroll.js`.
 *
 * ## The problem
 *
 * A paginated array mapper renders its rows and, below them, a pagination block
 * whose previous/next buttons only move a piece of React state
 * (`ds_<n>_state.page`). Nothing navigates, so the browser has no reason to
 * move the viewport: the visitor scrolls to the bottom of page 1, clicks
 * "Next", and lands on the BOTTOM of page 2 — looking at the last rows of a
 * list they have not seen the start of.
 *
 * ## Why a delegated runtime rather than per-button code
 *
 * The pagination block is emitted from one UIDL element type
 * (`cms-pagination-node`), on pages and on components, once per paginated
 * mapper — thirteen of them in a default e-commerce project alone. A single
 * capture-phase listener on `document`, keyed off the marker the project plugin
 * stamps on that element, covers every one of them (including blocks mounted
 * later by a client-side route change or a conditional branch) without touching
 * the generated `onClick`s, and gives the behaviour one place to live.
 *
 * ## Which element it scrolls to
 *
 * The mapper renders its rows INLINE — there is no wrapper element around them,
 * because one would become a stray grid/flex item in the list's own layout. So
 * the rows are plain siblings of the pagination block, and the first row is the
 * first sibling that is not chrome. Two element types are chrome and are marked
 * as such by the project plugin: the pagination block itself and the mapper's
 * search/sort/filter block (`data-source-search-node`), which the generator
 * emits ABOVE the rows.
 *
 * On a listing page that lands exactly on the first product card. On an admin
 * table — toolbar, table, pagination — it lands on the toolbar, which sits
 * directly above the table header, so the first row is on screen either way.
 *
 * ## Why it corrects after the first scroll
 *
 * Between the click and the new rows arriving, the mapper paints its loading
 * state, which is usually shorter than a full page of rows. A list near the
 * bottom of a short document therefore has a start the browser CANNOT reach at
 * that moment and clamps the scroll to the document end. The correction loop
 * re-issues the scroll once the document is tall enough again, and hands
 * control straight back the moment the visitor scrolls for themselves.
 */
export const PAGINATION_SCROLL_RUNTIME_JS = `/* Array-mapper pagination scroll (TeleportHQ). Generated file, do not edit.
   See the pagination-scroll project plugin in teleport-project-generator-next. */

var PAGINATION_ATTR = '${PAGINATION_ATTR}'
var CHROME_ATTR = '${LIST_CHROME_ATTR}'
var PAGINATION_SELECTOR = '[' + PAGINATION_ATTR + ']'
var CHROME_SELECTOR = '[' + CHROME_ATTR + ']'

// Only a real control counts. A caption or a page counter sitting inside the
// pagination block must not move the page when it is clicked.
var CONTROL_SELECTOR = 'button, [role="button"]'

// Load More appends below what the visitor is already reading, so scrolling
// them back to the first row would undo the click they just made.
var LOAD_MORE_SELECTOR = '[${PAGINATION_CONTROL_ATTR}="${LOAD_MORE_CONTROL_VALUE}"]'

// Keys that mean "I am scrolling myself", and therefore end the correction loop.
var SCROLL_KEYS = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']

// How long after the click corrections stay armed. Long enough to cover a slow
// fetch, short enough that a late layout shift is no longer attributed to it.
var SETTLE_MS = 2000
var CORRECTION_INTERVAL_MS = 100

// Breathing room above the first row.
var TOP_GAP = 8

// Whatever is pinned to the top of the viewport may not be treated as a header
// beyond this share of it — a full-screen fixed overlay is not a header.
var MAX_STICKY_RATIO = 0.4

var activePin = null

function isElement(node) {
  return !!node && node.nodeType === 1
}

function asElement(node) {
  if (isElement(node)) {
    return node
  }
  return node && node.parentElement ? node.parentElement : null
}

function isDisabled(control) {
  return control.disabled === true || control.getAttribute('aria-disabled') === 'true'
}

function hasBox(element) {
  return element.getClientRects().length > 0
}

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch (error) {
    return false
  }
}

// A sibling of the rows that is chrome rather than a row: a pagination block
// (this one, or a second one rendered above the rows), the mapper's
// search/sort/filter block, or a wrapper holding either of them.
function isChrome(candidate) {
  if (candidate.hasAttribute(CHROME_ATTR) || candidate.hasAttribute(PAGINATION_ATTR)) {
    return true
  }
  return !!candidate.querySelector(CHROME_SELECTOR + ', ' + PAGINATION_SELECTOR)
}

// The rows live alongside the pagination block, so the first row is the first
// sibling that is neither chrome nor hidden. Deliberately does NOT climb past
// that one parent: when a list has no rows to point at, the enclosing block is
// a safe answer, whereas a search widened to grandparents starts returning
// whatever else happens to sit next to the list.
function findFirstListItem(pagination) {
  var region = pagination.parentElement
  if (!region) {
    return null
  }

  var children = region.children
  for (var index = 0; index < children.length; index++) {
    var child = children[index]
    // A hidden sibling reports a zero box, which would put the scroll somewhere
    // the visitor cannot see anything.
    if (isChrome(child) || !hasBox(child)) {
      continue
    }
    return child
  }

  return null
}

// Falls back to the block holding the pagination: an empty result may render
// no rows at all, and its top is still the top of the list.
function findScrollTarget(pagination) {
  return findFirstListItem(pagination) || pagination.parentElement
}

function isScrollable(element) {
  var overflowY = window.getComputedStyle(element).overflowY
  if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') {
    return false
  }
  // A block that grows with its content reports the same two heights, so only a
  // genuinely constrained one is treated as the scroller. This also rules out
  // the horizontal table wrapper, whose overflow-y computes to auto by spec.
  return element.scrollHeight - element.clientHeight > 1
}

// The element that actually scrolls the list — a panel with its own overflow,
// or null when it is the page itself.
function findScrollContainer(element) {
  var parent = element.parentElement
  while (parent && parent !== document.body && parent !== document.documentElement) {
    if (isScrollable(parent)) {
      return parent
    }
    parent = parent.parentElement
  }
  return null
}

// Height of whatever is pinned to the top of the viewport, so the first row
// lands below a sticky header instead of behind it.
function stickyOffset() {
  if (typeof document.elementsFromPoint !== 'function') {
    return 0
  }

  var stack = document.elementsFromPoint(Math.floor(window.innerWidth / 2), 1)
  var offset = 0

  for (var index = 0; index < stack.length; index++) {
    var element = stack[index]
    if (!isElement(element)) {
      continue
    }
    var position = window.getComputedStyle(element).position
    if (position !== 'fixed' && position !== 'sticky') {
      continue
    }
    var bottom = element.getBoundingClientRect().bottom
    if (bottom > offset) {
      offset = bottom
    }
  }

  return Math.min(Math.max(offset, 0), window.innerHeight * MAX_STICKY_RATIO)
}

function maxScrollTop(container) {
  var scroller = container || document.scrollingElement || document.documentElement
  return Math.max(0, scroller.scrollHeight - scroller.clientHeight)
}

function desiredScrollTop(pagination, container) {
  var target = findScrollTarget(pagination)
  if (!target || !target.isConnected) {
    return null
  }

  var top = target.getBoundingClientRect().top
  var desired

  if (container) {
    var box = container.getBoundingClientRect()
    desired = container.scrollTop + top - box.top - container.clientTop - TOP_GAP
  } else {
    desired = top + window.pageYOffset - stickyOffset() - TOP_GAP
  }

  return Math.min(Math.max(desired, 0), maxScrollTop(container))
}

function applyScroll(container, top, behavior) {
  var scroller = container || window
  try {
    scroller.scrollTo({ top: top, behavior: behavior })
  } catch (error) {
    if (container) {
      container.scrollTop = top
    } else {
      window.scrollTo(0, top)
    }
  }
}

function pinListStart(pagination) {
  if (activePin) {
    activePin.stop()
  }

  var container = findScrollContainer(pagination)
  var behavior = prefersReducedMotion() ? 'auto' : 'smooth'
  var deadline = Date.now() + SETTLE_MS
  var lastTop = null
  var timer = null
  var listening = false
  var pin = { stop: stop }

  function stop() {
    if (timer) {
      window.clearTimeout(timer)
      timer = null
    }
    if (listening) {
      window.removeEventListener('wheel', onVisitorScroll)
      window.removeEventListener('touchstart', onVisitorScroll)
      window.removeEventListener('keydown', onVisitorScroll)
      listening = false
    }
    if (activePin === pin) {
      activePin = null
    }
  }

  function onVisitorScroll(event) {
    if (event.type === 'keydown' && SCROLL_KEYS.indexOf(event.key) === -1) {
      return
    }
    stop()
  }

  // Armed only once the first scroll has been issued: a trackpad still coasting
  // from the gesture that brought the visitor down to the button would
  // otherwise cancel the pin before it had moved the page at all.
  function listenForVisitorScroll() {
    if (listening) {
      return
    }
    listening = true
    window.addEventListener('wheel', onVisitorScroll, { passive: true })
    window.addEventListener('touchstart', onVisitorScroll, { passive: true })
    window.addEventListener('keydown', onVisitorScroll)
  }

  function correct() {
    timer = null

    try {
      if (!pagination.isConnected) {
        stop()
        return
      }

      var top = desiredScrollTop(pagination, container)
      if (top !== null && (lastTop === null || Math.abs(top - lastTop) > 1)) {
        // A correction re-targets with the SAME behaviour: it usually arrives
        // while the first scroll is still animating, and switching to an
        // instant jump there would cut that animation short in front of the
        // visitor.
        applyScroll(container, top, behavior)
        lastTop = top
        listenForVisitorScroll()
      }
    } catch (error) {
      // Never leave the loop half-alive with its listeners still attached.
      stop()
      return
    }

    if (Date.now() < deadline) {
      timer = window.setTimeout(correct, CORRECTION_INTERVAL_MS)
    } else {
      stop()
    }
  }

  activePin = pin
  // Deferred by one task rather than run inline, so React has committed the
  // click's state update and the list is already showing whatever it shows for
  // the new page. A timer rather than an animation frame: the correction loop
  // is timer-based anyway, so stop() stays a single cancel path.
  timer = window.setTimeout(correct, 0)
}

function onDocumentClick(event) {
  try {
    var target = asElement(event.target)
    if (!target) {
      return
    }
    var control = target.closest(CONTROL_SELECTOR)
    if (!control) {
      return
    }
    if (control.closest(LOAD_MORE_SELECTOR)) {
      return
    }
    var pagination = control.closest(PAGINATION_SELECTOR)
    if (!pagination || isDisabled(control)) {
      return
    }
    pinListStart(pagination)
  } catch (error) {
    // Scroll assistance is best-effort — pagination has to keep working.
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // Capture phase, so the listener is reached even when a handler closer to the
  // button stops the event from bubbling.
  document.addEventListener('click', onDocumentClick, true)
}
`
