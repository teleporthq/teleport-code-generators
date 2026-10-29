/* tslint:disable:max-classes-per-file */
import * as nodeCrypto from 'crypto'
import * as net from 'net'
import type { UIDLAuthentication } from '@teleporthq/teleport-types'
import {
  generateAuthDbHealthFile,
  generateAuthOptionsFile,
  generateHashPasswordFile,
  generateSignupRouteFile,
  SignupRouteOptions,
  WelcomeEmailOptions,
} from '../src/auth-generator'
import { generateResetPasswordRoute } from '../src/password-reset-route-generator'
import { generateSessionRevocationFile } from '../src/session-revocation-generator'
import { generateSecurityRuntimeCode } from '../src/security-runtime/security-runtime-code'
import { parse } from '@babel/parser'
import {
  EXISTING_ACCOUNT_EMAIL,
  SET_PASSWORD_EMAIL,
  SUPPORTED_EMAIL_PROVIDERS,
} from '../src/transactional-email-code'
import { accountLogin } from '../src/nodes/account/account-login'
import { accountSignup } from '../src/nodes/account/account-signup'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'

/**
 * Newsletter Phase 0 (Task 0a): sign-up for people the site already knows
 * without a password, and consent as the person gave it.
 *
 * A newsletter subscriber, a checkout or booking guest and a contact the owner
 * added are `users` rows with no password. Signing up with such an address was
 * answered "You already have an account" — wrong, they never had one. It must
 * still never hand the row to whoever typed the address: the mailbox owner is
 * sent a link to set a password (a password-reset link) instead. The page is
 * answered exactly as for an account, so it never tells a subscriber or a
 * guest from one, and the address is found in any letter case. Every new
 * account gets `source = 'signup'` and `marketing_consent` from the box,
 * never the column's TRUE default.
 *
 * The generated modules run against a fake Postgres that answers only the
 * statements below, with the real security runtime (in-memory limits).
 */

type Row = Record<string, any>

const sha256 = (value: string) => nodeCrypto.createHash('sha256').update(value).digest('hex')

// bcryptjs is not installed in the generator repo: a stand-in with its two calls.
const fakeBcrypt = {
  hashSync: (value: string) => 'bcrypt:' + sha256(value),
  compareSync: (value: string, hash: string) => hash === 'bcrypt:' + sha256(value),
}

interface Reset {
  token_hash: string
  user_id: string
  expires_at: number
  used_at: number | null
}

class FakePostgres {
  users: Row[] = []
  resets: Reset[] = []
  /** Columns this users table lacks: one made before they existed. */
  missingColumns: string[] = []
  /** Column defaults, for the columns an INSERT leaves out. */
  defaults: Row = {}
  now = Date.UTC(2026, 9, 26, 12)

