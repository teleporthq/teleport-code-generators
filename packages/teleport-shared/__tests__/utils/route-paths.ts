import { appendRouteDisambiguator, pathHasDynamicSegment } from '../../src/utils/route-paths'

describe('appendRouteDisambiguator', () => {
  it('returns the route untouched for suffix 0', () => {
    expect(appendRouteDisambiguator('/products-list', 0)).toBe('/products-list')
    expect(appendRouteDisambiguator('/products/[id]', 0)).toBe('/products/[id]')
  })

  it('appends to a static route exactly as the old string append did', () => {
    expect(appendRouteDisambiguator('/products-list', 1)).toBe('/products-list1')
    expect(appendRouteDisambiguator('/admin/product-reviews/create', 2)).toBe(
      '/admin/product-reviews/create2'
    )
  })

  /**
   * The shipped build failure: `[id]1` is not a route parameter, so Next
   * refuses `getStaticPaths` on the page and the production build dies.
   */
  it('THE DEFECT: never suffixes a trailing route parameter', () => {
    const deduped = appendRouteDisambiguator('/admin/product-reviews/update/[id]', 1)
    expect(deduped).toBe('/admin/product-reviews/update1/[id]')
    expect(deduped.endsWith('[id]')).toBe(true)
    expect(pathHasDynamicSegment(deduped)).toBe(true)
  })

  it('skips past every trailing parameter to the last literal segment', () => {
    expect(appendRouteDisambiguator('/shop/[category]/[id]', 3)).toBe('/shop3/[category]/[id]')
  })

  it('leaves catch-all and optional catch-all parameters alone', () => {
    expect(appendRouteDisambiguator('/docs/[...slug]', 1)).toBe('/docs1/[...slug]')
    expect(appendRouteDisambiguator('/docs/[[...slug]]', 1)).toBe('/docs1/[[...slug]]')
  })

  it('ignores the empty segment a leading slash produces', () => {
    expect(appendRouteDisambiguator('/about', 1)).toBe('/about1')
  })

  /**
   * A route made only of parameters has no text to extend, and renaming `[id]`
   * would break the `params.id` the page reads — so a literal segment is added
   * in front of the tail.
   */
  it('inserts a literal segment when every segment is a parameter', () => {
    expect(appendRouteDisambiguator('/[id]', 1)).toBe('/page1/[id]')
    expect(appendRouteDisambiguator('/[category]/[id]', 2)).toBe('/page2/[category]/[id]')
    expect(pathHasDynamicSegment(appendRouteDisambiguator('/[id]', 1))).toBe(true)
  })

  it('keeps the historical append for routes with no real segment', () => {
    expect(appendRouteDisambiguator('/', 1)).toBe('/1')
    expect(appendRouteDisambiguator('**', 1)).toBe('**1')
    expect(appendRouteDisambiguator('', 1)).toBe('1')
  })

  it('is injective in the suffix, so the dedupe loop always terminates', () => {
    const route = '/admin/product-reviews/update/[id]'
    const results = [1, 2, 3, 10].map((suffix) => appendRouteDisambiguator(route, suffix))
    expect(new Set(results).size).toBe(results.length)
    expect(results).not.toContain(route)
  })

  it('is deterministic — the dedupe loop probes with the same call it commits', () => {
    const route = '/admin/product-reviews/update/[id]'
    expect(appendRouteDisambiguator(route, 1)).toBe(appendRouteDisambiguator(route, 1))
  })
})
