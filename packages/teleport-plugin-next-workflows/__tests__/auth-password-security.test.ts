/* tslint:disable:max-classes-per-file */
import * as nodeCrypto from 'crypto'
import * as net from 'net'
import type { UIDLAuthentication } from '@teleporthq/teleport-types'
import {
  generateAuthDbHealthFile,
  generateAuthOptionsFile,
  generateHashPasswordFile,
  generateMiddlewareFile,
  generateNextAuthRouteFile,
  generateSignupRouteFile,
  isPrivilegedUserField,
  resolveSignupFields,
  SIGN_IN_FAILURE_LIMIT,
  SIGN_IN_VISITOR_FAILURE_LIMIT,
} from '../src/auth-generator'
import {
  FORGOT_PASSWORD_ANSWER,
  generateForgotPasswordRoute,
  generateResetPasswordRoute,
  resolveResetPagePath,
} from '../src/password-reset-route-generator'
import { generateSessionRevocationFile } from '../src/session-revocation-generator'
import { generateSecurityRuntimeCode } from '../src/security-runtime/security-runtime-code'
import { generatePageAccessGuardModule } from '../src/page-access-guard-generator'
import { generateWorkflowAuthHelperFile } from '../src/workflow-auth-generator'
import { generateAccountDeleteRoute } from '../src/account-delete-route-generator'
import { generateCommonJsSessionTokenResolverCode } from '../src/session-cookie-resolver'
import { generateDataAPIRoute } from '../src/data-api-route-generator'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { accountRequestPasswordReset } from '../src/nodes/account/account-request-password-reset'
import { accountResetPassword } from '../src/nodes/account/account-reset-password'
import { accountHashPassword } from '../src/nodes/account/account-hash-password'
import { accountComparePasswords } from '../src/nodes/account/account-compare-passwords'

/**
 * Task 3a of the 2026-10-25 security round, EXECUTED: the generated auth
 * modules and routes run against a fake Postgres that answers only the
 * statements below, with the real security runtime (in-memory limits).
 *
 * A3-C1 (pre-auth account takeover): the forgot-password workflow minted the
 * reset token in the browser and stored it with the email the browser named,
 * so `{ email: victim, token: mine }` followed by `{ token: mine, password }`
 * set anyone's password. Now the routes mint, hash, bind and spend the token
 * on the server, and nothing a request sends can name one.
 */

type Row = Record<string, any>

const sha256 = (value: string) => nodeCrypto.createHash('sha256').update(value).digest('hex')

// bcryptjs is not installed in the generator repo: a stand-in with its two calls.
const fakeBcrypt = {
  hashSync: (value: string) => 'bcrypt:' + sha256(value),
  compareSync: (value: string, hash: string) => hash === 'bcrypt:' + sha256(value),
}

const pepperedHash = (password: string, pepper: string) =>
  fakeBcrypt.hashSync(
    nodeCrypto
      .createHash('sha256')
      .update(password + pepper)
      .digest('base64')
  )

interface Reset {
  token_hash: string
  user_id: string
  expires_at: number
  used_at: number | null
}

class FakePostgres {
  users: Row[] = []
  resets: Reset[] = []
  resetsTableExists = false
  /** Off, as the site's role connects: it may read and write tables, and create none, whether or not one exists. */
  mayCreateTables = true
  /** Fails the statement that stores a link: the database went away between two calls. */
  failResetWrites = false
  now = Date.UTC(2026, 9, 25, 12)
  statements: string[] = []
  // The account store cannot be read (a connection refused) for lookups by id.
  failLookups = false

  query(sql: string, values: any[] = []): { rows: Row[]; rowCount?: number } {
    this.statements.push(sql)
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || sql.startsWith('SELECT pg_advisory_xact_lock')) {
      return { rows: [] }
    }
    if (sql.startsWith('CREATE TABLE IF NOT EXISTS teleport_password_resets')) {
      if (!this.mayCreateTables) {
        throw Object.assign(new Error('permission denied for schema public'), { code: '42501' })
      }
      this.resetsTableExists = true
      return { rows: [] }
    }
    if (sql.startsWith('CREATE INDEX IF NOT EXISTS teleport_password_resets_user_id_idx')) {
      return { rows: [] }
    }
    if (sql === 'SELECT * FROM users WHERE email = $1 LIMIT 1') {
      return { rows: this.users.filter((u) => u.email === values[0]).map((u) => ({ ...u })) }
    }
    // The sign-up's case-blind existence check.
    if (sql === 'SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 2') {
      const folded = String(values[0]).toLowerCase()
      return {
        rows: this.users
          .filter((u) => String(u.email).toLowerCase() === folded)
          .slice(0, 2)
          .map((u) => ({ ...u })),
      }
    }
    if (sql === 'SELECT * FROM users WHERE id = $1 LIMIT 1') {
      if (this.failLookups) {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
      }
      return { rows: this.users.filter((u) => u.id === values[0]).map((u) => ({ ...u })) }
    }
    if (sql === 'SELECT id FROM users WHERE email = $1 LIMIT 1') {
      return { rows: this.users.filter((u) => u.email === values[0]).map((u) => ({ id: u.id })) }
    }
    if (sql.startsWith('INSERT INTO users (name, email, password, role, image')) {
      const columns = /INSERT INTO users \(([^)]*)\)/.exec(sql)![1].split(', ')
      const row: Row = { id: 'u' + (this.users.length + 1) }
      columns.forEach((column, index) => {
        row[column] = values[index]
      })
      this.users.push(row)
      return { rows: [{ ...row }] }
    }
    if (sql === 'UPDATE users SET password = $1 WHERE id = $2 AND password = $3') {
      const user = this.users.find((u) => u.id === values[1] && u.password === values[2])
      if (user) {
        user.password = values[0]
      }
      return { rows: [], rowCount: user ? 1 : 0 }
    }
    if (!this.resetsTableExists && sql.includes('teleport_password_resets')) {
      throw Object.assign(new Error('relation "teleport_password_resets" does not exist'), {
        code: '42P01',
      })
    }
    if (sql === 'SELECT 1 FROM teleport_password_resets LIMIT 1') {
      return { rows: [] }
    }
    if (this.failResetWrites && sql.startsWith('INSERT INTO teleport_password_resets')) {
      throw Object.assign(new Error('Connection terminated unexpectedly'), { code: '57P01' })
    }
    if (sql.startsWith('UPDATE teleport_password_resets SET used_at = NOW() WHERE user_id = $1')) {
      for (const reset of this.resets) {
        if (reset.user_id === values[0] && reset.used_at === null) {
          reset.used_at = this.now
        }
      }
      return { rows: [] }
    }
    if (sql.startsWith('INSERT INTO teleport_password_resets (token_hash, user_id, expires_at)')) {
      this.resets.push({
        token_hash: values[0],
        user_id: values[1],
        expires_at: this.now + Number(values[2]) * 1000,
        used_at: null,
      })
      return { rows: [] }
    }
    if (sql.startsWith('DELETE FROM teleport_password_resets WHERE expires_at <')) {
      return { rows: [] }
    }
    if (sql.startsWith('WITH consumed AS ( UPDATE teleport_password_resets SET used_at = NOW()')) {
      const reset = this.live(values[0])
      if (!reset) {
        return { rows: [] }
      }
      reset.used_at = this.now
      const user = this.users.find((u) => String(u.id) === reset.user_id)
      if (!user) {
        return { rows: [] }
      }
      user.password = values[1]
      return { rows: [{ id: user.id, email: user.email }] }
    }
    if (sql.startsWith('SELECT 1 FROM teleport_password_resets WHERE token_hash = $1')) {
      return { rows: this.live(values[0]) ? [{ '?column?': 1 }] : [] }
    }
    throw new Error('unexpected SQL: ' + sql)
  }

  private live(tokenHash: string): Reset | undefined {
    return this.resets.find(
      (r) => r.token_hash === tokenHash && r.used_at === null && r.expires_at > this.now
    )
  }
}

const pgFor = (db: FakePostgres) => ({
  Client: class {
    public async connect() {
      return undefined
    }
    public async end() {
      return undefined
    }
    public on() {
      return undefined
    }
    public async query(sql: string, values?: any[]) {
      return db.query(sql, values)
    }
  },
})

const AUTH: UIDLAuthentication = {
  enabled: true,
  dataSourceId: 'ds-1',
  dataSourceType: 'postgresql',
  passwordAuthEnabled: true,
  providers: [],
  roles: ['user', 'admin'],
  tables: {},
  pageProtection: {},
  folderProtection: {},
  authPages: {},
  callbackBaseUrl: '/api/auth/callback',
  envKeys: {},
  customUserProperties: [
    { key: 'company', label: 'Company', columnType: 'TEXT', attributeType: 'string' },
    { key: 'is_admin', label: 'Admin', columnType: 'BOOLEAN', attributeType: 'boolean' },
    { key: 'email_verified', label: 'Verified', columnType: 'BOOLEAN', attributeType: 'boolean' },
    { key: 'credits', label: 'Credits', columnType: 'INTEGER', attributeType: 'number' },
  ],
} as UIDLAuthentication

const ENV = {
  NEXTAUTH_SECRET: 'app-secret',
  DB_CONNECTION_STRING: 'postgres://fake',
  AUTH_PEPPER: 'project-id-1',
  AUTH_PEPPER_SECRET: 'per-project-random-pepper',
  NEXTAUTH_URL: 'https://shop.example',
  RESEND_KEY: 're_test_key',
}

interface FakeResponse {
  statusCode: number
  body: any
  headers: Record<string, string>
  status: (code: number) => FakeResponse
  json: (body: unknown) => FakeResponse
  setHeader: (name: string, value: string) => void
}

const fakeResponse = (): FakeResponse => {
  const res: FakeResponse = {
    statusCode: 0,
    body: undefined,
    headers: {},
    status: (code) => {
      res.statusCode = code
      return res
    },
    json: (body) => {
      res.body = body
      return res
    },
    setHeader: (name, value) => {
      res.headers[name.toLowerCase()] = value
    },
  }
  return res
}

const request = (body: Row, ip = '203.0.113.7', extra: Row = {}) => ({
  method: 'POST',
  headers: { host: 'shop.example' },
  socket: { remoteAddress: ip },
  body,
  query: {},
  ...extra,
})

/**
 * One app instance: the generated modules, required from each other the way
 * the generated files require them.
 */
