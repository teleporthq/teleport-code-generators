/**
 * The audit that runs INSIDE the page.
 *
 * `next build` passing and the DOM being present prove nothing about whether a
 * human sees anything. The archetype: framer-motion server-renders its `initial`
 * state, so a reveal animation ships `opacity: 0` in the HTML and depends on
 * client JS to undo it. If hydration throws, if an IntersectionObserver never
 * fires, or if a timing failsafe misses, the section stays invisible forever —
 * with a perfectly valid UIDL, a green build, and every generator test passing.
 *
 * So this looks for the only thing that matters: content that occupies real
 * space and cannot be seen. It then scrolls each candidate to the centre of the
 * viewport, waits, and re-checks THE SAME ELEMENT. Content that appears was a
 * working in-view animation; content still invisible while sitting in the middle
 * of the screen is a defect.
 *
 * One function, one `page.evaluate`, element references held across both phases.
 * Two earlier designs failed here and both failed *quietly*:
 *  - passing this as a source STRING made Playwright evaluate it as an
 *    expression rather than call it, so every audit returned `undefined` and
 *    every route reported "nothing hidden";
 *  - re-finding elements by CSS selector between phases conflated distinct
 *    nodes, because generated markup reuses machine-generated class names.
 * A check that cannot fail is worse than no check, so the caller treats a
 * missing result as an error rather than a pass.
 *
 * Runs in the browser: self-contained, no imports, no closure over this module.
 */
export const auditVisibility = async (options) => {
  const MIN_AREA = (options && options.minArea) || 2500
  const DWELL_MS = (options && options.dwellMs) || 700
  const MAX_CANDIDATES = (options && options.maxCandidates) || 40

  // Provenance the generators stamp into the DOM. An invisible region reports
  // which widget produced it, so the finding routes to a fix without guesswork.
  const provenance = (el) => {
    let node = el
    for (let depth = 0; node && depth < 6; depth += 1) {
      if (node.getAttribute && node.getAttribute('data-thq')) {
        return node.getAttribute('data-thq')
      }
      node = node.parentElement
    }
    return null
  }

  const selectorFor = (el) => {
    const parts = []
    let node = el
    for (let depth = 0; node && node.tagName && depth < 4; depth += 1) {
      let part = node.tagName.toLowerCase()
      if (node.id) {
        parts.unshift(part + '#' + node.id)
        break
      }
      const cls = typeof node.className === 'string' ? node.className.trim().split(/\s+/)[0] : ''
      if (cls) {
        part += '.' + cls
      }
      parts.unshift(part)
      node = node.parentElement
    }
    return parts.join(' > ')
  }

  const hasVisibleContent = (el) => {
    if (el.querySelector('img, svg, video, canvas, picture')) {
      return true
    }
    return (el.textContent || '').trim().length > 0
  }

  const isInvisible = (el) => {
    const style = window.getComputedStyle(el)
    const opacity = parseFloat(style.opacity)
    if (style.visibility === 'hidden') {
      return { hidden: true, reason: 'visibility', opacity: isNaN(opacity) ? null : opacity }
    }
    if (!isNaN(opacity) && opacity < 0.01) {
      return { hidden: true, reason: 'opacity', opacity }
    }
    return { hidden: false, reason: null, opacity: isNaN(opacity) ? null : opacity }
  }

  const candidates = []
  const claimed = []
  const all = document.querySelectorAll('body *')
  for (let index = 0; index < all.length; index += 1) {
    const el = all[index]
    const rect = el.getBoundingClientRect()
    const area = rect.width * rect.height
    if (area < MIN_AREA || !hasVisibleContent(el)) {
      continue
    }
    const state = isInvisible(el)
    if (!state.hidden) {
      continue
    }
    // An ancestor already reported covers its subtree; reporting every
    // descendant of one hidden hero turns a single defect into fifty findings.
    if (claimed.some((other) => other.contains(el))) {
      continue
    }
    claimed.push(el)
    candidates.push({
      element: el,
      finding: {
        selector: selectorFor(el),
        dataThq: provenance(el),
        tag: el.tagName.toLowerCase(),
        reason: state.reason,
        opacityOnLoad: state.opacity,
        area: Math.round(area),
        documentTop: Math.round(rect.top + window.scrollY),
        inlineStyle: (el.getAttribute('style') || '').slice(0, 160),
        textPreview: (el.textContent || '').trim().slice(0, 120),
      },
    })
  }

  const domNodes = document.getElementsByTagName('*').length
  const bodyText = (document.body.innerText || '').trim().length
  const scrollHeight = document.documentElement.scrollHeight

  const probed = candidates.slice(0, MAX_CANDIDATES)
  for (const entry of probed) {
    entry.element.scrollIntoView({ block: 'center' })
    await new Promise((resolve) => setTimeout(resolve, DWELL_MS))
  }
  window.scrollTo(0, 0)
  await new Promise((resolve) => setTimeout(resolve, 500))

  const stillHidden = []
  for (const entry of probed) {
    const state = isInvisible(entry.element)
    if (state.hidden) {
      stillHidden.push({ ...entry.finding, opacity: state.opacity })
    }
  }

  return {
    stillHidden,
    hiddenOnLoad: candidates.length,
    revealedByScroll: probed.length - stillHidden.length,
    truncated: candidates.length > probed.length,
    domNodes,
    bodyText,
    scrollHeight,
  }
}
