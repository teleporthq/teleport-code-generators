import { generateCacheClientRuntime } from '../../src/cache/client-runtime'
import { createFakeWindow, loadEmittedModule } from '../_helpers/emitted-module-harness'

const CODE = generateCacheClientRuntime()
const SCOPE = 'ds_1:teleport_products'

const load = (options: { failOnSet?: boolean; reload?: boolean } = {}) => {
  const fake = createFakeWindow({ failOnSet: options.failOnSet })
  const runtime = loadEmittedModule(CODE, {
    window: fake.window,
    document: fake.document,
    performance: { getEntriesByType: () => [{ type: options.reload ? 'reload' : 'navigate' }] },
  })
  runtime.tqMarkHydrated()
  return { runtime, fake }
}

describe('emitted client cache runtime', () => {
  it('derives a key that is stable under property order', () => {
    const { runtime } = load()
    const a = runtime.tqCacheKey({ page: 1, query: 'shoe', perPage: 20 })
    const b = runtime.tqCacheKey({ perPage: 20, query: 'shoe', page: 1 })
    expect(a).toBe(b)
  })

  it('distinguishes different filter/sort/search/page combinations', () => {
    const { runtime } = load()
    const base = { page: 1, perPage: 20, query: '', filters: '[]', sorts: '[]' }
    const keys = new Set([
      runtime.tqCacheKey(base),
      runtime.tqCacheKey({ ...base, page: 2 }),
      runtime.tqCacheKey({ ...base, query: 'shoe' }),
      runtime.tqCacheKey({ ...base, sorts: '[{"field":"price"}]' }),
      runtime.tqCacheKey({ ...base, filters: '[{"source":"category"}]' }),
    ])
    expect(keys.size).toBe(5)
  })

  /**
   * `DataProvider` runs `useEffect(() => setData(initialData), [initialData])`.
   * A fresh reference per read is an infinite render loop, so this is the single
   * most important property of the whole browser cache.
   */
  it('hands back the SAME reference every time', () => {
    const { runtime } = load()
    const rows = [{ id: 1 }]
    runtime.tqCacheSet(SCOPE, 'k', rows, 60, 1)

    const first = runtime.tqCacheGet(SCOPE, 'k')
    const second = runtime.tqCacheGet(SCOPE, 'k')
    expect(first).toBe(second)
    expect(first).toBe(rows)
  })

  it('keeps reference identity after a reparse from storage', () => {
    const fake = createFakeWindow()
    const write = loadEmittedModule(CODE, {
      window: fake.window,
      performance: { getEntriesByType: () => [{ type: 'navigate' }] },
    })
    write.tqMarkHydrated()
    write.tqCacheSet(SCOPE, 'k', [{ id: 1 }], 60, 1)

    // A fresh module instance, same tab: the value now comes off storage.
    const read = loadEmittedModule(CODE, {
      window: fake.window,
      performance: { getEntriesByType: () => [{ type: 'navigate' }] },
    })
    read.tqMarkHydrated()
    expect(read.tqCacheGet(SCOPE, 'k')).toBe(read.tqCacheGet(SCOPE, 'k'))
  })

  /**
   * The peek is evaluated during RENDER. Returning a value before the first
   * client effect would make the hydration render differ from the server render.
   */
  it('returns undefined until the hydration latch is flipped', () => {
    const fake = createFakeWindow()
    const runtime = loadEmittedModule(CODE, {
      window: fake.window,
      performance: { getEntriesByType: () => [{ type: 'navigate' }] },
    })
    runtime.tqCacheSet(SCOPE, 'k', [{ id: 1 }], 60, 1)

    expect(runtime.tqCacheGet(SCOPE, 'k')).toBeUndefined()
    runtime.tqMarkHydrated()
    expect(runtime.tqCacheGet(SCOPE, 'k')).toEqual([{ id: 1 }])
  })

  it('expires an entry once its TTL has passed', () => {
    const { runtime } = load()
    const now = Date.now()
    const spy = jest.spyOn(Date, 'now')
    spy.mockReturnValue(now)
    runtime.tqCacheSet(SCOPE, 'k', [{ id: 1 }], 60, 1)

    spy.mockReturnValue(now + 61_000)
    expect(runtime.tqCacheGet(SCOPE, 'k')).toBeUndefined()
    spy.mockRestore()
  })

  /**
   * A mid-mount expiry must not flip `initialData` back to undefined: the
   * provider would blank the list and NOT refetch, because `params` never
   * changed.
   */
  it('keeps a sticky entry alive past its TTL once it has been handed out', () => {
    const { runtime } = load()
    const now = Date.now()
    const spy = jest.spyOn(Date, 'now')
    spy.mockReturnValue(now)
    runtime.tqCacheSet(SCOPE, 'k', [{ id: 1 }], 60, 1)
    expect(runtime.tqCacheGet(SCOPE, 'k', { sticky: true })).toEqual([{ id: 1 }])

    spy.mockReturnValue(now + 61_000)
    expect(runtime.tqCacheGet(SCOPE, 'k', { sticky: true })).toEqual([{ id: 1 }])
    // A non-sticky read of the same entry still sees it as expired.
    expect(runtime.tqCacheGet(SCOPE, 'k')).toBeUndefined()
    spy.mockRestore()
  })

  it('drops the whole scope when the version moves', () => {
    const { runtime } = load()
    runtime.tqCacheSet(SCOPE, 'a', [1], 60, 1)
    runtime.tqCacheSet(SCOPE, 'b', [2], 60, 1)
    runtime.tqCacheSet('other:table', 'c', [3], 60, 1)

    runtime.tqCacheSetVersion(SCOPE, 2)

    expect(runtime.tqCacheGet(SCOPE, 'a')).toBeUndefined()
    expect(runtime.tqCacheGet(SCOPE, 'b')).toBeUndefined()
    expect(runtime.tqCacheGet('other:table', 'c')).toEqual([3])
  })

  it('purges everything when the page load was a reload', () => {
    const fake = createFakeWindow()
    const first = loadEmittedModule(CODE, {
      window: fake.window,
      performance: { getEntriesByType: () => [{ type: 'navigate' }] },
    })
    first.tqMarkHydrated()
    first.tqCacheSet(SCOPE, 'k', [{ id: 1 }], 600, 1)
    expect(fake.session.map.size).toBe(1)

    // Same tab, but this load is a refresh.
    const afterReload = loadEmittedModule(CODE, {
      window: fake.window,
      performance: { getEntriesByType: () => [{ type: 'reload' }] },
    })
    afterReload.tqMarkHydrated()

    expect(fake.session.map.size).toBe(0)
    expect(afterReload.tqCacheGet(SCOPE, 'k')).toBeUndefined()
  })

  it('survives a full storage quota by staying in memory', () => {
    const { runtime, fake } = load({ failOnSet: true })
    const rows = [{ id: 1 }]

    expect(() => runtime.tqCacheSet(SCOPE, 'k', rows, 60, 1)).not.toThrow()
    expect(fake.session.map.size).toBe(0)
    expect(runtime.tqCacheGet(SCOPE, 'k')).toBe(rows)
  })

  it('drops a corrupt storage entry instead of throwing', () => {
    const fake = createFakeWindow()
    fake.session.map.set('tqc:' + SCOPE + '|k', '{not json')
    const runtime = loadEmittedModule(CODE, {
      window: fake.window,
      performance: { getEntriesByType: () => [{ type: 'navigate' }] },
    })
    runtime.tqMarkHydrated()

    expect(runtime.tqCacheGet(SCOPE, 'k')).toBeUndefined()
    expect(fake.session.map.size).toBe(0)
  })

  it('never throws and never caches when there is no window at all (SSR)', () => {
    const runtime = loadEmittedModule(CODE, { window: undefined, performance: undefined })
    runtime.tqMarkHydrated()

    expect(() => runtime.tqCacheSet(SCOPE, 'k', [1], 60, 1)).not.toThrow()
    expect(runtime.tqCacheGet(SCOPE, 'k')).toBeUndefined()
  })

  it('evicts the least recently used entry past the cap', () => {
    const { runtime } = load()
    for (let i = 0; i < 70; i++) {
      runtime.tqCacheSet(SCOPE, 'k' + i, [i], 600, 1)
    }
    expect(runtime.tqCacheGet(SCOPE, 'k0')).toBeUndefined()
    expect(runtime.tqCacheGet(SCOPE, 'k69')).toEqual([69])
  })

  it('asks the version endpoint for every scope on the page in ONE request', async () => {
    const calls: string[] = []
    const fake = createFakeWindow()
    const runtime = loadEmittedModule(CODE, {
      window: fake.window,
      performance: { getEntriesByType: () => [{ type: 'navigate' }] },
      fetch: (url: string) => {
        calls.push(url)
        return Promise.resolve({ json: () => Promise.resolve({ versions: { [SCOPE]: 7 } }) })
      },
    })
    runtime.tqMarkHydrated()
    runtime.tqCacheSet(SCOPE, 'k', [1], 600, 1)

    runtime.tqCacheRevalidate([SCOPE, 'other:table'])
    await new Promise((resolve) => setImmediate(resolve))

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain(encodeURIComponent(SCOPE + ',other:table'))
    expect(runtime.tqCacheGet(SCOPE, 'k')).toBeUndefined()
  })

  it('fails open when the version endpoint is down', async () => {
    const fake = createFakeWindow()
    const runtime = loadEmittedModule(CODE, {
      window: fake.window,
      performance: { getEntriesByType: () => [{ type: 'navigate' }] },
      fetch: () => Promise.reject(new Error('offline')),
    })
    runtime.tqMarkHydrated()
    runtime.tqCacheSet(SCOPE, 'k', [1], 600, 1)

    runtime.tqCacheRevalidate([SCOPE])
    await new Promise((resolve) => setImmediate(resolve))

    expect(runtime.tqCacheGet(SCOPE, 'k')).toEqual([1])
  })
})

