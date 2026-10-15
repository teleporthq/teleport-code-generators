import { parse } from '@babel/parser'
import { generateDataSourceFetcher } from '../src/data-source-fetchers'

/**
 * How the SQL routes of the platform's listings order what a visitor's sort
 * leaves tied or empty: a post without a reading time comes after the others
 * whichever way the list is sorted ("longest read first" opened on them), and
 * equal rows keep one order across pages.
 *
 * Pinned on the route the project generator ships (`generateDataSourceFetcher`),
 * for both databases a blog can live in.
 */

const ROUTES = [
  ['teleport', { host: 'db', database: 'blog' }],
  ['postgresql', { connectionString: 'postgres://user:pw@host:5432/db' }],
] as const

const routeFor = (type: string, config: object, tableName: string): string =>
  generateDataSourceFetcher(
    { type, config } as unknown as Parameters<typeof generateDataSourceFetcher>[0],
    tableName
  )

const orderByLines = (route: string): string[] =>
  route.split('\n').filter((line) => line.includes('ORDER BY') && line.includes('Clauses.join'))

describe.each(ROUTES)('the %s route of the blog listing', (type, config) => {
  const route = routeFor(type, config, 'teleport_blog_posts')

  it('parses as valid JavaScript', () => {
    expect(() => parse(route, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('puts the rows without a value last, in both directions', () => {
    expect(route).toMatch(/\$\{orderOf\(sort\)\} NULLS LAST`/)
    expect(route).toMatch(/\$\{sortByDirection\} NULLS LAST`/)
  })

  it('falls back to a plain ORDER BY when the database rejects it', () => {
    expect(route).toMatch(/plainClauses = valid\.map\(\(sort\) => `[^`]*\$\{orderOf\(sort\)\}`\)/)
    expect(route).toContain('const usedRewrittenSort = orderBySql !== plainOrderBySql')
    expect(route).toContain('if (!usedRewrittenSort) throw sortError')
    expect(route).toContain('baseSql + plainOrderBySql + sqlTail')
  })

  it('breaks ties by id, in the ORDER BY and in its fallback', () => {
    const lines = orderByLines(route)
    expect(lines).toHaveLength(2)
    lines.forEach((line) => expect(line).toContain('"id" ASC'))
  })
})

describe('a table no listing sorts for visitors', () => {
  it('gets the empty-values-last order but no tiebreaker', () => {
    const route = routeFor('teleport', { host: 'db', database: 'store' }, 'teleport_orders')
    expect(route).toMatch(/\$\{orderOf\(sort\)\} NULLS LAST`/)
    orderByLines(route).forEach((line) => expect(line).not.toContain('"id" ASC'))
  })
})