const loadApp = (
  options: {
    auth?: UIDLAuthentication
    env?: Record<string, string>
    db?: FakePostgres
    resetPagePath?: string
    tokenInFragment?: boolean
    fetch?: (url: string, init: unknown) => Promise<unknown>
    welcome?: boolean
    /** More modules the generated files may require (a store's driver). */
    externals?: Record<string, unknown>
  } = {}
) => {
  const auth = options.auth || AUTH
  const env = { ...(options.env || ENV) }
  const db = options.db || new FakePostgres()
  const sent: Row[] = []
  const delays: number[] = []
  const logs: unknown[][] = []
  const quiet = {
    error: (...args: unknown[]) => logs.push(args),
    warn: (...args: unknown[]) => logs.push(args),
    log: () => undefined,
    info: () => undefined,
  }
  const cache: Record<string, any> = {}
  const sources: Record<string, string> = {
    runtime: generateSecurityRuntimeCode(),
    hash: generateHashPasswordFile(),
    health: generateAuthDbHealthFile(),
    revocation: generateSessionRevocationFile(),
    options: generateAuthOptionsFile(auth, null),
    forgot: generateForgotPasswordRoute({
      resetPagePath: options.resetPagePath || '/reset-password',
      tokenInFragment: options.tokenInFragment,
      emailProvider: 'resend',
      fromEmail: 'shop@brand.test',
      emailSecretEnvName: 'RESEND_KEY',
      emailSubject: 'Reset your password',
      emailBodyHtml: '<a href="{{resetUrl}}">Reset</a> for {{recipientEmail}}',
    }),
    reset: generateResetPasswordRoute(),
    signup: generateSignupRouteFile(
      auth,
      options.welcome
        ? {
            emailProvider: 'resend',
            fromEmail: 'shop@brand.test',
            emailSecretEnvName: 'RESEND_KEY',
            emailSubject: 'Welcome',
            emailBodyHtml: '<p>Welcome {{userName}}</p>',
            siteName: 'Shop',
          }
        : {},
      {},
      {
        fields: resolveSignupFields(auth, [{ email: 1, password: 1, company: 1, is_admin: 1 }]),
      }
    ),
    nextauth: generateNextAuthRouteFile({ passwordAuthEnabled: true }),
  }
  const fakeNextAuth = (authOptions: Row) => async (req: Row, res: FakeResponse) => {
    try {
      const user = await authOptions.providers[0].authorize(req.body, {
        headers: req.headers,
        body: req.body,
      })
      res.status(200).json({ url: 'https://shop.example/', user })
    } catch (err) {
      res
        .status(401)
        .json({ url: 'https://shop.example/api/auth/error?error=' + (err as Error).message })
    }
  }
  const external: Record<string, unknown> = {
    crypto: nodeCrypto,
    net,
    pg: pgFor(db),
    bcryptjs: fakeBcrypt,
    'next-auth': fakeNextAuth,
    'next-auth/providers/credentials': (config: unknown) => config,
    resend: {
      Resend: class {
        public emails = {
          send: async (msg: Row) => {
            sent.push(msg)
            return {}
          },
        }
      },
    },
    '../../../utils/email/email-locale': {
      resolveRequestLocale: () => '',
      pickLocalizedTemplate: (base: Row) => base,
    },
    '../../../utils/email/sent-email-log': {
      recordSentEmail: (entry: Row) => sent.push({ ledger: entry }),
      settleSentEmailLog: async () => undefined,
    },
    ...(options.externals || {}),
  }
  const files: Record<string, string> = {
    runtime: 'runtime',
    '../security-runtime': 'runtime',
    '../../../utils/security-runtime': 'runtime',
    './hash-password': 'hash',
    '../../../utils/auth/hash-password': 'hash',
    './db-health': 'health',
    './session-revocation': 'revocation',
    './auth-options': 'options',
    '../../../utils/auth/auth-options': 'options',
  }
  const load = (name: string): any => {
    if (cache[name]) {
      return cache[name].exports
    }
    const module = { exports: {} as any }
    cache[name] = module
    const req = (id: string): unknown => {
      if (Object.prototype.hasOwnProperty.call(files, id)) {
        return load(files[id])
      }
      if (Object.prototype.hasOwnProperty.call(external, id)) {
        return external[id]
      }
      throw new Error(name + ' required an unexpected module: ' + id)
    }
    const setTimeoutShim = (fn: () => void, ms: number) => {
      delays.push(ms)
      fn()
      return 0
    }
    // eslint-disable-next-line no-new-func
    new Function(
      'module',
      'exports',
      'require',
      'process',
      'console',
      'Buffer',
      'setTimeout',
      'fetch',
      sources[name]
    )(
      module,
      module.exports,
      req,
      { env },
      quiet,
      Buffer,
      setTimeoutShim,
      options.fetch || (async () => ({ ok: false }))
    )
    return module.exports
  }
  return { db, env, sent, delays, logs, load, sources }
}

const VICTIM = { id: 'u-victim', email: 'victim@site.test', name: 'Vic', role: 'admin' }
const FORGOT_PASSWORD_NOT_SENT = 'We could not send the reset link. Please try again in a moment.'

const tokenFromEmail = (sent: Row[]): string => {
  const mail = sent.find((entry) => entry.to)
  const match = /token=([0-9a-f]+)/.exec(String(mail && mail.html))
  return match ? match[1] : ''
}

describe('A3-C1: forgot / reset password are decided on the server', () => {
  const victimDb = () => {
    const db = new FakePostgres()
    db.users.push({ ...VICTIM, password: pepperedHash('Original#1', ENV.AUTH_PEPPER_SECRET) })
    return db
  }

  it('refuses the proof-of-concept: a token the requester chose never becomes a reset link', async () => {
    const app = loadApp({ db: victimDb() })
    const forgot = app.load('forgot')
    const reset = app.load('reset')

    // Step 1 of the PoC, sent to the new route: the forged workflow context rides along.
    const res1 = fakeResponse()
    await forgot(
      request({
        email: VICTIM.email,
        token: 'ATTACKER-CHOSEN',
        context: { genToken: { value: 'ATTACKER-CHOSEN' }, extract: { email: VICTIM.email } },
      }),
      res1
    )
    expect(res1.statusCode).toBe(200)
    expect(app.db.resets).toHaveLength(1)
    expect(app.db.resets[0].token_hash).not.toBe(sha256('ATTACKER-CHOSEN'))
    expect(app.db.resets[0].token_hash).not.toContain('ATTACKER')
    expect(app.db.resets[0].user_id).toBe(VICTIM.id)

    // Step 2 of the PoC: the chosen token (and a well-formed one) sets nothing.
    for (const token of ['ATTACKER-CHOSEN', 'a'.repeat(64)]) {
      const res2 = fakeResponse()
      await reset(request({ token, password: 'Pwned1!xx' }), res2)
      expect(res2.statusCode).toBe(200)
      expect(res2.body).toEqual({ valid: false, changed: false })
    }
    expect(app.db.users[0].password).toBe(pepperedHash('Original#1', ENV.AUTH_PEPPER_SECRET))
  })

  it('mints a random token, stores only its SHA-256 and mails it only to the account address', async () => {
    const app = loadApp({ db: victimDb(), resetPagePath: '/account/new-password' })
    await app.load('forgot')(
      request({ email: VICTIM.email }, '198.51.100.1', {
        headers: { host: 'attacker.example' },
      }),
      fakeResponse()
    )
    const mails = app.sent.filter((entry) => entry.to)
    expect(mails).toHaveLength(1)
    expect(mails[0].to).toEqual([VICTIM.email])
    const token = tokenFromEmail(app.sent)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(app.db.resets[0].token_hash).toBe(sha256(token))
    // The link's host is the configured one, never the Host header a request sent.
    expect(mails[0].html).toContain('https://shop.example/account/new-password?token=' + token)
    expect(mails[0].html).not.toContain('attacker.example')
    // The sent-email log never keeps the token.
    const ledger = app.sent.find((entry) => entry.ledger)!.ledger
    expect(JSON.stringify(ledger)).not.toContain(token)
    expect(ledger.html).toContain('token=[hidden]')
  })

  it('a link works once, for its own account, within 30 minutes', async () => {
    const db = victimDb()
    db.users.push({ id: 'u-other', email: 'other@site.test', password: 'x', role: 'user' })
    const app = loadApp({ db })
    await app.load('forgot')(request({ email: VICTIM.email }), fakeResponse())
    const token = tokenFromEmail(app.sent)
    const reset = app.load('reset')

    const check = fakeResponse()
    await reset(request({ token, checkOnly: true }), check)
    expect(check.body).toEqual({ valid: true, changed: false })

    const first = fakeResponse()
    // A user id or email in the body changes nothing: the link is bound to its account.
    await reset(
      request({ token, password: 'NewPassw0rd', userId: 'u-other', email: 'other@site.test' }),
      first
    )
    expect(first.body).toEqual({ valid: true, changed: true })
    expect(db.users[0].password).toBe(pepperedHash('NewPassw0rd', ENV.AUTH_PEPPER_SECRET))
    expect(db.users[1].password).toBe('x')

    const second = fakeResponse()
    await reset(request({ token, password: 'Another0ne' }), second)
    expect(second.body).toEqual({ valid: false, changed: false })

    // A fresh link, 31 minutes later.
    app.sent.length = 0
    await app.load('forgot')(request({ email: VICTIM.email }, '198.51.100.2'), fakeResponse())
    const later = tokenFromEmail(app.sent)
    db.now += 31 * 60 * 1000
    const expired = fakeResponse()
    await reset(request({ token: later, password: 'Late123456' }), expired)
    expect(expired.body).toEqual({ valid: false, changed: false })
  })

  it('a new link ends the one sent before it', async () => {
    const app = loadApp({ db: victimDb() })
    await app.load('forgot')(request({ email: VICTIM.email }), fakeResponse())
    const first = tokenFromEmail(app.sent)
    app.sent.length = 0
    await app.load('forgot')(request({ email: VICTIM.email }), fakeResponse())
    const res = fakeResponse()
    await app.load('reset')(request({ token: first, checkOnly: true }), res)
    expect(res.body).toEqual({ valid: false, changed: false })
  })

  it('refuses a new password outside the policy (8 characters, 128 bytes)', async () => {
    const app = loadApp({ db: victimDb() })
    await app.load('forgot')(request({ email: VICTIM.email }), fakeResponse())
    const token = tokenFromEmail(app.sent)
    for (const password of ['short7!', 'é'.repeat(65)]) {
      const refused = fakeResponse()
      await app.load('reset')(request({ token, password }), refused)
      expect(refused.statusCode).toBe(400)
    }
    const res = fakeResponse()
    await app.load('reset')(request({ token, checkOnly: true }), res)
    expect(res.body.valid).toBe(true)
  })

  it('answers an address without an account exactly like one with, and writes nothing for it', async () => {
    const app = loadApp({ db: victimDb() })
    const known = fakeResponse()
    await app.load('forgot')(request({ email: VICTIM.email }), known)
    const delaysForKnown = app.delays.slice()
    app.delays.length = 0
    const unknown = fakeResponse()
    await app.load('forgot')(request({ email: 'nobody@site.test' }), unknown)

    expect(unknown.statusCode).toBe(known.statusCode)
    expect(unknown.body).toEqual(known.body)
    expect(unknown.body).toEqual({ success: true, message: FORGOT_PASSWORD_ANSWER })
    expect(app.db.resets).toHaveLength(1)
    expect(app.sent.filter((entry) => entry.to)).toHaveLength(1)
    // Both wait out the same minimum response time.
    expect(delaysForKnown.length).toBeGreaterThan(0)
    expect(app.delays.length).toBeGreaterThan(0)
  })

  const asksToCreate = (db: FakePostgres) =>
    db.statements.filter((sql) => /\bCREATE\b|pg_advisory_xact_lock/.test(sql))

  it('stores a link in the table the editor made, never asking to create it', async () => {
    const db = victimDb()
    db.resetsTableExists = true
    db.mayCreateTables = false
    const app = loadApp({ db })
    const res = fakeResponse()

    await app.load('forgot')(request({ email: VICTIM.email }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ success: true, message: FORGOT_PASSWORD_ANSWER })
    expect(db.resets).toHaveLength(1)
    expect(app.sent.filter((entry) => entry.to)).toHaveLength(1)
    expect(asksToCreate(db)).toEqual([])
  })

  it('creates the table only when it is really missing, then stores the link in it', async () => {
    const db = victimDb()
    const app = loadApp({ db })
    await app.load('forgot')(request({ email: VICTIM.email }), fakeResponse())

    expect(asksToCreate(db).map((sql) => sql.split(' (')[0])).toEqual([
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'CREATE TABLE IF NOT EXISTS teleport_password_resets',
      'CREATE INDEX IF NOT EXISTS teleport_password_resets_user_id_idx ON teleport_password_resets',
    ])
    expect(db.resets).toHaveLength(1)
    expect(app.sent.filter((entry) => entry.to)).toHaveLength(1)
  })

  it('stores a sign-up set-password link the same way when the table went missing', async () => {
    const db = victimDb()
    const app = loadApp({ db })
    await app.load('options').storePasswordReset(VICTIM.id, 'hash', 1800)
    expect(db.resets).toHaveLength(1)

    const refused = victimDb()
    refused.mayCreateTables = false
    const refusedApp = loadApp({ db: refused })
    await expect(
      refusedApp.load('options').storePasswordReset(VICTIM.id, 'hash', 1800)
    ).rejects.toThrow(
      'the table teleport_password_resets is missing and could not be created: permission denied for schema public'
    )
    expect(refused.statements).toContain('ROLLBACK')
  })

  it('tells no one a link was sent when the table is missing and cannot be made, naming it in the log', async () => {
    const db = victimDb()
    db.mayCreateTables = false
    const app = loadApp({ db })
    const known = fakeResponse()
    await app.load('forgot')(request({ email: VICTIM.email }), known)
    const unknown = fakeResponse()
    await app.load('forgot')(request({ email: 'nobody@site.test' }), unknown)

    for (const res of [known, unknown]) {
      expect(res.statusCode).toBe(503)
      expect(res.body.error).toBe(FORGOT_PASSWORD_NOT_SENT)
      expect(res.body).not.toHaveProperty('success')
    }
    expect(db.resets).toEqual([])
    expect(app.sent).toEqual([])
    const logged = app.logs.map((args) => args.map(String).join(' ')).join('\n')
    expect(logged).toContain('teleport_password_resets')
    expect(logged).toContain('permission denied for schema public')
  })

  it('tells no one a link was sent when storing it fails', async () => {
    const db = victimDb()
    db.resetsTableExists = true
    db.failResetWrites = true
    const app = loadApp({ db })
    const res = fakeResponse()

    await app.load('forgot')(request({ email: VICTIM.email }), res)

    expect(res.statusCode).toBe(503)
    expect(res.body.error).toBe(FORGOT_PASSWORD_NOT_SENT)
    expect(app.sent).toEqual([])
    // Waits out the same minimum, so the time tells nothing either.
    expect(app.delays.length).toBeGreaterThan(0)
  })

  it('sends one address at most 3 links an hour, answering the same', async () => {
    const app = loadApp({ db: victimDb() })
    for (let i = 0; i < 5; i++) {
      const res = fakeResponse()
      await app.load('forgot')(request({ email: VICTIM.email }, '198.51.100.' + (i + 10)), res)
      expect(res.body).toEqual({ success: true, message: FORGOT_PASSWORD_ANSWER })
    }
    expect(app.sent.filter((entry) => entry.to)).toHaveLength(3)
  })

  it('keeps the reset page a same-site path and never takes it from a request', () => {
    expect(resolveResetPagePath('/account/new-password')).toBe('/account/new-password')
    for (const bad of [
      '//evil.test/x',
      'https://evil.test',
      '/go?url=https://evil.test',
      '/a/../b',
      '',
    ]) {
      expect(resolveResetPagePath(bad)).toBe('/reset-password')
    }
  })
})

