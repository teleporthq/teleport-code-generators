import type { UIDLAuthentication, UIDLWorkflow, UIDLWorkflows } from '@teleporthq/teleport-types'
import { generateSignupRouteFile } from '../src/auth-generator'
import { generateAccountDeleteRoute } from '../src/account-delete-route-generator'
import { hasAutomationEventBus } from '../src/automations/automations-scope'
import { accountSignup } from '../src/nodes/account/account-signup'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { insertedLines } from './_helpers/inserted-lines'

/**
 * Account events (spec §5.1): in a project with automations, the signup route
 * (and a signup a server workflow runs) records `user-signed-up` once the
 * account exists, and the account-deletion route records `user-deleted` once
 * the deletion is committed, both on the in-app event bus
 * (`lib/automations/event-bus.js`), which wakes the automations on the app's
 * own origin as the request reached it. Best effort, like the emails: a failing
 * event never fails the request. A project without automations gets every
 * route exactly as before.
 *
 * The generated routes are EXECUTED with their modules stubbed, so the order
 * of what they do is proven by what they call.
 */

type Row = Record<string, unknown>

interface FakeResponse {
  statusCode: number
  body: unknown
  status: (code: number) => FakeResponse
  json: (body: unknown) => FakeResponse
  setHeader: () => void
}

type RouteHandler = (req: Row, res: FakeResponse) => Promise<unknown>

const BUS = '../../../lib/automations/event-bus'
const CREATED_AT = '2026-10-22T14:03:00.000Z'

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

const requireFrom =
  (modules: Record<string, unknown>) =>
  (id: string): unknown => {
    if (!Object.prototype.hasOwnProperty.call(modules, id)) {
      throw new Error('The code required an unexpected module: ' + id)
    }
    const value = modules[id]
    if (value instanceof Error) {
      throw value
    }
    return value
  }

const quietConsole = (errors: unknown[][]) => ({
  error: (...args: unknown[]) => {
    errors.push(args)
  },
  warn: () => undefined,
  log: () => undefined,
})

const loadRoute = (
  source: string,
  modules: Record<string, unknown>,
  errors: unknown[][]
): RouteHandler => {
  const module = { exports: {} as unknown }
  const env = { NEXTAUTH_SECRET: 'app-secret', TELEPORT_DB_CONNECTION_STRING: 'postgres://db' }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'console', 'process', source)(
    module,
    module.exports,
    requireFrom(modules),
    quietConsole(errors),
    { env }
  )
  return module.exports as RouteHandler
}

interface BusCalls {
  calls: string[]
  emitted: Row[]
  requests: unknown[]
}

const busCalls = (): BusCalls => ({ calls: [], emitted: [], requests: [] })

/** A bus that records what it is handed, or fails the way the test asks. */
const fakeBus = (seen: BusCalls, fail?: 'reject') => ({
  emitBusinessEvent: async (input: Row, req: unknown) => {
    seen.calls.push('emit')
    if (fail === 'reject') {
      throw new Error('the database is down')
    }
    seen.emitted.push(input)
    seen.requests.push(req)
    return { recorded: true, id: '1' }
  },
})

const LOCALE = { resolveRequestLocale: () => 'en' }

// utils/auth/hash-password: the hasher, and the password policy the routes check.
const HASH_PASSWORD = Object.assign((password: string) => 'hashed:' + password, {
  passwordPolicyError: () => '',
})

// utils/security-runtime: every request within its rate limits.
const SECURITY_RUNTIME = {
  rateLimitRequest: async () => true,
  sendClientError: (res: FakeResponse, status: number, message: string) => {
    res.status(status).json({ error: message })
  },
}

const userEvent = (type: string, source: string) => ({
  type,
  entityType: 'user',
  entityId: 'u1',
  payload: {
    user: {
      id: 'u1',
      email: 'ava@example.com',
      name: 'Ava Thompson',
      role: 'user',
      source,
      createdAt: CREATED_AT,
    },
  },
  actor: 'ava@example.com',
  actorType: 'customer',
  dedupeKey: type + ':u1',
})

const workflowsOf = (triggers: Row[]): UIDLWorkflows =>
  ({
    workflows: Object.fromEntries(
      triggers.map((trigger, index) => [
        'wf-' + index,
        { id: 'wf-' + index, name: 'W', trigger, nodes: [], edges: [] },
      ])
    ),
  } as unknown as UIDLWorkflows)

