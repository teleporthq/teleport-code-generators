/* tslint:disable:max-classes-per-file */
import * as nodeCrypto from 'crypto'
import type { UIDLNewsletterSettings } from '@teleporthq/teleport-types'
import { NextNewsletterProjectPlugin } from '../src/newsletter/project-plugin'
import {
  NEWSLETTER_SQL,
  generateNewsletterHelperCode,
  newsletterTokenSpec,
} from '../src/newsletter/helper-code'
import {
  generateNewsletterConfirmRoute,
  generateNewsletterSubscribeRoute,
  generateNewsletterUnsubscribeRoute,
} from '../src/newsletter/routes-code'
import { nodeRegistry } from '../src/nodes'
import { needsVisitorRequest } from '../src/nodes/general/visitor-request'
import { generateSignupRouteFile } from '../src/auth-generator'
import { newsletterSignupSubscribes } from '../src/newsletter/newsletter-scope'
import { buildVisitorStepLimitGuard } from '../src/visitor-step-limits'
import { isCostBearingNodeType } from '../src/nodes/cost-bearing-node-types'
import { assertWorkflowPublishGates, collectWorkflowPublishRefusals } from '../src/publish-refusals'
import type { WorkflowSegment } from '../src/types'
import { loadHandler } from './_helpers/load-handler'

/**
 * Newsletter Task 2: the generated helper (`utils/newsletter/newsletter.js`),
 * the public routes and the three nodes.
 *
 * The helper runs against a fake `users` table that answers exactly the
 * statements it is generated with (`NEWSLETTER_SQL`), with every module it
 * requires stubbed: the security runtime (limits counted in memory), the email
 * locale, the sent-email log, the provider and the event bus.
 */

type Row = Record<string, any>

const SECRET = newsletterTokenSpec.testVector.secret
const MINUTE = 60 * 1000

class FakeUsers {
  rows: Row[] = []
  queries: Array<{ sql: string; values: unknown[] }> = []
  /** The next statement fails with this (a pg error). */
  failWith: Row | null = null
  private nextId = 1

  public async query(sql: string, values: any[] = []): Promise<{ rows: Row[] }> {
    this.queries.push({ sql, values })
    if (this.failWith) {
      throw Object.assign(new Error(this.failWith.message), this.failWith)
    }
    const person = (row: Row | undefined) =>
      row
        ? [
            {
              id: row.id,
              email: row.email,
              source: row.source ?? null,
              email_unsubscribed: row.email_unsubscribed ?? false,
              newsletter_status: row.newsletter_status ?? null,
              newsletter_source: row.newsletter_source ?? null,
              newsletter_unsubscribed_at: row.newsletter_unsubscribed_at ?? null,
            },
          ]
        : []
    const byId = (id: unknown) => this.rows.find((row) => row.id === id)
    switch (sql) {
      case NEWSLETTER_SQL.findPerson: {
        const matches = this.rows.filter((row) => String(row.email).toLowerCase() === values[0])
        const exact = matches.find((row) => row.email === values[0])
        return { rows: person(exact || matches[0]) }
      }
      case NEWSLETTER_SQL.insertPending:
      case NEWSLETTER_SQL.insertSubscribed: {
        const subscribed = sql === NEWSLETTER_SQL.insertSubscribed
        const row: Row = {
          id: 'u' + this.nextId++,
          email: values[0],
          source: values[1],
          marketing_consent: subscribed,
          email_unsubscribed: false,
          newsletter_status: subscribed ? 'subscribed' : 'pending',
          newsletter_source: values[2],
          newsletter_subscribed_at: subscribed ? new Date() : null,
        }
        this.rows.push(row)
        return { rows: person(row) }
      }
      case NEWSLETTER_SQL.markPending:
      case NEWSLETTER_SQL.markSubscribed: {
        const row = byId(values[0])
        // The statements' guard (asserted as text below): never on the list, or
        // pending, and not opted out of email.
        if (
          !row ||
          (row.newsletter_status != null && row.newsletter_status !== 'pending') ||
          row.email_unsubscribed === true
        ) {
          return { rows: [] }
        }
        row.newsletter_source = values[1]
        if (sql === NEWSLETTER_SQL.markSubscribed) {
          Object.assign(row, {
            newsletter_status: 'subscribed',
            newsletter_subscribed_at: new Date(),
            marketing_consent: true,
            email_unsubscribed: false,
          })
        } else {
          row.newsletter_status = 'pending'
        }
        return { rows: person(row) }
      }
      case NEWSLETTER_SQL.confirm: {
        const row = byId(values[0])
        if (!row || row.newsletter_status === 'subscribed') {
          return { rows: [] }
        }
        Object.assign(row, {
          newsletter_status: 'subscribed',
          newsletter_subscribed_at: new Date(),
          marketing_consent: true,
          email_unsubscribed: false,
        })
        return { rows: person(row) }
      }
      case NEWSLETTER_SQL.unsubscribe: {
        const row = byId(values[0])
        if (!row || row.newsletter_status === 'unsubscribed') {
          return { rows: [] }
        }
        Object.assign(row, {
          newsletter_status: 'unsubscribed',
          newsletter_unsubscribed_at: new Date(),
          marketing_consent: false,
          email_unsubscribed: true,
        })
        return { rows: person(row) }
      }
      default:
        throw new Error('unexpected SQL: ' + sql)
    }
  }

  /** The statements that changed a row. */
  writes() {
    return this.queries.filter((query) => !query.sql.startsWith('SELECT'))
  }
}

