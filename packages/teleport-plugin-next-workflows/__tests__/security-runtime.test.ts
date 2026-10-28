import * as nodeCrypto from 'crypto'
import * as net from 'net'
import * as path from 'path'
import {
  RATE_LIMITS_TABLE,
  SECURITY_RUNTIME_FILE_KEY,
  TOO_MANY_REQUESTS_MESSAGE,
  ensureSecurityRuntimeModule,
  generateSecurityRuntimeCode,
  securityRuntimeSpecifier,
} from '../src/security-runtime'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { TableAccess } from '@teleporthq/teleport-shared'

/**
 * The shared security runtime (`utils/security-runtime.js`) is EXECUTED here.
 * Each `loadRuntime()` is one app instance — a fresh module, as every
 * serverless instance loads its own — and instances handed the same
 * `FakeDatabase` share one Postgres. The database answers exactly the
 * statements below and refuses any other, so they are the statements on the
 * wire; it applies the counter upsert in one step, as Postgres does for
 * writers of one row.
 */

const CREATE_SQL =
  'CREATE TABLE IF NOT EXISTS "teleport_rate_limits" (' +
  '"key" TEXT NOT NULL, "window_start" BIGINT NOT NULL, "count" INTEGER NOT NULL DEFAULT 0, ' +
  '"expires_at" BIGINT NOT NULL, PRIMARY KEY ("key", "window_start"))'
const INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS "teleport_rate_limits_expires_at_idx" ' +
  'ON "teleport_rate_limits" ("expires_at")'
const LOCK_SQL = 'SELECT pg_advisory_xact_lock(hashtext($1))'
const HIT_SQL =
  'INSERT INTO "teleport_rate_limits" AS r ("key", "window_start", "count", "expires_at") ' +
  'VALUES ($1, $2, 1, $3) ' +
  'ON CONFLICT ("key", "window_start") DO UPDATE SET "count" = r."count" + 1 RETURNING "count"'
const CLEANUP_SQL =
  'DELETE FROM "teleport_rate_limits" WHERE ctid IN (SELECT ctid FROM "teleport_rate_limits" ' +
  'WHERE "expires_at" < $1 LIMIT 5000)'

/** 2026-10-25 00:00:00 UTC: a multiple of every window used below. */
const MIDNIGHT = Date.UTC(2026, 9, 25)
const MIDNIGHT_SEC = MIDNIGHT / 1000

interface Query {
  sql: string
  values: unknown[]
}

interface Row {
  count: number
  expiresAt: number
}

class FakeDatabase {
  readonly rows = new Map<string, Row>()
  readonly queries: Query[] = []
  connects = 0
  destroyed = 0
  outage: Error | null = null
  /** `connect`: connect() never settles; `query`: no query settles; `cleanup`: the DELETE never settles. */
  hang: 'connect' | 'query' | 'cleanup' | null = null
  connectDelayMs = 0
  tableExists = false

  rowKey(key: unknown, windowStart: unknown): string {
    return `${key} @ ${windowStart}`
  }

  /** A row as an earlier request left it. */
  seed(key: string, windowStart: number, windowSeconds: number, count: number): string {
    const rowKey = this.rowKey(key, windowStart)
    this.rows.set(rowKey, { count, expiresAt: windowStart + windowSeconds })
    return rowKey
  }

  dropTable(): void {
    this.tableExists = false
    this.rows.clear()
  }

  answer(
    sql: string,
    values: unknown[]
  ): { rows: Array<Record<string, unknown>>; rowCount: number } {
    this.queries.push({ sql, values })
    const none = { rows: [] as Array<Record<string, unknown>>, rowCount: 0 }
    if (sql === 'BEGIN' || sql === 'COMMIT') {
      return none
    }
    if (sql === LOCK_SQL) {
      expect(values).toEqual([RATE_LIMITS_TABLE])
      return none
    }
    if (sql === CREATE_SQL) {
      this.tableExists = true
      return none
    }
    if (sql === INDEX_SQL) {
      expect(this.tableExists).toBe(true)
      return none
    }
    if (!this.tableExists) {
      throw Object.assign(new Error('relation "teleport_rate_limits" does not exist'), {
        code: '42P01',
      })
    }
    if (sql === HIT_SQL) {
      const rowKey = this.rowKey(values[0], values[1])
      const row = this.rows.get(rowKey) || { count: 0, expiresAt: Number(values[2]) }
      row.count += 1
      this.rows.set(rowKey, row)
      return { rows: [{ count: row.count }], rowCount: 1 }
    }
    if (sql === CLEANUP_SQL) {
      const now = Number(values[0])
      let deleted = 0
      for (const [rowKey, row] of Array.from(this.rows)) {
        if (deleted < 5000 && row.expiresAt < now) {
          this.rows.delete(rowKey)
          deleted++
        }
      }
      return { rows: [], rowCount: deleted }
    }
    throw new Error('unexpected SQL: ' + sql)
  }