describe('A3-H1: sign-in and sign-up limits', () => {
  const signIn = async (
    app: ReturnType<typeof loadApp>,
    email: string,
    password: string,
    ip: string
  ) => {
    const res = fakeResponse()
    await app.load('nextauth')(
      request({ email, password, json: 'true' }, ip, {
        query: { nextauth: ['callback', 'credentials'] },
        headers: { host: 'shop.example', 'x-teleport-signin-visitor': '10.9.9.9' },
      }),
      res
    )
    return res
  }

  it(`answers 429 after ${SIGN_IN_FAILURE_LIMIT} failures for one email from one visitor`, async () => {
    const db = new FakePostgres()
    db.users.push({ ...VICTIM, password: pepperedHash('Right#Pass1', ENV.AUTH_PEPPER_SECRET) })
    const app = loadApp({ db })
    for (let i = 0; i < SIGN_IN_FAILURE_LIMIT; i++) {
      const res = await signIn(app, VICTIM.email, 'wrong-' + i, '203.0.113.50')
      expect(res.statusCode).toBe(401)
      expect(res.body.url).toContain('error=InvalidCredentials')
    }
    const refused = await signIn(app, VICTIM.email, 'Right#Pass1', '203.0.113.50')
    expect(refused.statusCode).toBe(429)
    expect(refused.body.url).toContain('error=TooManyAttempts')
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0)

    // Another visitor, or another email from the same visitor, is not affected.
    expect((await signIn(app, VICTIM.email, 'Right#Pass1', '203.0.113.51')).statusCode).toBe(200)
    expect((await signIn(app, 'someone@site.test', 'x', '203.0.113.50')).statusCode).toBe(401)
  })

  it('does not count successful sign-ins as failures', async () => {
    const db = new FakePostgres()
    db.users.push({ ...VICTIM, password: pepperedHash('Right#Pass1', ENV.AUTH_PEPPER_SECRET) })
    const app = loadApp({ db })
    for (let i = 0; i < SIGN_IN_FAILURE_LIMIT + 5; i++) {
      expect((await signIn(app, VICTIM.email, 'Right#Pass1', '203.0.113.60')).statusCode).toBe(200)
    }
  })

  it(`answers 429 once one visitor has ${SIGN_IN_VISITOR_FAILURE_LIMIT} failures across any emails`, async () => {
    const app = loadApp()
    for (let i = 0; i < SIGN_IN_VISITOR_FAILURE_LIMIT; i++) {
      // A different address each time: the per-email limit never trips.
      const res = await signIn(app, `user${i}@site.test`, 'guess', '203.0.113.90')
      expect(res.statusCode).toBe(401)
    }
    const refused = await signIn(app, 'fresh@site.test', 'guess', '203.0.113.90')
    expect(refused.statusCode).toBe(429)
    expect(refused.body.url).toContain('error=TooManyAttempts')
    expect((await signIn(app, 'fresh@site.test', 'guess', '203.0.113.91')).statusCode).toBe(401)
  })

  it('limits sign-ups to 10 an hour per visitor', async () => {
    const app = loadApp()
    for (let i = 0; i < 10; i++) {
      const created = fakeResponse()
      await app.load('signup')(
        request({ email: `a${i}@site.test`, password: 'Passw0rd!' }, '203.0.113.70'),
        created
      )
      expect(created.statusCode).toBe(201)
    }
    const res = fakeResponse()
    await app.load('signup')(
      request({ email: 'a11@site.test', password: 'Passw0rd!' }, '203.0.113.70'),
      res
    )
    expect(res.statusCode).toBe(429)
  })
})

describe('A3-M3 / A1-05: sign-up writes only what its form collects', () => {
  it('ignores email_verified, is_admin, role and credits in the body', async () => {
    const app = loadApp()
    const res = fakeResponse()
    await app.load('signup')(
      request({
        email: 'new@site.test',
        password: 'Passw0rd!',
        name: 'New',
        company: 'ACME',
        is_admin: true,
        email_verified: true,
        role: 'admin',
        credits: 9999,
      }),
      res
    )
    expect(res.statusCode).toBe(201)
    const row = app.db.users[0]
    expect(row).toMatchObject({ email: 'new@site.test', company: 'ACME', role: 'user' })
    expect(row.is_admin).toBeNull()
    expect(row.email_verified).toBeNull()
    expect(row.credits).toBeNull()
  })

  it('collects only declared, non-privileged fields of the sign-up form', () => {
    expect(
      resolveSignupFields(AUTH, [{ email: 1, company: 1, is_admin: 1, credits: 1, undeclared: 1 }])
    ).toEqual(['image', 'company'])
    for (const key of [
      'role',
      'roleName',
      'is_admin',
      'isAdmin',
      'admin',
      'is_staff',
      'isSuperuser',
      'email_verified',
      'emailVerified',
      'verified',
      'credits',
      'balance',
      'plan',
      'tier',
      'subscription_tier',
      'entitlements',
    ]) {
      expect(isPrivilegedUserField(key)).toBe(true)
    }
    expect(isPrivilegedUserField('company')).toBe(false)
  })

  it('refuses a password shorter than 8 characters', async () => {
    const app = loadApp()
    const res = fakeResponse()
    await app.load('signup')(request({ email: 'p@site.test', password: 'seven77' }), res)
    expect(res.statusCode).toBe(400)
    expect(app.db.users).toHaveLength(0)
  })
})