const SETTINGS: UIDLNewsletterSettings = {
  dataSourceId: 'ds-1',
  dataSourceType: 'teleport',
  confirmation: true,
  welcome: true,
  sender: { name: 'Studio', email: 'hello@studio.test' },
  email: { provider: 'resend', apiKeyEnv: 'EMAIL_RESEND_APIKEY', domainEnv: null },
  templates: {
    confirmation: {
      subject: 'Confirm {{site_name}}',
      body: '<p>Confirm at <a href="{{confirm_url}}">this link</a> for {{email}}</p>',
    },
    welcome: {
      subject: 'Welcome',
      body: '<p>Welcome! <a href="{{unsubscribe_url}}">Unsubscribe</a></p>',
    },
  },
  pages: { confirm: '/newsletter/confirm', unsubscribe: '/newsletter/unsubscribe' },
  signUp: { signupCheckbox: false },
  adminRoutes: false,
}

interface App {
  db: FakeUsers
  sent: Row[]
  ledger: Row[]
  events: Row[]
  limits: string[]
  visitorLimits: Row[]
  clientErrors: unknown[]
  logs: unknown[][]
  helper: any
  load: (name: string) => any
}

/** One app instance: the helper and the routes, required from each other as the files are. */
const loadApp = (
  options: {
    settings?: Partial<UIDLNewsletterSettings>
    withAutomations?: boolean
    signupSendsAccountWelcome?: boolean
    env?: Record<string, string | undefined>
    provider?: Row
  } = {}
): App => {
  const db = new FakeUsers()
  const sent: Row[] = []
  const ledger: Row[] = []
  const events: Row[] = []
  const limits: string[] = []
  const visitorLimits: Row[] = []
  const clientErrors: unknown[] = []
  const logs: unknown[][] = []
  const record = (...args: unknown[]): void => {
    logs.push(args)
  }
  const quiet = { error: record, warn: record, log: record }
  const sources: Record<string, string> = {
    helper: generateNewsletterHelperCode({
      settings: { ...SETTINGS, ...(options.settings || {}) } as UIDLNewsletterSettings,
      siteName: 'Studio',
      withAutomations: options.withAutomations !== false,
      signupSendsAccountWelcome: options.signupSendsAccountWelcome === true,
    }),
    subscribe: generateNewsletterSubscribeRoute(),
    confirm: generateNewsletterConfirmRoute(),
    unsubscribe: generateNewsletterUnsubscribeRoute(),
  }
  const security = {
    rateLimit: async ({ key, limit }: { key: string; limit: number }) => {
      limits.push(key)
      return { allowed: limits.filter((k) => k === key).length <= limit, retryAfter: 0 }
    },
    rateLimitRequest: async (_req: unknown, _res: unknown, limit: Row) => {
      visitorLimits.push(limit)
      return true
    },
    sendClientError: (res: any, status: number, message: string, err?: unknown) => {
      clientErrors.push(err)
      return res.status(status).json({ error: message })
    },
  }
  const pg = {
    Client: class {
      public async connect(): Promise<void> {
        return undefined
      }
      public async end(): Promise<void> {
        return undefined
      }
      public on(): void {
        return undefined
      }
      public async query(sql: string, values?: any[]) {
        return db.query(sql, values)
      }
    },
  }
  const external: Record<string, unknown> = {
    crypto: nodeCrypto,
    pg,
    resend: options.provider || {
      Resend: class {
        public emails = {
          send: async (msg: Row) => {
            sent.push(msg)
            return {}
          },
        }
      },
    },
    '../../utils/security-runtime': security,
    '../../../utils/security-runtime': security,
    '../../utils/email/email-locale': {
      resolveRequestLocale: () => '',
      pickLocalizedTemplate: (base: Row) => base,
    },
    '../../utils/email/sent-email-log': {
      recordSentEmail: (entry: Row) => ledger.push(entry),
      settleSentEmailLog: async (): Promise<void> => undefined,
    },
    '../../lib/automations/event-bus': {
      emitBusinessEvent: async (event: Row) => {
        events.push(event)
        return { recorded: true, id: String(events.length) }
      },
    },
  }
  const files: Record<string, string> = { '../../../utils/newsletter/newsletter': 'helper' }
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
    const setTimeoutShim = (fn: () => void) => {
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
    )(
      module,
      module.exports,
      req,
      {
        env: {
          NEXTAUTH_SECRET: SECRET,
          NEXTAUTH_URL: 'https://studio.example',
          EMAIL_RESEND_APIKEY: 're_test_key',
          ...(options.env || {}),
        },
      },
      quiet,
      Buffer,
      setTimeoutShim
    )
    return module.exports
  }
  return {
    db,
    sent,
    ledger,
    events,
    limits,
    visitorLimits,
    clientErrors,
    logs,
    helper: load('helper'),
    load,
  }
}

const REQ = { headers: { host: 'studio.example' } }

const fakeResponse = () => {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Row }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (body: unknown) => {
    res.body = body
    return res
  }
  res.setHeader = (name: string, value: string) => {
    res.headers[name] = value
  }
  res.end = (body: string) => {
    res.body = body
  }
  return res
}

const route = async (app: App, name: string, request: Row) => {
  const res = fakeResponse()
  await app.load(name)({ headers: { host: 'studio.example' }, query: {}, ...request }, res)
  return res
}

/** `<type>:<id>:<unix minute>`, the minute this test ran in. */
const expectMinuteKey = (key: string, prefix: string) => {
  expect(key.startsWith(prefix)).toBe(true)
  const minute = Number(key.slice(prefix.length))
  const now = Math.floor(Date.now() / MINUTE)
  expect(minute === now || minute === now - 1).toBe(true)
}