describe('hasAutomationEventBus', () => {
  it('is true for an automation that names its event, the bus being generated for it', () => {
    const workflows = workflowsOf([
      { type: 'event-business-event', config: { eventType: 'user-signed-up' } },
    ])
    expect(hasAutomationEventBus(workflows)).toBe(true)
    // The automations collectAutomationWorkflows found answer the same.
    expect(hasAutomationEventBus(Object.values(workflows.workflows) as UIDLWorkflow[])).toBe(true)
  })

  it('is false without an automation, or for one that names no event (it is skipped)', () => {
    expect(hasAutomationEventBus(undefined)).toBe(false)
    expect(hasAutomationEventBus(workflowsOf([{ type: 'event-page-loaded', config: {} }]))).toBe(
      false
    )
    expect(
      hasAutomationEventBus(
        workflowsOf([{ type: 'event-business-event', config: { eventType: '  ' } }])
      )
    ).toBe(false)
  })
})

describe('signup route — user-signed-up', () => {
  const auth = {
    enabled: true,
    passwordAuthEnabled: true,
    dataSourceType: 'postgresql',
    customUserProperties: [],
    providers: [],
    tables: {},
    authPages: {},
  } as unknown as UIDLAuthentication

  const run = async (options: {
    withAutomations?: boolean
    bus?: unknown
    exists?: boolean
    created?: Row | null
  }) => {
    const calls: string[] = []
    const errors: unknown[][] = []
    const source = generateSignupRouteFile(auth, {}, { withAutomations: options.withAutomations })
    const modules: Record<string, unknown> = {
      '../../../utils/auth/hash-password': HASH_PASSWORD,
      '../../../utils/security-runtime': SECURITY_RUNTIME,
      '../../../utils/auth/auth-options': {
        // A taken address is an account: it has a password.
        findSignupUserByEmail: async () =>
          options.exists === true
            ? { id: 'u0', email: 'ava@example.com', password: 'hashed:x' }
            : null,
        createUser: async (data: Row) => {
          calls.push('createUser')
          if (options.created === null) {
            return null
          }
          return {
            id: 'u1',
            role: 'user',
            created_at: new Date(CREATED_AT),
            ...data,
            ...(options.created || {}),
          }
        },
        sanitizeUser: (user: Row) => ({ id: user.id, email: user.email }),
      },
      '../../../utils/email/email-locale': LOCALE,
    }
    if (options.bus !== undefined) {
      modules[BUS] = options.bus
    }
    const handler = loadRoute(source, modules, errors)
    const res = fakeResponse()
    const req = {
      method: 'POST',
      headers: { host: 'shop.test' },
      body: { email: 'ava@example.com', password: 'secret12', name: 'Ava Thompson' },
    }
    await handler(req, res)
    return { res, calls, errors, source, req }
  }

  it('records the new account once it exists, keyed on it, without its credentials', async () => {
    const seen = busCalls()
    const result = await run({ withAutomations: true, bus: fakeBus(seen) })

    expect(result.res.statusCode).toBe(201)
    // Built from what the visitor sent: a taken address is answered the same.
    expect(result.res.body).toEqual({ user: { email: 'ava@example.com', name: 'Ava Thompson' } })
    expect(result.calls).toEqual(['createUser'])
    expect(seen.calls).toEqual(['emit'])
    expect(seen.emitted).toEqual([userEvent('user-signed-up', 'signup')])
    // The bus wakes the automations on the origin this request reached.
    expect(seen.requests).toEqual([result.req])
    expect(JSON.stringify(seen.emitted)).not.toContain('hashed:')
    // After the account is created, and before the route answers.
    const source = result.source
    expect(source.indexOf('const newUser = await createUser(userData);')).toBeLessThan(
      source.indexOf("await recordAccountEvent('user-signed-up', newUser, 'signup', req);")
    )
    // (The last 201 is the new account's; the first answers a taken address.)
    expect(source.indexOf("await recordAccountEvent('user-signed-up'")).toBeLessThan(
      source.lastIndexOf('res.status(201)')
    )
  })

  it('still signs the visitor up when the event cannot be recorded', async () => {
    const rejecting = await run({ withAutomations: true, bus: fakeBus(busCalls(), 'reject') })
    expect(rejecting.res.statusCode).toBe(201)
    expect(String(rejecting.errors[0][0])).toContain(
      '[account-signup] could not record the user-signed-up event'
    )

    const missing = await run({ withAutomations: true, bus: new Error('Cannot find module') })
    expect(missing.res.statusCode).toBe(201)
  })

  it('records nothing for a signup that did not create an account', async () => {
    const seen = busCalls()
    const exists = await run({ withAutomations: true, bus: fakeBus(seen), exists: true })
    // A taken address is answered like a new one (its owner is told by email).
    expect(exists.res.statusCode).toBe(201)
    const failed = await run({ withAutomations: true, bus: fakeBus(seen), created: null })
    expect(failed.res.statusCode).toBe(500)
    expect(seen.emitted).toEqual([])
  })

  it('never reaches for the bus without automations', async () => {
    // The shim throws on any module it was not given.
    const result = await run({})
    expect(result.res.statusCode).toBe(201)
    expect(result.errors).toEqual([])
  })
})