  query(sql: string, values: any[] = []): { rows: Row[] } {
    if (
      /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) ||
      sql.startsWith('SELECT pg_advisory_xact_lock') ||
      sql.startsWith('CREATE TABLE IF NOT EXISTS teleport_password_resets') ||
      sql.startsWith('CREATE INDEX IF NOT EXISTS teleport_password_resets') ||
      sql.startsWith('DELETE FROM teleport_password_resets WHERE expires_at <')
    ) {
      return { rows: [] }
    }
    if (sql === 'SELECT * FROM users WHERE email = $1 LIMIT 1') {
      return { rows: this.users.filter((u) => u.email === values[0]).map((u) => ({ ...u })) }
    }
    if (sql === 'SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 2') {
      const folded = String(values[0]).toLowerCase()
      return {
        rows: this.users
          .filter((u) => String(u.email).toLowerCase() === folded)
          .slice(0, 2)
          .map((u) => ({ ...u })),
      }
    }
    if (sql.startsWith('INSERT INTO users (')) {
      const columns = /INSERT INTO users \(([^)]*)\)/.exec(sql)![1].split(', ')
      const missing = columns.find((column) => this.missingColumns.includes(column))
      if (missing) {
        throw Object.assign(new Error(`column "${missing}" of relation "users" does not exist`), {
          code: '42703',
        })
      }
      const row: Row = { id: 'u' + (this.users.length + 1), ...this.defaults }
      columns.forEach((column, index) => {
        row[column] = values[index]
      })
      this.users.push(row)
      return { rows: [{ ...row }] }
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
    if (sql.startsWith('WITH consumed AS ( UPDATE teleport_password_resets SET used_at = NOW()')) {
      const reset = this.resets.find(
        (r) => r.token_hash === values[0] && r.used_at === null && r.expires_at > this.now
      )
      const user = reset && this.users.find((u) => String(u.id) === reset.user_id)
      if (!reset || !user) {
        return { rows: [] }
      }
      reset.used_at = this.now
      user.password = values[1]
      return { rows: [{ id: user.id, email: user.email }] }
    }
    throw new Error('unexpected SQL: ' + sql)
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

const AUTH = {
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
  customUserProperties: [],
} as UIDLAuthentication

const ENV = {
  NEXTAUTH_SECRET: 'app-secret',
  DB_CONNECTION_STRING: 'postgres://fake',
  AUTH_PEPPER: 'project-id-1',
  AUTH_PEPPER_SECRET: 'per-project-random-pepper',
  NEXTAUTH_URL: 'https://shop.example',
  RESEND_KEY: 're_test_key',
}

const WELCOME: WelcomeEmailOptions = {
  emailProvider: 'resend',
  fromEmail: 'shop@brand.test',
  emailSecretEnvName: 'RESEND_KEY',
  emailSubject: 'Welcome',
  emailBodyHtml: '<p>Welcome {{userName}}</p>',
  siteName: 'Shop',
}

interface FakeResponse {
  statusCode: number
  body: any
  status: (code: number) => FakeResponse
  json: (body: unknown) => FakeResponse
  setHeader: () => void
}

const fakeResponse = (): FakeResponse => {
  const res: FakeResponse = {
    statusCode: 0,
    body: undefined,
    status: (code) => {
      res.statusCode = code
      return res
    },
    json: (body) => {
      res.body = body
      return res
    },
    setHeader: () => undefined,
  }
  return res
}

const request = (body: Row, ip = '203.0.113.7') => ({
  method: 'POST',
  headers: { host: 'shop.example' },
  socket: { remoteAddress: ip },
  body,
  query: {},
})

/** One app instance: the generated modules, required from each other as the files are. */
const loadApp = (
  options: {
    db?: FakePostgres
    welcome?: WelcomeEmailOptions
    signup?: SignupRouteOptions
    env?: Record<string, string>
  } = {}
) => {
  const db = options.db || new FakePostgres()
  const env = options.env || ENV
  const sent: Row[] = []
  const ledger: Row[] = []
  const delays: number[] = []
  const logs: unknown[][] = []
  // What bcrypt is asked to do: the cost of each hash it makes, and how many compares.
  const bcryptWork = { hashCosts: [] as number[], compares: 0 }
  const countingBcrypt = {
    hashSync: (value: string, cost: number) => {
      bcryptWork.hashCosts.push(cost)
      return fakeBcrypt.hashSync(value)
    },
    compareSync: (value: string, hash: string) => {
      bcryptWork.compares++
      return fakeBcrypt.compareSync(value, hash)
    },
  }
  const quiet = {
    error: (...args: unknown[]) => logs.push(args),
    warn: (...args: unknown[]) => logs.push(args),
    log: () => undefined,
    info: () => undefined,
  }
  const sources: Record<string, string> = {
    runtime: generateSecurityRuntimeCode(),
    hash: generateHashPasswordFile(),
    health: generateAuthDbHealthFile(),
    revocation: generateSessionRevocationFile(),
    options: generateAuthOptionsFile(AUTH, null),
    signup: generateSignupRouteFile(
      AUTH,
      options.welcome === undefined ? WELCOME : options.welcome,
      {},
      { fields: ['image'], ...(options.signup || {}) }
    ),
    reset: generateResetPasswordRoute(),
  }
  const external: Record<string, unknown> = {
    crypto: nodeCrypto,
    net,
    pg: pgFor(db),
    bcryptjs: countingBcrypt,
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
      recordSentEmail: (entry: Row) => ledger.push(entry),
      settleSentEmailLog: async () => undefined,
    },
  }
  const files: Record<string, string> = {
    '../security-runtime': 'runtime',
    '../../../utils/security-runtime': 'runtime',
    './hash-password': 'hash',
    '../../../utils/auth/hash-password': 'hash',
    './db-health': 'health',
    './session-revocation': 'revocation',
    './auth-options': 'options',
    '../../../utils/auth/auth-options': 'options',
  }
  const cache: Record<string, { exports: any }> = {}
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
      sources[name]
    )(module, module.exports, req, { env: { ...env } }, quiet, Buffer, setTimeoutShim)
    return module.exports
  }
  const signUp = async (body: Row, ip?: string) => {
    const res = fakeResponse()
    await load('signup')(request(body, ip), res)
    return res
  }
  /** The credentials sign-in (NextAuth's authorize): its error code, or 'ok'. */
  const signIn = async (email: string, password: string): Promise<string> => {
    const req = request({ email, password })
    try {
      await load('options').providers[0].authorize({ email, password }, req)
      return 'ok'
    } catch (err) {
      return (err as Error).message
    }
  }
  return { db, sent, ledger, delays, logs, load, signUp, signIn, sources, bcryptWork }
}

