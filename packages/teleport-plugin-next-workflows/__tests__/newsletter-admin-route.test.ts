import type { ProjectUIDL, UIDLNewsletterSettings } from '@teleporthq/teleport-types'
import {
  NEWSLETTER_ADMIN_MESSAGES,
  NEWSLETTER_SERVICE_ENV_NAMES,
  NEWSLETTER_SERVICE_TIMEOUT_MS,
  generateNewsletterAdminRouteCode,
} from '../src/newsletter/admin-route-code'
import { NextNewsletterProjectPlugin } from '../src/newsletter/project-plugin'
import { AbortControllerStub } from './_helpers/abort-controller-stub'
import { evaluateEmittedModule } from './_helpers/load-invoice-route'

/**
 * Newsletter Task 9: `POST /api/newsletter/admin/[action]`, the admin panel's
 * "Send now" (`send`) and "Send a test" (`test`). Staff only; the route relays
 * the services worker's answer and is the only code that reads the site's
 * newsletter service token.
 *
 * The emitted route runs with the session (`next-auth/jwt`), the site's
 * database (the newsletter helper's `withNewsletterDb`) and the worker
 * (`fetch`) stubbed.
 */

type Row = Record<string, any>

const SERVICE_TOKEN = 'tqnl_0123456789abcdef0123456789abcdef0123456789abcdef'
const SERVICE_ENV = {
  NEWSLETTER_SERVICE_URL: 'https://worker.test/',
  NEWSLETTER_SERVICE_TOKEN: SERVICE_TOKEN,
  NEWSLETTER_SERVICE_PROJECT_ID: 'project-1',
}

const SETTINGS: UIDLNewsletterSettings = {
  dataSourceId: 'ds-1',
  dataSourceType: 'teleport',
  confirmation: true,
  welcome: false,
  sender: { name: '', email: '' },
  email: { provider: null, apiKeyEnv: null },
  templates: { confirmation: { subject: '', body: '' } },
  pages: { confirm: '/newsletter/confirm', unsubscribe: '/newsletter/unsubscribe' },
  signUp: { signupCheckbox: false },
  adminRoutes: true,
}

/** A project whose admin panel admits `admin` and `editor`. */
const UIDL = {
  name: 'Studio',
  authentication: {
    enabled: true,
    folderProtection: {
      panel: { folderName: 'admin-panel', allowedRoles: ['editor', 'admin'] },
    },
  },
  newsletterSettings: SETTINGS,
} as unknown as ProjectUIDL

const STAFF = { role: 'editor', id: 'u-7', email: ' Editor@Studio.TEST ' }

interface RunOptions {
  method?: string
  action?: string
  body?: unknown
  token?: Row | null
  issues?: string[]
  dbFails?: boolean
  env?: Partial<typeof SERVICE_ENV>
  /** Request headers over the defaults (a page of the site posting JSON); undefined drops one. */
  headers?: Record<string, string | undefined>
  worker?: (call: { url: string; init: Row }) => Promise<{ status: number; body: unknown }>
}

interface RunResult {
  status: number
  payload: Row
  headers: Record<string, string>
  calls: Array<{ url: string; init: Row; headers: Record<string, string>; json: Row | null }>
  queries: Array<{ sql: string; values: unknown[] }>
  logs: string[]
  sessionReads: number
}

/** What the admin panel's own fetch sends. */
const PAGE_HEADERS: Record<string, string> = {
  host: 'localhost:3000',
  origin: 'http://localhost:3000',
  'content-type': 'application/json',
  cookie: 'next-auth.session-token=abc',
}

const SAVED_ENV = { ...process.env }