  statements(sql: string): Query[] {
    return this.queries.filter((query) => query.sql === sql)
  }
}

const never = (): Promise<never> => new Promise<never>(() => undefined)

/** Lets every promise chain that is ready run (with real or fake timers). */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 50; i++) {
    await Promise.resolve()
  }
}

/** A `pg` module whose clients all talk to `db`. */
const pgDriverFor = (db: FakeDatabase): { Client: unknown } => {
  class Client {
    connection = {
      stream: {
        destroy: () => {
          db.destroyed++
        },
      },
    }
    on(): void {
      return undefined
    }
    async connect(): Promise<void> {
      db.connects++
      if (db.connectDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, db.connectDelayMs))
      }
      if (db.hang === 'connect') {
        return never()
      }
      if (db.outage) {
        throw db.outage
      }
    }
    async query(sql: string, values: unknown[] = []) {
      if (db.hang === 'query' || (db.hang === 'cleanup' && sql === CLEANUP_SQL)) {
        db.queries.push({ sql, values })
        return never()
      }
      return db.answer(sql, values)
    }
    end(): Promise<void> {
      // A database that hangs never acknowledges the close either.
      return db.hang ? never() : Promise.resolve()
    }
  }
  return { Client }
}

interface Clock {
  now: number
}

const DB_ENV = { TELEPORT_DB_CONNECTION_STRING: 'postgresql://app:secret@db.internal:5432/app' }

const loadRuntime = (
  options: {
    db?: FakeDatabase
    env?: Record<string, string>
    pgInstalled?: boolean
    clock?: Clock
  } = {}
) => {
  const env = options.env || (options.db ? DB_ENV : {})
  const log = { warn: jest.fn(), error: jest.fn(), log: jest.fn(), info: jest.fn() }
  const timingSafeEqual = jest.fn(nodeCrypto.timingSafeEqual)
  const cryptoShim = { ...nodeCrypto, timingSafeEqual }
  const requireShim = (id: string): unknown => {
    if (id === 'crypto') {
      return cryptoShim
    }
    if (id === 'net') {
      return net
    }
    if (id === 'pg') {
      if (!options.db || options.pgInstalled === false) {
        throw new Error("Cannot find module 'pg'")
      }
      return pgDriverFor(options.db)
    }
    throw new Error('unexpected require: ' + id)
  }
  const clock = options.clock
  const dateShim = clock ? { now: () => clock.now } : Date
  const module = { exports: {} as any }
  // eslint-disable-next-line no-new-func
  new Function(
    'module',
    'exports',
    'require',
    'process',
    'console',
    'Buffer',
    'Date',
    generateSecurityRuntimeCode()
  )(module, module.exports, requireShim, { env }, log, Buffer, dateShim)
  return { runtime: module.exports, log, timingSafeEqual }
}

const request = (headers: Record<string, string> = {}, remoteAddress?: string): any => ({
  headers,
  socket: remoteAddress ? { remoteAddress } : undefined,
})

const fakeResponse = (): any => {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    headersSent: false,
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value
    },
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(body: unknown) {
      res.body = body
      res.headersSent = true
      return res
    },
  }
  return res
}