const SUBSCRIBER = {
  id: 'u-sub',
  email: 'sub@site.test',
  name: null,
  password: null,
  provider: null,
  role: 'user',
  source: 'newsletter',
  marketing_consent: true,
}

const withSubscriber = (row: Row = SUBSCRIBER) => {
  const db = new FakePostgres()
  db.users.push({ ...row })
  return db
}

const linkIn = (mail: Row | undefined): string => {
  const match = /href="([^"]+)"/.exec(String(mail && mail.html))
  return match ? match[1] : ''
}

describe('the generated sign-up route', () => {
  const auth = AUTH
  const welcome = WELCOME
  const events = {}
  const signup: SignupRouteOptions = { fields: ['image'] }

  it('signup writes source=signup and explicit consent from the checkbox', () => {
    const src = generateSignupRouteFile(auth, welcome, events, signup)
    expect(src).toContain(`source: 'signup'`)
    expect(src).toContain(`marketing_consent: body.marketing_consent === 'true'`)
  })

  it('signup on a password-less row sends the set-password email, never claims the row', () => {
    const src = generateSignupRouteFile(auth, welcome, events, signup)
    expect(src).toContain('sendSetPasswordEmail(')
    expect(src).not.toContain('UPDATE users SET password')
  })

  it('writes no newsletter state: a ticked box subscribes through the newsletter helper', () => {
    expect(generateSignupRouteFile(auth, welcome, events, signup)).not.toContain('newsletter_')
  })

  it('answers every address the site already knows alike, with no flag', () => {
    const src = generateSignupRouteFile(auth, welcome, events, signup)
    expect(src).not.toContain('setPassword')
    expect(src).toContain('const existing = await findSignupUserByEmail(email);')
  })
})

describe('sign-up writes where the person came from, and their consent as given', () => {
  it('an unticked box, or a form without one, is an explicit no', async () => {
    const app = loadApp()
    expect((await app.signUp({ email: 'a@site.test', password: 'Passw0rd!' })).statusCode).toBe(201)
    expect(
      (
        await app.signUp({
          email: 'b@site.test',
          password: 'Passw0rd!',
          marketing_consent: 'false',
        })
      ).statusCode
    ).toBe(201)
    for (const row of app.db.users) {
      expect(row).toMatchObject({ source: 'signup', marketing_consent: false, role: 'user' })
      expect(row).not.toHaveProperty('newsletter_status')
    }
  })

  it('a ticked box is consent', async () => {
    const app = loadApp()
    await app.signUp({ email: 'a@site.test', password: 'Passw0rd!', marketing_consent: 'true' })
    expect(app.db.users[0]).toMatchObject({ source: 'signup', marketing_consent: true })
    expect(app.db.users[0]).not.toHaveProperty('newsletter_status')
  })

  it('takes neither raw from the body, even as declared fields', async () => {
    const app = loadApp({ signup: { fields: ['image', 'source', 'marketing_consent'] } })
    await app.signUp({
      email: 'a@site.test',
      password: 'Passw0rd!',
      source: 'import',
      marketing_consent: 'yes',
    })
    expect(app.db.users[0]).toMatchObject({ source: 'signup', marketing_consent: false })
  })

  it('still signs the person up on a users table made before these columns', async () => {
    const db = new FakePostgres()
    db.missingColumns = ['source', 'marketing_consent']
    const app = loadApp({ db })
    const res = await app.signUp({ email: 'old@site.test', password: 'Passw0rd!' })
    expect(res.statusCode).toBe(201)
    expect(app.db.users).toHaveLength(1)
    expect(app.db.users[0]).toMatchObject({ email: 'old@site.test', role: 'user' })
    expect(app.db.users[0]).not.toHaveProperty('source')
    expect(JSON.stringify(app.logs)).toContain('the account is created without it')
  })

  it('leaves out only the column the table lacks: a consent column defaulting to TRUE still gets the no', async () => {
    const db = new FakePostgres()
    db.missingColumns = ['source']
    db.defaults = { marketing_consent: true }
    const app = loadApp({ db })
    const res = await app.signUp({ email: 'old@site.test', password: 'Passw0rd!' })
    expect(res.statusCode).toBe(201)
    expect(app.db.users).toHaveLength(1)
    expect(app.db.users[0]).toMatchObject({ email: 'old@site.test', marketing_consent: false })
    expect(app.db.users[0]).not.toHaveProperty('source')
    expect(JSON.stringify(app.logs)).toContain('the users table has no source column yet')
  })
})

