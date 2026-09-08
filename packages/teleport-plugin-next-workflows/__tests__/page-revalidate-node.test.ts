import { nodeRegistry } from '../src'

interface RevalidateResult {
  revalidated?: string[]
  warning?: string
  success?: boolean
  error?: unknown
}

interface FetchCall {
  url: string
  init: {
    method: string
    headers: Record<string, string>
    body: string
  }
}

const source = () => nodeRegistry['page-revalidate'].generateHandler()

/**
 * Runs the emitted handler the way the generated app does: as runtime source in
 * a scope that provides only `globalThis`, `window` and `fetch`. `process` is
 * reached through the injected `globalThis`, which is exactly how the handler
 * has to read it to survive the browser webpack.
 */
const runHandler = async (
  config: Record<string, unknown>,
  options: {
    secret?: string
    context?: Record<string, unknown>
    // tslint:disable-next-line:no-any
    respond?: (call: FetchCall) => any
    calls?: FetchCall[]
  } = {}
): Promise<RevalidateResult> => {
  const env = options.secret === undefined ? {} : { TQ_CACHE_SECRET: options.secret }
  const calls = options.calls || []

  // tslint:disable-next-line:no-any
  const fetchImpl = async (url: string, init: any) => {
    const call: FetchCall = { url, init }
    calls.push(call)
    if (!options.respond) {
      throw new Error('offline')
    }
    const payload = options.respond(call)
    return {
      ok: payload.ok !== false,
      json: async () => payload.body,
    }
  }

  // tslint:disable-next-line:function-constructor
  const factory = new Function(
    'globalThis',
    'window',
    'fetch',
    `${source()}; return page_revalidate;`
  )
  const fn = factory({ process: { env } }, undefined, fetchImpl)

  return fn(config, options.context || { __baseUrl: 'https://site.test' })
}

const expectNotFatal = (result: RevalidateResult) => {
  // Mirrors `isFatalNodeResult` in the emitted runtime: `success: false`, a
  // string `error`, or `error: true` HALTS the workflow.
  expect(result.success).toBeUndefined()
  expect(typeof result.error).not.toBe('string')
  expect(result.error).not.toBe(true)
}