describe('R19 / A8-09: the project pepper, with the old one still accepted', () => {
  const signInWith = async (env: Record<string, string>, stored: string, password: string) => {
    const db = new FakePostgres()
    db.users.push({ ...VICTIM, password: stored })
    const app = loadApp({ db, env })
    const options = app.load('options')
    const visitor = { headers: { 'x-teleport-signin-visitor': '203.0.113.80' } }
    let error: Error | null = null
    let user: Row | null = null
    try {
      user = await options.providers[0].authorize({ email: VICTIM.email, password }, visitor)
    } catch (err) {
      error = err as Error
    }
    return { db, user, error, app }
  }

  it('signs a legacy-pepper user in and re-hashes the password with the project pepper', async () => {
    const legacy = pepperedHash('Old#Passw0rd', ENV.AUTH_PEPPER)
    const first = await signInWith(ENV, legacy, 'Old#Passw0rd')
    expect(first.error).toBeNull()
    expect(first.user).toMatchObject({ id: VICTIM.id, role: 'admin' })
    expect(first.db.users[0].password).toBe(pepperedHash('Old#Passw0rd', ENV.AUTH_PEPPER_SECRET))
    // The session is stamped with the account as stored after the re-hash.
    const revocation = first.app.load('revocation')
    expect(revocation.stampVerdict(first.user, first.db.users[0])).toBe('current')
  })

  it('keeps hashing and verifying on the old pepper when the project has no pepper secret', async () => {
    const env = { ...ENV, AUTH_PEPPER_SECRET: '' }
    const legacy = pepperedHash('Old#Passw0rd', ENV.AUTH_PEPPER)
    const result = await signInWith(env, legacy, 'Old#Passw0rd')
    expect(result.error).toBeNull()
    expect(result.db.users[0].password).toBe(legacy)
    const hash = result.app.load('hash')
    expect(hash.hashPassword('Brand#New1')).toBe(pepperedHash('Brand#New1', ENV.AUTH_PEPPER))
    // An unresolved placeholder is no secret either.
    const placeholder = loadApp({
      env: { ...ENV, AUTH_PEPPER_SECRET: 'teleporthq.secrets.AUTH_PEPPER_SECRET' },
    })
    expect(placeholder.load('hash').hashPassword('Brand#New1')).toBe(
      pepperedHash('Brand#New1', ENV.AUTH_PEPPER)
    )
  })

  it('refuses a wrong password under either pepper', async () => {
    const result = await signInWith(ENV, pepperedHash('Old#Passw0rd', ENV.AUTH_PEPPER), 'nope-nope')
    expect(result.error && result.error.message).toBe('InvalidCredentials')
  })

  it('makes the workflow hash / compare nodes use the same two peppers', async () => {
    const run = (source: string, config: Row, env: Record<string, string>) =>
      // eslint-disable-next-line no-new-func
      new Function(
        'require',
        'globalThis',
        `${source}\nreturn ${source.match(/function (\w+)/)![1]};`
      )((id: string) => (id === 'bcryptjs' ? fakeBcrypt : nodeCrypto), {
        process: { env },
        Buffer,
      })(config, {})
    const hashed = await run(accountHashPassword.generateHandler(), { password: 'Node#Pass1' }, ENV)
    expect(hashed.hash).toBe(pepperedHash('Node#Pass1', ENV.AUTH_PEPPER_SECRET))
    await expect(
      run(accountHashPassword.generateHandler(), { password: 'seven77' }, ENV)
    ).rejects.toThrow('at least 8')
    const legacy = pepperedHash('Node#Pass1', ENV.AUTH_PEPPER)
    const compared = await run(
      accountComparePasswords.generateHandler(),
      { password: 'Node#Pass1', hash: legacy },
      ENV
    )
    expect(compared.isMatch).toBe(true)
  })
})

describe('A3-H2: an OAuth sign-in takes a local account only with a verified email', () => {
  const OAUTH_AUTH = {
    ...AUTH,
    providers: [{ id: 'keycloak', name: 'Keycloak', credentials: {} }],
  } as UIDLAuthentication

  const app = () => {
    const db = new FakePostgres()
    db.users.push({ ...VICTIM, password: 'x' })
    return loadApp({ auth: OAUTH_AUTH, db })
  }

  it('keeps an unverified email out of the local admin account', async () => {
    const instance = app()
    const options = instance.load('options')
    const token: Row = { email: VICTIM.email, name: 'Eve', sub: 'kc-1' }
    await options.callbacks.jwt({
      token,
      user: { id: 'kc-1', email: VICTIM.email, name: 'Eve' },
      account: { provider: 'keycloak', type: 'oauth', providerAccountId: 'kc-1' },
      profile: { email: VICTIM.email },
    })
    expect(token.email).toBeUndefined()
    expect(token.role).toBeUndefined()
    expect(token.id).toBe('oauth:keycloak:kc-1')
    instance.db.statements.length = 0
    await options.callbacks.jwt({ token, trigger: 'update' })
    expect(token.role).toBeUndefined()
    expect(token.id).toBe('oauth:keycloak:kc-1')
    expect(instance.db.statements).toEqual([])
    const session = await options.callbacks.session({ session: { user: {} }, token })
    expect(session.user).not.toHaveProperty('__oauthUnverified')
  })

  it('binds a verified email (or a provider that only hands out verified ones) to the account', async () => {
    for (const [provider, profile] of [
      ['keycloak', { email: VICTIM.email, email_verified: true }],
      ['google', { email: VICTIM.email }],
    ] as Array<[string, Row]>) {
      const options = app().load('options')
      const token: Row = { email: VICTIM.email, sub: 'p-1' }
      await options.callbacks.jwt({
        token,
        user: { id: 'p-1', email: VICTIM.email },
        account: { provider, type: 'oauth', providerAccountId: 'p-1' },
        profile,
      })
      await options.callbacks.jwt({ token, trigger: 'update' })
      expect(token).toMatchObject({ id: VICTIM.id, role: 'admin', email: VICTIM.email })
    }
  })

  it('I1: a multi-tenant Microsoft sign-in never takes the local account', async () => {
    const auth = {
      ...AUTH,
      providers: [
        {
          id: 'azure-ad',
          name: 'Azure AD',
          credentials: { AUTH_AZURE_AD_ID: '', AUTH_AZURE_AD_SECRET: '' },
        },
      ],
    } as UIDLAuthentication
    const db = new FakePostgres()
    db.users.push({ ...VICTIM, password: 'x' })
    const options = loadApp({ auth, db }).load('options')
    const token: Row = { email: VICTIM.email, sub: 'ms-1' }
    await options.callbacks.jwt({
      token,
      user: { id: 'ms-1', email: VICTIM.email },
      account: { provider: 'azure-ad', type: 'oauth', providerAccountId: 'ms-1' },
      profile: { email: VICTIM.email, tid: '11111111-2222-3333-4444-555555555555' },
    })
    await options.callbacks.jwt({ token, trigger: 'update' })
    expect(token.email).toBeUndefined()
    expect(token.role).toBeUndefined()
    expect(token.id).toBe('oauth:azure-ad:ms-1')
  })

  it('I1: a single-tenant Microsoft sign-in (or a verified email domain) takes the local account', async () => {
    const TENANT = '11111111-2222-3333-4444-555555555555'
    const auth = {
      ...AUTH,
      providers: [
        {
          id: 'azure-ad',
          name: 'Azure AD',
          credentials: {
            AUTH_AZURE_AD_ID: '',
            AUTH_AZURE_AD_SECRET: '',
            AUTH_AZURE_AD_TENANT_ID: '',
          },
        },
      ],
    } as UIDLAuthentication
    const signIn = async (env: Record<string, string>, profile: Row) => {
      const db = new FakePostgres()
      db.users.push({ ...VICTIM, password: 'x' })
      const options = loadApp({ auth, db, env: { ...ENV, ...env } }).load('options')
      const token: Row = { email: VICTIM.email, sub: 'ms-1' }
      await options.callbacks.jwt({
        token,
        user: { id: 'ms-1', email: VICTIM.email },
        account: { provider: 'azure-ad', type: 'oauth', providerAccountId: 'ms-1' },
        profile,
      })
      await options.callbacks.jwt({ token, trigger: 'update' })
      return token
    }
    // Configured for the owner's own tenant: adopted.
    expect(
      await signIn({ AUTH_AZURE_AD_TENANT_ID: TENANT }, { email: VICTIM.email, tid: TENANT })
    ).toMatchObject({
      id: VICTIM.id,
      role: 'admin',
    })
    // A token from another tenant, or a "common" configuration: not adopted.
    expect(
      (
        await signIn(
          { AUTH_AZURE_AD_TENANT_ID: TENANT },
          { email: VICTIM.email, tid: '99999999-2222-3333-4444-555555555555' }
        )
      ).role
    ).toBeUndefined()
    expect(
      (await signIn({ AUTH_AZURE_AD_TENANT_ID: 'common' }, { email: VICTIM.email })).role
    ).toBeUndefined()
    // Multi-tenant, but the token says the email's domain is verified: adopted.
    expect((await signIn({}, { email: VICTIM.email, xms_edov: true })).role).toBe('admin')
    // The provider really is configured for that tenant.
    expect(generateAuthOptionsFile(auth, null)).toContain(
      'tenantId: process.env.AUTH_AZURE_AD_TENANT_ID || undefined'
    )
  })

  it('trusts an explicit "not verified" over the provider list, and asks GitHub', async () => {
    const google = app().load('options')
    const token: Row = { email: VICTIM.email, sub: 'g-1' }
    await google.callbacks.jwt({
      token,
      user: { id: 'g-1', email: VICTIM.email },
      account: { provider: 'google', type: 'oauth', providerAccountId: 'g-1' },
      profile: { email: VICTIM.email, email_verified: false },
    })
    expect(token.email).toBeUndefined()

    const asked: string[] = []
    const github = loadApp({
      auth: OAUTH_AUTH,
      fetch: async (url: string) => {
        asked.push(url)
        return {
          ok: true,
          json: async () => [{ email: VICTIM.email, verified: false, primary: true }],
        }
      },
    }).load('options')
    const ghToken: Row = { email: VICTIM.email, sub: 'gh-1' }
    await github.callbacks.jwt({
      token: ghToken,
      user: { id: 'gh-1', email: VICTIM.email },
      account: { provider: 'github', type: 'oauth', providerAccountId: 'gh-1', access_token: 't' },
      profile: { email: VICTIM.email },
    })
    expect(asked).toEqual(['https://api.github.com/user/emails'])
    expect(ghToken.email).toBeUndefined()
  })
})

