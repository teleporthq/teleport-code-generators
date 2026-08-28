import { generateCacheServerRuntime } from '../../src/cache/server-runtime'
import { loadEmittedModule } from '../_helpers/emitted-module-harness'

const CODE = generateCacheServerRuntime()
const SCOPE = 'ds_1:teleport_products'

interface VersionStoreStub {
  isEnabled(): boolean
  readVersions(): Promise<Record<string, number>>
  bumpVersions(scopes: string[]): Promise<Record<string, number>>
}

const load = (store?: Partial<VersionStoreStub>) => {
  const versionStore: VersionStoreStub = {
    isEnabled: () => false,
    readVersions: () => Promise.resolve({}),
    bumpVersions: () => Promise.resolve({}),
    ...store,
  }
  return loadEmittedModule(CODE, { requireStub: () => versionStore })
}

/** A Next-style response recorder. */
const makeRes = (options: { withHeaders?: boolean } = {}) => {
  const headers: Record<string, string> = {}
  const recorded: { code?: number; body?: unknown } = {}
  const res: Record<string, unknown> = {
    status: (code: number) => {
      recorded.code = code
      return res
    },
    json: (body: unknown) => {
      recorded.body = body
      return res
    },
  }
  if (options.withHeaders !== false) {
    res.setHeader = (key: string, value: string) => {
      headers[key] = value
    }
  }
  return { res, headers, recorded }
}

const okHandler = (rows: unknown[]) =>
  jest.fn(
    async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => unknown } }) =>
      res.status(200).json({ success: true, data: rows })
  )