describe('rateLimit — Postgres-backed', () => {
  it('counts across two instances that share one database', async () => {
    const db = new FakeDatabase()
    const clock = { now: MIDNIGHT + 5000 }
    const a = loadRuntime({ db, clock }).runtime
    const b = loadRuntime({ db, clock }).runtime
    const hit = (runtime: any) =>
      runtime.rateLimit({ key: 'signin|203.0.113.7|ava@example.com', limit: 3, windowSeconds: 60 })

    expect(await hit(a)).toEqual({ allowed: true, retryAfter: 0 })
    expect(await hit(b)).toEqual({ allowed: true, retryAfter: 0 })
    expect(await hit(a)).toEqual({ allowed: true, retryAfter: 0 })
    expect(await hit(b)).toEqual({ allowed: false, retryAfter: 55 })
    expect(await hit(a)).toEqual({ allowed: false, retryAfter: 55 })
    // Side by side, too: one counter, every request counted once.
    const burst = await Promise.all([hit(a), hit(b), hit(a), hit(b)])
    expect(burst.every((result: any) => result.allowed === false)).toBe(true)

    const hits = db.statements(HIT_SQL)
    expect(hits).toHaveLength(9)
    expect(new Set(hits.map((query) => query.values[0])).size).toBe(1)
    expect(hits[0].values[0]).toMatch(/^60:[0-9a-f]{64}$/)
    expect(hits[0].values.slice(1)).toEqual([MIDNIGHT_SEC, MIDNIGHT_SEC + 60])
    expect(Array.from(db.rows.values())).toEqual([{ count: 9, expiresAt: MIDNIGHT_SEC + 60 }])
    // The visitor's address and email never reach the table.
    const wire = JSON.stringify(db.queries)
    expect(wire).not.toContain('ava@example.com')
    expect(wire).not.toContain('203.0.113.7')
  })

  it('creates its table and index once per instance, under an advisory lock', async () => {
    const db = new FakeDatabase()
    const clock = { now: MIDNIGHT + 5000 }
    const { runtime } = loadRuntime({ db, clock })
    await runtime.rateLimit({ key: 'k', limit: 5, windowSeconds: 60 })
    await settle()
    await runtime.rateLimit({ key: 'k', limit: 5, windowSeconds: 60 })
    expect(db.queries.map((query) => query.sql)).toEqual([
      'BEGIN',
      LOCK_SQL,
      CREATE_SQL,
      INDEX_SQL,
      'COMMIT',
      HIT_SQL,
      CLEANUP_SQL,
      HIT_SQL,
    ])
    // A second instance creates them again (IF NOT EXISTS), under the same lock.
    await loadRuntime({ db, clock }).runtime.rateLimit({ key: 'k', limit: 5, windowSeconds: 60 })
    expect(db.statements(CREATE_SQL)).toHaveLength(2)
    expect(db.statements(INDEX_SQL)).toHaveLength(2)
    expect(db.statements(LOCK_SQL)).toHaveLength(2)
  })

  it('creates the table again, within the same request, when it went missing', async () => {
    const db = new FakeDatabase()
    const { runtime, log } = loadRuntime({ db, clock: { now: MIDNIGHT + 5000 } })
    await runtime.rateLimit({ key: 'k', limit: 5, windowSeconds: 60 })
    // Dropped, or the database restored from a backup taken before it existed.
    db.dropTable()
    expect(await runtime.rateLimit({ key: 'k', limit: 5, windowSeconds: 60 })).toEqual({
      allowed: true,
      retryAfter: 0,
    })
    expect(db.statements(CREATE_SQL)).toHaveLength(2)
    // Counted in the database, not in memory.
    expect(Array.from(db.rows.values()).map((row) => row.count)).toEqual([1])
    expect(log.error).not.toHaveBeenCalled()
  })

  it('keeps one counter per window length, so a minute and a day limit never share a row', async () => {
    const db = new FakeDatabase()
    const { runtime } = loadRuntime({ db, clock: { now: MIDNIGHT } })
    const perMinute = { key: 'segment|203.0.113.7', limit: 1, windowSeconds: 60 }
    const perDay = { key: 'segment|203.0.113.7', limit: 1, windowSeconds: 86400 }
    expect((await runtime.rateLimit(perMinute)).allowed).toBe(true)
    // At midnight both windows start at the same second.
    expect((await runtime.rateLimit(perDay)).allowed).toBe(true)
    expect((await runtime.rateLimit(perMinute)).allowed).toBe(false)
    expect((await runtime.rateLimit(perDay)).retryAfter).toBe(86400)
  })

  it('starts a new count in the next window and tells a refused caller how long to wait', async () => {
    const db = new FakeDatabase()
    const clock = { now: MIDNIGHT + 50_000 }
    const { runtime } = loadRuntime({ db, clock })
    const once = { key: 'k', limit: 1, windowSeconds: 60 }
    expect(await runtime.rateLimit(once)).toEqual({ allowed: true, retryAfter: 0 })
    expect(await runtime.rateLimit(once)).toEqual({ allowed: false, retryAfter: 10 })
    clock.now += 10_000
    expect(await runtime.rateLimit(once)).toEqual({ allowed: true, retryAfter: 0 })
  })

  it('deletes windows that are over in the background, in batches, at most once per instance a minute', async () => {
    const db = new FakeDatabase()
    const clock = { now: MIDNIGHT + 30_000 }
    const nowSec = MIDNIGHT_SEC + 30
    for (let i = 0; i < 16_000; i++) {
      db.seed('60:over-' + i, MIDNIGHT_SEC - 120, 60, 1)
    }
    const runningDay = db.seed('86400:running', MIDNIGHT_SEC - 3600, 86400, 9)
    const overRows = () => Array.from(db.rows.keys()).filter((key) => key.startsWith('60:over-'))
    const { runtime } = loadRuntime({ db, clock })

    await runtime.rateLimit({ key: 'k', limit: 5, windowSeconds: 60 })
    await settle()
    // Three batches of 5,000 a pass: 1,000 of the 16,000 wait for the next one.
    expect(db.statements(CLEANUP_SQL).map((query) => query.values)).toEqual([
      [nowSec],
      [nowSec],
      [nowSec],
    ])
    expect(overRows()).toHaveLength(1000)
    expect(db.rows.get(runningDay)!.count).toBe(9)

    clock.now += 59_000
    await runtime.rateLimit({ key: 'k', limit: 5, windowSeconds: 60 })
    await settle()
    expect(db.statements(CLEANUP_SQL)).toHaveLength(3)
    clock.now += 1_000
    await runtime.rateLimit({ key: 'k', limit: 5, windowSeconds: 60 })
    await settle()
    expect(db.statements(CLEANUP_SQL)).toHaveLength(4)
    expect(overRows()).toHaveLength(0)
    expect(db.rows.get(runningDay)!.count).toBe(9)
  })

  it('counts in memory through a database outage, logs it once, and probes one request at a time', async () => {
    const db = new FakeDatabase()
    const clock = { now: MIDNIGHT + 1000 }
    const { runtime, log } = loadRuntime({ db, clock })
    const hit = () => runtime.rateLimit({ key: 'k', limit: 2, windowSeconds: 60 })
    db.outage = Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:5432'), {
      code: 'ECONNREFUSED',
    })

    expect(await hit()).toEqual({ allowed: true, retryAfter: 0 })
    expect(await hit()).toEqual({ allowed: true, retryAfter: 0 })
    // Still limited: in this instance's memory, never opened.
    expect(await hit()).toEqual({ allowed: false, retryAfter: 59 })
    // The database is not asked again for 30 seconds.
    expect(db.connects).toBe(1)
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.error.mock.calls[0][0]).toContain('ECONNREFUSED')

    // After the back-off one request probes; the ones beside it count in memory.
    clock.now += 30_000
    await Promise.all([hit(), hit(), hit()])
    expect(db.connects).toBe(2)

    db.outage = null
    clock.now += 30_000
    expect(await hit()).toEqual({ allowed: true, retryAfter: 0 })
    expect(db.connects).toBe(3)
    expect(db.statements(HIT_SQL)).toHaveLength(1)
    // Healthy again: requests side by side all count in the database.
    await Promise.all([hit(), hit()])
    expect(db.statements(HIT_SQL)).toHaveLength(3)

    // A new outage is a new log line.
    db.outage = new Error('Connection terminated unexpectedly')
    clock.now += 1000
    await hit()
    expect(log.error).toHaveBeenCalledTimes(2)
  })
})

