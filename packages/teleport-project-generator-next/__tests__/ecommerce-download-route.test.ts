import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'
import {
  DOWNLOAD_CLAIM_QUERY,
  DOWNLOAD_ENTITLEMENT_QUERY,
  DOWNLOAD_LINE_LOCK_QUERY,
  DOWNLOAD_ORDER_QUERY,
  DOWNLOAD_RESUME_QUERY,
  DOWNLOAD_ROUTE_ERRORS,
  generateDownloadApiRoute,
} from '../src/ecommerce/ecommerce-download-route-generator'

/**
 * The generated route is EXECUTED — its request handler is lifted out of the
 * emitted source and run against a fake database, a fake storage worker, a
 * fake session and a fake clock — rather than pattern-matched: it ships as a
 * string into a generated app, and every refusal it can give is a status the
 * order page explains to the buyer. The bytes it serves are streamed through
 * a fake response so the proxying is exercised, not assumed.
 */

const SETTINGS = {
  digitalProducts: { enabled: true, withdrawalExemption: false, revokeOnRefund: true },
} as unknown as UIDLEcommerceSettings

const KEEP_ON_REFUND = {
  digitalProducts: { enabled: true, withdrawalExemption: false, revokeOnRefund: false },
} as unknown as UIDLEcommerceSettings

const DATA_SOURCE = { type: 'teleport', config: { connectionString: 'postgres://x' } }

interface RouteApi {
  serveDownload: (req: unknown, res: unknown, ctx: unknown) => Promise<unknown>
  claimDownload: (pool: unknown, params: unknown[]) => Promise<boolean>
  rangeStart: (range: string) => number
  config: { api: { responseLimit: boolean } }
}

// The module minus its `pg` import and its exports, evaluated with a CommonJS
// `require` for `crypto`.
const loadRoute = (settings: UIDLEcommerceSettings): RouteApi => {
  const source = generateDownloadApiRoute(settings, DATA_SOURCE.type, DATA_SOURCE.config)
  const body = source
    .replace(/const \{ Pool \} = require\('pg'\)[\s\S]*?\}\)\n/, '')
    .replace('export default async function handler', 'async function handler')
    .replace('export const config', 'const config')
  return new Function(
    'require',
    `${body}\nreturn { serveDownload, claimDownload, rangeStart, config };`
  )(require) as RouteApi
}

interface FakeResponse {
  statusCode: number | null
  body: unknown
  headers: Record<string, string>
  chunks: string[]
  ended: boolean
  destroyed: boolean
}

const fakeResponse = () => {
  const state: FakeResponse = {
    statusCode: null,
    body: undefined,
    headers: {},
    chunks: [],
    ended: false,
    destroyed: false,
  }
  const listeners: Record<string, Array<() => void>> = {}
  const res = {
    headersSent: false,
    setHeader: (name: string, value: string) => {
      state.headers[name.toLowerCase()] = value
    },
    status: (code: number) => {
      state.statusCode = code
      return res
    },
    json: (payload: unknown) => {
      state.body = payload
      return res
    },
    write: (chunk: Buffer) => {
      res.headersSent = true
      state.chunks.push(chunk.toString('utf8'))
      return true
    },
    end: () => {
      state.ended = true
      return res
    },
    destroy: () => {
      state.destroyed = true
    },
    on: (event: string, listener: () => void) => {
      ;(listeners[event] = listeners[event] || []).push(listener)
    },
    once: (event: string, listener: () => void) => {
      ;(listeners[event] = listeners[event] || []).push(listener)
    },
  }
  return { res, state }
}

// A WHATWG-style body: the global fetch's ReadableStream, read chunk by chunk,
// or cancelled whole when its bytes will not be sent.
const webBody = (chunks: string[]) => {
  const pending = chunks.map((chunk) => Buffer.from(chunk, 'utf8'))
  let cancelled = false
  return {
    cancelled: () => cancelled,
    cancel: async () => {
      cancelled = true
    },
    getReader: () => ({
      read: async () =>
        pending.length > 0
          ? { done: false, value: pending.shift() }
          : { done: true, value: undefined },
      cancel: async () => {
        cancelled = true
      },
    }),
  }
}

