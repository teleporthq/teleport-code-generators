import { nodeRegistry } from '../src'

const CACHE_NODES = ['cache-get', 'cache-set', 'cache-invalidate']

const emittedFor = (nodeType: string): string => {
  const generator = nodeRegistry[nodeType]
  let source = generator.generateHandler()
  if (typeof generator.generateServerHandler === 'function') {
    source += '\n' + generator.generateServerHandler()
  }
  return source
}

/**
 * Mirrors `isFatalNodeResult` in the emitted runtime: a node result carrying
 * `success: false`, a string `error`, or `error: true` HALTS the workflow.
 */
const runHandler = async (nodeType: string, config: Record<string, unknown>, context = {}) => {
  const source = nodeRegistry[nodeType].generateHandler()
  const entry = nodeType.replace(/-/g, '_')
  // tslint:disable-next-line:function-constructor
  const factory = new Function('globalThis', 'window', 'fetch', `${source}; return ${entry};`)
  const fn = factory({}, undefined, () => Promise.reject(new Error('offline')))
  return fn(config, context)
}

describe('cache workflow nodes', () => {
  it('registers all three', () => {
    for (const nodeType of CACHE_NODES) {
      expect(nodeRegistry[nodeType]).toBeDefined()
      expect(nodeRegistry[nodeType].nodeType).toBe(nodeType)
    }
  })

  /**
   * `cache-invalidate` bumps the SHARED version row, which needs the server-only
   * secret — and being server-side puts it in the same segment as the write it
   * follows, so a CRUD workflow pays no extra round trip for it.
   */
  it('runs the purge on the server and the read/write anywhere', () => {
    expect(nodeRegistry['cache-invalidate'].executionEnv).toBe('server')
    expect(nodeRegistry['cache-get'].executionEnv).toBe('universal')
    expect(nodeRegistry['cache-set'].executionEnv).toBe('universal')
  })

  /**
   * Handlers ship as runtime source and are re-bundled by webpack, which
   * rewrites `require(`. The browser must also never be handed the Postgres
   * driver by way of the server cache runtime.
   */
  it('never requires a module', () => {
    for (const nodeType of CACHE_NODES) {
      expect(emittedFor(nodeType)).not.toMatch(/(?<![\w.])require\s*\(/)
    }
  })

  /**
   * THE regression that would abort an admin's save. The runtime treats
   * `success: false` / a string `error` as FATAL, so a cache that could not be
   * cleared would halt the workflow AFTER the row was already written — no
   * success toast, no navigation, and an error for an action that worked.
   */
  describe('never reports failure in a shape the runtime treats as fatal', () => {
    it('cache-invalidate without a configured scope', async () => {
      const result = await runHandler('cache-invalidate', {})
      expect(result.cleared).toBe(false)
      expect(result.success).toBeUndefined()
      expect(typeof result.error).not.toBe('string')
      expect(result.error).not.toBe(true)
    })

    it('cache-invalidate with no secret configured', async () => {
      const result = await runHandler('cache-invalidate', { scope: 'ds:products' })
      expect(result.cleared).toBe(false)
      expect(result.warning).toContain('TQ_CACHE_SECRET')
      expect(result.success).toBeUndefined()
      expect(typeof result.error).not.toBe('string')
    })

    it('cache-set with no scope', async () => {
      const result = await runHandler('cache-set', { key: 'k', value: 1 })
      expect(result.stored).toBe(false)
      expect(result.success).toBeUndefined()
      expect(typeof result.error).not.toBe('string')
    })

    it('cache-get reports a miss without any failure marker', async () => {
      const result = await runHandler('cache-get', { scope: 'ds:products', key: 'missing' })
      expect(result.hit).toBe(false)
      expect(result.success).toBeUndefined()
      expect(typeof result.error).not.toBe('string')
    })
  })

  it('round-trips a value through the workflow cache', async () => {
    const shared = {}
    const set = new Function(
      'globalThis',
      'window',
      `${nodeRegistry['cache-set'].generateHandler()}; return cache_set;`
    )(shared, undefined)
    const get = new Function(
      'globalThis',
      'window',
      `${nodeRegistry['cache-get'].generateHandler()}; return cache_get;`
    )(shared, undefined)

    await set({ scope: 'rates', key: 'EUR', value: { rate: 1.1 }, ttlSeconds: 60 }, {})
    const hit = await get({ scope: 'rates', key: 'EUR' }, {})

    expect(hit.hit).toBe(true)
    expect(hit.value).toEqual({ rate: 1.1 })
  })

  it('reports a miss once the entry has expired', async () => {
    const shared = {}
    const set = new Function(
      'globalThis',
      'window',
      `${nodeRegistry['cache-set'].generateHandler()}; return cache_set;`
    )(shared, undefined)
    const get = new Function(
      'globalThis',
      'window',
      `${nodeRegistry['cache-get'].generateHandler()}; return cache_get;`
    )(shared, undefined)

    await set({ scope: 'rates', key: 'EUR', value: 1, ttlSeconds: 60 }, {})

    const now = Date.now()
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 61_000)
    const miss = await get({ scope: 'rates', key: 'EUR' }, {})
    spy.mockRestore()

    expect(miss.hit).toBe(false)
  })
})