/** The `#t=` (or, for the site's route, `?t=`) token of the first link of an email. */
const linkToken = (html: string): string => {
  const match = /[?#]t=([A-Za-z0-9_.%-]+)/.exec(html)
  return match ? decodeURIComponent(match[1]) : ''
}

describe('NextNewsletterProjectPlugin', () => {
  const structureFor = (extra: Row) => ({
    uidl: {
      name: 'Studio',
      globals: { settings: { title: 'Studio', language: 'en' }, env: {} },
      root: { name: 'Root', node: { type: 'element', content: { elementType: 'container' } } },
      dataSources: { 'ds-1': { id: 'ds-1', type: 'teleport', name: 'Site', config: {} } },
      ...extra,
    },
    files: new Map<string, { path: string[]; files: Array<{ name: string; content: string }> }>(),
    dependencies: {} as Record<string, string>,
    devDependencies: {},
  })
  const paths = (structure: ReturnType<typeof structureFor>) =>
    Array.from(structure.files.values()).flatMap((entry) =>
      entry.files.map((file) => [...entry.path, file.name].join('/'))
    )

  it('emits the helper and the three routes when uidl.newsletterSettings is set', async () => {
    const structure = structureFor({ newsletterSettings: SETTINGS })
    await new NextNewsletterProjectPlugin().runAfter(structure as never)
    expect(paths(structure)).toEqual(
      expect.arrayContaining([
        'utils/newsletter/newsletter',
        'pages/api/newsletter/subscribe',
        'pages/api/newsletter/confirm',
        'pages/api/newsletter/unsubscribe',
        'utils/security-runtime',
        'utils/email/email-locale',
        'utils/email/sent-email-log',
      ])
    )
    expect(structure.dependencies.pg).toBeDefined()
    expect(structure.dependencies.resend).toBeDefined()
    const helper = structure.files.get('newsletter-helper')!.files[0].content
    expect(helper).toContain('module.exports = {')
    expect(helper).toContain("require('../../utils/security-runtime')")
  })

  it('emits nothing when it is not set, or not on the TeleportHQ database', async () => {
    for (const extra of [
      {},
      { newsletterSettings: { ...SETTINGS, dataSourceType: 'postgresql' } },
      { newsletterSettings: { ...SETTINGS, dataSourceId: '' } },
    ]) {
      const structure = structureFor(extra)
      await new NextNewsletterProjectPlugin().runAfter(structure as never)
      expect(paths(structure)).toEqual([])
      expect(structure.dependencies).toEqual({})
    }
  })
})

describe('the newsletter helper', () => {
  it('subscribe: unsubscribed person gets a confirmation, status unchanged', async () => {
    const app = loadApp({ settings: { confirmation: false } })
    app.db.rows.push({
      id: 'u-left',
      email: 'left@site.test',
      source: 'newsletter',
      marketing_consent: false,
      email_unsubscribed: true,
      newsletter_status: 'unsubscribed',
      newsletter_source: 'footer',
    })
    const result = await app.helper.subscribeNewsletterPerson({
      db: app.db,
      email: '  Left@Site.TEST ',
      signUpPoint: 'popup',
      req: REQ,
    })
    expect(result).toEqual({ outcome: 'confirm-sent' })
    expect(app.db.writes()).toEqual([])
    expect(app.db.rows[0]).toMatchObject({
      newsletter_status: 'unsubscribed',
      marketing_consent: false,
      email_unsubscribed: true,
    })
    expect(app.events).toEqual([])
    expect(app.sent).toHaveLength(1)
    expect(app.sent[0].to).toEqual(['left@site.test'])
    expect(app.sent[0].from).toBe('Studio <hello@studio.test>')
    expect(app.sent[0].html).toContain('https://studio.example/newsletter/confirm#t=')
    expect(app.sent[0].html).not.toContain('/newsletter/confirm?t=')
    // The emailed link is the person's way back: opening it subscribes them.
    const confirmed = await app.helper.confirmNewsletter({
      db: app.db,
      token: linkToken(app.sent[0].html),
      req: REQ,
    })
    expect(confirmed).toEqual({ ok: true, email: 'left@site.test' })
    expect(app.db.rows[0]).toMatchObject({
      newsletter_status: 'subscribed',
      marketing_consent: true,
    })
    // The token never lands in the sent-email log.
    expect(app.ledger[0].emailType).toBe('newsletter-confirmation')
    expect(app.ledger[0].html).toContain('[hidden]')
    expect(app.ledger[0].html).not.toContain(linkToken(app.sent[0].html))
  })

  it('subscribe: new address with confirmation off is subscribed with source and event', async () => {
    const app = loadApp({ settings: { confirmation: false } })
    const result = await app.helper.subscribeNewsletterPerson({
      db: app.db,
      email: 'New@Reader.test',
      signUpPoint: 'footer',
      req: REQ,
    })
    expect(result).toEqual({ outcome: 'subscribed' })
    expect(app.db.writes().map((query) => query.sql)).toEqual([NEWSLETTER_SQL.insertSubscribed])
    expect(app.db.rows[0]).toMatchObject({
      email: 'new@reader.test',
      source: 'newsletter',
      newsletter_source: 'footer',
      newsletter_status: 'subscribed',
      marketing_consent: true,
      email_unsubscribed: false,
    })
    expect(app.events).toHaveLength(1)
    expect(app.events[0]).toMatchObject({
      type: 'newsletter-subscribed',
      entityType: 'subscriber',
      entityId: 'u1',
      payload: { subscriber: { email: 'new@reader.test', source: 'newsletter', consent: true } },
      actorType: 'customer',
    })
    expectMinuteKey(app.events[0].dedupeKey, 'newsletter-subscribed:u1:')
    // The welcome email carries the unsubscribe link.
    expect(app.sent).toHaveLength(1)
    expect(app.sent[0].html).toContain('https://studio.example/newsletter/unsubscribe#t=')
    expect(app.helper.publicSubscribeAnswer()).toEqual({ ok: true, pending: false })
  })

  it('subscribe: a new address with double opt-in waits, with no consent, for its link', async () => {
    const app = loadApp()
    const result = await app.helper.subscribeNewsletterPerson({
      db: app.db,
      email: 'wait@reader.test',
      signUpPoint: 'block',
      req: REQ,
    })
    expect(result).toEqual({ outcome: 'confirm-sent' })
    expect(app.db.rows[0]).toMatchObject({
      newsletter_status: 'pending',
      marketing_consent: false,
      newsletter_source: 'block',
    })
    expect(app.events).toEqual([])
    expect(app.helper.publicSubscribeAnswer()).toEqual({ ok: true, pending: true })
  })

  it('subscribe: an address already subscribed is left alone, silently', async () => {
    const app = loadApp()
    app.db.rows.push({ id: 'u-in', email: 'in@site.test', newsletter_status: 'subscribed' })
    const result = await app.helper.subscribeNewsletterPerson({
      db: app.db,
      email: 'in@site.test',
      signUpPoint: 'popup',
      req: REQ,
    })
    expect(result).toEqual({ outcome: 'already' })
    expect(app.db.writes()).toEqual([])
    expect(app.sent).toEqual([])
  })

  it('confirm: expired token refused', async () => {
    const app = loadApp()
    app.db.rows.push({ id: 'u-p', email: 'late@site.test', newsletter_status: 'pending' })
    const eightDaysAgo = Math.floor(Date.now() / 1000) - 8 * 24 * 3600
    const expired = app.helper.signNewsletterToken('late@site.test', 'confirm', eightDaysAgo)
    expect(await app.helper.confirmNewsletter({ db: app.db, token: expired, req: REQ })).toEqual({
      ok: false,
    })
    expect(app.db.writes()).toEqual([])
    // An unsubscribe token is not a confirmation, however fresh.
    const wrongPurpose = app.helper.signNewsletterToken('late@site.test', 'unsubscribe')
    expect(
      await app.helper.confirmNewsletter({ db: app.db, token: wrongPurpose, req: REQ })
    ).toEqual({ ok: false })
    const fresh = app.helper.signNewsletterToken('late@site.test', 'confirm')
    expect(await app.helper.confirmNewsletter({ db: app.db, token: fresh, req: REQ })).toEqual({
      ok: true,
      email: 'late@site.test',
    })
  })

  it('confirm: a link mailed before the person last unsubscribed cannot bring them back', async () => {
    const app = loadApp()
    const issuedAt = Math.floor(Date.now() / 1000) - 3600
    app.db.rows.push({
      id: 'u-gone',
      email: 'gone@site.test',
      newsletter_status: 'unsubscribed',
      newsletter_unsubscribed_at: new Date(Date.now() - 60 * 1000),
    })
    const old = app.helper.signNewsletterToken('gone@site.test', 'confirm', issuedAt)
    expect(await app.helper.confirmNewsletter({ db: app.db, token: old, req: REQ })).toEqual({
      ok: false,
    })
    expect(app.db.writes()).toEqual([])
  })

  it('unsubscribe: idempotent, records the event once per minute key', async () => {
    const app = loadApp()
    app.db.rows.push({
      id: 'u-sub',
      email: 'reader@site.test',
      source: 'checkout',
      newsletter_status: 'subscribed',
      marketing_consent: true,
    })
    const token = app.helper.signNewsletterToken('reader@site.test', 'unsubscribe')
    const first = await app.helper.unsubscribeNewsletter({ db: app.db, token, req: REQ })
    const second = await app.helper.unsubscribeNewsletter({ db: app.db, token, req: REQ })
    expect(first).toEqual({ ok: true, email: 'reader@site.test' })
    expect(second).toEqual(first)
    expect(app.db.rows[0]).toMatchObject({
      newsletter_status: 'unsubscribed',
      email_unsubscribed: true,
      marketing_consent: false,
    })
    expect(app.db.writes().map((query) => query.sql)).toEqual([NEWSLETTER_SQL.unsubscribe])
    expect(app.events).toHaveLength(1)
    expect(app.events[0]).toMatchObject({
      type: 'newsletter-unsubscribed',
      entityType: 'subscriber',
      entityId: 'u-sub',
      payload: { subscriber: { email: 'reader@site.test', source: 'checkout', consent: false } },
    })
    expectMinuteKey(app.events[0].dedupeKey, 'newsletter-unsubscribed:u-sub:')
    expect(
      await app.helper.unsubscribeNewsletter({ db: app.db, token: 'not.a-token', req: REQ })
    ).toEqual({ ok: false })
  })

  it('records no event without automations', async () => {
    const app = loadApp({ settings: { confirmation: false }, withAutomations: false })
    await app.helper.subscribeNewsletterPerson({
      db: app.db,
      email: 'quiet@reader.test',
      signUpPoint: 'block',
      req: REQ,
    })
    expect(app.db.rows[0].newsletter_status).toBe('subscribed')
    expect(app.events).toEqual([])
  })

  it('mints tokens exactly as newsletterTokenSpec describes (the worker reproduces them)', () => {
    const app = loadApp()
    const vector = newsletterTokenSpec.testVector
    expect(app.helper.signNewsletterToken(vector.email, vector.purpose, vector.issuedAt)).toBe(
      vector.token
    )
    // An independent implementation of the spec.
    const key = nodeCrypto
      .createHmac('sha256', vector.secret)
      .update(newsletterTokenSpec.keyLabel)
      .digest()
    const payload = Buffer.from(
      [vector.email, vector.purpose, vector.issuedAt].join(newsletterTokenSpec.separator),
      'utf8'
    )
    const b64u = (buffer: Buffer) =>
      buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(
      b64u(payload) + '.' + b64u(nodeCrypto.createHmac('sha256', key).update(payload).digest())
    ).toBe(vector.token)
    // An unsubscribe token never expires; a forged one never verifies.
    expect(app.helper.verifyNewsletterToken(vector.token, 'unsubscribe')).toEqual({
      email: vector.email,
      purpose: 'unsubscribe',
      issuedAt: vector.issuedAt,
    })
    const forged = vector.token.slice(0, -2) + (vector.token.endsWith('AA') ? 'AB' : 'AA')
    expect(app.helper.verifyNewsletterToken(forged, 'unsubscribe')).toBeNull()
  })
})

describe('the newsletter routes', () => {
  it('subscribe: honeypot answers ok without a query', async () => {
    const app = loadApp()
    const res = await route(app, 'subscribe', {
      method: 'POST',
      body: { email: 'bot@spam.test', website: 'http://spam.test', signUpPoint: 'footer' },
    })
    expect(res.statusCode).toBe(200)
    // The same answer a person gets.
    expect(res.body).toEqual(app.helper.publicSubscribeAnswer())
    expect(app.db.queries).toEqual([])
    expect(app.limits).toEqual([])
    // One visitor budget with the sign-up workflows' steps (visitorLimit scope newsletter-signup).
    expect(app.visitorLimits).toEqual([
      { scope: 'visitor-limit:newsletter-signup', limit: 5, windowSeconds: 3600 },
    ])
    expect(app.sent).toEqual([])
  })

  it('subscribe: answers every address the same, and refuses only a malformed one', async () => {
    const app = loadApp()
    app.db.rows.push({ id: 'u-in', email: 'in@site.test', newsletter_status: 'subscribed' })
    const known = await route(app, 'subscribe', { method: 'POST', body: { email: 'in@site.test' } })
    const fresh = await route(app, 'subscribe', {
      method: 'POST',
      body: { email: 'fresh@site.test', signUpPoint: 'admin' },
    })
    expect(known.body).toEqual({ ok: true, pending: true })
    expect(fresh.body).toEqual(known.body)
    // A visitor never names an owner's sign-up point.
    expect(app.db.rows[1].newsletter_source).toBe('block')
    const bad = await route(app, 'subscribe', { method: 'POST', body: { email: 'nope' } })
    expect(bad.statusCode).toBe(400)
    const get = await route(app, 'subscribe', { method: 'GET' })
    expect(get.statusCode).toBe(405)
  })

  it('unsubscribe: a GET only shows the button; its POST unsubscribes', async () => {
    const app = loadApp()
    app.db.rows.push({ id: 'u-sub', email: 'reader@site.test', newsletter_status: 'subscribed' })
    const token = app.helper.signNewsletterToken('reader@site.test', 'unsubscribe')
    const page = await route(app, 'unsubscribe', { method: 'GET', query: { t: token } })
    expect(page.statusCode).toBe(200)
    expect(page.body).toContain('<form method="post" action="/api/newsletter/unsubscribe">')
    expect(app.db.writes()).toEqual([])
    const done = await route(app, 'unsubscribe', {
      method: 'POST',
      headers: { host: 'studio.example', 'content-type': 'application/x-www-form-urlencoded' },
      body: { t: token },
    })
    expect(done.body).toContain('<h1>You&#39;re unsubscribed</h1>')
    expect(app.db.rows[0].newsletter_status).toBe('unsubscribed')
    const json = await route(app, 'unsubscribe', { method: 'POST', body: { token } })
    expect(json.body).toEqual({ ok: true, email: 'reader@site.test' })
  })

  it('confirm: answers { ok, email } for a live link and { ok: false } otherwise', async () => {
    const app = loadApp()
    app.db.rows.push({ id: 'u-p', email: 'wait@site.test', newsletter_status: 'pending' })
    const token = app.helper.signNewsletterToken('wait@site.test', 'confirm')
    const ok = await route(app, 'confirm', { method: 'POST', body: { token } })
    expect(ok.body).toEqual({ ok: true, email: 'wait@site.test' })
    const bad = await route(app, 'confirm', { method: 'POST', body: { token: 'x.y' } })
    expect(bad.body).toEqual({ ok: false })
  })
})

describe('the newsletter nodes', () => {
  it('registers the sign-up on the server and the link steps in the browser', () => {
    expect(nodeRegistry['newsletter-subscribe'].executionEnv).toBe('server')
    expect(nodeRegistry['newsletter-confirm'].executionEnv).toBe('client')
    expect(nodeRegistry['newsletter-unsubscribe'].executionEnv).toBe('client')
    // The sign-up's route hands it the visitor's request (origin, language).
    expect(needsVisitorRequest(['newsletter-subscribe'])).toBe(true)
  })

  it('newsletter-subscribe calls the helper and answers { ok, pending }', async () => {
    const app = loadApp({ settings: { confirmation: false } })
    const source = nodeRegistry['newsletter-subscribe'].generateServerHandler!({
      relativePrefix: '../../..',
    })
    expect(source).toContain("require('../../../utils/newsletter/newsletter')")
    // eslint-disable-next-line no-new-func
    const handler = new Function(
      'require',
      'setTimeout',
      `${source}\nreturn newsletter_subscribe;`
    )(
      (id: string) => {
        if (id === '../../../utils/newsletter/newsletter') {
          return app.helper
        }
        throw new Error('unexpected module ' + id)
      },
      (fn: () => void) => fn()
    )
    const context = { __request: REQ }
    expect(await handler({ email: 'node@reader.test', signUpPoint: 'popup' }, context)).toEqual({
      ok: true,
      pending: false,
    })
    expect(app.db.rows[0]).toMatchObject({
      newsletter_source: 'popup',
      newsletter_status: 'subscribed',
    })
    expect(await handler({ email: 'bot@reader.test', website: 'x' }, context)).toEqual({
      ok: true,
      pending: false,
    })
    expect(app.db.rows).toHaveLength(1)
    await expect(handler({ email: 'nope' }, context)).rejects.toThrow(
      'Enter a valid email address.'
    )
    // Without the helper's place, the step refuses.
    expect(nodeRegistry['newsletter-subscribe'].generateHandler()).not.toContain('require(')
  })

  it('newsletter-confirm and newsletter-unsubscribe post the token to their routes', async () => {
    const calls: Array<{ url: string; body: Row }> = []
    const realFetch = (global as any).fetch
    ;(global as any).fetch = async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) })
      return { ok: true, json: async () => ({ ok: true, email: 'reader@site.test' }) }
    }
    try {
      const confirm = loadHandler('newsletter-confirm')
      const unsubscribe = loadHandler('newsletter-unsubscribe')
      expect(await confirm({ token: ' tok ' }, { __baseUrl: 'https://studio.example' })).toEqual({
        ok: true,
        email: 'reader@site.test',
      })
      expect(await unsubscribe({ token: 'tok' }, {})).toEqual({
        ok: true,
        email: 'reader@site.test',
      })
      expect(await confirm({}, {})).toEqual({ ok: false })
    } finally {
      ;(global as any).fetch = realFetch
    }
    expect(calls).toEqual([
      { url: 'https://studio.example/api/newsletter/confirm', body: { token: 'tok' } },
      { url: '/api/newsletter/unsubscribe', body: { token: 'tok' } },
    ])
  })
})