describe('sign-up on an address the site knows without a password', () => {
  it('mails its owner a link to set a password, and never takes the row', async () => {
    const app = loadApp({ db: withSubscriber() })
    const res = await app.signUp({ email: SUBSCRIBER.email, password: 'Passw0rd!', name: 'Eve' })

    expect(res.statusCode).toBe(201)
    expect(res.body).toEqual({ user: { email: SUBSCRIBER.email, name: 'Eve' } })
    // The row is as it was: no password, no name, nothing the visitor typed.
    expect(app.db.users).toEqual([SUBSCRIBER])

    const mails = app.sent
    expect(mails.map((mail) => mail.to)).toEqual([[SUBSCRIBER.email]])
    expect(mails[0].subject).toBe('Set your password to finish creating your account')
    const link = linkIn(mails[0])
    expect(link).toMatch(/^https:\/\/shop\.example\/reset-password\?token=[0-9a-f]{64}$/)
    const token = link.split('token=')[1]
    expect(app.db.resets).toEqual([
      expect.objectContaining({ token_hash: sha256(token), user_id: 'u-sub', used_at: null }),
    ])

    // The sent-email log keeps the email with the link hidden.
    expect(app.ledger).toHaveLength(1)
    expect(app.ledger[0]).toMatchObject({
      emailType: SET_PASSWORD_EMAIL,
      to: SUBSCRIBER.email,
      status: 'sent',
      source: 'signup',
      userId: 'u-sub',
    })
    expect(JSON.stringify(app.ledger)).not.toContain(token)
    expect(app.ledger[0].html).toContain('[hidden]')

    // Like the forgot-password answer, it takes at least 1200 ms.
    expect(Math.max(...app.delays)).toBeGreaterThan(1000)

    // The link is a reset link: it sets the password, once.
    const reset = fakeResponse()
    await app.load('reset')(request({ token, password: 'Mine#Pass1' }), reset)
    expect(reset.body).toEqual({ valid: true, changed: true })
    expect(app.db.users[0].password).toBeTruthy()
    expect(app.db.users[0].name).toBeNull()
  })

  it('opens the project reset page, with the token in the fragment where the page reads it there', async () => {
    const app = loadApp({
      db: withSubscriber(),
      signup: { resetPagePath: '/account/new-password', tokenInFragment: true },
    })
    await app.signUp({ email: SUBSCRIBER.email, password: 'Passw0rd!' })
    expect(linkIn(app.sent[0])).toMatch(
      /^https:\/\/shop\.example\/account\/new-password#token=[0-9a-f]{64}$/
    )
  })

  it('sends one address at most 3 links an hour, answering the same', async () => {
    const app = loadApp({ db: withSubscriber() })
    for (let i = 0; i < 5; i++) {
      const res = await app.signUp(
        { email: SUBSCRIBER.email, password: 'Passw0rd!' },
        '198.51.100.' + (i + 30)
      )
      expect(res.statusCode).toBe(201)
      expect(res.body).toEqual({ user: { email: SUBSCRIBER.email, name: null } })
    }
    expect(app.sent).toHaveLength(3)
    expect(app.db.users).toEqual([SUBSCRIBER])
  })

  it('without an email provider sends nothing and answers the same', async () => {
    const app = loadApp({ db: withSubscriber(), welcome: {} })
    const res = await app.signUp({ email: SUBSCRIBER.email, password: 'Passw0rd!' })
    expect(res.statusCode).toBe(201)
    expect(res.body).toEqual({ user: { email: SUBSCRIBER.email, name: null } })
    expect(app.sent).toEqual([])
    expect(app.db.resets).toEqual([])
    expect(JSON.stringify(app.logs)).toContain('set-password link not sent')
  })

  it('without a sign-up sender, mails through the forgot-password one', async () => {
    const noticeEmail = {
      emailProvider: 'resend',
      fromEmail: 'reset@brand.test',
      emailSecretEnvName: 'RESEND_KEY',
    }
    const subscriber = loadApp({ db: withSubscriber(), welcome: {}, signup: { noticeEmail } })
    await subscriber.signUp({ email: SUBSCRIBER.email, password: 'Passw0rd!' })
    expect(subscriber.sent.map((mail) => [mail.from, mail.to, mail.subject])).toEqual([
      ['reset@brand.test', [SUBSCRIBER.email], 'Set your password to finish creating your account'],
    ])
    expect(subscriber.ledger).toEqual([
      expect.objectContaining({ emailType: SET_PASSWORD_EMAIL, provider: 'resend' }),
    ])

    const account = loadApp({
      db: withSubscriber({ ...SUBSCRIBER, password: 'bcrypt:x' }),
      welcome: {},
      signup: { noticeEmail },
    })
    await account.signUp({ email: SUBSCRIBER.email, password: 'Passw0rd!' })
    expect(account.sent.map((mail) => [mail.from, mail.subject])).toEqual([
      ['reset@brand.test', 'You already have an account'],
    ])

    // The welcome email keeps the sign-up node's sender: none here.
    const fresh = loadApp({ welcome: {}, signup: { noticeEmail } })
    await fresh.signUp({ email: 'new@site.test', password: 'Passw0rd!' })
    expect(fresh.sent).toEqual([])
  })

  it('where reset links cannot be kept (not Postgres), tells the owner the address is known', async () => {
    const app = loadApp({ db: withSubscriber() })
    app.load('options').PASSWORD_RESET_SUPPORTED = false
    const res = await app.signUp({ email: SUBSCRIBER.email, password: 'Passw0rd!' })
    expect(res.body).toEqual({ user: { email: SUBSCRIBER.email, name: null } })
    expect(app.sent.map((mail) => [mail.to, mail.subject])).toEqual([
      [[SUBSCRIBER.email], 'You already have an account'],
    ])
    expect(app.ledger.map((entry) => entry.emailType)).toEqual([EXISTING_ACCOUNT_EMAIL])
    expect(app.db.resets).toEqual([])
    expect(app.db.users).toEqual([SUBSCRIBER])
  })

  it('an account (a password, or an OAuth sign-in) is still told it already has one, under its own purpose', async () => {
    for (const row of [
      { ...SUBSCRIBER, password: 'bcrypt:x' },
      { ...SUBSCRIBER, provider: 'google' },
    ]) {
      const app = loadApp({ db: withSubscriber(row) })
      const res = await app.signUp({ email: SUBSCRIBER.email, password: 'Passw0rd!', name: 'Eve' })
      expect(res.statusCode).toBe(201)
      expect(res.body).toEqual({ user: { email: SUBSCRIBER.email, name: 'Eve' } })
      expect(app.sent.map((mail) => mail.subject)).toEqual(['You already have an account'])
      expect(app.ledger).toEqual([
        expect.objectContaining({
          emailType: EXISTING_ACCOUNT_EMAIL,
          to: SUBSCRIBER.email,
          subject: 'You already have an account',
          status: 'sent',
          userId: 'u-sub',
        }),
      ])
      expect(app.db.resets).toEqual([])
      expect(app.db.users).toEqual([row])
    }
  })

  it('answers a password-less row exactly as it answers an account, in the same time', async () => {
    const account = loadApp({ db: withSubscriber({ ...SUBSCRIBER, password: 'bcrypt:x' }) })
    const subscriber = loadApp({ db: withSubscriber() })
    const body = { email: SUBSCRIBER.email, password: 'Passw0rd!', name: 'Eve' }
    const toAccount = await account.signUp(body)
    const toSubscriber = await subscriber.signUp(body)

    expect(toSubscriber.statusCode).toBe(toAccount.statusCode)
    expect(JSON.stringify(toSubscriber.body)).toBe(JSON.stringify(toAccount.body))
    // Each email went out, under its own purpose.
    expect(account.ledger.map((entry) => entry.emailType)).toEqual([EXISTING_ACCOUNT_EMAIL])
    expect(subscriber.ledger.map((entry) => entry.emailType)).toEqual([SET_PASSWORD_EMAIL])
    // Both wait out the same minimum.
    expect(Math.max(...account.delays)).toBeGreaterThan(1000)
    expect(Math.max(...subscriber.delays)).toBeGreaterThan(1000)
  })
})