async function run(options: RunOptions = {}): Promise<RunResult> {
  const result: RunResult = {
    status: 0,
    payload: {},
    headers: {},
    calls: [],
    queries: [],
    logs: [],
    sessionReads: 0,
  }
  const issues = options.issues || ['issue-1']
  const db = {
    query: async (sql: string, values: unknown[] = []) => {
      result.queries.push({ sql, values })
      if (options.dbFails) {
        throw Object.assign(new Error('relation "teleport_newsletter_issues" does not exist'), {
          code: '42P01',
        })
      }
      return { rows: issues.indexOf(String(values[0])) !== -1 ? [{ id: values[0] }] : [] }
    },
  }
  const newsletterHelper = {
    normalizeEmail: (value: unknown) => {
      const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
    },
    withNewsletterDb: async (fn: (client: typeof db) => Promise<unknown>) => fn(db),
  }
  const token = options.token === undefined ? STAFF : options.token
  const requireFn = ((id: string) => {
    if (id === '../../../../utils/newsletter/newsletter') {
      return newsletterHelper
    }
    if (id === 'next-auth/jwt') {
      return {
        getToken: async () => {
          result.sessionReads++
          return token
        },
      }
    }
    throw new Error('Unexpected require: ' + id)
  }) as unknown as NodeRequire

  for (const name of NEWSLETTER_SERVICE_ENV_NAMES) {
    delete process.env[name]
  }
  Object.assign(process.env, { NEXTAUTH_SECRET: 'secret' }, SERVICE_ENV, options.env || {})

  // jest's node sandbox has no AbortController (abort-controller-stub.ts).
  const scope = globalThis as Record<string, unknown>
  const originalAbortController = scope.AbortController
  scope.AbortController = AbortControllerStub
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: string, init: Row = {}) => {
    let json: Row | null = null
    try {
      json = JSON.parse(String(init.body))
    } catch (_e) {
      json = null
    }
    const call = {
      url: String(url),
      init,
      headers: (init.headers || {}) as Record<string, string>,
      json,
    }
    result.calls.push(call)
    const answer = options.worker
      ? await options.worker(call)
      : {
          status: 200,
          body: { success: true, status: 'sending', message: 'Sending to 12 subscribers.' },
        }
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => {
        if (typeof answer.body === 'string') {
          return JSON.parse(answer.body)
        }
        return answer.body
      },
    }
  }) as unknown as typeof fetch

  const capture = (...args: unknown[]) => {
    result.logs.push(args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '))
  }
  const consoleSpies = (['log', 'info', 'warn', 'error'] as const).map((level) =>
    jest.spyOn(console, level).mockImplementation(capture)
  )

  const handler = evaluateEmittedModule<(req: unknown, res: unknown) => Promise<void>>(
    generateNewsletterAdminRouteCode(UIDL, { withRevocation: true }),
    requireFn
  )
  const res = {
    status(code: number) {
      result.status = code
      return this
    },
    json(value: Row) {
      result.payload = value
      return this
    },
    setHeader(name: string, value: string) {
      result.headers[name] = value
      return this
    },
  }
  const headers: Record<string, string> = { ...PAGE_HEADERS }
  for (const [name, value] of Object.entries(options.headers || {})) {
    if (value === undefined) {
      delete headers[name]
    } else {
      headers[name] = value
    }
  }
  try {
    await handler(
      {
        method: options.method || 'POST',
        query: { action: options.action === undefined ? 'send' : options.action },
        headers,
        body: options.body === undefined ? { issueId: 'issue-1' } : options.body,
      },
      res
    )
  } finally {
    globalThis.fetch = originalFetch
    scope.AbortController = originalAbortController
    consoleSpies.forEach((spy) => spy.mockRestore())
  }
  return result
}

/** The token never reaches an answer or a log line. */
const expectTokenHidden = (result: RunResult) => {
  expect(JSON.stringify(result.payload)).not.toContain(SERVICE_TOKEN)
  expect(result.logs.join('\n')).not.toContain(SERVICE_TOKEN)
}