describe('A3-M1 / R16: a password change ends every session, in every check', () => {
  it('revokes a stamped session after a password reset — in the jwt callback and the shared guard check', async () => {
    const db = new FakePostgres()
    db.users.push({ ...VICTIM, password: pepperedHash('Right#Pass1', ENV.AUTH_PEPPER_SECRET) })
    const app = loadApp({ db })
    const options = app.load('options')
    const user = await options.providers[0].authorize(
      { email: VICTIM.email, password: 'Right#Pass1' },
      { headers: {} }
    )
    const token: Row = { email: VICTIM.email, sub: VICTIM.id }
    await options.callbacks.jwt({ token, user })
    expect(typeof token.__sessionStamp).toBe('string')
    await options.callbacks.jwt({ token, trigger: 'update' })
    const revocation = app.load('revocation')
    expect(await revocation.liveSessionToken(token)).not.toBeNull()
    const session = await options.callbacks.session({ session: { user: {} }, token })
    expect(session.user).not.toHaveProperty('__sessionStamp')

    // The password is reset (another instance: no cached verdict).
    await app.load('forgot')(request({ email: VICTIM.email }), fakeResponse())
    await app.load('reset')(
      request({ token: tokenFromEmail(app.sent), password: 'Brand#New2' }),
      fakeResponse()
    )

    await expect(options.callbacks.jwt({ token, trigger: 'update' })).rejects.toThrow(
      'SessionRevoked'
    )
    const other = loadApp({ db })
    expect(await other.load('revocation').liveSessionToken(token)).toBeNull()
  })

  // I2: the check lives in the shared reader (__tqSessionToken), so every
  // consumer refuses a revoked session — proven here through two of them.
  const stamped = { id: VICTIM.id, email: VICTIM.email, role: 'admin', __sessionStamp: 'stamp-1' }
  const revocationStub = (revokedStamp: boolean) => ({
    liveSessionToken: async (token: Row) =>
      revokedStamp && token.__sessionStamp === 'stamp-1' ? null : token,
  })

  it('the account-deletion route refuses a revoked session and deletes nothing', async () => {
    const run = async (revoked: boolean) => {
      const statements: string[] = []
      const module = { exports: {} as any }
      // eslint-disable-next-line no-new-func
      new Function(
        'require',
        'module',
        'exports',
        'process',
        'console',
        generateAccountDeleteRoute({})
      )(
        (id: string) => {
          if (id === 'pg') {
            return {
              Client: class {
                public async connect() {
                  return undefined
                }
                public async end() {
                  return undefined
                }
                public async query(sql: string) {
                  statements.push(sql)
                  return sql.startsWith('SELECT * FROM users')
                    ? { rows: [{ ...VICTIM }] }
                    : { rows: [] }
                }
              },
            }
          }
          if (id === 'next-auth/jwt') {
            return { getToken: async () => stamped }
          }
          if (id === '../../../utils/auth/session-revocation') {
            return revocationStub(revoked)
          }
          if (id === '../../../utils/email/email-locale') {
            return { resolveRequestLocale: () => '' }
          }
          throw new Error('unexpected require: ' + id)
        },
        module,
        module.exports,
        { env: { NEXTAUTH_SECRET: 's', TELEPORT_DB_CONNECTION_STRING: 'postgres://x' } },
        { error: () => undefined, warn: () => undefined, log: () => undefined }
      )
      const res = fakeResponse()
      await module.exports(
        {
          method: 'POST',
          headers: { host: 'shop.example', cookie: '__Host-next-auth.session-token=mine' },
        },
        res
      )
      return { res, statements }
    }
    const refused = await run(true)
    expect(refused.res.statusCode).toBe(401)
    expect(refused.statements.filter((sql) => sql.startsWith('DELETE'))).toEqual([])
    const live = await run(false)
    expect(live.res.statusCode).toBe(200)
    expect(live.statements.some((sql) => sql.startsWith('DELETE FROM users'))).toBe(true)
  })

  it('the workflow route guard treats a revoked session as anonymous', async () => {
    const boot = (revoked: boolean) => {
      const module = { exports: {} as any }
      // eslint-disable-next-line no-new-func
      new Function(
        'require',
        'module',
        'exports',
        'process',
        'Buffer',
        generateWorkflowAuthHelperFile({})
      )(
        (id: string) => {
          if (id === 'next-auth/jwt') {
            return { getToken: async () => stamped }
          }
          if (id === '../../utils/auth/session-revocation') {
            return revocationStub(revoked)
          }
          if (id === './server-runtime') {
            return { isInternalCall: () => false }
          }
          if (id === 'crypto') {
            return nodeCrypto
          }
          throw new Error('unexpected require: ' + id)
        },
        module,
        module.exports,
        { env: { NEXTAUTH_SECRET: 's' } },
        Buffer
      )
      return module.exports.guardWorkflowRequest
    }
    const req = { headers: { host: 'shop.example', cookie: '__Host-next-auth.session-token=mine' } }
    const policy = { requiresAuth: true, allowedRoles: ['admin'] }
    expect(await boot(true)(req, {}, policy)).toEqual({ status: 401, message: 'Unauthenticated' })
    expect(await boot(false)(req, {}, policy)).toBeNull()
  })

  it('a stamped session whose check cannot be loaded is no session (fail closed)', async () => {
    const module = { exports: {} as any }
    // eslint-disable-next-line no-new-func
    new Function(
      'require',
      'module',
      'exports',
      'process',
      'Buffer',
      generateWorkflowAuthHelperFile({})
    )(
      (id: string) => {
        if (id === 'next-auth/jwt') {
          return { getToken: async () => stamped }
        }
        if (id === './server-runtime') {
          return { isInternalCall: () => false }
        }
        if (id === 'crypto') {
          return nodeCrypto
        }
        throw new Error("Cannot find module '" + id + "'")
      },
      module,
      module.exports,
      { env: { NEXTAUTH_SECRET: 's' } },
      Buffer
    )
    const req = { headers: { host: 'shop.example', cookie: '__Host-next-auth.session-token=mine' } }
    expect(
      await module.exports.guardWorkflowRequest(req, {}, { requiresAuth: true, allowedRoles: [] })
    ).toEqual({ status: 401, message: 'Unauthenticated' })
  })

  it('every server file reads the session through the one reader, from its own folder', () => {
    // [file the reader is inlined into, emitted code]: the revocation module
    // each one requires must be utils/auth/session-revocation.js from that folder.
    const posix = require('path').posix
    const consumers: Array<[string, string]> = [
      ['pages/api/account/delete-current.js', generateAccountDeleteRoute({})],
      ['utils/auth/page-access.js', generatePageAccessGuardModule(AUTH)],
      ['utils/workflows/workflow-auth.js', generateWorkflowAuthHelperFile({})],
    ]
    for (const [file, code] of consumers) {
      const specifier = /require\('([^']*utils\/auth\/session-revocation)'\)/.exec(code)
      expect(specifier).not.toBeNull()
      expect(posix.join(posix.dirname(file), specifier![1])).toBe('utils/auth/session-revocation')
      expect(code).toContain('revocation.liveSessionToken(token)')
    }
  })
})

describe('client nodes and project wiring', () => {
  it('the client nodes send only the address, or the token and password, to their routes', async () => {
    const calls: Array<{ url: string; body: Row }> = []
    const fakeFetch = async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) })
      return { ok: true, json: async () => ({ success: true, valid: true, changed: true }) }
    }
    const run = (source: string) =>
      // eslint-disable-next-line no-new-func
      new Function('fetch', `${source}\nreturn ${source.match(/function (\w+)/)![1]};`)(fakeFetch)
    await run(accountRequestPasswordReset.generateHandler())(
      { email: ' v@site.test ', apiKey: 'K', body: '<p/>' },
      {}
    )
    expect(
      await run(accountResetPassword.generateHandler())({ token: 't1', password: 'p' }, {})
    ).toEqual({
      valid: true,
      changed: true,
    })
    await run(accountResetPassword.generateHandler())({ token: 't2', checkOnly: true }, {})
    expect(calls).toEqual([
      { url: '/api/auth/forgot-password', body: { email: 'v@site.test' } },
      { url: '/api/auth/reset-password', body: { token: 't1', password: 'p' } },
      { url: '/api/auth/reset-password', body: { token: 't2', checkOnly: true } },
    ])
  })

  it('emits the routes, the revocation check and an empty AUTH_PEPPER_SECRET for password sign-in', async () => {
    const files = new Map<string, any>()
    const structure = {
      uidl: {
        name: 'Shop',
        globals: { env: {} as Record<string, string> },
        authentication: AUTH,
        dataSources: {},
        workflows: {
          workflows: {
            wf: {
              id: 'wf',
              name: 'Forgot Password Flow',
              trigger: { type: 'event-element-clicked', nodeId: 't', config: {} },
              nodes: [
                {
                  id: 'n1',
                  type: 'account-request-password-reset',
                  config: {
                    email: 'x',
                    emailProvider: 'email-resend',
                    from: 'shop@brand.test',
                    apiKey: {
                      type: 'dynamic',
                      content: { referenceType: 'secret', id: 'RESEND_KEY' },
                    },
                    subject: 'Reset',
                    body: '<a href="{{resetUrl}}">Reset</a>',
                    resetPagePath: '/account/new-password',
                  },
                },
              ],
              edges: [],
            },
          },
        },
      },
      files,
      dependencies: {} as Record<string, string>,
      devDependencies: {},
      strategy: {},
    }
    await new NextWorkflowProjectPlugin().runAfter(structure as never)
    const content = (key: string) => files.get(key)?.files?.[0]?.content as string
    expect(content('auth-forgot-password-route')).toContain(
      'var RESET_PAGE_PATH = "/account/new-password";'
    )
    expect(content('auth-forgot-password-route')).toContain(
      'var EMAIL_SECRET_ENV_NAME = "RESEND_KEY";'
    )
    expect(content('auth-reset-password-route')).toContain('consumePasswordReset')
    expect(content('auth-session-revocation')).toContain('liveSessionToken')
    expect(content('auth-nextauth-route')).toContain('throttleCredentialsSignIn')
    expect(structure.uidl.globals.env.AUTH_PEPPER_SECRET).toBe('')
    expect(structure.dependencies.resend).toBeTruthy()
  })

  it('leaves a project without password sign-in as it was', () => {
    const oauthOnly = { ...AUTH, passwordAuthEnabled: false } as UIDLAuthentication
    const optionsSource = generateAuthOptionsFile(oauthOnly, null)
    for (const marker of [
      'session-revocation',
      'checkSignInAllowed',
      'oauthEmailIsVerified',
      'revoked',
    ]) {
      expect(optionsSource).not.toContain(marker)
    }
    expect(generateNextAuthRouteFile()).not.toContain('security-runtime')
    expect(generateNextAuthRouteFile()).toBe(
      generateNextAuthRouteFile({ passwordAuthEnabled: false })
    )
  })
})

describe('sign-up never tells whether an address already has an account', () => {
  it('answers a taken address exactly like a new one, and tells its owner by email', async () => {
    const db = new FakePostgres()
    db.users.push({ ...VICTIM, password: 'x' })
    const app = loadApp({ db, welcome: true })
    const signup = app.load('signup')

    const taken = fakeResponse()
    await signup(request({ email: VICTIM.email, password: 'Passw0rd!', name: 'Eve' }), taken)
    const fresh = fakeResponse()
    await signup(request({ email: 'new@site.test', password: 'Passw0rd!', name: 'Eve' }), fresh)

    expect(taken.statusCode).toBe(201)
    expect(fresh.statusCode).toBe(201)
    expect(taken.body).toEqual({ user: { email: VICTIM.email, name: 'Eve' } })
    expect(fresh.body).toEqual({ user: { email: 'new@site.test', name: 'Eve' } })
    expect(Object.keys(taken.body.user)).toEqual(Object.keys(fresh.body.user))
    // Nothing about the existing account (its id, role) leaves the server.
    expect(JSON.stringify(taken.body)).not.toContain(VICTIM.id)
    expect(app.db.users).toHaveLength(2)

    const mails = app.sent.filter((entry) => entry.to)
    expect(mails.map((mail) => mail.to)).toEqual([[VICTIM.email], ['new@site.test']])
    expect(mails[0].subject).toBe('You already have an account')
    expect(mails[0].html).toContain('Forgot password')
    expect(mails[1].subject).toBe('Welcome')
  })

  it('sends one address at most 3 "you already have an account" emails an hour', async () => {
    const db = new FakePostgres()
    db.users.push({ ...VICTIM, password: 'x' })
    const app = loadApp({ db, welcome: true })
    for (let i = 0; i < 5; i++) {
      const res = fakeResponse()
      await app.load('signup')(
        request({ email: VICTIM.email, password: 'Passw0rd!' }, '198.51.100.' + (i + 30)),
        res
      )
      expect(res.statusCode).toBe(201)
    }
    expect(app.sent.filter((entry) => entry.to)).toHaveLength(3)
  })
})