describe('sign-up finds the address in any letter case', () => {
  it('reaches the row of the same address typed in another case, and never makes a second one', async () => {
    const subscriber = loadApp({ db: withSubscriber() })
    const res = await subscriber.signUp({ email: 'Sub@Site.TEST', password: 'Passw0rd!' })
    expect(res.body).toEqual({ user: { email: 'Sub@Site.TEST', name: null } })
    expect(subscriber.db.users).toEqual([SUBSCRIBER])
    // The link goes to the address the row holds.
    expect(subscriber.sent.map((mail) => mail.to)).toEqual([[SUBSCRIBER.email]])
    expect(subscriber.sent[0].subject).toBe('Set your password to finish creating your account')

    const account = loadApp({ db: withSubscriber({ ...SUBSCRIBER, password: 'bcrypt:x' }) })
    await account.signUp({ email: 'SUB@site.test', password: 'Passw0rd!' })
    expect(account.db.users).toHaveLength(1)
    expect(account.sent.map((mail) => [mail.to, mail.subject])).toEqual([
      [[SUBSCRIBER.email], 'You already have an account'],
    ])
  })

  it('prefers the exact address, and takes no row when the case-blind match is ambiguous', async () => {
    const db = new FakePostgres()
    db.users.push({ ...SUBSCRIBER, id: 'u-upper', email: 'Sub@site.test', password: 'bcrypt:x' })
    db.users.push({ ...SUBSCRIBER })
    const exact = loadApp({ db })
    await exact.signUp({ email: SUBSCRIBER.email, password: 'Passw0rd!' })
    expect(exact.sent.map((mail) => mail.subject)).toEqual([
      'Set your password to finish creating your account',
    ])

    const ambiguous = loadApp({ db })
    const res = await ambiguous.signUp({ email: 'SUB@SITE.TEST', password: 'Passw0rd!' })
    expect(res.statusCode).toBe(201)
    expect(db.users.map((user) => user.email)).toEqual([
      'Sub@site.test',
      SUBSCRIBER.email,
      'SUB@SITE.TEST',
    ])
  })

  it('sign-in keeps its exact lookup; stores other than Postgres keep theirs for sign-up too', () => {
    const postgres = generateAuthOptionsFile(AUTH, null)
    const signIn = /async function findUserByEmail\(email\) \{[\s\S]*?\n\}/.exec(postgres)![0]
    expect(signIn).toContain("'SELECT * FROM users WHERE email = $1 LIMIT 1'")
    expect(signIn).not.toContain('LOWER')
    expect(postgres).toContain('module.exports.findSignupUserByEmail = findSignupUserByEmail;')

    const mysql = generateAuthOptionsFile({ ...AUTH, dataSourceType: 'mysql' }, null)
    expect(mysql).toContain(
      'async function findSignupUserByEmail(email) {\n  return findUserByEmail(email);\n}'
    )
    expect(mysql).not.toContain('LOWER(email)')
  })
})