describe('account-deletion route — user-deleted', () => {
  const USER_ROW = {
    id: 'u1',
    email: 'ava@example.com',
    name: 'Ava Thompson',
    role: 'user',
    source: 'checkout',
    password: 'hashed:secret12',
    created_at: new Date(CREATED_AT),
  }

  const run = async (options: {
    withAutomations?: boolean
    bus?: unknown
    found?: boolean
    failDelete?: boolean
  }) => {
    const calls: string[] = []
    const errors: unknown[][] = []
    const source = generateAccountDeleteRoute({ withAutomations: options.withAutomations })
    class FakeClient {
      public async connect() {
        return undefined
      }

      public async end() {
        return undefined
      }

      public async query(sql: string) {
        if (sql === 'COMMIT' || sql === 'ROLLBACK') {
          calls.push(sql)
        }
        if (sql.startsWith('SELECT * FROM users WHERE id = $1')) {
          return { rows: options.found === false ? [] : [USER_ROW] }
        }
        if (sql.startsWith('DELETE FROM users') && options.failDelete) {
          throw new Error('the row is locked')
        }
        return { rows: [] }
      }
    }
    const modules: Record<string, unknown> = {
      pg: { Client: FakeClient },
      'next-auth/jwt': { getToken: async () => ({ id: 'u1', iat: 1 }) },
      '../../../utils/email/email-locale': LOCALE,
    }
    if (options.bus !== undefined) {
      modules[BUS] = options.bus
    }
    const handler = loadRoute(source, modules, errors)
    const res = fakeResponse()
    // The session cookie an https site sets (__Host-, see the auth options).
    const req = {
      method: 'POST',
      headers: { host: 'shop.test', cookie: '__Host-next-auth.session-token=signed' },
    }
    await handler(req, res)
    return { res, calls, errors, source, req }
  }

  it('records the deleted account once the deletion is committed', async () => {
    const seen = busCalls()
    const result = await run({ withAutomations: true, bus: fakeBus(seen) })

    expect(result.res.statusCode).toBe(200)
    expect(result.calls).toEqual(['COMMIT'])
    expect(seen.calls).toEqual(['emit'])
    expect(seen.emitted).toEqual([userEvent('user-deleted', 'checkout')])
    expect(seen.requests).toEqual([result.req])
    expect(JSON.stringify(seen.emitted)).not.toContain('hashed:')
    const source = result.source
    expect(source.indexOf("await client.query('COMMIT');")).toBeLessThan(
      source.indexOf("await recordAccountEvent('user-deleted', deletedUser, '', req);")
    )
    expect(source.indexOf("await recordAccountEvent('user-deleted'")).toBeLessThan(
      source.indexOf('return res.status(200)')
    )
  })

  it('still answers the deletion when the event cannot be recorded', async () => {
    const result = await run({ withAutomations: true, bus: fakeBus(busCalls(), 'reject') })
    expect(result.res.statusCode).toBe(200)
    expect(String(result.errors[0][0])).toContain(
      '[account-delete] could not record the user-deleted event'
    )
  })

  it('records nothing when no account was deleted', async () => {
    const seen = busCalls()
    const failed = await run({ withAutomations: true, bus: fakeBus(seen), failDelete: true })
    expect(failed.res.statusCode).toBe(500)
    expect(failed.calls).toEqual(['ROLLBACK'])
    const missing = await run({ withAutomations: true, bus: fakeBus(seen), found: false })
    expect(missing.res.statusCode).toBe(404)
    expect(seen.emitted).toEqual([])
  })

  it('never reaches for the bus without automations', async () => {
    const result = await run({})
    expect(result.res.statusCode).toBe(200)
    expect(result.errors).toEqual([])
  })
})