describe('newsletter admin route — source', () => {
  const code = generateNewsletterAdminRouteCode(UIDL, { withRevocation: true })

  it('answers POST only', () => {
    expect(code).toContain("if (req.method !== 'POST') {")
    expect(code).toContain("res.setHeader('Allow', 'POST');")
    expect(code).toContain('return res.status(405).json(')
  })

  it('checks the session and bakes the staff roles from the admin panel', () => {
    expect(code).toContain('token = await __tqSessionToken(req);')
    expect(code).toContain('function roleOf(token) {')
    expect(code).toContain('var STAFF_ROLES = ["admin","editor"];')
    expect(code).toContain('STAFF_ROLES.indexOf(role) < 0')
    expect(code).toContain("require('../../../../utils/auth/session-revocation')")
    expect(code).toContain(JSON.stringify(NEWSLETTER_ADMIN_MESSAGES.signIn))
    expect(code).toContain(JSON.stringify(NEWSLETTER_ADMIN_MESSAGES.staffOnly))
  })

  it('serves send and test only', () => {
    expect(code).toContain('var NEWSLETTER_ADMIN_ACTIONS = ["send","test"];')
    expect(code).not.toMatch(/['"](schedule|cancel)['"]/)
  })

  it('calls the worker at the env URL with the three headers and a 15 s timeout', () => {
    expect(code).toContain('process.env.NEWSLETTER_SERVICE_URL')
    expect(code).toContain('process.env.NEWSLETTER_SERVICE_TOKEN')
    expect(code).toContain('process.env.NEWSLETTER_SERVICE_PROJECT_ID')
    expect(code).toContain("'/newsletter/site/' + action")
    expect(code).toContain("'X-Teleport-Service-Token': service.token,")
    expect(code).toContain("'X-Teleport-Service-Project': service.project,")
    expect(code).toContain("'X-Teleport-Staff': staff,")
    expect(code).toContain('var SERVICE_TIMEOUT_MS = 15000;')
    expect(code).toContain('signal: controller.signal,')
  })

  it('logs nothing that carries the token', () => {
    const consoleLines = code.split('\n').filter((line) => /console\.\w+\(/.test(line))
    expect(consoleLines.length).toBeGreaterThan(0)
    for (const line of consoleLines) {
      expect(line).not.toMatch(
        /NEWSLETTER_SERVICE_TOKEN|service\.token|X-Teleport-Service-Token|headers/
      )
    }
  })

  it('skips the session-stamp check in a project without it', () => {
    const plain = generateNewsletterAdminRouteCode(UIDL, { withRevocation: false })
    expect(plain).not.toContain('session-revocation')
    expect(plain).toContain('function __tqSessionToken(req) {')
  })

  it('is valid JavaScript', () => {
    // eslint-disable-next-line no-new-func
    expect(() => new Function('require', 'module', 'exports', code)).not.toThrow()
  })
})

describe('newsletter admin route — guards (never call the worker)', () => {
  afterAll(() => {
    process.env = SAVED_ENV
  })

  it('refuses every method but POST', async () => {
    const result = await run({ method: 'GET' })
    expect(result.status).toBe(405)
    expect(result.headers.Allow).toBe('POST')
    expect(result.payload.success).toBe(false)
    expect(result.calls).toEqual([])
    expect(result.queries).toEqual([])
  })

  it('refuses a request from another site before reading the session (R-N25)', async () => {
    const evil = 'https://evil.teleporthq.app'
    const refused: Array<Record<string, string | undefined>> = [
      // A sibling site on the shared domain: same-site, so Lax sends the cookie.
      { origin: evil, 'sec-fetch-site': 'same-site' },
      { origin: evil },
      { origin: 'null' },
      // No Origin and no Referer: no page of this site sent it.
      { origin: undefined },
      { origin: undefined, referer: evil + '/promo' },
      // Sec-Fetch-Site wins over a forged-looking Origin.
      { 'sec-fetch-site': 'cross-site' },
    ]
    for (const headers of refused) {
      const result = await run({ headers })
      expect(result.status).toBe(403)
      expect(result.payload).toEqual({
        success: false,
        error: 'This request must come from your site.',
      })
      expect(result.sessionReads).toBe(0)
      expect(result.queries).toEqual([])
      expect(result.calls).toEqual([])
    }
  })

  it('refuses a body that is not JSON (a form-encoded or text/plain post) with 415', async () => {
    for (const [type, body] of [
      ['application/x-www-form-urlencoded', { issueId: 'issue-1' }],
      ['text/plain', '{"issueId":"issue-1"}'],
      ['multipart/form-data; boundary=x', { issueId: 'issue-1' }],
      [undefined, { issueId: 'issue-1' }],
    ] as Array<[string | undefined, unknown]>) {
      const result = await run({ headers: { 'content-type': type }, body })
      expect(result.status).toBe(415)
      expect(result.payload).toEqual({
        success: false,
        error: NEWSLETTER_ADMIN_MESSAGES.jsonOnly,
      })
      expect(result.sessionReads).toBe(0)
      expect(result.queries).toEqual([])
      expect(result.calls).toEqual([])
    }
  })

  it('accepts its own pages: Origin, a Referer without Origin, Sec-Fetch-Site same-origin, JSON with a charset', async () => {
    const accepted: Array<Record<string, string | undefined>> = [
      { 'sec-fetch-site': 'same-origin' },
      { origin: undefined, referer: 'http://localhost:3000/admin/newsletter-issues' },
      { 'content-type': 'application/json; charset=utf-8' },
    ]
    for (const headers of accepted) {
      const result = await run({ headers })
      expect(result.status).toBe(200)
      expect(result.calls).toHaveLength(1)
    }
  })

  it('answers 401 without a session', async () => {
    const result = await run({ token: null })
    expect(result.status).toBe(401)
    expect(result.payload).toEqual({ success: false, error: 'Sign in again.' })
    expect(result.calls).toEqual([])
    expect(result.queries).toEqual([])
  })

  it('answers 403 to a visitor session and to a role-less one', async () => {
    for (const token of [{ role: 'customer', id: 'c-1', email: 'c@x.test' }, { id: 'c-2' }]) {
      const result = await run({ token })
      expect(result.status).toBe(403)
      expect(result.payload).toEqual({ success: false, error: 'Staff only.' })
      expect(result.calls).toEqual([])
      expect(result.queries).toEqual([])
    }
  })

  it('answers 404 to any action but send and test', async () => {
    for (const action of ['schedule', 'cancel', 'delete', '']) {
      const result = await run({ action })
      expect(result.status).toBe(404)
      expect(result.payload.success).toBe(false)
      expect(result.queries).toEqual([])
      expect(result.calls).toEqual([])
    }
  })

  it('answers 503 where the site has no newsletter service (not the production deploy)', async () => {
    for (const name of NEWSLETTER_SERVICE_ENV_NAMES) {
      const result = await run({ env: { [name]: '' } })
      expect(result.status).toBe(503)
      expect(result.payload).toEqual({
        success: false,
        error: 'Newsletter sending from the admin panel works on the published production site.',
      })
      expect(result.calls).toEqual([])
      expect(result.queries).toEqual([])
    }
  })

  it('answers 400 without an issue id', async () => {
    for (const body of [{}, { issueId: '   ' }, { issueId: 'x'.repeat(256) }, 'not json']) {
      const result = await run({ body })
      expect(result.status).toBe(400)
      expect(result.queries).toEqual([])
      expect(result.calls).toEqual([])
    }
  })

  it("answers 404 for an issue the site's database does not hold (another project's)", async () => {
    const result = await run({ body: { issueId: 'issue-of-project-b' } })
    expect(result.status).toBe(404)
    expect(result.payload).toEqual({ success: false, error: NEWSLETTER_ADMIN_MESSAGES.notFound })
    expect(result.queries).toEqual([
      {
        sql: 'SELECT id FROM teleport_newsletter_issues WHERE id = $1 LIMIT 1',
        values: ['issue-of-project-b'],
      },
    ])
    expect(result.calls).toEqual([])
  })

  it('answers 503 when the database cannot be read, naming no table', async () => {
    const result = await run({ dbFails: true })
    expect(result.status).toBe(503)
    expect(result.payload).toEqual({ success: false, error: NEWSLETTER_ADMIN_MESSAGES.readFailed })
    expect(result.calls).toEqual([])
    expectTokenHidden(result)
  })

  it('refuses a test for an account without an email address', async () => {
    const result = await run({ action: 'test', token: { role: 'admin', id: 'u-1' } })
    expect(result.status).toBe(422)
    expect(result.payload).toEqual({
      success: false,
      error: NEWSLETTER_ADMIN_MESSAGES.noTestAddress,
    })
    expect(result.calls).toEqual([])
  })

  it('tells a staff member whose address a header cannot carry to send the test from the editor', async () => {
    const result = await run({
      action: 'test',
      token: { role: 'admin', id: 'u-1', email: 'rené@exämple.test' },
    })
    expect(result.status).toBe(422)
    expect(result.payload).toEqual({
      success: false,
      error:
        "Your account's email address cannot receive the test from the admin panel; send the test from the editor.",
    })
    expect(result.queries).toEqual([])
    expect(result.calls).toEqual([])
  })
})

describe('newsletter admin route — the worker call', () => {
  afterAll(() => {
    process.env = SAVED_ENV
  })

  it('send: posts { issueId } with the token, the project and the staff member, and relays the answer', async () => {
    const result = await run({ action: 'send', body: { issueId: 'issue-1', to: 'x@evil.test' } })
    expect(result.calls).toHaveLength(1)
    const [call] = result.calls
    expect(call.url).toBe('https://worker.test/newsletter/site/send')
    expect(call.init.method).toBe('POST')
    expect(call.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Teleport-Service-Token': SERVICE_TOKEN,
      'X-Teleport-Service-Project': 'project-1',
      'X-Teleport-Staff': 'editor@studio.test',
    })
    expect(call.json).toEqual({ issueId: 'issue-1' })
    expect(call.init.signal).toBeDefined()
    expect(call.init.redirect).toBe('error')
    expect(result.status).toBe(200)
    expect(result.payload).toEqual({
      success: true,
      status: 'sending',
      message: 'Sending to 12 subscribers.',
    })
    expectTokenHidden(result)
  })

  it("test: sends to the signed-in staff member's address, never a `to` from the body", async () => {
    const result = await run({
      action: 'test',
      body: { issueId: 'issue-1', to: 'someone@else.test' },
      worker: async () => ({
        status: 200,
        body: { success: true, status: 'draft', message: 'Test sent to editor@studio.test.' },
      }),
    })
    expect(result.calls).toHaveLength(1)
    expect(result.calls[0].url).toBe('https://worker.test/newsletter/site/test')
    expect(result.calls[0].json).toEqual({ issueId: 'issue-1' })
    expect(result.calls[0].headers['X-Teleport-Staff']).toBe('editor@studio.test')
    expect(result.status).toBe(200)
    expect(result.payload.success).toBe(true)
  })

  it('send: an admin session without an email names the staff member by id', async () => {
    const result = await run({ token: { role: 'admin', sub: 'u-9' } })
    expect(result.calls[0].headers['X-Teleport-Staff']).toBe('u-9')
  })

  it("relays a refusal with the worker's status, and only the contract's fields", async () => {
    const result = await run({
      worker: async () => ({
        status: 409,
        body: { success: false, error: 'This newsletter is already being sent.', stack: 'secret' },
      }),
    })
    expect(result.status).toBe(409)
    expect(result.payload).toEqual({
      success: false,
      error: 'This newsletter is already being sent.',
    })
  })

  it("answers 503 when the worker refuses the site's key (rotated: publish again)", async () => {
    const result = await run({
      worker: async () => ({
        status: 401,
        body: { success: false, error: 'Invalid service token' },
      }),
    })
    expect(result.status).toBe(503)
    expect(result.payload).toEqual({ success: false, error: NEWSLETTER_ADMIN_MESSAGES.keyRefused })
    expectTokenHidden(result)
  })

  it('answers 504 when the worker does not answer within 15 s, 502 when it cannot be reached', async () => {
    jest.useFakeTimers()
    let abortedEarly: boolean | null = null
    const timedOut = await run({
      worker: ({ init }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))
          )
          jest.advanceTimersByTime(NEWSLETTER_SERVICE_TIMEOUT_MS - 1)
          abortedEarly = init.signal.aborted
          jest.advanceTimersByTime(1)
        }),
    })
    jest.useRealTimers()
    expect(abortedEarly).toBe(false)
    expect(timedOut.status).toBe(504)
    expect(timedOut.payload).toEqual({ success: false, error: NEWSLETTER_ADMIN_MESSAGES.timeout })
    expectTokenHidden(timedOut)

    const unreachable = await run({
      worker: async () => {
        throw new Error('getaddrinfo ENOTFOUND worker.test')
      },
    })
    expect(unreachable.status).toBe(502)
    expect(unreachable.payload).toEqual({
      success: false,
      error: NEWSLETTER_ADMIN_MESSAGES.unreachable,
    })
    expectTokenHidden(unreachable)
  })

  it('never follows a redirect with the token: a redirect answers 502', async () => {
    const result = await run({
      worker: async ({ init }) => {
        // What fetch does with redirect: 'error' on a 3xx.
        if (init.redirect === 'error') {
          throw Object.assign(new TypeError('fetch failed'), {
            cause: new Error('unexpected redirect'),
          })
        }
        return { status: 200, body: { success: true, status: 'sending', message: 'followed' } }
      },
    })
    expect(result.status).toBe(502)
    expect(result.payload).toEqual({
      success: false,
      error: NEWSLETTER_ADMIN_MESSAGES.unreachable,
    })
    expectTokenHidden(result)
  })

  it("replaces a server failure's own text (5xx) with a fixed line", async () => {
    for (const status of [500, 503]) {
      const result = await run({
        worker: async () => ({
          status,
          body: {
            success: false,
            error: "TypeError: Cannot read properties of undefined (reading 'rows') at send.ts:88",
          },
        }),
      })
      expect(result.status).toBe(status)
      expect(result.payload).toEqual({
        success: false,
        error: 'The newsletter could not be sent right now. Try again in a moment.',
      })
    }
  })

  it('answers 502 to an answer that is not the JSON contract', async () => {
    for (const body of ['<html>Bad gateway</html>', null]) {
      const result = await run({ worker: async () => ({ status: 200, body }) })
      expect(result.status).toBe(502)
      expect(result.payload).toEqual({ success: false, error: NEWSLETTER_ADMIN_MESSAGES.badAnswer })
    }
  })
})