describe("the sign-up form's consent box (R-N15)", () => {
  const AUTH = {
    enabled: true,
    dataSourceId: 'ds-1',
    dataSourceType: 'teleport',
    passwordAuthEnabled: true,
    providers: [],
    roles: ['user'],
    tables: {},
    customUserProperties: [],
  } as never

  it('subscribes a ticked box through the helper, from the signup point', () => {
    const signupRoute = generateSignupRouteFile(AUTH, {}, {}, { newsletter: true })
    expect(signupRoute).toContain(
      "    if (userData.marketing_consent) {\n      try {\n        const __newsletter = require('../../../utils/newsletter/newsletter');"
    )
    expect(signupRoute).toContain(
      "return __newsletter.subscribeNewsletterPerson({ db: db, email: email, signUpPoint: 'signup', req: req });"
    )
    // After the account exists, before the answer.
    expect(signupRoute.indexOf('subscribeNewsletterPerson')).toBeGreaterThan(
      signupRoute.indexOf('const newUser = await createUser(userData);')
    )
    expect(generateSignupRouteFile(AUTH, {}, {}, {})).not.toContain('utils/newsletter')
  })

  it('is on only when the newsletter is generated and its settings say so', () => {
    expect(newsletterSignupSubscribes({})).toBe(false)
    expect(newsletterSignupSubscribes({ newsletterSettings: SETTINGS })).toBe(false)
    expect(
      newsletterSignupSubscribes({
        newsletterSettings: { ...SETTINGS, signUp: { signupCheckbox: true } },
      })
    ).toBe(true)
    expect(
      newsletterSignupSubscribes({
        newsletterSettings: {
          ...SETTINGS,
          dataSourceType: 'postgresql' as never,
          signUp: { signupCheckbox: true },
        },
      })
    ).toBe(false)
  })

  it("sends one welcome per sign-up: the account's, when the sign-up route sends one", async () => {
    const both = loadApp({ settings: { confirmation: false }, signupSendsAccountWelcome: true })
    both.db.rows.push({ id: 'u-acc', email: 'acc@site.test', source: 'signup' })
    expect(
      await both.helper.subscribeNewsletterPerson({
        db: both.db,
        email: 'acc@site.test',
        signUpPoint: 'signup',
        req: REQ,
      })
    ).toEqual({ outcome: 'subscribed' })
    expect(both.sent).toEqual([])
    expect(both.events).toHaveLength(1)
    // From the footer the same person is welcomed by the newsletter.
    const footer = loadApp({ settings: { confirmation: false }, signupSendsAccountWelcome: true })
    await footer.helper.subscribeNewsletterPerson({
      db: footer.db,
      email: 'acc@site.test',
      signUpPoint: 'footer',
      req: REQ,
    })
    expect(footer.sent).toHaveLength(1)
  })

  it('R-N35: the account page switch is its own sign-up point, and is welcomed', async () => {
    const app = loadApp({ settings: { confirmation: false }, signupSendsAccountWelcome: true })
    app.db.rows.push({ id: 'u-acc', email: 'acc@site.test', source: 'signup' })
    expect(
      await app.helper.subscribeNewsletterPerson({
        db: app.db,
        email: 'acc@site.test',
        signUpPoint: 'account',
        req: REQ,
      })
    ).toEqual({ outcome: 'subscribed' })
    expect(app.db.rows[0]).toMatchObject({ newsletter_source: 'account', source: 'signup' })
    expect(app.sent).toHaveLength(1)
    expect(app.sent[0].html).toContain('/newsletter/unsubscribe#t=')
    // With double opt-in the welcome follows the confirmation, still not suppressed.
    const confirming = loadApp({
      settings: { confirmation: true },
      signupSendsAccountWelcome: true,
    })
    confirming.db.rows.push({ id: 'u-acc', email: 'acc@site.test', source: 'signup' })
    await confirming.helper.subscribeNewsletterPerson({
      db: confirming.db,
      email: 'acc@site.test',
      signUpPoint: 'account',
      req: REQ,
    })
    await confirming.helper.confirmNewsletter({
      db: confirming.db,
      token: linkToken(confirming.sent[0].html),
      req: REQ,
    })
    expect(confirming.sent).toHaveLength(2)
    expect(confirming.sent[1].html).toContain('/newsletter/unsubscribe#t=')
  })

  it("R-N34: a link to the site's own unsubscribe route keeps the token in its query", async () => {
    const app = loadApp({
      settings: {
        confirmation: false,
        pages: { confirm: '/newsletter/confirm', unsubscribe: '/api/newsletter/unsubscribe' },
      },
    })
    await app.helper.subscribeNewsletterPerson({
      db: app.db,
      email: 'route@reader.test',
      signUpPoint: 'block',
      req: REQ,
    })
    expect(app.sent[0].html).toContain('https://studio.example/api/newsletter/unsubscribe?t=')
    expect(app.sent[0].html).not.toContain('#t=')
  })
})