describe('a signup a server workflow runs — user-signed-up', () => {
  type SignupHandler = (config: Row, context: Row) => Promise<Row>

  const load = (source: string, seen: BusCalls, calls: string[]): SignupHandler => {
    const modules: Record<string, unknown> = {
      '../../../utils/auth/hash-password': HASH_PASSWORD,
      '../../../utils/auth/auth-options': {
        findSignupUserByEmail: async () => null,
        createUser: async (data: Row) => {
          calls.push('createUser')
          return { id: 'u1', created_at: new Date(CREATED_AT), ...data }
        },
        sanitizeUser: (user: Row) => ({ id: user.id, email: user.email }),
      },
      [BUS]: fakeBus(seen),
    }
    // eslint-disable-next-line no-new-func
    return new Function('require', 'console', source + '\nreturn account_signup;')(
      requireFrom(modules),
      quietConsole([])
    ) as SignupHandler
  }

  const config = { email: 'ava@example.com', password: 'secret12', name: 'Ava Thompson' }

  it('records the account it created, with the same payload as the signup route', async () => {
    const seen = busCalls()
    const calls: string[] = []
    const request = { ip: '10.0.0.1', headers: { host: 'shop.test' } }
    const handler = load(
      accountSignup.generateServerHandler!({ withAutomations: true, relativePrefix: '../../..' }),
      seen,
      calls
    )
    const result = await handler(config, { __request: request })

    expect(result.success).toBe(true)
    expect(calls).toEqual(['createUser'])
    expect(seen.emitted).toEqual([userEvent('user-signed-up', 'signup')])
    expect(seen.requests).toEqual([request])
  })

  it('reaches the bus from the file it is inlined into', () => {
    const source = accountSignup.generateServerHandler!({
      withAutomations: true,
      relativePrefix: '../../../..',
    })
    expect(source).toContain("require('../../../../lib/automations/event-bus')")
  })

  it('is unchanged without automations, and never reaches for the bus', async () => {
    const plain = accountSignup.generateServerHandler!()
    expect(accountSignup.generateServerHandler!({ withAutomations: false })).toBe(plain)
    const seen = busCalls()
    await load(plain, seen, [])(config, {})
    expect(seen.calls).toEqual([])
  })
})