// The runner is Jest 26, whose modern timers fake the clock too; the installed
// @types/jest predates them.
const modernTimers = jest as unknown as { useFakeTimers(implementation: 'modern'): void }

describe('rateLimit — a database that does not answer', () => {
  beforeEach(() => {
    modernTimers.useFakeTimers('modern')
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  const track = (promise: Promise<unknown>) => {
    const state: { done: boolean; result: any } = { done: false, result: undefined }
    promise.then((result) => {
      state.done = true
      state.result = result
    })
    return state
  }

  it('gives up on a connect after 1 s, never waits for the close, and backs off without new connections', async () => {
    const db = new FakeDatabase()
    db.hang = 'connect'
    const { runtime, log } = loadRuntime({ db })
    const once = { key: 'k', limit: 1, windowSeconds: 3600 }

    const first = track(runtime.rateLimit(once))
    await settle()
    jest.advanceTimersByTime(999)
    await settle()
    expect(first.done).toBe(false)
    jest.advanceTimersByTime(1)
    await settle()
    // Counted in memory; the hung socket destroyed; its end() (which never
    // resolves here) not awaited.
    expect(first.result).toEqual({ allowed: true, retryAfter: 0 })
    expect(db.destroyed).toBe(1)
    expect(log.error).toHaveBeenCalledTimes(1)

    // Backing off: a burst answers at once, from memory, without a connection.
    const burst = [track(runtime.rateLimit(once)), track(runtime.rateLimit(once))]
    await settle()
    expect(burst.map((state) => state.result && state.result.allowed)).toEqual([false, false])
    expect(db.connects).toBe(1)

    // After the back-off a single probe goes out; a request beside it does not wait for it.
    jest.advanceTimersByTime(30_000)
    const probe = track(runtime.rateLimit(once))
    const beside = track(runtime.rateLimit(once))
    await settle()
    expect(beside.done).toBe(true)
    expect(probe.done).toBe(false)
    expect(db.connects).toBe(2)
    jest.advanceTimersByTime(1000)
    await settle()
    expect(probe.done).toBe(true)
  })

  it('holds a request at most 1.5 s on the database in all', async () => {
    const db = new FakeDatabase()
    db.connectDelayMs = 900
    db.hang = 'query'
    const { runtime } = loadRuntime({ db })
    const call = track(runtime.rateLimit({ key: 'k', limit: 5, windowSeconds: 60 }))
    await settle()
    jest.advanceTimersByTime(900)
    await settle()
    expect(call.done).toBe(false)
    // The connect took 900 ms: the hung query gets the 600 ms left, not a full second.
    jest.advanceTimersByTime(599)
    await settle()
    expect(call.done).toBe(false)
    jest.advanceTimersByTime(1)
    await settle()
    expect(call.result).toEqual({ allowed: true, retryAfter: 0 })
    expect(db.destroyed).toBe(1)
  })

  it('never makes a request wait for the cleanup, and cuts off a cleanup that hangs', async () => {
    const db = new FakeDatabase()
    db.hang = 'cleanup'
    const { runtime } = loadRuntime({ db })
    const call = track(runtime.rateLimit({ key: 'k', limit: 5, windowSeconds: 60 }))
    await settle()
    expect(call.result).toEqual({ allowed: true, retryAfter: 0 })
    expect(db.statements(CLEANUP_SQL)).toHaveLength(1)
    expect(db.destroyed).toBe(0)
    jest.advanceTimersByTime(5000)
    await settle()
    expect(db.destroyed).toBe(1)
  })
})

describe('rateLimit — no database', () => {
  it('counts in a per-instance memory map and says so once', async () => {
    const clock = { now: MIDNIGHT + 1000 }
    const { runtime, log } = loadRuntime({ clock })
    const hit = (target: any) => target.rateLimit({ key: 'k', limit: 2, windowSeconds: 60 })
    expect((await hit(runtime)).allowed).toBe(true)
    expect((await hit(runtime)).allowed).toBe(true)
    expect(await hit(runtime)).toEqual({ allowed: false, retryAfter: 59 })
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0][0]).toContain('per server instance')
    // The documented limit of the fallback: another instance counts on its own.
    expect((await hit(loadRuntime({ clock }).runtime)).allowed).toBe(true)
  })

  it('uses memory when the database is configured but the pg driver is not installed', async () => {
    const db = new FakeDatabase()
    const { runtime } = loadRuntime({ db, pgInstalled: false, clock: { now: MIDNIGHT } })
    await runtime.rateLimit({ key: 'k', limit: 1, windowSeconds: 60 })
    expect((await runtime.rateLimit({ key: 'k', limit: 1, windowSeconds: 60 })).allowed).toBe(false)
    expect(db.queries).toHaveLength(0)
  })

  it('holds at most 10,000 windows, dropping the oldest first', async () => {
    const { runtime } = loadRuntime({ clock: { now: MIDNIGHT } })
    const once = (key: string) => runtime.rateLimit({ key, limit: 1, windowSeconds: 3600 })
    expect((await once('first')).allowed).toBe(true)
    expect((await once('first')).allowed).toBe(false)
    for (let i = 0; i < 10000; i++) {
      await once('other-' + i)
    }
    expect((await once('first')).allowed).toBe(true)
    expect((await once('other-9999')).allowed).toBe(false)
  })

  it('refuses to run with a key, limit or window it cannot count', async () => {
    const { runtime } = loadRuntime()
    for (const options of [
      { key: '', limit: 1, windowSeconds: 60 },
      { key: 'k', limit: 0, windowSeconds: 60 },
      { key: 'k', limit: 1, windowSeconds: 0 },
      { key: 'k', limit: undefined, windowSeconds: 60 },
      { key: 'k', limit: 1, windowSeconds: Number.NaN },
      undefined,
    ]) {
      await expect(runtime.rateLimit(options)).rejects.toThrow(TypeError)
    }
  })
})

