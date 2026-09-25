import { DataCache } from '@teleporthq/teleport-shared'
import { UIDLDataSource } from '@teleporthq/teleport-types'
import { generateRESTAPIFetcher } from '../src/fetchers/rest-api'
import { generateDataSourceFetcherWithCore } from '../src/data-source-fetchers'
import { resolveRESTAPICacheTTLSeconds } from '../src/fetchers/utils/rest-api-response-cache'

/**
 * The REST API data source's response cache, asserted on BEHAVIOUR: every test
 * runs the generated handler against a counting `fetch`, the same way the
 * published app runs it.
 */

type Handler = (req: Record<string, unknown>, res: Record<string, unknown>) => Promise<unknown>

interface Captured {
  status: number
  payload: Record<string, unknown>
  headers: Record<string, string>
}

const URL = 'https://api.test/items'
const cachedConfig = (ttlSeconds: number, extra: Record<string, unknown> = {}) => ({
  url: URL,
  method: 'GET',
  cache: { enabled: true, ttlSeconds },
  ...extra,
})

const upstreamResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : 'Service Unavailable',
  text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  json: () => Promise.resolve(body),
})

const loadHandler = (code: string, fetchImpl: jest.Mock): Handler => {
  const withoutImports = code.replace(/^import\s+.*?$/gm, '')
  const factory = new Function(
    'fetch',
    `${withoutImports.replace('export default async function handler', 'async function handler')}
    return handler`
  )
  return factory(fetchImpl)
}

/** A generated `utils/data-sources` module, with its ES exports turned into a return. */
const loadDataSourceModule = (code: string, fetchImpl: jest.Mock) => {
  const body = code.replace(/^import\s+.*?$/gm, '').replace(/^export\s+.*$/gm, '')
  const factory = new Function('fetch', `${body}\nreturn { fetchData, fetchCount }`)
  return factory(fetchImpl) as {
    fetchData: (params?: Record<string, unknown>) => Promise<unknown>
    fetchCount: (params?: Record<string, unknown>) => Promise<number>
  }
}

/**
 * Calls the handler like a Next API route does. `withSetHeader: false` is the
 * bare `{ status, json }` object fetchData, fetchCount and tqWithCache pass.
 */
const call = async (
  handler: Handler,
  req: Record<string, unknown> = {},
  withSetHeader = true
): Promise<Captured> => {
  const captured: Captured = { status: 200, payload: {}, headers: {} }
  const res: Record<string, unknown> = {
    status: (code: number) => {
      captured.status = code
      return res
    },
    json: (data: Record<string, unknown>) => {
      captured.payload = data
      return res
    },
  }
  if (withSetHeader) {
    res.setHeader = (name: string, value: string) => {
      captured.headers[name] = value
    }
  }
  await handler({ query: {}, method: 'GET', ...req }, res)
  return captured
}

const ROWS = [
  { id: 1, name: 'b' },
  { id: 2, name: 'c' },
  { id: 3, name: 'a' },
]

let now = 1_000_000

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__tqRestApiCache
  now = 1_000_000
  jest.spyOn(Date, 'now').mockImplementation(() => now)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
  delete (globalThis as Record<string, unknown>).__tqRestApiCache
})