describe('the generated project — account events', () => {
  interface GeneratedEntry {
    path: string[]
    files: Array<{ name: string; fileType?: string; content: unknown }>
  }

  const signupNode = {
    id: 'su',
    type: 'account-signup',
    config: { email: 'a@b.c', password: 'secret12', name: 'A' },
    stepNumber: 1,
    label: 'Sign up',
  }
  const WORKFLOWS: Record<string, Row> = {
    'wf-delete': {
      id: 'wf-delete',
      name: 'Delete my account',
      trigger: { type: 'event-element-click', nodeId: 't', scope: 'component', config: {} },
      nodes: [{ id: 'del', type: 'account-delete-current', config: {}, stepNumber: 1, label: 'D' }],
      edges: [{ id: 'e1', source: 't', target: 'del' }],
    },
    'wf-page': {
      id: 'wf-page',
      name: 'Load orders',
      trigger: {
        type: 'event-page-loaded',
        nodeId: 't',
        scope: 'page',
        config: { allPages: true },
      },
      nodes: [
        {
          id: 'select',
          type: 'data-select',
          config: { dataSourceId: 'ds-1', tableName: 'teleport_orders', filters: [] },
          stepNumber: 1,
          label: 'Orders',
        },
      ],
      edges: [{ id: 'e1', source: 't', target: 'select' }],
    },
    'wf-hook': {
      id: 'wf-hook',
      name: 'Sign up from the CRM',
      trigger: { type: 'event-webhook-received', nodeId: 't', scope: 'global', config: {} },
      nodes: [signupNode],
      edges: [{ id: 'e1', source: 't', target: 'su' }],
      webhookConfig: { httpMethod: 'POST', urlPath: 'webhooks/signup' },
    },
  }
  const AUTOMATION: Row = {
    id: 'wf-auto',
    name: 'Welcome',
    trigger: {
      type: 'event-business-event',
      nodeId: 't',
      scope: 'global',
      config: { eventType: 'user-signed-up' },
    },
    nodes: [
      {
        id: 'post',
        type: 'general-http-request',
        config: { url: 'https://echo.test/welcome', method: 'POST', body: {} },
        stepNumber: 1,
        label: 'Post',
      },
    ],
    edges: [{ id: 'e1', source: 't', target: 'post' }],
  }

  const generate = async (workflows: Record<string, Row>): Promise<Map<string, string>> => {
    const structure = {
      uidl: {
        name: 'Store',
        globals: { settings: { title: 'Store', language: 'en' }, env: { NEXTAUTH_SECRET: 'k' } },
        root: {
          name: 'Root',
          stateDefinitions: {
            route: { type: 'string', defaultValue: 'Home', values: [{ value: 'Home' }] },
          },
          node: { type: 'element', content: { elementType: 'container', children: [] } },
        },
        components: {},
        dataSources: { 'ds-1': { id: 'ds-1', type: 'teleport', name: 'Store', config: {} } },
        // Where the automation tables live (the GUI mapper's `automations`):
        // without it no event bus is generated.
        automations: { dataSourceId: 'ds-1', dataSourceType: 'teleport' },
        authentication: {
          enabled: true,
          passwordAuthEnabled: true,
          dataSourceType: 'teleport',
          dataSourceId: 'ds-1',
          providers: [],
          customUserProperties: [],
          tables: { users: [{ name: 'id' }, { name: 'email' }, { name: 'password' }] },
          authPages: { signIn: { route: '/sign-in' } },
        },
        workflows: { workflows: JSON.parse(JSON.stringify(workflows)) },
      },
      strategy: { pages: { options: {} } },
      files: new Map<string, GeneratedEntry>(),
      dependencies: {},
      devDependencies: {},
    }
    const warn = console.warn
    console.warn = () => undefined
    try {
      await new NextWorkflowProjectPlugin().runAfter(structure as never)
    } finally {
      console.warn = warn
    }
    const files = new Map<string, string>()
    for (const entry of structure.files.values()) {
      for (const file of entry.files) {
        files.set(
          [...entry.path, `${file.name}.${file.fileType || 'js'}`].join('/'),
          String(file.content)
        )
      }
    }
    return files
  }

  const SIGNUP = 'pages/api/auth/signup.js'
  const DELETE = 'pages/api/account/delete-current.js'
  const WEBHOOK = 'pages/api/webhooks/signup.js'
  const DATA_API = 'pages/api/data/[...params].js'

  it('records them in a project with an automation, next to the event bus', async () => {
    const files = await generate({ ...WORKFLOWS, 'wf-auto': AUTOMATION })
    expect(files.has('lib/automations/event-bus.js')).toBe(true)
    expect(files.get(SIGNUP)).toContain(
      "await recordAccountEvent('user-signed-up', newUser, 'signup', req);"
    )
    expect(files.get(DELETE)).toContain(
      "await recordAccountEvent('user-deleted', deletedUser, '', req);"
    )
    expect(files.get(WEBHOOK)).toContain(
      "await recordAccountEvent('user-signed-up', newUser, 'signup', context && context.__request);"
    )
    // The route hands the request to the node, so the event is recorded on
    // the origin the request reached (rate limiter or not).
    expect(files.get(WEBHOOK)).toContain('context.__request = { headers: req.headers || {} };')
    expect(files.get(DATA_API)).toContain('wakeAutomations(req);')
  })

  it('hands the request to a signup a cron runs too, and only with automations', async () => {
    const cron: Row = {
      id: 'wf-cron',
      name: 'Nightly import',
      trigger: {
        type: 'event-cron-triggered',
        nodeId: 't',
        scope: 'global',
        config: { schedule: '0 3 * * *' },
      },
      nodes: [signupNode],
      edges: [{ id: 'e1', source: 't', target: 'su' }],
    }
    const cronRoute = (files: Map<string, string>) =>
      Array.from(files.entries()).filter(([path]) => path.startsWith('pages/api/workflows/'))
    const withAutomation = cronRoute(await generate({ 'wf-cron': cron, 'wf-auto': AUTOMATION }))
    expect(withAutomation).toHaveLength(1)
    expect(withAutomation[0][1]).toContain('context.__request = { headers: req.headers || {} };')
    const without = cronRoute(await generate({ 'wf-cron': cron }))
    expect(without).toHaveLength(1)
    expect(without[0][1]).not.toContain('context.__request')
  })

  it('changes nothing without one: an automation only ADDS to these routes, and nothing else', async () => {
    const without = await generate(WORKFLOWS)
    const withAutomation = await generate({ ...WORKFLOWS, 'wf-auto': AUTOMATION })

    for (const content of without.values()) {
      expect(content).not.toContain('recordAccountEvent')
      expect(content).not.toContain('wakeAutomations')
      expect(content).not.toContain('lib/automations')
    }
    const routesWithEvents = [SIGNUP, DELETE, WEBHOOK, DATA_API]
    for (const [path, content] of without) {
      if (routesWithEvents.indexOf(path) === -1) {
        expect({ path, content: withAutomation.get(path) }).toEqual({ path, content })
        continue
      }
      const diff = insertedLines(content, withAutomation.get(path) as string)
      expect({ path, kept: diff.kept }).toEqual({ path, kept: true })
      expect(diff.inserted.join('\n')).toMatch(/recordAccountEvent|wakeAutomations/)
    }
  })
})