describe('session cookies cannot be tossed by a sibling site', () => {
  it('names the session and callback-url cookies __Host- on https, and keeps the defaults on http', () => {
    const https = loadApp().load('options')
    expect(https.cookies).toEqual({
      sessionToken: {
        name: '__Host-next-auth.session-token',
        options: { httpOnly: true, sameSite: 'lax', path: '/', secure: true },
      },
      callbackUrl: {
        name: '__Host-next-auth.callback-url',
        options: { httpOnly: true, sameSite: 'lax', path: '/', secure: true },
      },
    })
    expect(JSON.stringify(https.cookies)).not.toContain('domain')
    const local = loadApp({ env: { ...ENV, NEXTAUTH_URL: 'http://localhost:3000' } }).load(
      'options'
    )
    expect(local.cookies).toBeUndefined()
    // OAuth-only projects get it too.
    const oauthOnly = generateAuthOptionsFile({ ...AUTH, passwordAuthEnabled: false }, null)
    expect(oauthOnly).toContain("name: '__Host-next-auth.session-token'")
  })

  const planted = '__Secure-next-auth.session-token=evil; next-auth.session-token=evil'
  const anySession = async () => ({ id: 'attacker', role: 'admin' })

  it('the page guard ignores a planted cookie and reads only the __Host- one', async () => {
    const load = () => {
      const module = { exports: {} as any }
      // eslint-disable-next-line no-new-func
      new Function(
        'require',
        'module',
        'exports',
        'process',
        'console',
        generatePageAccessGuardModule({
          ...AUTH,
          passwordAuthEnabled: false,
        } as UIDLAuthentication)
      )(
        (id: string) => {
          if (id === 'next-auth/jwt') {
            return { getToken: anySession }
          }
          throw new Error(id)
        },
        module,
        module.exports,
        { env: { NEXTAUTH_SECRET: 's' } },
        { error: () => undefined }
      )
      return module.exports.guardPageAccess
    }
    const context = (cookie: string) => ({
      req: { headers: { cookie, 'x-forwarded-proto': 'https', host: 'victim.teleporthq.app' } },
      res: { setHeader: () => undefined },
      resolvedUrl: '/admin',
    })
    const policy = { requiresAuth: true, allowedRoles: ['admin'] }
    expect((await load()(context(planted), policy)).redirect).toBeDefined()
    expect(await load()(context('__Host-next-auth.session-token=mine'), policy)).toBeNull()
  })

  it('the workflow route guard ignores a planted cookie', async () => {
    const module = { exports: {} as any }
    // eslint-disable-next-line no-new-func
    new Function(
      'require',
      'module',
      'exports',
      'process',
      'Buffer',
      generateWorkflowAuthHelperFile({})
    )(
      (id: string) => {
        if (id === 'next-auth/jwt') {
          return { getToken: anySession }
        }
        if (id === './server-runtime') {
          return { isInternalCall: () => false }
        }
        if (id === 'crypto') {
          return nodeCrypto
        }
        throw new Error(id)
      },
      module,
      module.exports,
      { env: { NEXTAUTH_SECRET: 's' } },
      Buffer
    )
    const guard = module.exports.guardWorkflowRequest
    const req = (cookie: string) => ({
      headers: { cookie, 'x-forwarded-proto': 'https', host: 'victim.teleporthq.app' },
    })
    const policy = { requiresAuth: true, allowedRoles: [] }
    expect(await guard(req(planted), {}, policy)).toEqual({
      status: 401,
      message: 'Unauthenticated',
    })
    expect(await guard(req('__Host-next-auth.session-token=mine'), {}, policy)).toBeNull()
  })

  it('the middleware ignores a planted cookie (no decode, no session round trip)', async () => {
    const code = generateMiddlewareFile({
      ...AUTH,
      authPages: { signIn: { pageId: 's', pageName: 's', route: '/sign-in' } },
      pageProtection: {
        p: { requiresAuth: true, allowedRoles: [], pageName: 'A', route: '/account' },
      },
    } as never)
      .replace("import { NextResponse } from 'next/server';", '')
      .replace("import { getToken } from 'next-auth/jwt';", '')
      .replace('export default middleware;', '')
      .replace('export const config = {', 'const config = {')
    const fetched: string[] = []
    const middleware = new Function(
      'NextResponse',
      'getToken',
      'fetch',
      'process',
      `${code}; return middleware;`
    )(
      {
        next: () => ({ kind: 'next' }),
        redirect: (url: URL) => ({ kind: 'redirect', location: String(url) }),
      },
      anySession,
      async (url: string) => {
        fetched.push(url)
        return { ok: true, json: async () => ({ user: { id: 'attacker' } }) }
      },
      { env: { NEXTAUTH_SECRET: 's' } }
    )
    const edgeRequest = (cookie: string) => ({
      nextUrl: { pathname: '/account' },
      url: 'https://victim.teleporthq.app/account',
      cookies: { get: () => undefined },
      headers: { get: (name: string) => (name === 'cookie' ? cookie : '') },
    })
    expect((await middleware(edgeRequest(planted))).kind).toBe('redirect')
    expect(fetched).toEqual([])
    expect((await middleware(edgeRequest('__Host-next-auth.session-token=mine'))).kind).toBe('next')
  })
})

describe('middleware matcher (Task 3b finding)', () => {
  it('leaves out only the API routes, never a page whose path starts with "api"', () => {
    const middleware = generateMiddlewareFile({
      ...AUTH,
      pageProtection: {
        p1: { requiresAuth: true, allowedRoles: ['admin'], pageName: 'Keys', route: '/api-keys' },
      },
    } as never)
    const matcher = /matcher: \['\/', '\/\(([^']*)\)'\]/.exec(middleware)
    expect(matcher).not.toBeNull()
    const pattern = new RegExp('^/(' + matcher![1].replace(/\\\\/g, '\\') + ')$')
    for (const page of ['/api-keys', '/apiary', '/about', '/api-keys/new']) {
      expect(pattern.test(page)).toBe(true)
    }
    for (const route of [
      '/api',
      '/api/',
      '/api/auth/session',
      '/_next/static/x.js',
      '/favicon.ico',
    ]) {
      expect(pattern.test(route)).toBe(false)
    }
  })
})

describe('peekRateLimitRequest (security runtime)', () => {
  const runtime = () => {
    const module = { exports: {} as any }
    // eslint-disable-next-line no-new-func
    new Function(
      'module',
      'exports',
      'require',
      'process',
      'console',
      'Buffer',
      generateSecurityRuntimeCode()
    )(
      module,
      module.exports,
      (id: string) =>
        id === 'crypto'
          ? nodeCrypto
          : id === 'net'
          ? net
          : (() => {
              throw new Error(id)
            })(),
      { env: {} },
      { warn: () => undefined, error: () => undefined, log: () => undefined },
      Buffer
    )
    return module.exports
  }

  it('reads what rateLimitRequest counted without counting itself', async () => {
    const security = runtime()
    const req = { headers: {}, socket: { remoteAddress: '203.0.113.9' } }
    const options = {
      scope: 'auth-signin-failures',
      limit: 2,
      windowSeconds: 900,
      keyParts: ['a@b.c'],
    }
    for (let i = 0; i < 5; i++) {
      expect((await security.peekRateLimitRequest(req, options)).allowed).toBe(true)
    }
    await security.rateLimitRequest(req, null, options)
    expect((await security.peekRateLimitRequest(req, options)).allowed).toBe(true)
    await security.rateLimitRequest(req, null, options)
    const refused = await security.peekRateLimitRequest(req, options)
    expect(refused.allowed).toBe(false)
    expect(refused.retryAfter).toBeGreaterThan(0)
    // Another email, or another visitor, has its own count.
    expect(
      (await security.peekRateLimitRequest(req, { ...options, keyParts: ['x@b.c'] })).allowed
    ).toBe(true)
    expect(
      (
        await security.peekRateLimitRequest(
          { headers: {}, socket: { remoteAddress: '203.0.113.10' } },
          options
        )
      ).allowed
    ).toBe(true)
  })

  it('refuses arguments that say nothing about what it limits', async () => {
    const security = runtime()
    await expect(
      security.peekRateLimitRequest({}, { scope: '', limit: 1, windowSeconds: 1 })
    ).rejects.toThrow(TypeError)
    await expect(
      security.peekRateLimitRequest({}, { scope: 's', limit: 0, windowSeconds: 1 })
    ).rejects.toThrow(TypeError)
  })
})