describe('the account-signup step', () => {
  it('when no session follows an answered sign-up, says one thing whatever the address was', async () => {
    const source = accountSignup.generateHandler()
    expect(source).not.toContain('setPassword')
    const calls: string[] = []
    const fakeFetch = async (url: string) => {
      calls.push(url)
      return url === '/api/auth/session'
        ? { ok: true, json: async () => ({}) }
        : { ok: true, json: async () => ({ user: { email: 'sub@site.test', name: null } }) }
    }
    const signInFails = {
      __teleportNextAuth: { signIn: async () => ({ error: 'CredentialsSignin' }) },
    }
    const noSession = { __teleportNextAuth: { signIn: async () => ({ error: null }) } }
    // A wrong password for an account, a row without one, no session, sign-in not loaded yet.
    for (const window of [signInFails, noSession, undefined]) {
      // eslint-disable-next-line no-new-func
      const handler = new Function('fetch', 'window', `${source}\nreturn account_signup;`)(
        fakeFetch,
        window
      )
      await expect(handler({ email: 'sub@site.test', password: 'Passw0rd!' }, {})).rejects.toThrow(
        'Check your inbox — we sent an email about this address.'
      )
    }
    expect(calls.filter((url) => url === '/api/auth/signup')).toHaveLength(3)
  })

  it('sends the consent box as the route reads it: "true" when ticked, else "false"', async () => {
    const source = accountSignup.generateHandler()
    const bodies: Row[] = []
    const fakeFetch = async (url: string, init?: { body: string }) => {
      if (url === '/api/auth/signup' && init) {
        bodies.push(JSON.parse(init.body))
      }
      return { ok: true, json: async () => ({}) }
    }
    // eslint-disable-next-line no-new-func
    const handler = new Function('fetch', 'window', `${source}\nreturn account_signup;`)(
      fakeFetch,
      undefined
    )
    const values: unknown[] = [true, 'true', 'on', false, 'false', 'off', '', null, 'yes']
    for (const value of values) {
      await handler(
        { email: 'a@site.test', password: 'Passw0rd!', marketing_consent: value },
        {}
      ).catch(() => undefined)
    }
    await handler({ email: 'a@site.test', password: 'Passw0rd!' }, {}).catch(() => undefined)
    expect(bodies.map((body) => body.marketing_consent)).toEqual([
      'true',
      'true',
      'true',
      'false',
      'false',
      'false',
      'false',
      'false',
      'false',
      undefined,
    ])
  })

  const loadServerSignup = (existing: Row | null) => {
    const created: Row[] = []
    const looked: string[] = []
    const modules: Record<string, unknown> = {
      '../../../utils/auth/hash-password': Object.assign((p: string) => 'hashed:' + p, {
        passwordPolicyError: () => '',
      }),
      '../../../utils/auth/auth-options': {
        findSignupUserByEmail: async (email: string) => {
          looked.push(email)
          return existing
        },
        createUser: async (data: Row) => {
          created.push(data)
          return { id: 'u1', ...data }
        },
        sanitizeUser: (user: Row) => ({ id: user.id, email: user.email }),
      },
    }
    // eslint-disable-next-line no-new-func
    const handler = new Function(
      'require',
      `${accountSignup.generateServerHandler!({})}\nreturn account_signup;`
    )((id: string) => modules[id])
    return { handler, created, looked }
  }

  it('run on the server, writes where the person came from and their consent as given', async () => {
    const { handler, created } = loadServerSignup(null)
    await handler({ email: 'a@site.test', password: 'Passw0rd!' }, {})
    await handler(
      {
        email: 'b@site.test',
        password: 'Passw0rd!',
        marketing_consent: 'true',
        source: 'import',
      },
      {}
    )
    await handler({ email: 'c@site.test', password: 'Passw0rd!', marketing_consent: true }, {})
    expect(created[0]).toMatchObject({ source: 'signup', marketing_consent: false })
    expect(created[1]).toMatchObject({ source: 'signup', marketing_consent: true })
    expect(created[2]).toMatchObject({ marketing_consent: true })
  })

  it('run on the server, refuses any address the site knows with one message, in any letter case', async () => {
    for (const existing of [{ ...SUBSCRIBER, password: 'bcrypt:x' }, { ...SUBSCRIBER }]) {
      const { handler, created, looked } = loadServerSignup(existing)
      await expect(handler({ email: 'Sub@Site.test', password: 'Passw0rd!' }, {})).rejects.toThrow(
        /^This email cannot be used to create an account here\.$/
      )
      expect(looked).toEqual(['Sub@Site.test'])
      expect(created).toEqual([])
    }
  })
})

