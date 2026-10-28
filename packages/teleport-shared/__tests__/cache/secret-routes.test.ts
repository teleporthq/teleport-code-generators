import * as crypto from 'crypto'
import { generateCacheInvalidateRoute } from '../../src/cache/api-routes'
import { generateVersionStore } from '../../src/cache/version-store'
import { generatePageRevalidateRoute } from '../../src/page-revalidate/api-route'

// The two routes this app's own server code calls mid-workflow (bust the data
// cache, rebuild a page) take the shared TQ_CACHE_SECRET. An exported project
// ships the literal placeholder `teleporthq.secrets.TQ_CACHE_SECRET` until its
// owner fills it in — a value anyone can read in the code — so it, an unset
// and a blank secret all authorise nobody.

const PLACEHOLDER = 'teleporthq.secrets.TQ_CACHE_SECRET'
const SECRET = 'a-real-secret-the-platform-provisioned'

/** The route's ES module source, run as CommonJS with the given environment. */
const loadRoute = (source: string, env: Record<string, string | undefined>) => {
  const commonJs = source
    .replace(/^import crypto from 'crypto'$/m, "const crypto = require('crypto')")
    .replace(/^import \{([^}]+)\} from '([^']+)'$/m, "const {$1} = require('$2')")
    .replace('export default async function handler', 'module.exports = async function handler')
  const module = { exports: null as any }
  const requireShim = (id: string) => {
    if (id === 'crypto') {
      return crypto
    }
    if (id.endsWith('/utils/tq-cache/server')) {
      return { tqPurge: (): undefined => undefined, tqBumpVersions: async () => ({}) }
    }
    throw new Error('unexpected require: ' + id)
  }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'process', commonJs)(module, {}, requireShim, {
    env,
  })
  return async (headers: Record<string, string>) => {
    const reply = { status: 0 }
    const res: Record<string, unknown> = {
      status(code: number): unknown {
        reply.status = code
        return res
      },
      json: (): unknown => res,
      revalidate: async (): Promise<undefined> => undefined,
    }
    await module.exports({ method: 'POST', headers, body: { paths: ['/'], scopes: ['a'] } }, res)
    return reply.status
  }
}

describe.each([
  ['/api/tq-cache/invalidate', generateCacheInvalidateRoute()],
  ['/api/tq-revalidate', generatePageRevalidateRoute()],
])('%s', (_route, source) => {
  it('admits the caller holding the provisioned secret', async () => {
    const call = loadRoute(source, { TQ_CACHE_SECRET: SECRET })
    expect(await call({ 'x-tq-cache-secret': SECRET })).toBe(200)
    expect(await call({ 'x-tq-cache-secret': 'wrong' })).toBe(401)
    expect(await call({})).toBe(401)
  })

  it('trims the configured secret and the one presented the same way', async () => {
    const call = loadRoute(source, { TQ_CACHE_SECRET: `${SECRET}\n` })
    expect(await call({ 'x-tq-cache-secret': SECRET })).toBe(200)
    expect(await call({ 'x-tq-cache-secret': ` ${SECRET} ` })).toBe(200)
  })

  it('compares digests, so neither the secret nor its length leaks', () => {
    expect(source).toContain("crypto.createHash('sha256')")
    expect(source).not.toMatch(/\.length\s*(===|!==)/)
  })

  it.each([
    ['unset', undefined],
    ['blank', '   '],
    ['the unresolved placeholder', PLACEHOLDER],
  ])(
    'authorises nobody while the secret is %s — not even a caller who sends the same value',
    async (_label, value) => {
      const call = loadRoute(source, { TQ_CACHE_SECRET: value })
      expect(await call({ 'x-tq-cache-secret': value === undefined ? '' : value })).toBe(401)
      expect(await call({ 'x-tq-cache-secret': PLACEHOLDER })).toBe(401)
    }
  )
})

describe('the cache version store', () => {
  it('cuts every statement off after 10 s, for its own transaction only', async () => {
    const sql: string[] = []
    class Client {
      async connect(): Promise<void> {
        return undefined
      }
      async query(text: string) {
        sql.push(text)
        return { rows: [{ scope: 'a', version: 2 }] }
      }
      async end(): Promise<void> {
        return undefined
      }
    }
    const code = generateVersionStore({
      clientCode: 'function getClient() { return new Client(); }',
    })
    const module = { exports: null as any }
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'process', 'Client', code)(
      module,
      {},
      { env: { TELEPORT_DB_CONNECTION_STRING: 'postgresql://app@db.test/app' } },
      Client
    )
    expect(await module.exports.readVersions(['a'])).toEqual({ a: 2 })
    await module.exports.bumpVersions(['a'])
    expect(sql[0]).toBe("BEGIN; SET LOCAL statement_timeout = '10s'")
    expect(sql[1]).toContain('SELECT scope, version FROM teleport_cache_versions')
    expect(sql[2]).toBe('COMMIT')
    expect(sql[3]).toBe("BEGIN; SET LOCAL statement_timeout = '10s'")
    expect(sql[4]).toContain('INSERT INTO teleport_cache_versions')
    expect(sql[5]).toBe('COMMIT')
    // A session-wide SET would outlive the request on a pooled connection.
    expect(sql.some((text) => /^SET statement_timeout/i.test(text))).toBe(false)
  })
})