describe('the newsletter, after review (fix round 1)', () => {
  it('subscribe: an address opted out of email gets a confirmation, flags unchanged', async () => {
    for (const status of [null, 'pending']) {
      const app = loadApp({ settings: { confirmation: false } })
      app.db.rows.push({
        id: 'u-out',
        email: 'out@site.test',
        source: 'checkout',
        marketing_consent: false,
        email_unsubscribed: true,
        newsletter_status: status,
      })
      const result = await app.helper.subscribeNewsletterPerson({
        db: app.db,
        email: 'out@site.test',
        signUpPoint: 'footer',
        req: REQ,
      })
      expect(result).toEqual({ outcome: 'confirm-sent' })
      expect(app.db.writes()).toEqual([])
      expect(app.db.rows[0]).toMatchObject({
        email_unsubscribed: true,
        marketing_consent: false,
        newsletter_status: status,
      })
      expect(app.events).toEqual([])
      expect(app.sent).toHaveLength(1)
      expect(app.sent[0].html).toContain('/newsletter/confirm#t=')
      // The person's own click on that link is what brings them back.
      await app.helper.confirmNewsletter({
        db: app.db,
        token: linkToken(app.sent[0].html),
        req: REQ,
      })
      expect(app.db.rows[0]).toMatchObject({
        newsletter_status: 'subscribed',
        email_unsubscribed: false,
        marketing_consent: true,
      })
    }
  })

  it('guards every change of state in its own statement', () => {
    const neverOnTheList = "(newsletter_status IS NULL OR newsletter_status = 'pending')"
    for (const sql of [NEWSLETTER_SQL.markPending, NEWSLETTER_SQL.markSubscribed]) {
      expect(sql).toContain(
        `WHERE id = $1 AND ${neverOnTheList} AND email_unsubscribed IS NOT TRUE`
      )
    }
    expect(NEWSLETTER_SQL.markSubscribed).toContain('email_unsubscribed = FALSE')
    expect(NEWSLETTER_SQL.markSubscribed).toContain('marketing_consent = TRUE')
    expect(NEWSLETTER_SQL.insertPending).toContain("VALUES ($1, $2, FALSE, 'pending', $3)")
    expect(NEWSLETTER_SQL.confirm).toContain(
      "WHERE id = $1 AND newsletter_status IS DISTINCT FROM 'subscribed'"
    )
    expect(NEWSLETTER_SQL.confirm).toContain('email_unsubscribed = FALSE')
    expect(NEWSLETTER_SQL.unsubscribe).toContain(
      "WHERE id = $1 AND newsletter_status IS DISTINCT FROM 'unsubscribed'"
    )
    expect(NEWSLETTER_SQL.findPerson).toContain('email_unsubscribed')
  })

  it('subscribe: the sixth sign-up of an address in an hour is limited, and writes nothing', async () => {
    const app = loadApp()
    for (let i = 0; i < 5; i++) {
      app.db.rows.length = 0
      await app.helper.subscribeNewsletterPerson({
        db: app.db,
        email: 'many@site.test',
        signUpPoint: 'block',
        req: REQ,
      })
    }
    app.db.rows.length = 0
    app.db.queries.length = 0
    const sixth = await app.helper.subscribeNewsletterPerson({
      db: app.db,
      email: 'many@site.test',
      signUpPoint: 'block',
      req: REQ,
    })
    expect(sixth).toEqual({ outcome: 'limited' })
    expect(app.db.queries).toEqual([])
  })

  it('without the app secret nothing is mailed and no link verifies', async () => {
    const app = loadApp({ env: { NEXTAUTH_SECRET: undefined } })
    const result = await app.helper.subscribeNewsletterPerson({
      db: app.db,
      email: 'nosecret@site.test',
      signUpPoint: 'block',
      req: REQ,
    })
    expect(result).toEqual({ outcome: 'pending' })
    expect(app.sent).toEqual([])
    expect(app.helper.signNewsletterToken('nosecret@site.test', 'confirm')).toBeNull()
    expect(
      app.helper.verifyNewsletterToken(newsletterTokenSpec.testVector.token, 'unsubscribe')
    ).toBeNull()
  })

  it('unsubscribe: a pending person leaves without a newsletter-unsubscribed event', async () => {
    const app = loadApp()
    app.db.rows.push({ id: 'u-p', email: 'wait@site.test', newsletter_status: 'pending' })
    const token = app.helper.signNewsletterToken('wait@site.test', 'unsubscribe')
    expect(await app.helper.unsubscribeNewsletter({ db: app.db, token, req: REQ })).toEqual({
      ok: true,
      email: 'wait@site.test',
    })
    expect(app.db.rows[0].newsletter_status).toBe('unsubscribed')
    expect(app.events).toEqual([])
  })

  it('subscribe: an opted-out address is sent at most one confirmation a day', async () => {
    const app = loadApp()
    app.db.rows.push({ id: 'u-left', email: 'left@site.test', newsletter_status: 'unsubscribed' })
    const outcomes = []
    for (let i = 0; i < 3; i++) {
      outcomes.push(
        (
          await app.helper.subscribeNewsletterPerson({
            db: app.db,
            email: 'left@site.test',
            signUpPoint: 'block',
            req: REQ,
          })
        ).outcome
      )
    }
    expect(outcomes).toEqual(['confirm-sent', 'limited', 'limited'])
    expect(app.sent).toHaveLength(1)
    expect(app.limits).toContain('newsletter-resubscribe:left@site.test')
    // The visitor is answered the same either way.
    const res = await route(app, 'subscribe', {
      method: 'POST',
      body: { email: 'left@site.test' },
    })
    expect(res.body).toEqual(app.helper.publicSubscribeAnswer())
  })

  it('the public route names only the sign-up points of the site pages', async () => {
    const app = loadApp()
    for (const [point, kept] of [
      ['footer', 'footer'],
      ['popup', 'popup'],
      ['form', 'form'],
      ['signup', 'block'],
      ['account', 'block'],
      ['checkout', 'block'],
      ['booking', 'block'],
      ['import', 'block'],
    ]) {
      const email = `${point}@site.test`
      await route(app, 'subscribe', { method: 'POST', body: { email, signUpPoint: point } })
      const row = app.db.rows.find((candidate) => candidate.email === email)
      expect([point, row && row.newsletter_source, row && row.source]).toEqual([
        point,
        kept,
        kept === 'form' ? 'form' : 'newsletter',
      ])
    }
  })

  it('never logs a database row or the recipient', async () => {
    const app = loadApp()
    app.db.failWith = {
      message: 'null value in column "name" of relation "users" violates not-null constraint',
      code: '23502',
      detail: 'Failing row contains (u9, leak@site.test, null).',
    }
    const res = await route(app, 'subscribe', { method: 'POST', body: { email: 'leak@site.test' } })
    expect(res.statusCode).toBe(503)
    expect(app.clientErrors).toEqual([
      {
        code: '23502',
        message: 'null value in column "name" of relation "users" violates not-null constraint',
      },
    ])
    // A provider that echoes the recipient.
    const echoing = loadApp({
      provider: {
        Resend: class {
          public emails = {
            send: async (msg: Row) => ({
              error: { message: `Invalid 'To' address: '${msg.to[0]}'` },
            }),
          }
        },
      },
    })
    await echoing.helper.sendNewsletterEmail('confirmation', 'echo@site.test', '', REQ)
    const logged = JSON.stringify(echoing.logs)
    expect(logged).toContain('[address]')
    expect(logged).not.toContain('echo@site.test')
  })

  it('every welcome carries a way out: a footer link when the body has none, and List-Unsubscribe', async () => {
    const app = loadApp({
      settings: {
        confirmation: false,
        templates: {
          ...SETTINGS.templates,
          welcome: { subject: 'Welcome', body: '<html><body><p>Hello!</p></body></html>' },
        },
      },
    })
    await app.helper.subscribeNewsletterPerson({
      db: app.db,
      email: 'hello@reader.test',
      signUpPoint: 'block',
      req: REQ,
    })
    expect(app.sent).toHaveLength(1)
    const welcome = app.sent[0]
    const token = linkToken(welcome.html)
    expect(welcome.html).toMatch(
      /<a href="https:\/\/studio\.example\/newsletter\/unsubscribe#t=[^"]+">Unsubscribe<\/a>.*<\/body><\/html>$/
    )
    expect(welcome.headers).toEqual({
      // The route that reads the token on the server (a fragment never reaches it).
      'List-Unsubscribe': `<https://studio.example/api/newsletter/unsubscribe?t=${token}>`,
    })
    // A confirmation carries none.
    const pending = loadApp()
    await pending.helper.subscribeNewsletterPerson({
      db: pending.db,
      email: 'wait@reader.test',
      signUpPoint: 'block',
      req: REQ,
    })
    expect(pending.sent[0].headers).toBeUndefined()
  })
})