describe('every failed sign-in does the same bcrypt work', () => {
  const ACCOUNT = { ...SUBSCRIBER, id: 'u-acc', email: 'acc@site.test', password: 'bcrypt:other' }
  const attempts = [
    ['an unknown address', 'nobody@site.test'],
    ['a row without a password', SUBSCRIBER.email],
    ['an account, with a wrong password', ACCOUNT.email],
  ]

  for (const [label, env] of [
    ['with the project pepper', ENV],
    ['on the old pepper only', { ...ENV, AUTH_PEPPER_SECRET: '' }],
  ] as Array<[string, Record<string, string>]>) {
    it(label, async () => {
      const db = withSubscriber()
      db.users.push({ ...ACCOUNT })
      const app = loadApp({ db, env })
      // The stand-in hash is made once per process, at the cost of a real one.
      await app.signIn('warm-up@site.test', 'Wrong#Pass1')
      expect(app.bcryptWork.hashCosts).toEqual([12])

      const compares: Record<string, number> = {}
      for (const [what, email] of attempts) {
        const before = app.bcryptWork.compares
        expect(await app.signIn(email, 'Wrong#Pass1')).toBe('InvalidCredentials')
        compares[what] = app.bcryptWork.compares - before
      }
      const expected = env.AUTH_PEPPER_SECRET ? 2 : 1
      expect(compares).toEqual({
        'an unknown address': expected,
        'a row without a password': expected,
        'an account, with a wrong password': expected,
      })
      expect(app.bcryptWork.hashCosts).toEqual([12])
    })
  }

  it('the server-run sign-in step too', async () => {
    const db = withSubscriber()
    db.users.push({ ...ACCOUNT })
    const app = loadApp({ db })
    const modules: Record<string, unknown> = {
      '../../../utils/auth/hash-password': app.load('hash'),
      '../../../utils/auth/auth-options': app.load('options'),
      '../../../utils/security-runtime': app.load('runtime'),
    }
    // eslint-disable-next-line no-new-func
    const login = new Function(
      'require',
      `${accountLogin.generateServerHandler!({})}\nreturn account_login;`
    )((id: string) => modules[id])
    const counts: number[] = []
    for (const [, email] of attempts) {
      const before = app.bcryptWork.compares
      await expect(login({ email, password: 'Wrong#Pass1' }, {})).rejects.toThrow(
        'Invalid email or password'
      )
      counts.push(app.bcryptWork.compares - before)
    }
    expect(counts).toEqual([2, 2, 2])
  })
})