describe('review fix round 1: the session follows its account, by id', () => {
  const victimDb = () => {
    const db = new FakePostgres()
    db.users.push({ ...VICTIM, password: pepperedHash('Right#Pass1', ENV.AUTH_PEPPER_SECRET) })
    return db
  }

  // A password sign-in on one instance: its stamped token.
  const signedIn = async (db: FakePostgres) => {
    const options = loadApp({ db }).load('options')
    const user = await options.providers[0].authorize(
      { email: VICTIM.email, password: 'Right#Pass1' },
      { headers: {} }
    )
    const token: Row = { email: VICTIM.email, sub: VICTIM.id }
    await options.callbacks.jwt({ token, user })
    expect(typeof token.__sessionStamp).toBe('string')
    return { options, token }
  }

  const signedInRequest = {
    method: 'POST',
    headers: { host: 'shop.example', cookie: '__Host-next-auth.session-token=mine' },
    socket: { remoteAddress: '203.0.113.7' },
  }

  // `__tqSessionToken` of a route in pages/api/<folder>/, over one instance's
  // utils/auth/session-revocation.js; `decoded` is what the cookie decodes to.
  const sessionReader = (app: ReturnType<typeof loadApp>, decoded: Row) => {
    const module = { exports: {} as any }
    // eslint-disable-next-line no-new-func
    new Function(
      'require',
      'module',
      'exports',
      'process',
      generateCommonJsSessionTokenResolverCode('../../..') + '\nmodule.exports = __tqSessionToken;'
    )(
      (id: string) => {
        if (id === 'next-auth/jwt') {
          return { getToken: async () => ({ ...decoded }) }
        }
        if (id === '../../../utils/auth/session-revocation') {
          return app.load('revocation')
        }
        throw new Error('unexpected require: ' + id)
      },
      module,
      module.exports,
      { env: app.env }
    )
    return module.exports as (req: Row) => Promise<Row | null>
  }

  it('A1: a stamped session whose account cannot be read is no session, and account deletion answers 401', async () => {
    const db = victimDb()
    const { options, token } = await signedIn(db)
    db.failLookups = true
    // Another instance: nothing cached.
    const app = loadApp({ db })
    expect(await sessionReader(app, token)(signedInRequest)).toBeNull()

    const statements: string[] = []
    const module = { exports: {} as any }
    // eslint-disable-next-line no-new-func
    new Function(
      'require',
      'module',
      'exports',
      'process',
      'console',
      generateAccountDeleteRoute({})
    )(
      (id: string) => {
        if (id === 'pg') {
          return {
            Client: class {
              public async connect() {
                return undefined
              }
              public async end() {
                return undefined
              }
              public async query(sql: string) {
                statements.push(sql)
                return { rows: [] }
              }
            },
          }
        }
        if (id === 'next-auth/jwt') {
          return { getToken: async () => ({ ...token }) }
        }
        if (id === '../../../utils/auth/session-revocation') {
          return app.load('revocation')
        }
        if (id === '../../../utils/email/email-locale') {
          return { resolveRequestLocale: () => '' }
        }
        throw new Error('unexpected require: ' + id)
      },
      module,
      module.exports,
      { env: { ...app.env, TELEPORT_DB_CONNECTION_STRING: 'postgres://x' } },
      { error: () => undefined, warn: () => undefined, log: () => undefined }
    )
    const deleted = fakeResponse()
    await module.exports(signedInRequest, deleted)
    expect(deleted.statusCode).toBe(401)
    expect(statements.filter((sql) => sql.startsWith('DELETE'))).toEqual([])

    // /api/auth/session alone keeps the token through the hiccup.
    await expect(options.callbacks.jwt({ token, trigger: 'update' })).resolves.toBe(token)
    // No verdict was cached: once the store answers, the session counts again.
    db.failLookups = false
    expect(await sessionReader(app, token)(signedInRequest)).toMatchObject({ id: VICTIM.id })
  })

  it('A4: a deleted account ends its sessions', async () => {
    const db = victimDb()
    const { options, token } = await signedIn(db)
    db.users = []
    const app = loadApp({ db })
    expect(await app.load('revocation').liveSessionToken(token)).toBeNull()
    expect(await sessionReader(app, token)(signedInRequest)).toBeNull()
    await expect(options.callbacks.jwt({ token, trigger: 'update' })).rejects.toThrow(
      'SessionRevoked'
    )
  })

  it('A4: after an email change, a later password change still ends the earlier sessions', async () => {
    const db = victimDb()
    const { options, token } = await signedIn(db)
    db.users[0].email = 'renamed@site.test'
    await options.callbacks.jwt({ token, trigger: 'update' })
    expect(token).toMatchObject({ id: VICTIM.id, email: 'renamed@site.test' })
    expect(await sessionReader(loadApp({ db }), token)(signedInRequest)).toMatchObject({
      id: VICTIM.id,
      email: 'renamed@site.test',
    })

    db.users[0].password = pepperedHash('Other#Pass2', ENV.AUTH_PEPPER_SECRET)
    expect(await sessionReader(loadApp({ db }), token)(signedInRequest)).toBeNull()
    await expect(options.callbacks.jwt({ token, trigger: 'update' })).rejects.toThrow(
      'SessionRevoked'
    )
  })

  it('A4: a lowered role counts on the next request: the reader hands out the stored role, and the data API stops the staff bypass', async () => {
    const db = victimDb()
    const { token } = await signedIn(db)
    expect(token.role).toBe('admin')

    // A server segment acting for the signed-in visitor writes a role onto an account.
    const roleWrite = async (app: ReturnType<typeof loadApp>) => {
      const module = { exports: {} as any }
      // eslint-disable-next-line no-new-func
      new Function(
        'require',
        'module',
        'exports',
        'process',
        'console',
        generateDataAPIRoute({ authUsersTableName: 'users' })
      )(
        (id: string) => {
          if (id === 'pg') {
            return {
              Client: class {
                public async connect() {
                  return undefined
                }
                public async end() {
                  return undefined
                }
                public async query() {
                  return { rows: [], rowCount: 0 }
                }
              },
            }
          }
          if (id === 'next-auth/jwt') {
            return { getToken: async () => ({ ...token }) }
          }
          if (id === '../../../utils/auth/session-revocation') {
            return app.load('revocation')
          }
          if (/(^|\/)utils\/security-runtime$/.test(id)) {
            return app.load('runtime')
          }
          throw new Error('unexpected require: ' + id)
        },
        module,
        module.exports,
        { env: { ...app.env, TELEPORT_DB_CONNECTION_STRING: 'postgres://x' } },
        { error: () => undefined, warn: () => undefined, log: () => undefined }
      )
      const answer = fakeResponse()
      await module.exports(
        {
          method: 'POST',
          query: { params: ['ds-1', 'update'] },
          headers: {
            ...signedInRequest.headers,
            'x-internal-data-secret': app.env.NEXTAUTH_SECRET,
          },
          body: {
            tableName: 'users',
            columnMappings: { role: 'admin' },
            filters: [{ source: 'id', operand: '=', destination: 'u-other' }],
          },
        },
        answer
      )
      return answer
    }

    expect((await sessionReader(loadApp({ db }), token)(signedInRequest))!.role).toBe('admin')
    expect((await roleWrite(loadApp({ db }))).statusCode).not.toBe(403)

    db.users[0].role = 'user'
    // The token still says admin; the stored row does not.
    expect(token.role).toBe('admin')
    expect((await sessionReader(loadApp({ db }), token)(signedInRequest))!.role).toBe('user')
    const refused = await roleWrite(loadApp({ db }))
    expect(refused.statusCode).toBe(403)
  })
})

describe('review fix round 1: OAuth identities', () => {
  it('A2: an OAuth-only project keeps an unverified Microsoft email out of every local account', async () => {
    const auth = {
      ...AUTH,
      passwordAuthEnabled: false,
      providers: [
        {
          id: 'azure-ad',
          name: 'Azure AD',
          credentials: { AUTH_AZURE_AD_ID: '', AUTH_AZURE_AD_SECRET: '' },
        },
      ],
    } as UIDLAuthentication
    const db = new FakePostgres()
    db.users.push({ ...VICTIM, password: 'x' })
    const options = loadApp({ auth, db }).load('options')
    const token: Row = { email: VICTIM.email, sub: 'ms-1' }
    await options.callbacks.jwt({
      token,
      user: { id: 'ms-1', email: VICTIM.email },
      account: { provider: 'azure-ad', type: 'oauth', providerAccountId: 'ms-1' },
      profile: { email: VICTIM.email, tid: '11111111-2222-3333-4444-555555555555' },
    })
    await options.callbacks.jwt({ token, trigger: 'update' })
    expect(token.email).toBeUndefined()
    expect(token.role).toBeUndefined()
    expect(token.id).toBe('oauth:azure-ad:ms-1')
  })

  it('A2: an OAuth-only project keeps a verified Google sign-in as it was', async () => {
    const auth = {
      ...AUTH,
      passwordAuthEnabled: false,
      providers: [{ id: 'google', name: 'Google', credentials: {} }],
    } as UIDLAuthentication
    const options = loadApp({ auth }).load('options')
    const token: Row = { email: VICTIM.email, sub: 'g-1' }
    await options.callbacks.jwt({
      token,
      user: { id: 'g-1', email: VICTIM.email },
      account: { provider: 'google', type: 'oauth', providerAccountId: 'g-1' },
      profile: { email: VICTIM.email, email_verified: true },
    })
    expect(token.email).toBe(VICTIM.email)
    expect(token.id).toBe('g-1')
  })

  it('A7: a verified GitHub sign-in with no local account gets a namespaced id; with one, the local id', async () => {
    const auth = {
      ...AUTH,
      providers: [{ id: 'github', name: 'GitHub', credentials: {} }],
    } as UIDLAuthentication
    const signIn = async (withAccount: boolean) => {
      const db = new FakePostgres()
      if (withAccount) {
        db.users.push({ ...VICTIM, password: 'x' })
      }
      const options = loadApp({
        auth,
        db,
        fetch: async () => ({
          ok: true,
          json: async () => [{ email: VICTIM.email, verified: true, primary: true }],
        }),
      }).load('options')
      const token: Row = { email: VICTIM.email, sub: 'gh-1' }
      await options.callbacks.jwt({
        token,
        user: { id: 'gh-1', email: VICTIM.email },
        account: {
          provider: 'github',
          type: 'oauth',
          providerAccountId: 'gh-1',
          access_token: 't',
        },
        profile: { email: VICTIM.email },
      })
      await options.callbacks.jwt({ token, trigger: 'update' })
      return token
    }
    const without = await signIn(false)
    expect(without.id).toBe('oauth:github:gh-1')
    expect(without.role).toBeUndefined()
    expect(await signIn(true)).toMatchObject({ id: VICTIM.id, role: 'admin', email: VICTIM.email })
  })
})

describe('review fix round 1: reset links', () => {
  // Postgres's row lock, for the reset's one statement: an UPDATE of a row that
  // another open statement is updating waits for it, then re-checks its WHERE
  // against the row as that one left it (READ COMMITTED). The first statement
  // holds the row a moment, so the second arrives while it is locked.
  class RowLockingPostgres extends FakePostgres {
    public waited = 0
    private held = new Map<string, Promise<void>>()

    public query(sql: string, values: any[] = []): any {
      if (!sql.startsWith('WITH consumed AS (')) {
        return super.query(sql, values)
      }
      return this.locked(String(values[0]), () => super.query(sql, values))
    }

    private async locked(key: string, run: () => unknown) {
      while (this.held.has(key)) {
        this.waited++
        await this.held.get(key)
      }
      let release: () => void = () => undefined
      this.held.set(
        key,
        new Promise<void>((resolve) => {
          release = resolve
        })
      )
      try {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return run()
      } finally {
        this.held.delete(key)
        release()
      }
    }
  }

  it('A9: two simultaneous resets with one link set the password once', async () => {
    const db = new RowLockingPostgres()
    db.users.push({ ...VICTIM, password: pepperedHash('Original#1', ENV.AUTH_PEPPER_SECRET) })
    const app = loadApp({ db })
    await app.load('forgot')(request({ email: VICTIM.email }), fakeResponse())
    const link = tokenFromEmail(app.sent)
    const reset = app.load('reset')
    const first = fakeResponse()
    const second = fakeResponse()
    await Promise.all([
      reset(request({ token: link, password: 'First#Pass1' }, '203.0.113.21'), first),
      reset(request({ token: link, password: 'Second#Pass2' }, '203.0.113.22'), second),
    ])
    expect(db.waited).toBeGreaterThan(0)
    expect([first.body, second.body]).toContainEqual({ valid: true, changed: true })
    expect([first.body, second.body]).toContainEqual({ valid: false, changed: false })
    const winner = first.body.changed ? 'First#Pass1' : 'Second#Pass2'
    expect(db.users[0].password).toBe(pepperedHash(winner, ENV.AUTH_PEPPER_SECRET))
  })

  it('m2: the reset email carries the token in the fragment, and that link resets the password', async () => {
    const db = new FakePostgres()
    db.users.push({ ...VICTIM, password: pepperedHash('Original#1', ENV.AUTH_PEPPER_SECRET) })
    const app = loadApp({ db, tokenInFragment: true })
    await app.load('forgot')(request({ email: VICTIM.email }), fakeResponse())
    const mail = app.sent.find((entry) => entry.to)
    expect(String(mail!.html)).toMatch(
      /https:\/\/shop\.example\/reset-password#token=[0-9a-f]{64}"/
    )
    const answer = fakeResponse()
    await app.load('reset')(
      request({ token: tokenFromEmail(app.sent), password: 'Brand#New2' }),
      answer
    )
    expect(answer.body).toEqual({ valid: true, changed: true })
    // Without the option (a reset page that still reads the query), as before.
    expect(generateForgotPasswordRoute({})).toContain('var TOKEN_LINK_PREFIX = "?token=";')
  })

  it('m2: the project links with the fragment only when its reset page reads the kept token', async () => {
    const forgotRoute = async (readerCode: string) => {
      const files = new Map<string, any>()
      const structure = {
        uidl: {
          name: 'Shop',
          globals: { env: {} as Record<string, string> },
          authentication: AUTH,
          dataSources: {},
          workflows: {
            workflows: {
              forgot: {
                id: 'forgot',
                name: 'Forgot Password Flow',
                trigger: { type: 'event-element-clicked', nodeId: 't', config: {} },
                nodes: [
                  {
                    id: 'n1',
                    type: 'account-request-password-reset',
                    config: { email: 'x', emailProvider: 'email-resend' },
                  },
                ],
                edges: [],
              },
              resetPage: {
                id: 'resetPage',
                name: 'Reset Password Page Load',
                trigger: { type: 'event-page-loaded', nodeId: 't', config: {} },
                nodes: [{ id: 'n2', type: 'general-custom-js', config: { code: readerCode } }],
                edges: [],
              },
            },
          },
        },
        files,
        dependencies: {} as Record<string, string>,
        devDependencies: {},
        strategy: {},
      }
      await new NextWorkflowProjectPlugin().runAfter(structure as never)
      return files.get('auth-forgot-password-route')?.files?.[0]?.content as string
    }
    expect(await forgotRoute('sessionStorage.getItem("tq-reset-token")')).toContain(
      'var TOKEN_LINK_PREFIX = "#token=";'
    )
    expect(await forgotRoute('new URLSearchParams(location.search).get("token")')).toContain(
      'var TOKEN_LINK_PREFIX = "?token=";'
    )
  })
})