describe('NextNewsletterProjectPlugin — the admin route', () => {
  const structureFor = (adminRoutes: boolean) => ({
    uidl: {
      ...UIDL,
      globals: { settings: { title: 'Studio', language: 'en' }, env: {} as Record<string, string> },
      newsletterSettings: { ...SETTINGS, adminRoutes },
    },
    files: new Map<string, { path: string[]; files: Array<{ name: string; content: string }> }>(),
    dependencies: {} as Record<string, string>,
    devDependencies: {},
  })
  const paths = (structure: ReturnType<typeof structureFor>) =>
    Array.from(structure.files.values()).flatMap((entry) =>
      entry.files.map((file) => [...entry.path, file.name].join('/'))
    )

  it('does not emit a send route or a service token, with or without an admin panel', async () => {
    const on = structureFor(true)
    await new NextNewsletterProjectPlugin().runAfter(on as never)
    expect(paths(on)).not.toContain('pages/api/newsletter/admin/[action]')
    expect(paths(on)).toContain('pages/api/newsletter/subscribe')
    expect(on.uidl.globals.env).toEqual({})

    const off = structureFor(false)
    await new NextNewsletterProjectPlugin().runAfter(off as never)
    expect(paths(off)).not.toContain('pages/api/newsletter/admin/[action]')
    expect(off.uidl.globals.env).toEqual({})
  })
})