describe('resolveRESTAPICacheTTLSeconds', () => {
  it('is off unless the cache is explicitly enabled', () => {
    expect(resolveRESTAPICacheTTLSeconds(undefined)).toBeUndefined()
    expect(resolveRESTAPICacheTTLSeconds({ enabled: false, ttlSeconds: 60 })).toBeUndefined()
    expect(resolveRESTAPICacheTTLSeconds({ ttlSeconds: 60 })).toBeUndefined()
  })

  it('uses the configured window in whole seconds', () => {
    expect(resolveRESTAPICacheTTLSeconds({ enabled: true, ttlSeconds: 90 })).toBe(90)
    expect(resolveRESTAPICacheTTLSeconds({ enabled: true, ttlSeconds: 90.9 })).toBe(90)
    expect(resolveRESTAPICacheTTLSeconds({ enabled: true, ttlSeconds: 0.2 })).toBe(1)
  })

  it('falls back to the shared default when the window is missing or unusable', () => {
    const fallback = DataCache.DEFAULT_CACHE_TTL_SECONDS
    expect(resolveRESTAPICacheTTLSeconds({ enabled: true })).toBe(fallback)
    expect(resolveRESTAPICacheTTLSeconds({ enabled: true, ttlSeconds: 0 })).toBe(fallback)
    expect(resolveRESTAPICacheTTLSeconds({ enabled: true, ttlSeconds: -5 })).toBe(fallback)
    expect(resolveRESTAPICacheTTLSeconds({ enabled: true, ttlSeconds: NaN })).toBe(fallback)
    expect(
      resolveRESTAPICacheTTLSeconds({ enabled: true, ttlSeconds: '60' as unknown as number })
    ).toBe(fallback)
  })

  it('never emits a window longer than a year', () => {
    expect(resolveRESTAPICacheTTLSeconds({ enabled: true, ttlSeconds: 10 ** 12 })).toBe(31_536_000)
  })
})