const NOW = Date.parse('2026-09-23T10:00:00.000Z')
const ORDER_ID = '4d2f6a0e-8b1c-4f3a-9e7d-2c5b8a1f0d3e'
const FILE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const KEY = '7f1a3c2e-9b4d-4e8f-a1c2-3d4e5f607182'

const ORDER = {
  order_id: ORDER_ID,
  user_id: 'user-1',
  status: 'confirmed',
  payment_status: 'paid',
  download_key: KEY,
  account_order: true,
}

// A guest checkout: the link and the key are all it takes.
const GUEST_ORDER = { ...ORDER, user_id: 'anon-7', account_order: false }

const ROW = {
  order_id: ORDER_ID,
  payment_status: 'paid',
  status: 'confirmed',
  created_at: '2026-09-20T10:00:00.000Z',
  user_id: 'user-1',
  order_item_id: 'line-1',
  download_limit: '3',
  download_expiry_days: null as string | null,
  file_id: FILE_ID,
  file_name: 'Übung — presets "v2".zip',
  storage_file_id: 'storage-9',
  content_type: 'application/zip',
  downloads: '1',
}

interface Call {
  text: string
  params: unknown[]
}

interface Upstream {
  ok: boolean
  status: number
  headers: Record<string, string>
  body?: string[]
}

const partialAnswer = (contentRange: string, body: string[]): Upstream => ({
  ok: true,
  status: 206,
  headers: { 'content-type': 'application/zip', 'content-range': contentRange },
  body,
})

type Rows = Array<Record<string, unknown>>

// The store's tables as far as the route reads them. Every statement is
// recorded, and the claim counts against the downloads already made for the
// line, the way the conditional INSERT does: the row the route read is a
// snapshot, the counter is the table.
const fakeDatabase = (spec: {
  order?: Record<string, unknown> | null
  row?: Record<string, unknown> | null
  resumeFor?: (params: unknown[]) => boolean
  failClaim?: Error
}) => {
  const calls: Call[] = []
  const row = spec.row === undefined ? ROW : spec.row
  let downloads = row ? parseInt(String(row.downloads), 10) || 0 : 0
  let released = 0
  const query = async (text: string, params: unknown[] = []): Promise<{ rows: Rows }> => {
    calls.push({ text, params })
    if (text === DOWNLOAD_ORDER_QUERY) {
      return { rows: spec.order === null ? [] : [spec.order ?? ORDER] }
    }
    if (text === DOWNLOAD_ENTITLEMENT_QUERY) {
      return { rows: row ? [row] : [] }
    }
    if (text === DOWNLOAD_RESUME_QUERY) {
      return { rows: spec.resumeFor && spec.resumeFor(params) ? [{ resumed: 1 }] : [] }
    }
    if (text === DOWNLOAD_CLAIM_QUERY) {
      if (spec.failClaim) {
        throw spec.failClaim
      }
      const limit = Number(params[5])
      if (limit <= 0 || downloads < limit) {
        downloads++
        return { rows: [{ id: `download-${downloads}` }] }
      }
      return { rows: [] }
    }
    return { rows: [] }
  }
  const pool = {
    query,
    connect: async () => ({
      query,
      release: () => {
        released++
      },
    }),
  }
  return { calls, pool, counted: () => downloads, released: () => released }
}

type FakeDatabase = ReturnType<typeof fakeDatabase>