describe('clientIp', () => {
  const { runtime } = loadRuntime()
  const onVercel = loadRuntime({ env: { VERCEL: '1' } }).runtime

  it('on Vercel reads the address the edge set, never a hop the visitor wrote', () => {
    expect(
      onVercel.clientIp(
        request(
          {
            'x-vercel-forwarded-for': '203.0.113.7',
            'x-real-ip': '198.51.100.1',
            'x-forwarded-for': '6.6.6.6, 198.51.100.1',
          },
          '10.1.2.3'
        )
      )
    ).toBe('203.0.113.7')
    expect(
      onVercel.clientIp(request({ 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '6.6.6.6' }))
    ).toBe('198.51.100.1')
    // An edge that appended to a visitor's list wrote the last entry.
    expect(onVercel.clientIp(request({ 'x-vercel-forwarded-for': '6.6.6.6, 203.0.113.7' }))).toBe(
      '203.0.113.7'
    )
  })

  it('elsewhere trusts X-Forwarded-For only from a proxy on a private address, and only its last hop', () => {
    const spoofed = {
      'x-forwarded-for': '6.6.6.6',
      'x-real-ip': '6.6.6.6',
      'x-vercel-forwarded-for': '6.6.6.6',
    }
    // A visitor connecting directly: its own socket address, whatever it wrote.
    expect(runtime.clientIp(request(spoofed, '203.0.113.7'))).toBe('203.0.113.7')
    // Behind a proxy: the hop the proxy appended, not the one the visitor wrote.
    expect(
      runtime.clientIp(request({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }, '10.0.0.5'))
    ).toBe('203.0.113.7')
    expect(
      runtime.clientIp(request({ 'x-forwarded-for': '6.6.6.6,203.0.113.7' }, '::ffff:127.0.0.1'))
    ).toBe('203.0.113.7')
    expect(
      runtime.clientIp(request({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }, 'fd12::5'))
    ).toBe('203.0.113.7')
    // A last hop that is not an address: the proxy's own address, never an earlier hop.
    expect(
      runtime.clientIp(request({ 'x-forwarded-for': '203.0.113.7, not-an-ip' }, '10.0.0.5'))
    ).toBe('10.0.0.5')
    // `fc::1` is 00fc::1, a public address, not a proxy on a private network.
    expect(runtime.clientIp(request({ 'x-forwarded-for': '6.6.6.6' }, 'fc::1'))).toBe('fc::1')
    expect(runtime.clientIp(request({ 'x-forwarded-for': '6.6.6.6' }))).toBe('unknown')
    expect(runtime.clientIp(undefined)).toBe('unknown')
  })

  it('with TQ_TRUSTED_PROXY=none reads the socket address only, even from a private peer or on Vercel', () => {
    // Docker port publishing, a NodePort, any SNAT: every visitor arrives from a
    // private address with no proxy in front, and writes its own X-Forwarded-For.
    const direct = request(
      { 'x-forwarded-for': '6.6.6.6', 'x-vercel-forwarded-for': '6.6.6.6', 'x-real-ip': '6.6.6.6' },
      '172.17.0.1'
    )
    expect(runtime.clientIp(direct)).toBe('6.6.6.6')
    const none = loadRuntime({ env: { TQ_TRUSTED_PROXY: 'none', VERCEL: '1' } }).runtime
    expect(none.clientIp(direct)).toBe('172.17.0.1')
  })

  it('with TQ_TRUSTED_PROXY=vercel reads the Vercel edge headers only', () => {
    const vercel = loadRuntime({ env: { TQ_TRUSTED_PROXY: 'vercel' } }).runtime
    expect(vercel.clientIp(request({ 'x-vercel-forwarded-for': '203.0.113.7' }, '10.0.0.5'))).toBe(
      '203.0.113.7'
    )
    expect(vercel.clientIp(request({ 'x-forwarded-for': '6.6.6.6' }, '10.0.0.5'))).toBe('10.0.0.5')
  })

  it('keeps the default for an unknown TQ_TRUSTED_PROXY and says so once', () => {
    const odd = loadRuntime({ env: { TQ_TRUSTED_PROXY: 'cloudflare' } })
    const behindProxy = request({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }, '10.0.0.5')
    expect(odd.runtime.clientIp(behindProxy)).toBe('203.0.113.7')
    expect(odd.runtime.clientIp(behindProxy)).toBe('203.0.113.7')
    expect(odd.log.warn).toHaveBeenCalledTimes(1)
    expect(odd.log.warn.mock.calls[0][0]).toContain('TQ_TRUSTED_PROXY')
  })

  it('normalizes the forms an address arrives in', () => {
    expect(runtime.clientIp(request({}, '::ffff:203.0.113.9'))).toBe('203.0.113.9')
    expect(runtime.clientIp(request({}, '::ffff:cb00:7109'))).toBe('203.0.113.9')
    expect(runtime.clientIp(request({ 'x-forwarded-for': '203.0.113.7' }, '::ffff:a00:5'))).toBe(
      '203.0.113.7'
    )
    expect(runtime.clientIp(request({ 'x-forwarded-for': '[2001:DB8::1]:443' }, '10.0.0.5'))).toBe(
      '2001:db8::1'
    )
    expect(
      runtime.clientIp(request({ 'x-forwarded-for': '203.0.113.9:5555' }, '192.168.1.1'))
    ).toBe('203.0.113.9')
  })
})