describe('generateRESTAPIFetcher — response cache', () => {
  /** The regression pin: a data source that does not cache generates what it always did. */
  it('emits byte-identical output when caching is absent or disabled', () => {
    const base = { url: URL, method: 'GET' }
    const uncached = generateRESTAPIFetcher(base)

    expect(generateRESTAPIFetcher({ ...base, cache: { enabled: false, ttlSeconds: 60 } })).toBe(
      uncached
    )
    expect(uncached).not.toContain('__tqRestApiCache')
    expect(uncached).toContain('const response = await fetch(url, options)')
    expect(uncached).toContain('let data = await response.json()')
  })

  it('emits the configured window in milliseconds', () => {
    const code = generateRESTAPIFetcher(cachedConfig(90))

    expect(code).toContain('const REST_API_CACHE_TTL_MS = 90000')
    expect(code).toContain('const response = await fetchRestApiWithCache(url, options)')
    expect(code).toContain('let data = JSON.parse(response.bodyText)')
  })

  it('calls the URL once and serves every later request in the window from memory', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(upstreamResponse(ROWS)))
    const handler = loadHandler(generateRESTAPIFetcher(cachedConfig(60)), fetchImpl)

    const first = await call(handler)
    now += 59_000
    const second = await call(handler, { query: { page: '1', perPage: '2' } })
    const third = await call(handler, { query: { query: 'a', queryColumns: '["name"]' } })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(first.payload).toMatchObject({ success: true, data: ROWS })
    expect(second.payload.data).toEqual(ROWS.slice(0, 2))
    expect(third.payload.data).toEqual([{ id: 3, name: 'a' }])
  })

  it('calls the URL again once the window has passed', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(upstreamResponse(ROWS))
      .mockResolvedValueOnce(upstreamResponse([{ id: 9, name: 'fresh' }]))
    const handler = loadHandler(generateRESTAPIFetcher(cachedConfig(60)), fetchImpl)

    await call(handler)
    now += 60_000
    const refreshed = await call(handler)
    now += 1_000
    const servedFromNewEntry = await call(handler)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(refreshed.payload.data).toEqual([{ id: 9, name: 'fresh' }])
    expect(servedFromNewEntry.payload.data).toEqual([{ id: 9, name: 'fresh' }])
  })

  /** A clock stepped back (NTP) must not make an entry look fresh for longer than its window. */
  it('calls the URL again when the clock has moved backwards', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(upstreamResponse(ROWS)))
    const handler = loadHandler(generateRESTAPIFetcher(cachedConfig(60)), fetchImpl)

    await call(handler)
    now -= 10_000
    await call(handler)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('shares one upstream call between concurrent requests', async () => {
    let resolveUpstream: (value: unknown) => void = () => undefined
    const fetchImpl = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveUpstream = resolve
        })
    )
    const handler = loadHandler(generateRESTAPIFetcher(cachedConfig(60)), fetchImpl)

    const pending = [call(handler), call(handler, { query: { page: '2', perPage: '1' } })]
    resolveUpstream(upstreamResponse(ROWS))
    const [all, pageTwo] = await Promise.all(pending)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(all.payload.data).toEqual(ROWS)
    expect(pageTwo.payload.data).toEqual([ROWS[1]])
  })

  it('stops waiting on an upstream call that has been pending for too long', async () => {
    const fetchImpl = jest
      .fn()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce(upstreamResponse(ROWS))
    const handler = loadHandler(generateRESTAPIFetcher(cachedConfig(60)), fetchImpl)

    // Never settles: stands in for a request stuck on a dead socket.
    void call(handler)
    now += 10_000
    const next = await call(handler)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(next.payload.data).toEqual(ROWS)
  })

  it('answers an upstream error as before and never caches it', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(upstreamResponse({ message: 'down' }, 503))
      .mockResolvedValueOnce(upstreamResponse(ROWS))
    const handler = loadHandler(generateRESTAPIFetcher(cachedConfig(60)), fetchImpl)

    const failed = await call(handler)
    const recovered = await call(handler)

    expect(failed.status).toBe(503)
    expect(failed.payload).toMatchObject({
      success: false,
      error: 'HTTP 503: Service Unavailable',
    })
    expect(failed.headers).toEqual({})
    expect(recovered.payload.data).toEqual(ROWS)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('never caches a network failure or a body that is not JSON', async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(upstreamResponse('<html>maintenance</html>'))
      .mockResolvedValueOnce(upstreamResponse(ROWS))
    const handler = loadHandler(generateRESTAPIFetcher(cachedConfig(60)), fetchImpl)

    const networkFailure = await call(handler)
    const notJson = await call(handler)
    const recovered = await call(handler)

    expect(networkFailure.status).toBe(500)
    expect(networkFailure.payload).toMatchObject({ success: false, error: 'socket hang up' })
    expect(notJson.status).toBe(500)
    expect(notJson.payload.success).toBe(false)
    expect(recovered.payload.data).toEqual(ROWS)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  /**
   * The handler sorts in place. Were the cached payload handed out by
   * reference, one visitor's sort would reorder every later visitor's rows.
   */
  it('gives every request its own copy of the cached payload', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(upstreamResponse(ROWS)))
    const handler = loadHandler(generateRESTAPIFetcher(cachedConfig(60)), fetchImpl)

    const sorted = await call(handler, { query: { sortBy: 'name', sortOrder: 'asc' } })
    const unsorted = await call(handler)

    expect((sorted.payload.data as typeof ROWS).map((row) => row.name)).toEqual(['a', 'b', 'c'])
    expect(unsorted.payload.data).toEqual(ROWS)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('keys entries by the request body, so different bodies never share a response', async () => {
    const fetchImpl = jest.fn((_url: string, options: { body?: string }) =>
      Promise.resolve(upstreamResponse([{ echo: options.body }]))
    )
    const handler = loadHandler(
      generateRESTAPIFetcher(cachedConfig(60, { method: 'POST', bodyType: 'json' })),
      fetchImpl
    )

    const first = await call(handler, { method: 'POST', body: { q: 'first' } })
    const second = await call(handler, { method: 'POST', body: { q: 'second' } })
    const firstAgain = await call(handler, { method: 'POST', body: { q: 'first' } })

    expect(first.payload.data).toEqual([{ echo: '{"q":"first"}' }])
    expect(second.payload.data).toEqual([{ echo: '{"q":"second"}' }])
    expect(firstAgain.payload.data).toEqual([{ echo: '{"q":"first"}' }])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('shares the store between every REST API data source module in the process', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(upstreamResponse(ROWS)))
    const productsRoute = loadHandler(generateRESTAPIFetcher(cachedConfig(60)), fetchImpl)
    const globalStateRoute = loadHandler(generateRESTAPIFetcher(cachedConfig(60)), fetchImpl)

    await call(productsRoute)
    const fromOtherModule = await call(globalStateRoute)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fromOtherModule.payload.data).toEqual(ROWS)
  })

  it("judges a shared entry by the reader's own window", async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(upstreamResponse(ROWS)))
    const shortWindow = loadHandler(generateRESTAPIFetcher(cachedConfig(60)), fetchImpl)
    const longWindow = loadHandler(generateRESTAPIFetcher(cachedConfig(3_600)), fetchImpl)

    await call(longWindow)
    now += 120_000
    await call(longWindow)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    await call(shortWindow)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('drops the least recently used entry once the store is full', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(upstreamResponse(ROWS)))
    const handler = loadHandler(
      generateRESTAPIFetcher(cachedConfig(3_600, { method: 'POST', bodyType: 'json' })),
      fetchImpl
    )
    const request = (index: number) => call(handler, { method: 'POST', body: { index } })

    await request(0)
    await request(1)
    // A hit makes entry 0 recent again, which leaves entry 1 the oldest.
    await request(0)
    for (let index = 2; index <= 100; index++) {
      await request(index)
    }
    expect(fetchImpl).toHaveBeenCalledTimes(101)

    await request(0)
    expect(fetchImpl).toHaveBeenCalledTimes(101)
    await request(1)
    expect(fetchImpl).toHaveBeenCalledTimes(102)
  })

  describe('Cache-Control', () => {
    it('lets the CDN keep a GET response for what is left of the window', async () => {
      const fetchImpl = jest.fn(() => Promise.resolve(upstreamResponse(ROWS)))
      const handler = loadHandler(generateRESTAPIFetcher(cachedConfig(60)), fetchImpl)

      const fresh = await call(handler)
      now += 45_500
      const aged = await call(handler)

      expect(fresh.headers['Cache-Control']).toBe('public, max-age=0, s-maxage=60')
      expect(aged.headers['Cache-Control']).toBe('public, max-age=0, s-maxage=14')
    })

    it('sends nothing for a request that is not a GET', async () => {
      const fetchImpl = jest.fn(() => Promise.resolve(upstreamResponse(ROWS)))
      const handler = loadHandler(
        generateRESTAPIFetcher(cachedConfig(60, { method: 'POST' })),
        fetchImpl
      )

      const response = await call(handler, { method: 'POST', body: { q: 1 } })

      expect(response.payload.success).toBe(true)
      expect(response.headers).toEqual({})
    })

    it('tolerates the bare response object server-side callers pass', async () => {
      const fetchImpl = jest.fn(() => Promise.resolve(upstreamResponse(ROWS)))
      const handler = loadHandler(generateRESTAPIFetcher(cachedConfig(60)), fetchImpl)

      const response = await call(handler, {}, false)

      expect(response.payload).toMatchObject({ success: true, data: ROWS })
    })

    it('is never sent by a data source that does not cache', async () => {
      const fetchImpl = jest.fn(() => Promise.resolve(upstreamResponse(ROWS)))
      const handler = loadHandler(generateRESTAPIFetcher({ url: URL, method: 'GET' }), fetchImpl)

      const response = await call(handler)

      expect(response.payload.data).toEqual(ROWS)
      expect(response.headers).toEqual({})
    })
  })
})

describe('generateDataSourceFetcherWithCore — cached REST API source', () => {
  const dataSource: UIDLDataSource = {
    id: 'ds_rest_0001',
    name: 'Catalog',
    type: 'rest-api',
    config: cachedConfig(60),
  }

  /**
   * A paginated page asks for its rows (getStaticProps -> fetchData) and its
   * total (fetchCount) — two handler runs that must cost one upstream call.
   */
  it('serves fetchData and fetchCount from one upstream call', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(upstreamResponse(ROWS)))
    const code = generateDataSourceFetcherWithCore(dataSource, 'data', false, {})
    const dataSourceModule = loadDataSourceModule(code, fetchImpl)

    const [rows, count] = await Promise.all([
      dataSourceModule.fetchData({ limit: '2' }),
      dataSourceModule.fetchCount({}),
    ])

    expect(rows).toEqual(ROWS.slice(0, 2))
    expect(count).toBe(3)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