describe('review fix round 2 (A10): an OAuth id is namespaced only where it could collide', () => {
  const GITHUB = { id: 'github', name: 'GitHub', credentials: {} }
  const AZURE = {
    id: 'azure-ad',
    name: 'Azure AD',
    credentials: { AUTH_AZURE_AD_ID: '', AUTH_AZURE_AD_SECRET: '' },
  }
  const usersTable = (idType: string) => ({
    users: [
      { name: 'id', type: idType, nullable: false, isPrimaryKey: true },
      { name: 'email', type: 'VARCHAR(255)', nullable: true },
      { name: 'password', type: 'TEXT', nullable: true },
    ],
  })

  // A sign-in with no local account (no row), then a session refresh.
  const signIn = async (
    auth: UIDLAuthentication,
    provider: 'github' | 'azure-ad',
    providerAccountId: string
  ) => {
    const options = loadApp({
      auth,
      fetch: async () => ({
        ok: true,
        json: async () => [{ email: VICTIM.email, verified: true, primary: true }],
      }),
    }).load('options')
    const token: Row = { email: VICTIM.email, sub: providerAccountId }
    await options.callbacks.jwt({
      token,
      user: { id: providerAccountId, email: VICTIM.email },
      account: { provider, type: 'oauth', providerAccountId, access_token: 't' },
      // Azure AD: a multi-tenant token without xms_edov (not vouched for).
      profile: { email: VICTIM.email, tid: '11111111-2222-3333-4444-555555555555' },
    })
    await options.callbacks.jwt({ token, trigger: 'update' })
    return token
  }

  it('keeps the raw provider id on a UUID users table with one provider', async () => {
    const github = await signIn(
      { ...AUTH, providers: [GITHUB], tables: usersTable('UUID') } as UIDLAuthentication,
      'github',
      '583231'
    )
    expect(github.id).toBe('583231')
    expect(github.role).toBeUndefined()

    const azure = await signIn(
      {
        ...AUTH,
        passwordAuthEnabled: false,
        providers: [AZURE],
        tables: usersTable('uuid'),
      } as UIDLAuthentication,
      'azure-ad',
      'ms-1'
    )
    expect(azure.id).toBe('ms-1')
    expect(azure.email).toBeUndefined()
    expect(azure.role).toBeUndefined()
  })

  it('namespaces it on an integer users table, and with more than one provider', async () => {
    const integer = { ...AUTH, tables: usersTable('SERIAL') }
    expect(
      (await signIn({ ...integer, providers: [GITHUB] } as UIDLAuthentication, 'github', '583231'))
        .id
    ).toBe('oauth:github:583231')
    const azure = await signIn(
      { ...integer, passwordAuthEnabled: false, providers: [AZURE] } as UIDLAuthentication,
      'azure-ad',
      'ms-1'
    )
    expect(azure.id).toBe('oauth:azure-ad:ms-1')
    expect(azure.email).toBeUndefined()

    const twoProviders = {
      ...AUTH,
      providers: [GITHUB, AZURE],
      tables: usersTable('UUID'),
    } as UIDLAuthentication
    expect((await signIn(twoProviders, 'github', '583231')).id).toBe('oauth:github:583231')
    expect((await signIn(twoProviders, 'azure-ad', 'ms-1')).id).toBe('oauth:azure-ad:ms-1')
  })

  it('namespaces it where the users id type is unknown (fail-safe against a collision)', async () => {
    const undeclared = { ...AUTH, providers: [GITHUB], tables: {} } as UIDLAuthentication
    expect((await signIn(undeclared, 'github', '583231')).id).toBe('oauth:github:583231')
  })

  it('still adopts the local account of a verified email, whatever the id type', async () => {
    const db = new FakePostgres()
    db.users.push({ ...VICTIM, password: 'x' })
    const options = loadApp({
      auth: { ...AUTH, providers: [GITHUB], tables: usersTable('UUID') } as UIDLAuthentication,
      db,
      fetch: async () => ({
        ok: true,
        json: async () => [{ email: VICTIM.email, verified: true, primary: true }],
      }),
    }).load('options')
    const token: Row = { email: VICTIM.email, sub: '583231' }
    await options.callbacks.jwt({
      token,
      user: { id: '583231', email: VICTIM.email },
      account: {
        provider: 'github',
        type: 'oauth',
        providerAccountId: '583231',
        access_token: 't',
      },
      profile: { email: VICTIM.email },
    })
    await options.callbacks.jwt({ token, trigger: 'update' })
    expect(token).toMatchObject({ id: VICTIM.id, role: 'admin' })
  })
})

describe('review fix round 2b (A10): stores whose ids are their own keep the raw provider id', () => {
  const GITHUB = { id: 'github', name: 'GitHub', credentials: {} }
  const AZURE = {
    id: 'azure-ad',
    name: 'Azure AD',
    credentials: { AUTH_AZURE_AD_ID: '', AUTH_AZURE_AD_SECRET: '' },
  }
  // The stores' drivers, as far as loading auth-options needs them.
  const DRIVERS: Record<string, unknown> = {
    mongodb: {
      MongoClient: class {
        public async connect() {
          return this
        }
      },
      ObjectId: { isValid: () => false },
    },
    'firebase-admin': {
      apps: [],
      initializeApp: () => undefined,
      credential: { cert: () => ({}) },
      firestore: () => ({}),
    },
    airtable: class {
      public base() {
        return () => ({})
      }
    },
  }

  // A verified GitHub sign-in with no local account: the id it signs in with.
  const signInId = async (dataSourceType: string, providers: unknown[]) => {
    const options = loadApp({
      auth: { ...AUTH, dataSourceType, providers, tables: {} } as unknown as UIDLAuthentication,
      externals: DRIVERS,
      fetch: async () => ({
        ok: true,
        json: async () => [{ email: VICTIM.email, verified: true, primary: true }],
      }),
    }).load('options')
    const token: Row = { email: VICTIM.email, sub: '583231' }
    await options.callbacks.jwt({
      token,
      user: { id: '583231', email: VICTIM.email },
      account: {
        provider: 'github',
        type: 'oauth',
        providerAccountId: '583231',
        access_token: 't',
      },
      profile: { email: VICTIM.email },
    })
    return token.id
  }

  it('MongoDB with one provider keeps the raw id', async () => {
    expect(await signInId('mongodb', [GITHUB])).toBe('583231')
  })

  it('Airtable with one provider keeps the raw id', async () => {
    expect(await signInId('airtable', [GITHUB])).toBe('583231')
  })

  it('Firestore with one provider keeps the raw id', async () => {
    expect(await signInId('firestore', [GITHUB])).toBe('583231')
  })

  it('MongoDB with two providers namespaces it', async () => {
    expect(await signInId('mongodb', [GITHUB, AZURE])).toBe('oauth:github:583231')
  })

  it('a SQL store with no declared users id type still namespaces it', async () => {
    expect(await signInId('postgresql', [GITHUB])).toBe('oauth:github:583231')
  })
})

describe('review fix round 3 (A11): the users id type the editor read from the database decides', () => {
  const GITHUB = { id: 'github', name: 'GitHub', credentials: {} }
  // The UIDL as the editor now exports it: the id type the database reported, or none.
  const withLiveIdType = (idType: string) =>
    ({
      ...AUTH,
      providers: [GITHUB],
      tables: {
        users: [
          { name: 'id', type: idType, nullable: false, isPrimaryKey: true },
          { name: 'email', type: 'character varying', nullable: true },
        ],
      },
    } as UIDLAuthentication)

  const signInId = async (auth: UIDLAuthentication) => {
    const options = loadApp({
      auth,
      fetch: async () => ({
        ok: true,
        json: async () => [{ email: VICTIM.email, verified: true, primary: true }],
      }),
    }).load('options')
    const token: Row = { email: VICTIM.email, sub: '583231' }
    await options.callbacks.jwt({
      token,
      user: { id: '583231', email: VICTIM.email },
      account: {
        provider: 'github',
        type: 'oauth',
        providerAccountId: '583231',
        access_token: 't',
      },
      profile: { email: VICTIM.email },
    })
    await options.callbacks.jwt({ token, trigger: 'update' })
    return token.id
  }

  it('an existing integer users table namespaces the provider id', async () => {
    for (const idType of ['integer', 'bigint', 'int4']) {
      expect([idType, await signInId(withLiveIdType(idType))]).toEqual([
        idType,
        'oauth:github:583231',
      ])
    }
  })

  it('the UUID table the activation created keeps the raw provider id', async () => {
    expect(await signInId(withLiveIdType('uuid'))).toBe('583231')
  })

  it('no recorded type namespaces it', async () => {
    expect(await signInId(withLiveIdType(''))).toBe('oauth:github:583231')
  })
})
