import { PAGINATION_SCROLL_RUNTIME_JS } from '../src/pagination-scroll/pagination-scroll-runtime'
import {
  LIST_CHROME_ATTR,
  LIST_CONTROLS_ELEMENT_TYPE,
  LOAD_MORE_CONTROL_VALUE,
  PAGINATION_ATTR,
  PAGINATION_CONTROL_ATTR,
  PAGINATION_ELEMENT_TYPE,
} from '../src/pagination-scroll/constants'

/**
 * Contract guards for the emitted `utils/pagination-scroll.js`.
 *
 * The runtime is shipped as source, so the compiler cannot check any of this.
 * What is asserted here is exactly what would make it a silent no-op in the
 * browser: reading an attribute nobody writes, dropping the guards that keep it
 * from scrolling on a click that changed nothing, or losing the correction loop
 * that covers the list being briefly out of reach.
 */
describe('pagination scroll runtime source', () => {
  it('reads back the attributes the project plugin stamps', () => {
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(`var PAGINATION_ATTR = '${PAGINATION_ATTR}'`)
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(`var CHROME_ATTR = '${LIST_CHROME_ATTR}'`)
    // The stamped attributes and the element types they come from live in the
    // same module, so a rename cannot reach one half only.
    expect(PAGINATION_ELEMENT_TYPE).toBe('cms-pagination-node')
    expect(LIST_CONTROLS_ELEMENT_TYPE).toBe('data-source-search-node')
  })

  it('parses as valid JavaScript', () => {
    // tslint:disable-next-line:function-constructor
    expect(() => new Function(PAGINATION_SCROLL_RUNTIME_JS)).not.toThrow()
  })

  it('delegates one capture-phase click listener instead of wiring buttons', () => {
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(
      "document.addEventListener('click', onDocumentClick, true)"
    )
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(
      "typeof window !== 'undefined' && typeof document !== 'undefined'"
    )
  })

  it('only reacts to a real control inside a pagination block', () => {
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(
      `var CONTROL_SELECTOR = 'button, [role="button"]'`
    )
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain('var control = target.closest(CONTROL_SELECTOR)')
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(
      'var pagination = control.closest(PAGINATION_SELECTOR)'
    )
    // A disabled prev/next cannot have moved the page, so it must not scroll.
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain('if (!pagination || isDisabled(control))')
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(
      "control.disabled === true || control.getAttribute('aria-disabled') === 'true'"
    )
  })

  it('leaves a Load More click alone', () => {
    // Every other control REPLACES the rows, so returning to the top of the
    // list is what the visitor expects. Load More APPENDS below what they are
    // already reading — scrolling them back would undo the click.
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(
      `var LOAD_MORE_SELECTOR = '[${PAGINATION_CONTROL_ATTR}="${LOAD_MORE_CONTROL_VALUE}"]'`
    )
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain('if (control.closest(LOAD_MORE_SELECTOR))')
  })

  it('skips chrome and hidden siblings when it picks the first row', () => {
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain('if (isChrome(child) || !hasBox(child))')
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(
      'candidate.hasAttribute(CHROME_ATTR) || candidate.hasAttribute(PAGINATION_ATTR)'
    )
    // An empty result renders no rows at all; the list block is still a target.
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(
      'return findFirstListItem(pagination) || pagination.parentElement'
    )
  })

  it('clamps to what the document can actually scroll', () => {
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(
      'return Math.min(Math.max(desired, 0), maxScrollTop(container))'
    )
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(
      'return Math.max(0, scroller.scrollHeight - scroller.clientHeight)'
    )
  })

  it('keeps correcting until the list settles, then gives control back', () => {
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(
      'timer = window.setTimeout(correct, CORRECTION_INTERVAL_MS)'
    )
    // A correction re-targets with the same behaviour, so it cannot cut the
    // first scroll's animation short.
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain('applyScroll(container, top, behavior)')
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain('if (!pagination.isConnected)')
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(
      "window.addEventListener('wheel', onVisitorScroll, { passive: true })"
    )
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(
      "if (event.type === 'keydown' && SCROLL_KEYS.indexOf(event.key) === -1)"
    )
    // Two lists on one page must not correct each other.
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain('if (activePin) {\n    activePin.stop()')
  })

  it('honours reduced motion and never throws out of the handler', () => {
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(
      "window.matchMedia('(prefers-reduced-motion: reduce)').matches"
    )
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(
      "var behavior = prefersReducedMotion() ? 'auto' : 'smooth'"
    )
    expect(PAGINATION_SCROLL_RUNTIME_JS).toMatch(/function onDocumentClick\(event\) \{\s*try \{/)
  })

  it('scrolls the panel that owns the list when the page itself does not scroll', () => {
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(
      'var container = findScrollContainer(pagination)'
    )
    // A block that grows with its content is not a scroller — and neither is the
    // horizontally scrolling table wrapper, whose overflow-y computes to auto.
    expect(PAGINATION_SCROLL_RUNTIME_JS).toContain(
      'return element.scrollHeight - element.clientHeight > 1'
    )
  })
})