describe('sub-scope purges', () => {
  /**
   * The count endpoint caches under `<scope>:count`. A products write bumps the
   * PARENT scope, so a purge that only matched `<scope>|` would refresh the rows
   * and leave the total behind — the grid showing one more card than the pager
   * counts.
   */
  it('clears a :count sub-scope when the parent scope is purged', () => {
    const { runtime } = load()
    runtime.tqCacheSet(SCOPE, 'rows', [{ id: 1 }], 600, 1)
    runtime.tqCacheSet(`${SCOPE}:count`, 'total', { total: 1 }, 600, 1)

    runtime.tqCachePurge(SCOPE)

    expect(runtime.tqCacheGet(SCOPE, 'rows')).toBeUndefined()
    expect(runtime.tqCacheGet(`${SCOPE}:count`, 'total')).toBeUndefined()
  })

  it('never reaches a sibling table whose name merely starts the same', () => {
    const { runtime } = load()
    runtime.tqCacheSet(`${SCOPE}_archive`, 'rows', [{ id: 9 }], 600, 1)

    runtime.tqCachePurge(SCOPE)

    expect(runtime.tqCacheGet(`${SCOPE}_archive`, 'rows')).toEqual([{ id: 9 }])
  })
})

describe('revalidation when the visitor comes back to the tab', () => {
  const loadWithFetch = (versions: Record<string, number>) => {
    const calls: string[] = []
    const fake = createFakeWindow()
    const runtime = loadEmittedModule(CODE, {
      window: fake.window,
      document: fake.document,
      performance: { getEntriesByType: () => [{ type: 'navigate' }] },
      fetch: (url: string) => {
        calls.push(url)
        return Promise.resolve({ json: () => Promise.resolve({ versions }) })
      },
    })
    runtime.tqMarkHydrated()
    return { runtime, fake, calls }
  }

  /**
   * Without this, a visitor who leaves a listing open serves their own cached
   * rows and never talks to the server again, so they never learn about a write
   * until the entry's TTL runs out — the exact hole the shared version exists
   * to close.
   */
  it('re-asks for versions on visibilitychange and drops what moved', async () => {
    const { runtime, fake, calls } = loadWithFetch({ [SCOPE]: 9 })
    runtime.tqCacheSet(SCOPE, 'rows', [{ id: 1 }], 600, 1)
    runtime.tqCacheRevalidate([SCOPE])
    await new Promise((resolve) => setImmediate(resolve))
    expect(calls).toHaveLength(1)

    // Re-seed at the version the server just reported, then move it on.
    runtime.tqCacheSet(SCOPE, 'rows', [{ id: 1 }], 600, 9)
    expect(runtime.tqCacheGet(SCOPE, 'rows')).toEqual([{ id: 1 }])

    await new Promise((resolve) => setTimeout(resolve, 1100))
    calls.length = 0
    fake.documentListeners.visibilitychange.forEach((handler) => handler({}))
    await new Promise((resolve) => setImmediate(resolve))

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain(encodeURIComponent(SCOPE))
  })

  it('also revalidates on window focus', async () => {
    const { runtime, fake, calls } = loadWithFetch({ [SCOPE]: 9 })
    runtime.tqCacheRevalidate([SCOPE])
    await new Promise((resolve) => setImmediate(resolve))
    calls.length = 0

    await new Promise((resolve) => setTimeout(resolve, 1100))
    fake.listeners.focus.forEach((handler) => handler({}))
    await new Promise((resolve) => setImmediate(resolve))

    expect(calls).toHaveLength(1)
  })

  it('throttles a flurry of focus events into one request', async () => {
    const { runtime, fake, calls } = loadWithFetch({ [SCOPE]: 9 })
    runtime.tqCacheRevalidate([SCOPE])
    await new Promise((resolve) => setImmediate(resolve))
    calls.length = 0

    await new Promise((resolve) => setTimeout(resolve, 1100))
    fake.listeners.focus.forEach((handler) => handler({}))
    fake.listeners.focus.forEach((handler) => handler({}))
    fake.listeners.focus.forEach((handler) => handler({}))
    await new Promise((resolve) => setImmediate(resolve))

    expect(calls).toHaveLength(1)
  })

  it('does nothing when the page has no scopes to watch', async () => {
    const { fake, calls } = loadWithFetch({})
    await new Promise((resolve) => setTimeout(resolve, 1100))
    fake.listeners.focus.forEach((handler) => handler({}))
    await new Promise((resolve) => setImmediate(resolve))

    expect(calls).toHaveLength(0)
  })
})