const run = async (params: {
  settings?: UIDLEcommerceSettings
  query?: Record<string, unknown>
  headers?: Record<string, string>
  order?: Record<string, unknown> | null
  row?: Record<string, unknown> | null
  resumeFor?: (params: unknown[]) => boolean
  db?: FakeDatabase
  session?: Record<string, unknown> | null
  env?: Record<string, string>
  upstream?: Upstream | 'throw'
  method?: string
}) => {
  const api = loadRoute(params.settings ?? SETTINGS)
  const db =
    params.db ?? fakeDatabase({ order: params.order, row: params.row, resumeFor: params.resumeFor })
  const fetches: Array<{ url: string; init: { headers: Record<string, string> } }> = []
  const { res, state } = fakeResponse()
  const upstreamSpec: Upstream | 'throw' =
    params.upstream ??
    ({
      ok: true,
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-length': '11',
        'accept-ranges': 'bytes',
        etag: '"never-forwarded"',
      },
      body: ['hello ', 'world'],
    } as Upstream)
  const body = upstreamSpec !== 'throw' && upstreamSpec.body ? webBody(upstreamSpec.body) : null
  await api.serveDownload(
    {
      method: params.method ?? 'GET',
      query: params.query ?? { fileId: FILE_ID, order: ORDER_ID, key: KEY },
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1', ...(params.headers ?? {}) },
      socket: { remoteAddress: '127.0.0.1' },
    },
    res,
    {
      env: {
        NEXTAUTH_SECRET: 'nextauth-secret',
        RUNTIME_STORAGE_URL: 'https://storage.example.com/',
        RUNTIME_STORAGE_API_KEY: 'key',
        RUNTIME_STORAGE_PROJECT_ID: 'project-1',
        ...(params.env ?? {}),
      },
      now: () => NOW,
      sessionToken: async () => (params.session === undefined ? { id: 'user-1' } : params.session),
      query: db.pool.query,
      claim: (claimParams: unknown[]) => api.claimDownload(db.pool, claimParams),
      fetch: async (url: string, init: { headers: Record<string, string> }) => {
        fetches.push({ url, init })
        if (upstreamSpec === 'throw') {
          throw new Error('upstream down')
        }
        return {
          ok: upstreamSpec.ok,
          status: upstreamSpec.status,
          headers: { get: (name: string) => upstreamSpec.headers[name.toLowerCase()] ?? null },
          body,
        }
      },
    }
  )
  return { state, calls: db.calls, fetches, body, db }
}

const claimCalls = (calls: Call[]) => calls.filter((call) => call.text === DOWNLOAD_CLAIM_QUERY)
const resumeCalls = (calls: Call[]) => calls.filter((call) => call.text === DOWNLOAD_RESUME_QUERY)