describe('rateLimitRequest', () => {
  const opts = { scope: 'auth-signup', limit: 2, windowSeconds: 3600 }

  it('answers 429 with Retry-After and the public message, keyed by scope, client and parts', async () => {
    const db = new FakeDatabase()
    const { runtime } = loadRuntime({
      db,
      env: { ...DB_ENV, VERCEL: '1' },
      clock: { now: MIDNIGHT + 20_000 },
    })
    const from = (ip: string) => request({ 'x-vercel-forwarded-for': ip })

    const first = fakeResponse()
    expect(await runtime.rateLimitRequest(from('203.0.113.7'), first, opts)).toBe(true)
    expect(first.body).toBeUndefined()
    expect(await runtime.rateLimitRequest(from('203.0.113.7'), fakeResponse(), opts)).toBe(true)
    const refused = fakeResponse()
    expect(await runtime.rateLimitRequest(from('203.0.113.7'), refused, opts)).toBe(false)
    expect(refused.statusCode).toBe(429)
    expect(refused.body).toEqual({ error: 'Too many requests. Try again later.' })
    expect(TOO_MANY_REQUESTS_MESSAGE).toBe('Too many requests. Try again later.')
    expect(refused.headers['retry-after']).toBe('3580')

    // Another visitor, another route, another account: each its own counter.
    expect(await runtime.rateLimitRequest(from('198.51.100.4'), fakeResponse(), opts)).toBe(true)
    expect(
      await runtime.rateLimitRequest(from('203.0.113.7'), fakeResponse(), {
        ...opts,
        scope: 'auth-signin',
      })
    ).toBe(true)
    expect(
      await runtime.rateLimitRequest(from('203.0.113.7'), fakeResponse(), {
        ...opts,
        keyParts: ['ava@example.com'],
      })
    ).toBe(true)
    // Parts are kept apart, not joined: ['a|b'] is not ['a', 'b'].
    const parts = async (keyParts: string[]) =>
      runtime.rateLimitRequest(from('192.0.2.1'), fakeResponse(), { ...opts, limit: 1, keyParts })
    expect(await parts(['a|b'])).toBe(true)
    expect(await parts(['a', 'b'])).toBe(true)
  })

  it('counts every address of one IPv6 /64 as one visitor', async () => {
    const { runtime } = loadRuntime({ env: { VERCEL: '1' }, clock: { now: MIDNIGHT } })
    const from = (ip: string) => request({ 'x-vercel-forwarded-for': ip })
    const once = { ...opts, limit: 1 }
    expect(await runtime.rateLimitRequest(from('2001:db8:1:2::1'), fakeResponse(), once)).toBe(true)
    expect(
      await runtime.rateLimitRequest(from('2001:db8:1:2:ffff:0:0:9'), fakeResponse(), once)
    ).toBe(false)
    expect(await runtime.rateLimitRequest(from('2001:db8:1:3::1'), fakeResponse(), once)).toBe(true)
  })

  it('exports the visitor key every limiter of the app keys a visitor by', () => {
    const { runtime } = loadRuntime({ clock: { now: MIDNIGHT } })
    expect(runtime.visitorKey('203.0.113.7')).toBe('203.0.113.7')
    expect(runtime.visitorKey('unknown')).toBe('unknown')
    expect(runtime.visitorKey('2001:db8:1:2:ffff:0:0:9')).toBe('2001:db8:1:2::/64')
    expect(runtime.visitorKey('2001:db8:1:2::9')).toBe('2001:db8:1:2::/64')
    // An IPv4 tail fills two groups: 2001:db8::5:6:7:a.b.c.d is in 2001:db8:0:5::/64.
    expect(runtime.visitorKey('2001:db8::5:6:7:198.51.100.7')).toBe('2001:db8:0:5::/64')
    // An IPv4-mapped address is the IPv4 visitor once clientIp has read it.
    expect(runtime.visitorKey(runtime.clientIp(request({}, '::ffff:198.51.100.7')))).toBe(
      '198.51.100.7'
    )
  })

  it('cannot be dodged by rotating X-Forwarded-For', async () => {
    const { runtime } = loadRuntime({ clock: { now: MIDNIGHT } })
    const results: boolean[] = []
    for (let i = 1; i <= 3; i++) {
      results.push(
        await runtime.rateLimitRequest(
          request({ 'x-forwarded-for': '6.6.6.' + i }, '203.0.113.7'),
          fakeResponse(),
          { ...opts, limit: 1 }
        )
      )
    }
    expect(results).toEqual([true, false, false])
  })

  it('refuses to run without a scope', async () => {
    const { runtime } = loadRuntime()
    await expect(
      runtime.rateLimitRequest(request({}, '203.0.113.7'), fakeResponse(), { ...opts, scope: '' })
    ).rejects.toThrow(TypeError)
  })
})

