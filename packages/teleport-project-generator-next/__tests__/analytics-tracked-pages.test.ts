import { TRACKER_SOURCE } from '../src/analytics/tracker-source'

/**
 * The emitted tracker, executed: the module syntax is stripped the way a
 * bundler resolves it, and the matching functions plus the two module-level
 * lists are handed back so the tests drive the real code, not a copy of it.
 */
interface TrackerMatching {
  setExcludedPaths: (paths: string[]) => void
  setLocales: (locales: string[]) => void
  isPathExcluded: (path: string) => boolean
  normalizeTrackedPath: (path: string) => string
}

function loadMatching(): TrackerMatching {
  const body = TRACKER_SOURCE.replace(/^export\s+/gm, '')
  const factory = new Function(
    `${body}
    return {
      setExcludedPaths: function (paths) { excludedPaths = paths },
      setLocales: function (locales) { siteLocales = locales },
      isPathExcluded: isPathExcluded,
      normalizeTrackedPath: normalizeTrackedPath,
    }`
  )
  return factory() as TrackerMatching
}

describe('tracked pages — the emitted tracker', () => {
  it('tracks every page when no list was baked in', () => {
    const tracker = loadMatching()
    expect(tracker.isPathExcluded('/admin-panel/orders')).toBe(false)
    expect(tracker.isPathExcluded('/')).toBe(false)
  })

  it('keeps a listed page out, exactly or by prefix, however the address is written', () => {
    const tracker = loadMatching()
    tracker.setExcludedPaths(['/admin-panel', '/admin-panel/*', '/secret'])

    expect(tracker.isPathExcluded('/admin-panel')).toBe(true)
    expect(tracker.isPathExcluded('/admin-panel/')).toBe(true)
    expect(tracker.isPathExcluded('/admin-panel/orders/42')).toBe(true)
    expect(tracker.isPathExcluded('/secret?tab=1#top')).toBe(true)

    expect(tracker.isPathExcluded('/')).toBe(false)
    expect(tracker.isPathExcluded('/secrets')).toBe(false)
    expect(tracker.isPathExcluded('/admin-panels')).toBe(false)
  })

  it('matches a dynamic page by its published prefix without touching its listing page', () => {
    const tracker = loadMatching()
    tracker.setExcludedPaths(['/products/*'])

    expect(tracker.isPathExcluded('/products/42')).toBe(true)
    expect(tracker.isPathExcluded('/products')).toBe(false)
  })

  it('judges a locale-prefixed address against the same list', () => {
    const tracker = loadMatching()
    tracker.setExcludedPaths(['/admin-panel/*', '/'])
    tracker.setLocales(['en', 'fr'])

    expect(tracker.normalizeTrackedPath('/fr/admin-panel/orders/')).toBe('/admin-panel/orders')
    expect(tracker.isPathExcluded('/fr/admin-panel/orders')).toBe(true)
    expect(tracker.isPathExcluded('/fr')).toBe(true)
    expect(tracker.isPathExcluded('/fr/about')).toBe(false)
  })

  it('silences a page kept out of analytics instead of giving it a page identity', () => {
    expect(TRACKER_SOURCE).toMatch(
      /if \(isPathExcluded\(newPath\)\) \{[\s\S]*?currentPath = newPath\s*pageLoadId = null\s*return/
    )
    // Commerce steps guard on the page identity like clicks and heartbeats do.
    expect(TRACKER_SOURCE).toContain('if (!initialized || !isTrackingPossible() || !pageLoadId) {')
  })
})

describe('click matching — what a funnel step can see', () => {
  it('reports the clicked element’s classes, capped, so ".class" steps match', () => {
    expect(TRACKER_SOURCE).toContain(
      "Array.prototype.slice.call(target.classList).join(' ').slice(0, 255)"
    )
  })

  it('counts a click on any element marked data-tp-track', () => {
    expect(TRACKER_SOURCE).toContain(
      `'a, button, [role="button"], input[type="submit"], [data-tp-event], [data-tp-track]'`
    )
  })
})