describe('project wiring', () => {
  const secret = { type: 'dynamic', content: { referenceType: 'secret', id: 'RESEND_KEY' } }
  const SIGNUP_NODE_EMAIL = {
    emailProvider: 'email-resend',
    from: 'shop@brand.test',
    apiKey: secret,
    subject: 'Welcome',
    body: '<p>Welcome</p>',
  }

  /** The project plugin's files for a sign-up node with `signupEmail` and a reset node with a sender. */
  const runPluginFiles = async (signupEmail: Row) => {
    const files = new Map<string, any>()
    const node = (id: string, type: string, config: Row) => ({ id, type, config })
    const structure = {
      uidl: {
        name: 'Shop',
        globals: { env: {} as Record<string, string> },
        authentication: AUTH,
        dataSources: {},
        workflows: {
          workflows: {
            signup: {
              id: 'signup',
              name: 'Sign Up Flow',
              trigger: { type: 'event-element-clicked', nodeId: 't', config: {} },
              nodes: [node('s1', 'account-signup', { email: 'x', password: 'y', ...signupEmail })],
              edges: [],
            },
            forgot: {
              id: 'forgot',
              name: 'Forgot Password Flow',
              trigger: { type: 'event-element-clicked', nodeId: 't', config: {} },
              nodes: [
                node('f1', 'account-request-password-reset', {
                  email: 'x',
                  emailProvider: 'email-resend',
                  from: 'reset@brand.test',
                  apiKey: secret,
                  resetPagePath: '/account/new-password',
                }),
              ],
              edges: [],
            },
            reset: {
              id: 'reset',
              name: 'Reset Password Flow',
              trigger: { type: 'event-page-loaded', nodeId: 'p', config: {} },
              nodes: [
                node('r1', 'general-custom-js', {
                  code: 'function customHandler() { return sessionStorage.getItem("tq-reset-token"); }',
                }),
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
    return files
  }

  const runPlugin = async (signupEmail: Row) => {
    const files = await runPluginFiles(signupEmail)
    return (key: string) => files.get(key)?.files?.[0]?.content as string
  }

  it('the set-password link opens the page the reset link opens, as the forgot route builds it', async () => {
    const content = await runPlugin(SIGNUP_NODE_EMAIL)
    expect(content('auth-forgot-password-route')).toContain(
      'var RESET_PAGE_PATH = "/account/new-password";'
    )
    expect(content('auth-forgot-password-route')).toContain('var TOKEN_LINK_PREFIX = "#token=";')
    expect(content('auth-signup-route')).toContain(
      'var SET_PASSWORD_PAGE_PATH = "/account/new-password";'
    )
    expect(content('auth-signup-route')).toContain(
      'var SET_PASSWORD_TOKEN_LINK_PREFIX = "#token=";'
    )
    // The sign-up node's sender is the known-address sender.
    expect(content('auth-signup-route')).toContain('const NOTICE_EMAIL_FROM = "shop@brand.test";')
  })

  it('without a sign-up sender, the known-address emails use the forgot-password one', async () => {
    const content = await runPlugin({})
    expect(content('auth-signup-route')).toContain('const WELCOME_EMAIL_PROVIDER = null;')
    expect(content('auth-signup-route')).toContain('const NOTICE_EMAIL_PROVIDER = "resend";')
    expect(content('auth-signup-route')).toContain('const NOTICE_EMAIL_FROM = "reset@brand.test";')
    expect(content('auth-signup-route')).toContain(
      'const NOTICE_EMAIL_SECRET_ENV_NAME = "RESEND_KEY";'
    )
  })

  // Next compiles a route as a module, where a function declared twice fails
  // the build: the welcome send and the known-address send once both brought
  // `__emailSender`.
  it.each(Array.from(SUPPORTED_EMAIL_PROVIDERS))(
    'every file compiles as a module, with and without a sign-up sender (%s)',
    async (provider) => {
      for (const signupEmail of [
        { ...SIGNUP_NODE_EMAIL, emailProvider: `email-${provider}` },
        {},
      ]) {
        const files = await runPluginFiles(signupEmail)
        expect(files.has('auth-signup-route')).toBe(true)
        const failures: string[] = []
        files.forEach((file, key) => {
          for (const emitted of file.files || []) {
            try {
              parse(emitted.content, { sourceType: 'module', plugins: ['jsx'] })
            } catch (err) {
              failures.push(`${key}: ${(err as Error).message}`)
            }
          }
        })
        expect(failures).toEqual([])
      }
    }
  )
})