describe('safeEqual', () => {
  it('compares in constant time and is false for anything missing, mismatched or odd', () => {
    const { runtime, timingSafeEqual } = loadRuntime()
    expect(runtime.safeEqual('s3cret-token', 's3cret-token')).toBe(true)
    expect(timingSafeEqual).toHaveBeenCalledTimes(1)
    expect(runtime.safeEqual('s3cret-token', 's3cret-tokeN')).toBe(false)
    expect(runtime.safeEqual('s3cret-token', 's3cret')).toBe(false)
    expect(runtime.safeEqual(Buffer.from('ab'), 'ab')).toBe(true)
    const odd: Array<[unknown, unknown]> = [
      [undefined, 'x'],
      ['x', undefined],
      [null, null],
      ['', ''],
      [undefined, undefined],
      [123, 123],
      [{}, {}],
      [['a'], ['a']],
      [Symbol('a'), 'a'],
    ]
    for (const [a, b] of odd) {
      expect(runtime.safeEqual(a, b)).toBe(false)
    }
  })
})

describe('sendClientError', () => {
  it('answers a generic message and an opaque id, and logs the detail server-side only', () => {
    const { runtime, log } = loadRuntime()
    const err = new Error(
      'relation "orders" does not exist; Secret not found: OPENAI_API_KEY at /var/task/x.js'
    )
    const res = fakeResponse()
    const id = runtime.sendClientError(res, 500, 'Something went wrong.', err)
    expect(id).toMatch(/^[0-9a-f]{16}$/)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Something went wrong.', id })
    expect(JSON.stringify(res.body)).not.toMatch(/orders|OPENAI_API_KEY|Secret not found|var\/task/)
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining(id), err)

    expect(runtime.sendClientError(fakeResponse(), 400, 'Invalid request.')).not.toBe(id)
  })

  it('keeps a sane status, leaves a sent response alone, and answers a plain Node response', () => {
    const { runtime } = loadRuntime()
    const odd = fakeResponse()
    runtime.sendClientError(odd, 200, 'Request failed.')
    expect(odd.statusCode).toBe(500)

    const sent = fakeResponse()
    sent.headersSent = true
    runtime.sendClientError(sent, 500, 'Something went wrong.', new Error('late'))
    expect(sent.body).toBeUndefined()

    const plain: any = { statusCode: 200, headers: {}, setHeader: jest.fn(), end: jest.fn() }
    const id = runtime.sendClientError(plain, 503, 'Unavailable.')
    expect(plain.statusCode).toBe(503)
    expect(plain.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8')
    expect(JSON.parse(plain.end.mock.calls[0][0])).toEqual({ error: 'Unavailable.', id })
  })
})

