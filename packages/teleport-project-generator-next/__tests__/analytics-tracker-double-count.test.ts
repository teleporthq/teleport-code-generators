import { TRACKER_SOURCE } from '../src/analytics/tracker-source'
import { TRACKER_COMPONENT_SOURCE } from '../src/analytics/tracker-component'

// Regression guard for the page-view / page-leave double-count: the pages-router
// emits routeChangeStart/Complete for the SAME path during hydration (and on a
// link to the current page), which used to fire a second pageview (new
// pageLoadId — not server-deduped) and a 0ms page_leave. The fix guards the two
// route entry points on the router's destination url, with a defensive same-path
// guard inside trackPageview.
describe('tracker — same-path double-count guard', () => {
  it('defines a same-path helper over the router url', () => {
    expect(TRACKER_SOURCE).toContain('function samePathAsCurrent(url)')
    expect(TRACKER_SOURCE).toContain('function pathnameOf(url)')
  })

  it('guards trackRouteChange against a same-path re-fire', () => {
    expect(TRACKER_SOURCE).toMatch(
      /export function trackRouteChange\(url\)\s*{\s*if \(samePathAsCurrent\(url\)\)\s*{\s*return\s*}/
    )
  })

  it('guards trackRouteLeave so hydration cannot enqueue a bogus page_leave', () => {
    expect(TRACKER_SOURCE).toMatch(
      /export function trackRouteLeave\(url\)\s*{[\s\S]*?if \(samePathAsCurrent\(url\)\)\s*{\s*return\s*}/
    )
  })

  it('keeps the defensive same-path guard inside trackPageview', () => {
    expect(TRACKER_SOURCE).toContain(
      '!isFirstLoad && currentPath !== null && newPath === currentPath'
    )
  })

  it('keeps pagehide end-of-visit unconditional (genuine leave)', () => {
    expect(TRACKER_SOURCE).toContain("window.addEventListener('pagehide', () => {")
    expect(TRACKER_SOURCE).toContain('trackLeave(true)')
  })

  it('passes the router destination url into both handlers', () => {
    expect(TRACKER_COMPONENT_SOURCE).toContain(
      'const handleRouteChangeStart = (url) => trackRouteLeave(url)'
    )
    expect(TRACKER_COMPONENT_SOURCE).toContain(
      'const handleRouteChangeComplete = (url) => trackRouteChange(url)'
    )
  })
})
