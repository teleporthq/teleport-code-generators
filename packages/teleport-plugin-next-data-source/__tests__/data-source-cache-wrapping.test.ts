import { UIDLDataSource } from '@teleporthq/teleport-types'
import { generateDataSourceFetcherWithCore } from '../src/data-source-fetchers'
import { mergeServerCacheOptions } from '../src/cache/config'

const dataSource: UIDLDataSource = {
  id: 'ds_1',
  name: 'Store',
  type: 'teleport',
  config: {},
}

const CACHE = { scope: 'ds_1:teleport_products', ttlSeconds: 60 }

describe('generateDataSourceFetcherWithCore — server cache wrapping', () => {
  /**
   * The regression pin. A project that never asked for caching must generate
   * byte-identical output, or this feature is a breaking change for everyone.
   */
  it('emits byte-identical output when no cache is configured', () => {
    const before = generateDataSourceFetcherWithCore(dataSource, 'teleport_products', false, {})
    const after = generateDataSourceFetcherWithCore(
      dataSource,
      'teleport_products',
      false,
      {},
      undefined
    )

    expect(after).toBe(before)
    expect(before).not.toContain('tq-cache')
    expect(before).toContain('export { fetchData, fetchCount, handler, getCount }')
  })

  it('wraps both the data handler and the count handler', () => {
    const code = generateDataSourceFetcherWithCore(
      dataSource,
      'teleport_products',
      false,
      {},
      CACHE
    )

    expect(code).toContain("import { tqWithCache } from '../tq-cache/server'")
    expect(code).toContain('const cachedHandler = tqWithCache(handler, __tqDataCache)')
    expect(code).toContain('const cachedGetCount = tqWithCache(getCount, __tqCountCache)')
    expect(code).toContain(
      'export { fetchData, fetchCount, cachedHandler as handler, cachedGetCount as getCount }'
    )
  })

  /**
   * `getStaticProps` reaches the database through `fetchData`, not through the
   * API route, so pointing it at the raw handler would leave the prefetch —
   * which is page 1 of every list — permanently uncached.
   */
  it('routes the getStaticProps prefetch through the cache too', () => {
    const code = generateDataSourceFetcherWithCore(
      dataSource,
      'teleport_products',
      false,
      {},
      CACHE
    )

    expect(code).toContain('await cachedHandler(req, res)')
    expect(code).toContain('await cachedGetCount(req, res)')
  })

  it('gives the count endpoint its own sub-scope but the same version', () => {
    const code = generateDataSourceFetcherWithCore(
      dataSource,
      'teleport_products',
      false,
      {},
      CACHE
    )

    expect(code).toContain('"scope":"ds_1:teleport_products"')
    expect(code).toContain('"scope":"ds_1:teleport_products:count"')
  })

  /** The inline API-route variant sits one directory deeper. */
  it('uses the right import depth for the inlined API-route variant', () => {
    const code = generateDataSourceFetcherWithCore(dataSource, 'teleport_products', true, {}, CACHE)

    expect(code).toContain("import { tqWithCache } from '../../tq-cache/server'")
    expect(code).toContain('export default cachedHandler')
  })

  it('keeps the response private unless a shared window was granted', () => {
    const withoutCdn = generateDataSourceFetcherWithCore(
      dataSource,
      'teleport_products',
      false,
      {},
      CACHE
    )
    expect(withoutCdn).toContain('"sMaxAge":0')

    const withCdn = generateDataSourceFetcherWithCore(
      dataSource,
      'teleport_products',
      false,
      {},
      {
        ...CACHE,
        sMaxAge: 30,
        staleWhileRevalidate: 300,
      }
    )
    expect(withCdn).toContain('"sMaxAge":30')
    expect(withCdn).toContain('"swr":300')
  })
})

describe('mergeServerCacheOptions', () => {
  it('returns nothing when no mapper wants a server cache', () => {
    expect(mergeServerCacheOptions([{ scope: 's', ttlSeconds: 0 }])).toBeUndefined()
  })

  /**
   * Two mappers can read the same table from different pages and land in the
   * same generated file. The one that asked for fresher data must win, or a
   * sibling silently makes its list staler than it was configured to be.
   */
  it('takes the SHORTEST requested TTL', () => {
    expect(
      mergeServerCacheOptions([
        { scope: 's', ttlSeconds: 600 },
        { scope: 's', ttlSeconds: 60 },
      ])
    ).toMatchObject({ ttlSeconds: 60 })
  })

  it('ignores disabled entries when picking the TTL', () => {
    expect(
      mergeServerCacheOptions([
        { scope: 's', ttlSeconds: 0 },
        { scope: 's', ttlSeconds: 120 },
      ])
    ).toMatchObject({ ttlSeconds: 120 })
  })

  it('takes the shortest shared-cache window', () => {
    expect(
      mergeServerCacheOptions([
        { scope: 's', ttlSeconds: 60, sMaxAge: 300 },
        { scope: 's', ttlSeconds: 60, sMaxAge: 30 },
      ])
    ).toMatchObject({ sMaxAge: 30 })
  })
})