describe('the download route', () => {
  it('is emitted as an inert 503 for a store with no database', () => {
    const source = generateDownloadApiRoute(SETTINGS, null, null)
    expect(source).toContain('res.status(503)')
    expect(source).not.toContain('serveDownload')
  })

  it('lives at [fileId], streams without a response cap and never mints or verifies a token', () => {
    const source = generateDownloadApiRoute(SETTINGS, DATA_SOURCE.type, DATA_SOURCE.config)
    expect(source).toContain('export const config = { api: { responseLimit: false } }')
    expect(source).toContain('__tqResolveSessionToken')
    expect(source).not.toMatch(/createHmac|verifyDownloadToken|base64/)
    expect(loadRoute(SETTINGS).config).toEqual({ api: { responseLimit: false } })
  })

  it('serves the happy path: key, session, entitlement, claim, then the proxied bytes with their headers', async () => {
    const { state, calls, fetches, body, db } = await run({})
    expect(state.statusCode).toBe(200)
    expect(state.chunks.join('')).toBe('hello world')
    expect(state.ended).toBe(true)
    expect(body!.cancelled()).toBe(false)
    expect(state.headers['content-type']).toBe('application/zip')
    expect(state.headers['content-length']).toBe('11')
    expect(state.headers['accept-ranges']).toBe('bytes')
    expect(state.headers['cache-control']).toBe('no-store')
    expect(state.headers['x-robots-tag']).toBe('noindex')
    expect(state.headers['content-disposition']).toBe(
      `attachment; filename="_bung _ presets _v2_.zip"; filename*=UTF-8''${encodeURIComponent(
        ROW.file_name
      )}`
    )
    expect(state.headers.etag).toBeUndefined()
    expect(state.headers.location).toBeUndefined()
    // The limit check and the count are one transaction: the line locked,
    // then the conditional INSERT.
    expect(calls.map((call) => call.text)).toEqual([
      DOWNLOAD_ORDER_QUERY,
      DOWNLOAD_ENTITLEMENT_QUERY,
      'BEGIN',
      DOWNLOAD_LINE_LOCK_QUERY,
      DOWNLOAD_CLAIM_QUERY,
      'COMMIT',
    ])
    expect(calls[0].params).toEqual([ORDER_ID])
    expect(calls[1].params).toEqual([ORDER_ID, FILE_ID])
    expect(calls[3].params).toEqual(['line-1'])
    expect(calls[4].params).toEqual([ORDER_ID, 'line-1', FILE_ID, 'user-1', '203.0.113.9', 3])
    expect(db.counted()).toBe(2)
    expect(db.released()).toBe(1)
    // One request, to the worker's content endpoint with the project's key.
    expect(fetches).toHaveLength(1)
    expect(fetches[0].url).toBe(
      'https://storage.example.com/project/project-1/files/storage-9/content'
    )
    expect(fetches[0].init.headers).toEqual({ Authorization: 'Bearer key' })
  })

  it('refuses a malformed link before touching the database', async () => {
    const cases: Array<Record<string, unknown>> = [
      { fileId: FILE_ID, order: ORDER_ID },
      { fileId: FILE_ID, key: KEY },
      { order: ORDER_ID, key: KEY },
      { fileId: 'not-a-uuid', order: ORDER_ID, key: KEY },
      { fileId: FILE_ID, order: "1' OR 1=1", key: KEY },
      { fileId: FILE_ID, order: ORDER_ID, key: 'short' },
      { fileId: FILE_ID, order: ORDER_ID, key: `${KEY} ` + 'x'.repeat(200) },
    ]
    for (const query of cases) {
      const { state, calls } = await run({ query })
      expect(state.statusCode).toBe(400)
      expect(state.body).toEqual({ error: DOWNLOAD_ROUTE_ERRORS.MALFORMED })
      expect(calls).toHaveLength(0)
    }
    const method = await run({ method: 'POST' })
    expect(method.state.statusCode).toBe(405)
  })

  it('answers 404 for an unknown order and 403 for a wrong key, reading nothing further', async () => {
    const unknown = await run({ order: null })
    expect(unknown.state.statusCode).toBe(404)
    expect(unknown.calls).toHaveLength(1)

    for (const key of [
      KEY.replace('7f1a', '7f1b'),
      KEY.toUpperCase(),
      `${KEY}0`,
      KEY.slice(0, -1),
    ]) {
      const { state, calls, fetches } = await run({
        query: { fileId: FILE_ID, order: ORDER_ID, key },
      })
      expect(state.statusCode).toBe(403)
      expect(state.body).toEqual({ error: DOWNLOAD_ROUTE_ERRORS.INVALID })
      expect(calls).toHaveLength(1)
      expect(fetches).toHaveLength(0)
    }
    // An order whose table never gained the column has no key to match.
    const keyless = await run({ order: { ...ORDER, download_key: null } })
    expect(keyless.state.statusCode).toBe(403)
  })

  it('serves an account order only to its own session', async () => {
    const anonymous = await run({ session: null })
    expect(anonymous.state.statusCode).toBe(401)
    expect(anonymous.state.body).toEqual({ error: DOWNLOAD_ROUTE_ERRORS.SIGN_IN })
    expect(anonymous.calls).toHaveLength(1)

    const other = await run({ session: { id: 'user-2' } })
    expect(other.state.statusCode).toBe(403)
    expect(other.state.body).toEqual({ error: DOWNLOAD_ROUTE_ERRORS.OTHER_ACCOUNT })
    expect(other.calls).toHaveLength(1)

    // A token that carries only `sub` still names the user.
    const bySub = await run({ session: { sub: 'user-1' } })
    expect(bySub.state.statusCode).toBe(200)
  })

  it('serves a guest order on the key alone, whether user_id is empty or the anonymous id', async () => {
    const noUser = await run({
      order: { ...ORDER, user_id: null, account_order: false },
      row: { ...ROW, user_id: null },
      session: null,
    })
    expect(noUser.state.statusCode).toBe(200)
    expect(claimCalls(noUser.calls)[0].params).toEqual([
      ORDER_ID,
      'line-1',
      FILE_ID,
      null,
      '203.0.113.9',
      3,
    ])

    const anonymousId = await run({ order: GUEST_ORDER, session: null })
    expect(anonymousId.state.statusCode).toBe(200)
    expect(claimCalls(anonymousId.calls)[0].params[3]).toBe('anon-7')

    // The driver may hand the flag back as text.
    const textual = await run({ order: { ...ORDER, account_order: 'f' }, session: null })
    expect(textual.state.statusCode).toBe(200)
  })

  it('answers each entitlement failure with its own status and never counts it', async () => {
    const cases: Array<[Record<string, unknown> | null, number, string]> = [
      [null, 404, DOWNLOAD_ROUTE_ERRORS.NOT_FOUND],
      [{ ...ROW, payment_status: 'unpaid' }, 402, DOWNLOAD_ROUTE_ERRORS.UNPAID],
      [{ ...ROW, payment_status: 'refunded' }, 403, DOWNLOAD_ROUTE_ERRORS.REVOKED],
      [{ ...ROW, status: 'cancelled' }, 403, DOWNLOAD_ROUTE_ERRORS.REVOKED],
      [{ ...ROW, downloads: '3' }, 410, DOWNLOAD_ROUTE_ERRORS.LIMIT],
      [{ ...ROW, download_expiry_days: '2' }, 410, DOWNLOAD_ROUTE_ERRORS.WINDOW],
    ]
    for (const [row, status, error] of cases) {
      const { state, calls, fetches } = await run({ row })
      expect(state.statusCode).toBe(status)
      expect(state.body).toEqual({ error })
      expect(calls).toHaveLength(2)
      expect(fetches).toHaveLength(0)
    }
  })

  it('keeps a refunded order downloadable when the merchant chose to, and a partial refund always', async () => {
    const kept = await run({
      settings: KEEP_ON_REFUND,
      row: { ...ROW, payment_status: 'refunded' },
    })
    expect(kept.state.statusCode).toBe(200)
    const partial = await run({ row: { ...ROW, payment_status: 'partially_refunded' } })
    expect(partial.state.statusCode).toBe(200)
  })

  it('treats no limit and no expiry as unlimited, and a window still open as open', async () => {
    const open = await run({
      row: { ...ROW, download_limit: null, downloads: '999', download_expiry_days: '30' },
    })
    expect(open.state.statusCode).toBe(200)
    // Counted all the same, with no limit for the INSERT to hold it to.
    expect(claimCalls(open.calls)[0].params[5]).toBe(0)
  })

  it('cannot run without the storage worker, and never costs a download when it refuses or fails', async () => {
    const noStorage = await run({ env: { RUNTIME_STORAGE_URL: '' } })
    expect(noStorage.state.statusCode).toBe(503)
    expect(noStorage.calls).toHaveLength(2)

    const upstreamDown = await run({ upstream: 'throw' })
    expect(upstreamDown.state.statusCode).toBe(502)
    expect(upstreamDown.state.body).toEqual({ error: DOWNLOAD_ROUTE_ERRORS.STORAGE })
    expect(claimCalls(upstreamDown.calls)).toHaveLength(0)

    const upstreamRefused = await run({ upstream: { ok: false, status: 404, headers: {} } })
    expect(upstreamRefused.state.statusCode).toBe(502)
    expect(claimCalls(upstreamRefused.calls)).toHaveLength(0)
    expect(upstreamRefused.state.chunks).toEqual([])
  })

  it('lets only one of two requests racing for the last download through', async () => {
    // Both read the line at 2 of 3 and both pass the early check; the claim
    // is where one of them loses.
    const db = fakeDatabase({ row: { ...ROW, downloads: '2' } })
    const [first, second] = await Promise.all([run({ db }), run({ db })])
    expect([first.state.statusCode, second.state.statusCode].sort()).toEqual([200, 410])
    const loser = first.state.statusCode === 410 ? first : second
    expect(loser.state.body).toEqual({ error: DOWNLOAD_ROUTE_ERRORS.LIMIT })
    expect(loser.state.chunks).toEqual([])
    // The worker's answer to the loser is let go, not left hanging.
    expect(loser.body!.cancelled()).toBe(true)
    expect(db.counted()).toBe(3)
    expect(claimCalls(db.calls)).toHaveLength(2)
    expect(db.released()).toBe(2)
  })

  it('reads a Range as resuming only when it is one range past the first byte', () => {
    const { rangeStart } = loadRoute(SETTINGS)
    const cases: Array<[string, number]> = [
      ['', 0],
      ['bytes=0-', 0],
      ['bytes=0-1023', 0],
      ['bytes=00-', 0],
      ['bytes=500-', 500],
      ['bytes=500-999', 500],
      ['BYTES = 500-999', 500],
      ['bytes=1-', 1],
      // A worker may answer each of these with the file's start or all of it.
      ['bytes=-100000', 0],
      ['bytes=0-0,1-', 0],
      ['bytes=1-5,6-', 0],
      ['bytes=5-2', 0],
      ['items=500-', 0],
      ['bytes=abc-', 0],
    ]
    for (const [range, start] of cases) {
      expect([range, rangeStart(range)]).toEqual([range, start])
    }
  })

  it('counts a range that resumes nothing, so a shared link read in chunks still costs downloads', async () => {
    // Nothing counted for this address: `bytes=1-` is all but one byte of the file.
    const chunk = await run({
      order: GUEST_ORDER,
      session: null,
      headers: { range: 'bytes=1-' },
      upstream: partialAnswer('bytes 1-10/11', ['ello world']),
    })
    expect(chunk.state.statusCode).toBe(206)
    expect(resumeCalls(chunk.calls)[0].params).toEqual(['line-1', FILE_ID, '203.0.113.9'])
    expect(claimCalls(chunk.calls)).toHaveLength(1)

    // Once the limit is spent it is refused before the worker is asked.
    const spent = await run({
      order: GUEST_ORDER,
      session: null,
      row: { ...ROW, downloads: '3' },
      headers: { range: 'bytes=1-' },
    })
    expect(spent.state.statusCode).toBe(410)
    expect(spent.state.body).toEqual({ error: DOWNLOAD_ROUTE_ERRORS.LIMIT })
    expect(spent.fetches).toHaveLength(0)

    // A suffix, several ranges, a malformed or inverted header: each counts,
    // without asking whether it resumes anything.
    for (const range of ['bytes=-100000', 'bytes=0-0,1-', 'bytes=5-2', 'items=1-', 'bytes=00-']) {
      const other = await run({ order: GUEST_ORDER, session: null, headers: { range } })
      expect(other.state.statusCode).toBe(200)
      expect(resumeCalls(other.calls)).toHaveLength(0)
      expect(claimCalls(other.calls)).toHaveLength(1)
    }

    // A range from the first byte begins a download.
    const fromStart = await run({
      headers: { range: 'bytes=0-1023' },
      upstream: partialAnswer('bytes 0-1023/4096', ['head']),
    })
    expect(fromStart.state.statusCode).toBe(206)
    expect(resumeCalls(fromStart.calls)).toHaveLength(0)
    expect(claimCalls(fromStart.calls)).toHaveLength(1)
  })

  it('serves a resumed range uncounted, even past the limit, to the client that began the download', async () => {
    const sameAddress = (params: unknown[]) => params[2] === '203.0.113.9'
    const resumed = await run({
      order: GUEST_ORDER,
      session: null,
      row: { ...ROW, downloads: '3' },
      resumeFor: sameAddress,
      headers: { range: 'bytes=500-' },
      upstream: partialAnswer('bytes 500-505/506', ['tail!!']),
    })
    expect(resumed.state.statusCode).toBe(206)
    expect(resumed.state.headers['content-range']).toBe('bytes 500-505/506')
    expect(resumed.state.chunks.join('')).toBe('tail!!')
    expect(resumed.fetches[0].init.headers).toEqual({
      Authorization: 'Bearer key',
      Range: 'bytes=500-',
    })
    expect(claimCalls(resumed.calls)).toHaveLength(0)

    // Another address holding the same link resumes nothing: past the limit, refused.
    const elsewhere = await run({
      order: GUEST_ORDER,
      session: null,
      row: { ...ROW, downloads: '3' },
      resumeFor: sameAddress,
      headers: { range: 'bytes=500-', 'x-forwarded-for': '198.51.100.7' },
    })
    expect(elsewhere.state.statusCode).toBe(410)
    expect(elsewhere.fetches).toHaveLength(0)

    // An account order is bound to its session already: any address of it resumes.
    const account = await run({
      row: { ...ROW, downloads: '3' },
      resumeFor: (params) => params[2] === '',
      headers: { range: 'bytes=500-', 'x-forwarded-for': '198.51.100.7' },
      upstream: partialAnswer('bytes 500-505/506', ['tail!!']),
    })
    expect(account.state.statusCode).toBe(206)
    expect(claimCalls(account.calls)).toHaveLength(0)

    // A worker that ignored the range sent the whole file: that is a
    // download, and the spent limit refuses it before a byte is sent.
    const whole = await run({
      order: GUEST_ORDER,
      session: null,
      row: { ...ROW, downloads: '3' },
      resumeFor: sameAddress,
      headers: { range: 'bytes=500-' },
    })
    expect(whole.state.statusCode).toBe(410)
    expect(whole.state.chunks).toEqual([])
    expect(whole.body!.cancelled()).toBe(true)
    expect(claimCalls(whole.calls)).toHaveLength(1)
  })

  it('still refuses a resumed range once the order is no longer entitled', async () => {
    const cases: Array<[Record<string, unknown>, number, string]> = [
      [{ ...ROW, payment_status: 'refunded' }, 403, DOWNLOAD_ROUTE_ERRORS.REVOKED],
      [{ ...ROW, status: 'cancelled' }, 403, DOWNLOAD_ROUTE_ERRORS.REVOKED],
      [{ ...ROW, payment_status: 'unpaid' }, 402, DOWNLOAD_ROUTE_ERRORS.UNPAID],
      [{ ...ROW, download_expiry_days: '2' }, 410, DOWNLOAD_ROUTE_ERRORS.WINDOW],
    ]
    for (const [row, status, error] of cases) {
      const { state, fetches } = await run({
        row,
        resumeFor: () => true,
        headers: { range: 'bytes=500-' },
      })
      expect(state.statusCode).toBe(status)
      expect(state.body).toEqual({ error })
      expect(fetches).toHaveLength(0)
    }
  })

  it('rolls a failed claim back and answers a bare 500, never the database error', async () => {
    const db = fakeDatabase({
      failClaim: new Error('relation "teleport_downloads" does not exist'),
    })
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { state } = await run({ db })
    logged.mockRestore()
    expect(state.statusCode).toBe(500)
    expect(state.body).toEqual({ error: 'Internal server error' })
    const statements = db.calls.map((call) => call.text)
    expect(statements).toContain('ROLLBACK')
    expect(statements).not.toContain('COMMIT')
    expect(db.released()).toBe(1)
  })

  it('claims with the conditional INSERT alone on a driver without transactions', async () => {
    const { claimDownload } = loadRoute(SETTINGS)
    const calls: Call[] = []
    const pool = {
      query: async (text: string, params: unknown[]) => {
        calls.push({ text, params })
        return { rows: [] as Rows }
      },
    }
    expect(await claimDownload(pool, [ORDER_ID, 'line-1', FILE_ID, null, '', 3])).toBe(false)
    expect(calls.map((call) => call.text)).toEqual([DOWNLOAD_CLAIM_QUERY])
  })

  it('keeps the lock out of the counting statement, whose snapshot would predate it', () => {
    expect(DOWNLOAD_LINE_LOCK_QUERY).toMatch(/FOR UPDATE$/)
    expect(DOWNLOAD_CLAIM_QUERY).not.toMatch(/FOR UPDATE/)
    expect(DOWNLOAD_CLAIM_QUERY).toContain('< $6::int')
    expect(DOWNLOAD_CLAIM_QUERY).toMatch(/RETURNING id$/)
  })

  it('falls back to the row for the content type and to the socket for the address', async () => {
    const api = loadRoute(SETTINGS)
    const db = fakeDatabase({
      order: { ...ORDER, user_id: null as string | null, account_order: false },
      row: { ...ROW, user_id: null as string | null },
    })
    const { res, state } = fakeResponse()
    await api.serveDownload(
      {
        method: 'GET',
        query: { fileId: FILE_ID, order: ORDER_ID, key: KEY },
        headers: {},
        socket: { remoteAddress: '::1' },
      },
      res,
      {
        env: {
          RUNTIME_STORAGE_URL: 'https://s',
          RUNTIME_STORAGE_API_KEY: 'k',
          RUNTIME_STORAGE_PROJECT_ID: 'p',
        },
        now: () => NOW,
        sessionToken: async (): Promise<null> => null,
        query: db.pool.query,
        claim: (claimParams: unknown[]) => api.claimDownload(db.pool, claimParams),
        fetch: async () => ({
          ok: true,
          status: 200,
          headers: { get: (): null => null },
          body: webBody(['x']),
        }),
      }
    )
    expect(state.statusCode).toBe(200)
    expect(state.headers['content-type']).toBe('application/zip')
    expect(claimCalls(db.calls)[0].params).toEqual([ORDER_ID, 'line-1', FILE_ID, null, '::1', 3])
  })
})