describe('the security runtime in a generated app', () => {
  const structure = (extra: Record<string, unknown> = {}): any => ({
    uidl: {
      name: 'Site',
      globals: { settings: { title: 'Site', language: 'en' }, env: {} },
      root: { name: 'Root', stateDefinitions: {}, node: { type: 'element', content: {} } },
      ...extra,
    },
    strategy: { pages: { options: {} } },
    files: new Map(),
    dependencies: {},
    devDependencies: {},
  })

  it('is written at utils/security-runtime.js, with pg, for an app with a Postgres database', async () => {
    for (const type of ['teleport', 'postgresql']) {
      const project = structure({ dataSources: { ds1: { type, config: {} } } })
      await new NextWorkflowProjectPlugin().runAfter(project)
      const entry = project.files.get(SECURITY_RUNTIME_FILE_KEY)
      expect(entry.path).toEqual(['utils'])
      expect(entry.files).toHaveLength(1)
      expect(entry.files[0].name).toBe('security-runtime')
      expect(entry.files[0].fileType).toBe('js')
      expect(entry.files[0].content).toBe(generateSecurityRuntimeCode())
      expect(project.dependencies.pg).toBe('^8.12.0')
    }
  })

  it('is the file the data routes require to compare the app secret', () => {
    // teleport-shared's table-access guard names the same module from the root.
    expect(securityRuntimeSpecifier('../..')).toBe(
      '../../' + TableAccess.SECURITY_RUNTIME_MODULE_PATH
    )
  })

  it('is written without pg for an app with server routes and no Postgres database', async () => {
    const project = structure({
      dataSources: { ds1: { type: 'mysql', config: {} } },
    })
    await new NextWorkflowProjectPlugin().runAfter(project)
    expect(project.files.has(SECURITY_RUNTIME_FILE_KEY)).toBe(true)
    expect(project.dependencies.pg).toBeUndefined()
  })

  it('is not written for a static site', async () => {
    const project = structure()
    await new NextWorkflowProjectPlugin().runAfter(project)
    expect(project.files.has(SECURITY_RUNTIME_FILE_KEY)).toBe(false)
    expect(project.dependencies).toEqual({})
  })

  it('is written once and keeps the pg version the project has', () => {
    const project = structure({ dataSources: { ds1: { type: 'teleport', config: {} } } })
    project.dependencies.pg = '^8.11.0'
    ensureSecurityRuntimeModule(project)
    const entry = project.files.get(SECURITY_RUNTIME_FILE_KEY)
    ensureSecurityRuntimeModule(project)
    expect(project.files.get(SECURITY_RUNTIME_FILE_KEY)).toBe(entry)
    expect(project.dependencies.pg).toBe('^8.11.0')
  })

  it('is required from any generated file by its depth below the project root', () => {
    for (const [file, prefix] of [
      ['pages/api/auth/signup.js', '../../..'],
      ['pages/api/data/[...params].js', '../../..'],
      ['utils/workflows/server-runtime.js', '../..'],
    ]) {
      const specifier = securityRuntimeSpecifier(prefix)
      expect(path.posix.join(path.posix.dirname(file), specifier)).toBe('utils/security-runtime')
    }
    expect(securityRuntimeSpecifier('../..')).toBe('../../utils/security-runtime')
  })
})