describe('emitted server cache runtime', () => {
  it('serves the second identical request without calling the handler', async () => {
    const runtime = load()
    const handler = okHandler([{ id: 1 }])
    const wrapped = runtime.tqWithCache(handler, { scope: SCOPE, ttl: 60 })

    const first = makeRes()
    await wrapped({ method: 'GET', query: { page: '1' } }, first.res)
    const second = makeRes()
    await wrapped({ method: 'GET', query: { page: '1' } }, second.res)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(first.headers['X-TQ-Cache']).toBe('MISS')
    expect(second.headers['X-TQ-Cache']).toBe('HIT')
    expect(second.recorded.body).toMatchObject({ success: true, data: [{ id: 1 }] })
  })

  /**
   * The count endpoint keeps its own KEYSPACE but borrows the data scope's
   * VERSION row. Nothing ever bumps a ":count" row, so if the count versioned
   * itself it could never be invalidated by a write — a create would refresh the
   * grid while the pager kept insisting on the old total.
   */
  it('stamps the count response with the DATA scope version', async () => {
    const runtime = load({
      isEnabled: () => true,
      readVersions: () => Promise.resolve({ [SCOPE]: 7 }),
    })
    const counted = runtime.tqWithCache(okHandler([{ total: 24 }]), {
      scope: `${SCOPE}:count`,
      versionScope: SCOPE,
      ttl: 600,
    })

    // A cold instance answers before its first version read resolves.
    await counted({ method: 'GET', query: {} }, makeRes().res)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const after = makeRes()
    await counted({ method: 'GET', query: {} }, after.res)
    expect(after.headers['X-TQ-Version']).toBe('7')
    expect(after.recorded.body).toMatchObject({ version: 7 })
  })

  it('would see NO version without versionScope, since nothing bumps a :count row', async () => {
    const runtime = load({
      isEnabled: () => true,
      readVersions: () => Promise.resolve({ [SCOPE]: 7 }),
    })
    const counted = runtime.tqWithCache(okHandler([{ total: 24 }]), {
      scope: `${SCOPE}:count`,
      ttl: 600,
    })

    await counted({ method: 'GET', query: {} }, makeRes().res)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const after = makeRes()
    await counted({ method: 'GET', query: {} }, after.res)
    expect(after.headers['X-TQ-Version']).toBeUndefined()
  })

  it('purges a sub-scope when its parent scope is purged', async () => {
    const runtime = load()
    const dataHandler = okHandler([{ id: 1 }])
    const countHandler = okHandler([{ total: 1 }])
    const data = runtime.tqWithCache(dataHandler, { scope: SCOPE, ttl: 600 })
    const count = runtime.tqWithCache(countHandler, {
      scope: `${SCOPE}:count`,
      versionScope: SCOPE,
      ttl: 600,
    })

    await data({ method: 'GET', query: {} }, makeRes().res)
    await count({ method: 'GET', query: {} }, makeRes().res)
    expect(dataHandler).toHaveBeenCalledTimes(1)
    expect(countHandler).toHaveBeenCalledTimes(1)

    // One purge of the products scope must take the total with it.
    runtime.tqPurge(SCOPE)

    await data({ method: 'GET', query: {} }, makeRes().res)
    await count({ method: 'GET', query: {} }, makeRes().res)
    expect(dataHandler).toHaveBeenCalledTimes(2)
    expect(countHandler).toHaveBeenCalledTimes(2)
  })

  it('never lets a scope purge reach a sibling table with a longer name', async () => {
    const runtime = load()
    const sibling = okHandler([{ id: 9 }])
    const wrapped = runtime.tqWithCache(sibling, {
      scope: `${SCOPE}_archive`,
      ttl: 600,
    })

    await wrapped({ method: 'GET', query: {} }, makeRes().res)
    runtime.tqPurge(SCOPE)
    await wrapped({ method: 'GET', query: {} }, makeRes().res)

    expect(sibling).toHaveBeenCalledTimes(1)
  })

  it('treats a different query as a different entry', async () => {
    const runtime = load()
    const handler = okHandler([{ id: 1 }])
    const wrapped = runtime.tqWithCache(handler, { scope: SCOPE, ttl: 60 })

    await wrapped({ method: 'GET', query: { page: '1' } }, makeRes().res)
    await wrapped({ method: 'GET', query: { page: '2' } }, makeRes().res)

    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('keys on the query independently of property order', async () => {
    const runtime = load()
    const handler = okHandler([{ id: 1 }])
    const wrapped = runtime.tqWithCache(handler, { scope: SCOPE, ttl: 60 })

    await wrapped({ method: 'GET', query: { page: '1', q: 'shoe' } }, makeRes().res)
    await wrapped({ method: 'GET', query: { q: 'shoe', page: '1' } }, makeRes().res)

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('never caches a non-GET request', async () => {
    const runtime = load()
    const handler = okHandler([{ id: 1 }])
    const wrapped = runtime.tqWithCache(handler, { scope: SCOPE, ttl: 60 })

    await wrapped({ method: 'POST', query: {} }, makeRes().res)
    await wrapped({ method: 'POST', query: {} }, makeRes().res)

    expect(handler).toHaveBeenCalledTimes(2)
  })

  /**
   * A credentialed request is not a pure function of its URL, so it must never
   * read from or write to an entry that another visitor could be served.
   */
  it('bypasses the shared cache for a request carrying credentials', async () => {
    const runtime = load()
    const handler = okHandler([{ id: 1 }])
    const wrapped = runtime.tqWithCache(handler, { scope: SCOPE, ttl: 60 })

    await wrapped(
      { method: 'GET', query: { page: '1' }, headers: { authorization: 'Bearer x' } },
      makeRes().res
    )
    await wrapped(
      { method: 'GET', query: { page: '1' }, headers: { authorization: 'Bearer x' } },
      makeRes().res
    )

    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('never caches a failed response', async () => {
    const runtime = load()
    const handler = jest.fn(async (_req: unknown, res: ReturnType<typeof makeRes>['res']) =>
      // tslint:disable-next-line:no-any
      (res as any).status(500).json({ success: false, error: 'boom' })
    )
    const wrapped = runtime.tqWithCache(handler, { scope: SCOPE, ttl: 60 })

    const first = makeRes()
    await wrapped({ method: 'GET', query: {} }, first.res)
    await wrapped({ method: 'GET', query: {} }, makeRes().res)

    expect(handler).toHaveBeenCalledTimes(2)
    expect(first.recorded.code).toBe(500)
  })

  /**
   * `fetchData`/`fetchCount` call the handler with a hand-rolled `res` that
   * implements only `status` and `json`. A wrapper that assumed `setHeader`
   * would throw on the getStaticProps prefetch of every page.
   */
  it('survives a response object with no setHeader', async () => {
    const runtime = load()
    const wrapped = runtime.tqWithCache(okHandler([{ id: 1 }]), { scope: SCOPE, ttl: 60 })
    const bare = makeRes({ withHeaders: false })

    await expect(wrapped({ method: 'GET', query: {} }, bare.res)).resolves.not.toThrow()
    expect(bare.recorded.body).toMatchObject({ success: true })
  })

  it('does not let a browser or CDN cache a private response', async () => {
    const runtime = load()
    const wrapped = runtime.tqWithCache(okHandler([]), { scope: SCOPE, ttl: 60 })
    const res = makeRes()
    await wrapped({ method: 'GET', query: {} }, res.res)

    expect(res.headers['Cache-Control']).toBe('private, no-store')
  })

  it('emits a shared CDN directive only when one was granted', async () => {
    const runtime = load()
    const wrapped = runtime.tqWithCache(okHandler([]), {
      scope: SCOPE,
      ttl: 60,
      sMaxAge: 30,
      swr: 300,
    })
    const res = makeRes()
    await wrapped({ method: 'GET', query: {} }, res.res)

    expect(res.headers['Cache-Control']).toBe('public, s-maxage=30, stale-while-revalidate=300')
  })

  /**
   * The version read must never be awaited on the data path: a cold instance has
   * an empty cache and needs no version, so blocking would add a database
   * connect to the critical path to learn something that cannot change the
   * answer.
   */
  it('answers without waiting for the version lookup', async () => {
    let settle: (value: Record<string, number>) => void = () => undefined
    const pending = new Promise<Record<string, number>>((resolve) => {
      settle = resolve
    })
    const runtime = load({ isEnabled: () => true, readVersions: () => pending })
    const wrapped = runtime.tqWithCache(okHandler([{ id: 1 }]), { scope: SCOPE, ttl: 60 })

    const res = makeRes()
    await wrapped({ method: 'GET', query: {} }, res.res)

    expect(res.recorded.code).toBe(200)
    settle({})
  })

  it('drops its entries once the shared version moves', async () => {
    let version = 1
    const runtime = load({
      isEnabled: () => true,
      readVersions: () => Promise.resolve({ [SCOPE]: version }),
    })
    const handler = okHandler([{ id: 1 }])
    const wrapped = runtime.tqWithCache(handler, { scope: SCOPE, ttl: 600 })

    // Prime the memoised version, then fill the cache with it.
    await wrapped({ method: 'GET', query: {} }, makeRes().res)
    await new Promise((resolve) => setImmediate(resolve))
    await wrapped({ method: 'GET', query: {} }, makeRes().res)
    const callsBefore = handler.mock.calls.length

    version = 2
    const now = Date.now()
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 60_000)
    await wrapped({ method: 'GET', query: {} }, makeRes().res)
    await new Promise((resolve) => setImmediate(resolve))
    await wrapped({ method: 'GET', query: {} }, makeRes().res)
    spy.mockRestore()

    expect(handler.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  /**
   * A missing versions table must degrade to plain TTL caching, not break the
   * data request — and it must stop asking, or every request pays for a failed
   * database round trip.
   */
  it('stops asking for versions after the table turns out to be missing', async () => {
    const readVersions = jest.fn(() => {
      const error = new Error('relation does not exist') as Error & { code: string }
      error.code = '42P01'
      return Promise.reject(error)
    })
    const runtime = load({ isEnabled: () => true, readVersions })
    const wrapped = runtime.tqWithCache(okHandler([{ id: 1 }]), { scope: SCOPE, ttl: 60 })

    await wrapped({ method: 'GET', query: { page: '1' } }, makeRes().res)
    await new Promise((resolve) => setImmediate(resolve))

    const now = Date.now()
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 60_000)
    await wrapped({ method: 'GET', query: { page: '2' } }, makeRes().res)
    await new Promise((resolve) => setImmediate(resolve))
    spy.mockRestore()

    expect(readVersions).toHaveBeenCalledTimes(1)
  })

  it('bounds its memory with an LRU cap', async () => {
    const runtime = load()
    const handler = okHandler([{ id: 1 }])
    const wrapped = runtime.tqWithCache(handler, { scope: SCOPE, ttl: 600 })

    for (let i = 0; i < 210; i++) {
      await wrapped({ method: 'GET', query: { page: String(i) } }, makeRes().res)
    }
    const callsAfterFill = handler.mock.calls.length

    // The oldest entry has been evicted; the newest is still there.
    await wrapped({ method: 'GET', query: { page: '0' } }, makeRes().res)
    expect(handler.mock.calls.length).toBe(callsAfterFill + 1)

    await wrapped({ method: 'GET', query: { page: '209' } }, makeRes().res)
    expect(handler.mock.calls.length).toBe(callsAfterFill + 1)
  })

  it('purges a single scope without touching the others', async () => {
    const runtime = load()
    const productsHandler = okHandler([{ id: 1 }])
    const ordersHandler = okHandler([{ id: 2 }])
    const products = runtime.tqWithCache(productsHandler, { scope: SCOPE, ttl: 600 })
    const orders = runtime.tqWithCache(ordersHandler, { scope: 'ds_1:teleport_orders', ttl: 600 })

    await products({ method: 'GET', query: {} }, makeRes().res)
    await orders({ method: 'GET', query: {} }, makeRes().res)

    runtime.tqPurge(SCOPE)

    await products({ method: 'GET', query: {} }, makeRes().res)
    await orders({ method: 'GET', query: {} }, makeRes().res)

    expect(productsHandler).toHaveBeenCalledTimes(2)
    expect(ordersHandler).toHaveBeenCalledTimes(1)
  })
})