describe('the newsletter sign-up step, in the generator (fix round 1)', () => {
  const bareStep = (config: Row): WorkflowSegment =>
    ({
      id: 'server-1',
      env: 'server',
      nodeIds: ['join'],
      nodes: [
        { id: 'join', type: 'newsletter-subscribe', config, executionEnv: 'server', stepNumber: 1 },
      ],
      edges: [],
    } as unknown as WorkflowSegment)

  it('limits a bare step per visitor with the sign-up budget, and counts it as cost-bearing', () => {
    const guard = buildVisitorStepLimitGuard(bareStep({ email: 'a@b.co' }))
    expect(guard).toContain(
      '{"scope":"visitor-limit:newsletter-signup","limit":5,"windowSeconds":3600}'
    )
    expect(guard).toContain('__logStepLimitSkip("visitor-limit:newsletter-signup")')
    // A declared limit is the step's own.
    expect(
      buildVisitorStepLimitGuard(
        bareStep({ visitorLimit: { limit: 2, windowSeconds: 600, scope: 'newsletter-signup' } })
      )
    ).toContain('{"scope":"visitor-limit:newsletter-signup","limit":2,"windowSeconds":600}')
    expect(isCostBearingNodeType('newsletter-subscribe')).toBe(true)
  })

  it('refuses the sign-up step outside a workflow a form submit starts', () => {
    const workflowWith = (trigger: string) => ({
      workflows: {
        'wf-1': {
          id: 'wf-1',
          name: 'Join',
          trigger: { type: trigger, config: {} },
          nodes: [
            { id: 't', type: trigger, config: {} },
            {
              id: 'join',
              type: 'newsletter-subscribe',
              label: 'Join',
              config: { email: 'a@b.co' },
            },
          ],
          edges: [{ id: 'e', source: 't', target: 'join' }],
        },
      },
    })
    for (const trigger of [
      'event-page-loaded',
      'event-element-clicked',
      'event-cron-triggered',
      'event-webhook-received',
      'event-business-event',
    ]) {
      const refusals = collectWorkflowPublishRefusals(workflowWith(trigger) as never).filter(
        (refusal) => refusal.check === 'newsletter-sign-up'
      )
      expect([trigger, refusals]).toEqual([
        trigger,
        [
          {
            kind: 'refused',
            check: 'newsletter-sign-up',
            ownerId: 'wf-1',
            ownerKind: 'workflow',
            nodeId: 'join',
            message:
              'The step "Join" in "Join": The newsletter sign-up step runs only when a visitor submits a form.',
          },
        ],
      ])
      expect(() => assertWorkflowPublishGates(workflowWith(trigger) as never)).toThrow(
        'The newsletter sign-up step runs only when a visitor submits a form.'
      )
    }
    const formWorkflow = workflowWith('event-form-submitted')
    expect(
      collectWorkflowPublishRefusals(formWorkflow as never).filter(
        (refusal) => refusal.check === 'newsletter-sign-up'
      )
    ).toEqual([])
    expect(() => assertWorkflowPublishGates(formWorkflow as never)).not.toThrow()
  })
})