describe('page-revalidate node', () => {
  it('is registered and runs on the server', () => {
    expect(nodeRegistry['page-revalidate']).toBeDefined()
    expect(nodeRegistry['page-revalidate'].nodeType).toBe('page-revalidate')
    // `res.revalidate` only exists inside a server route, and server-side puts
    // the rebuild in the same segment as the write it follows.
    expect(nodeRegistry['page-revalidate'].executionEnv).toBe('server')
  })

  /**
   * Handlers ship as runtime source and are re-bundled by webpack, which
   * rewrites `require(`.
   */
  it('never requires a module', () => {
    expect(source()).not.toMatch(/(?<![\w.])require\s*\(/)
  })

  describe('path resolution', () => {
    it('posts the configured paths to the revalidate route', async () => {
      const calls: FetchCall[] = []
      const result = await runHandler(
        { paths: ['/pages/welcome', '/pages/about'] },
        {
          secret: 'sekret',
          calls,
          respond: () => ({ body: { ok: true, revalidated: ['/pages/welcome'], failed: [] } }),
        }
      )

      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe('https://site.test/api/tq-revalidate')
      expect(calls[0].init.method).toBe('POST')
      expect(calls[0].init.headers['x-tq-cache-secret']).toBe('sekret')
      expect(JSON.parse(calls[0].init.body)).toEqual({
        paths: ['/pages/welcome', '/pages/about'],
      })
      expect(result.revalidated).toEqual(['/pages/welcome'])
      expect(result.warning).toBeUndefined()
    })

    /**
     * A path built from a database column routinely arrives as the bare slug,
     * and `res.revalidate` only accepts a site-root-relative path.
     */
    it('gives a bare slug a leading slash', async () => {
      const calls: FetchCall[] = []
      await runHandler(
        { paths: ['pages/welcome'] },
        { secret: 'sekret', calls, respond: () => ({ body: { ok: true } }) }
      )

      expect(JSON.parse(calls[0].init.body).paths).toEqual(['/pages/welcome'])
    })

    /**
     * An update revalidates the slug the row HAD and the slug it now has — and
     * when the slug did not change, those are the same string. Rebuilding it
     * twice would double the work for no effect.
     */
    it('drops blanks, unresolved refs and duplicates', async () => {
      const calls: FetchCall[] = []
      await runHandler(
        {
          paths: [
            '/pages/welcome',
            '  ',
            '/pages/welcome',
            null,
            { type: 'workflowContext', nodeId: 'n1', path: ['value'] },
            'pages/welcome',
          ],
        },
        { secret: 'sekret', calls, respond: () => ({ body: { ok: true } }) }
      )

      expect(JSON.parse(calls[0].init.body).paths).toEqual(['/pages/welcome'])
    })

    /*
     * A step that rebuilds several rows at once resolves ONE reference to an
     * array of slugs — a bulk delete cannot know at build time how many rows the
     * admin will select, so it cannot configure a path per row.
     */
    it('flattens an array of paths resolved from a single reference', async () => {
      const calls: FetchCall[] = []
      await runHandler(
        { paths: [['/pages/welcome', '/pages/pricing'], '/pages/about'] },
        { secret: 'sekret', calls, respond: () => ({ body: { ok: true } }) }
      )

      expect(JSON.parse(calls[0].init.body).paths).toEqual([
        '/pages/welcome',
        '/pages/pricing',
        '/pages/about',
      ])
    })

    it('accepts a single path configured as a bare string', async () => {
      const calls: FetchCall[] = []
      await runHandler(
        { paths: '/pages/welcome' },
        { secret: 'sekret', calls, respond: () => ({ body: { ok: true } }) }
      )

      expect(JSON.parse(calls[0].init.body).paths).toEqual(['/pages/welcome'])
    })

    it('forwards the internal request headers the deployment protection needs', async () => {
      const calls: FetchCall[] = []
      await runHandler(
        { paths: ['/pages/welcome'] },
        {
          secret: 'sekret',
          calls,
          context: {
            __baseUrl: 'https://site.test',
            __internalHeaders: { cookie: '_vercel_jwt=abc' },
          },
          respond: () => ({ body: { ok: true } }),
        }
      )

      expect(calls[0].init.headers.cookie).toBe('_vercel_jwt=abc')
    })
  })

  /**
   * THE regression this node is shaped around. The runtime treats
   * `success: false` / a string `error` as FATAL, so a page that could not be
   * rebuilt would halt the workflow AFTER the row was already written — no
   * success toast, no navigation, and an error for an action that worked. Every
   * failure mode below has to report a warning instead.
   */
  describe('never reports failure in a shape the runtime treats as fatal', () => {
    it('with no paths configured', async () => {
      const calls: FetchCall[] = []
      const result = await runHandler({}, { secret: 'sekret', calls })

      expect(result.revalidated).toEqual([])
      expect(result.warning).toContain('No page paths')
      expect(calls).toHaveLength(0)
      expectNotFatal(result)
    })

    it('with every configured path blank', async () => {
      const result = await runHandler({ paths: ['', '   '] }, { secret: 'sekret' })

      expect(result.revalidated).toEqual([])
      expectNotFatal(result)
    })

    it('with no secret configured', async () => {
      const calls: FetchCall[] = []
      const result = await runHandler({ paths: ['/pages/welcome'] }, { calls })

      expect(result.revalidated).toEqual([])
      expect(result.warning).toContain('TQ_CACHE_SECRET')
      // Nothing is sent without the credential the route requires.
      expect(calls).toHaveLength(0)
      expectNotFatal(result)
    })

    it('when the route answers with an error status', async () => {
      const result = await runHandler(
        { paths: ['/pages/welcome'] },
        { secret: 'sekret', respond: () => ({ ok: false, body: { error: 'Unauthorized' } }) }
      )

      expect(result.revalidated).toEqual([])
      expect(result.warning).toBe('Unauthorized')
      expectNotFatal(result)
    })

    it('when the route is unreachable', async () => {
      const result = await runHandler({ paths: ['/pages/welcome'] }, { secret: 'sekret' })

      expect(result.revalidated).toEqual([])
      expect(result.warning).toBe('offline')
      expectNotFatal(result)
    })

    /**
     * `res.revalidate` throws for a path that was never statically generated —
     * the normal case for a page whose row was just deleted. The paths that DID
     * rebuild are still reported.
     */
    it('when some paths could not be rebuilt', async () => {
      const result = await runHandler(
        { paths: ['/pages/welcome', '/pages/gone'] },
        {
          secret: 'sekret',
          respond: () => ({
            body: { ok: true, revalidated: ['/pages/welcome'], failed: ['/pages/gone'] },
          }),
        }
      )

      expect(result.revalidated).toEqual(['/pages/welcome'])
      expect(result.warning).toContain('/pages/gone')
      expectNotFatal(result)
    })
  })
})
