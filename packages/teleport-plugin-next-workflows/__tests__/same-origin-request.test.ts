/* tslint:disable:function-constructor */
import * as nodeCrypto from 'crypto'
import * as net from 'net'
import type {
  UIDLAuthentication,
  UIDLInvoiceSettings,
  UIDLWorkflows,
} from '@teleporthq/teleport-types'
import { SameOriginRequest } from '@teleporthq/teleport-shared'
import {
  SAME_ORIGIN_REQUEST_FUNCTION,
  SAME_ORIGIN_REQUEST_SOURCE,
} from '../src/same-origin-request'
import {
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
} from '../src/api-route-generator'
import { generateDataAPIRoute } from '../src/data-api-route-generator'
import { generateAccountDeleteRoute } from '../src/account-delete-route-generator'
import { generateAccountProfilePhotoRoute } from '../src/account-profile-photo-route-generator'
import { generateProductOptionFilesRoute } from '../src/product-option-files-route-generator'
import { generateSignupRouteFile } from '../src/auth-generator'
import {
  generateForgotPasswordRoute,
  generateResetPasswordRoute,
} from '../src/password-reset-route-generator'
import { generateRuntimeStorageUploadRoute } from '../src/runtime-storage-generator'
import { generateRealtimeServerHelperCode } from '../src/realtime-generator'
import {
  generateInvoiceGenerateRouteCode,
  generateInvoiceRegenerateRouteCode,
} from '../src/invoice/api-routes-code'
import { generateSecurityRuntimeCode } from '../src/security-runtime'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'
import {
  isSecurityRuntimeSpecifier,
  loadSecurityRuntime as loadSharedSecurityRuntime,
} from './_helpers/load-security-runtime'

/**
 * Every route that changes something for a signed-in browser answers only the
 * site's own pages: the browser's Sec-Fetch-Site says same-origin, or (from a
 * browser that sends none) the Origin names the site's host. A request that
 * names no page at all is the site's own server, a scheduler or a provider,
 * and goes on to the route's own checks.
 */

type Row = Record<string, any>

const QUIET_CONSOLE = {
  error: (): undefined => undefined,
  warn: (): undefined => undefined,
  log: (): undefined => undefined,
}

const HOST = 'shop.example'
const SESSION_COOKIE = '__Host-next-auth.session-token=signed'

const OWN_PAGE = { host: HOST, origin: 'https://shop.example', 'sec-fetch-site': 'same-origin' }
const OTHER_SITE_PAGE = {
  host: HOST,
  origin: 'https://other-shop.example',
  'sec-fetch-site': 'same-site',
}
const CROSS_SITE_PAGE = {
  host: HOST,
  origin: 'https://elsewhere.example',
  'sec-fetch-site': 'cross-site',
}
// A browser that sends no Sec-Fetch-Site.
const OLDER_BROWSER_OTHER_SITE = { host: HOST, origin: 'https://other-shop.example' }
const OLDER_BROWSER_OWN_PAGE = { host: HOST, origin: 'https://shop.example' }
// The site's own server calling its route: Node's fetch sends neither header.
const SERVER = { host: HOST }

const isSameOriginRequest = (() => {
  const module = { exports: {} as any }
  new Function(
    'module',
    `${SAME_ORIGIN_REQUEST_SOURCE}\nmodule.exports = ${SAME_ORIGIN_REQUEST_FUNCTION};`
  )(module)
  return module.exports as (req: unknown) => boolean
})()

describe('which requests count as the site’s own', () => {
  it.each([
    ['a page of the site (Sec-Fetch-Site: same-origin)', OWN_PAGE, true],
    ['a page of the site, from a browser without Sec-Fetch-Site', OLDER_BROWSER_OWN_PAGE, true],
    ['the site’s own server (no Origin, no Sec-Fetch-Site)', SERVER, true],
    ['a page of another site on the same parent domain', OTHER_SITE_PAGE, false],
    ['a page of an unrelated site', CROSS_SITE_PAGE, false],
    [
      'a page of another site, from a browser without Sec-Fetch-Site',
      OLDER_BROWSER_OTHER_SITE,
      false,
    ],
    [
      'a navigation the visitor started (Sec-Fetch-Site: none)',
      { host: HOST, 'sec-fetch-site': 'none' },
      false,
    ],
    ['an opaque origin (Origin: null)', { host: HOST, origin: 'null' }, false],
    ['the same host on another port', { host: HOST, origin: 'https://shop.example:8443' }, false],
  ])('%s: %s', (_label, headers, expected) => {
    expect(isSameOriginRequest({ headers })).toBe(expected)
  })

  it('reads a request without headers as the server’s', () => {
    expect(isSameOriginRequest({})).toBe(true)
  })

  it('is the check teleport-shared exports, which every package emits', () => {
    expect(SAME_ORIGIN_REQUEST_FUNCTION).toBe(SameOriginRequest.SAME_ORIGIN_REQUEST_FUNCTION)
    expect(SAME_ORIGIN_REQUEST_SOURCE).toBe(SameOriginRequest.SAME_ORIGIN_REQUEST_SOURCE)
  })
})

/**
 * A `require` whose every module is a recording stand-in: any function a route
 * calls is logged, so a refusal can be shown to happen before the route reads
 * the session, touches the database or calls anything at all.
 */
const recordingModules = (calls: string[]) => {
  const stub = (path: string): any =>
    new Proxy(
      function stand(): undefined {
        return undefined
      },
      {
        get: (_target, prop) => {
          if (prop === 'then' || typeof prop === 'symbol') {
            return undefined
          }
          if (prop === 'toString' || prop === 'valueOf') {
            return () => path
          }
          return stub(path + '.' + String(prop))
        },
        apply: () => {
          calls.push(path)
          return stub(path + '()')
        },
        construct: () => {
          calls.push('new ' + path)
          return stub('new ' + path)
        },
      }
    )
  return (name: string) => stub(name)
}

const recordingResponse = () => {
  const res: Row = { statusCode: 0, body: undefined, headers: {} }
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
  res.writeHead = (code: number) => {
    res.statusCode = code
  }
  res.write = () => true
  res.end = (): undefined => undefined
  return res
}

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
} as unknown as UIDLAuthentication

const INVOICES = {
  enabled: true,
  invoicePrefix: 'INV-',
  emailDelivery: { enabled: false },
} as unknown as UIDLInvoiceSettings

const ONE_STEP_SEGMENT = {
  id: 'server-1',
  env: 'server',
  nodeIds: ['save'],
  nodes: [
    {
      id: 'save',
      type: 'data-create-item',
      label: 'Save The Entry',
      stepNumber: 1,
      executionEnv: 'server',
      config: {
        dataSourceId: 'ds-1',
        tableName: 'entries',
        columnMappings: [{ column: 'title', value: 'x' }],
      },
    },
  ],
  edges: [],
  entryNodeIds: ['save'],
} as unknown as WorkflowSegment

/**
 * Every route the generator emits that a signed-in browser posts a change to,
 * with how to reach its handler: the module's export, or (realtime) the relay
 * each realtime route hands its request to.
 */
const GUARDED_ROUTES: Array<{ route: string; code: string; handler?: string; query?: Row }> = [
  { route: 'a workflow step', code: generateServerSegmentAPIRoute(ONE_STEP_SEGMENT, 'Save') },
  {
    route: 'a streaming workflow step',
    code: generateStreamingServerSegmentAPIRoute(ONE_STEP_SEGMENT, 'Save'),
  },
  {
    route: 'the data API',
    code: generateDataAPIRoute({ authUsersTableName: 'users' }),
    query: { params: ['ds-1', 'create'] },
  },
  { route: 'account deletion', code: generateAccountDeleteRoute({}) },
  { route: 'the profile-photo release', code: generateAccountProfilePhotoRoute({}) },
  { route: 'the option-file release', code: generateProductOptionFilesRoute() },
  { route: 'sign-up', code: generateSignupRouteFile(AUTH) },
  { route: 'forgot-password', code: generateForgotPasswordRoute({}) },
  { route: 'reset-password', code: generateResetPasswordRoute() },
  { route: 'the runtime-storage upload', code: generateRuntimeStorageUploadRoute() },
  {
    route: 'a realtime call',
    code: generateRealtimeServerHelperCode({} as UIDLWorkflows),
    handler: 'relay',
  },
  { route: 'issuing an invoice', code: generateInvoiceGenerateRouteCode(INVOICES) },
  {
    route: 'rebuilding an invoice',
    code: generateInvoiceRegenerateRouteCode(INVOICES),
    query: { id: 'inv-1' },
  },
]

const runGuardedRoute = async (
  entry: (typeof GUARDED_ROUTES)[number],
  headers: Row
): Promise<{ res: Row; calls: string[]; fetched: string[] }> => {
  const calls: string[] = []
  const fetched: string[] = []
  const module = { exports: {} as any }
  const source = entry.code.replace(
    /^export default async function handler/m,
    'module.exports = async function handler'
  )
  new Function('require', 'module', 'exports', 'process', 'console', 'fetch', 'Buffer', source)(
    recordingModules(calls),
    module,
    module.exports,
    { env: { NEXTAUTH_SECRET: 'secret', TELEPORT_DB_CONNECTION_STRING: 'postgres://x' } },
    QUIET_CONSOLE,
    async (url: string) => {
      fetched.push(url)
      return { ok: true, status: 200, json: async () => ({}) }
    },
    Buffer
  )
  const handler = entry.handler ? module.exports[entry.handler] : module.exports
  // Loading the module may call what it requires; only the request counts.
  calls.length = 0
  const res = recordingResponse()
  const req = {
    method: 'POST',
    headers: { cookie: SESSION_COOKIE, 'content-type': 'application/json', ...headers },
    body: { context: {}, email: 'a@site.test', password: 'Typed#Pass1', token: 'a'.repeat(64) },
    query: entry.query || {},
    socket: { remoteAddress: '203.0.113.7' },
  }
  await (entry.handler ? handler(req, res, { scope: 'realtime-message' }) : handler(req, res))
  return { res, calls, fetched }
}

describe('a page of another site gets 403 from every route that changes something', () => {
  for (const entry of GUARDED_ROUTES) {
    it(`${entry.route}: answers 403 before it reads the session, the database or anything else`, async () => {
      for (const headers of [OTHER_SITE_PAGE, CROSS_SITE_PAGE, OLDER_BROWSER_OTHER_SITE]) {
        const { res, calls, fetched } = await runGuardedRoute(entry, headers)
        expect([headers, res.statusCode]).toEqual([headers, 403])
        // Counting the request against the visitor's limit is all it may do.
        expect(calls.filter((call) => !/\.rateLimitRequest$/.test(call))).toEqual([])
        expect(fetched).toEqual([])
      }
    })
  }

  it('each route carries the one shared check, once', () => {
    for (const entry of GUARDED_ROUTES) {
      const copies = entry.code.split(`function ${SAME_ORIGIN_REQUEST_FUNCTION}(req)`).length - 1
      expect([entry.route, copies]).toEqual([entry.route, 1])
    }
  })
})

describe('the data API: the site’s own pages and server are answered as before', () => {
  const SECRET = 'server-secret'

  const bootDataRoute = () => {
    const securityRuntime = loadSharedSecurityRuntime()
    const queries: string[] = []
    class FakeClient {
      public async connect(): Promise<void> {
        return undefined
      }
      public async end(): Promise<void> {
        return undefined
      }
      public async query(sql: string) {
        queries.push(sql)
        return { rows: [{ id: 'row-1' }], rowCount: 1 }
      }
    }
    const module = { exports: {} as any }
    new Function(
      'require',
      'module',
      'exports',
      'process',
      'console',
      generateDataAPIRoute({ authUsersTableName: 'users' })
    )(
      (name: string): any => {
        if (name === 'pg') {
          return { Client: FakeClient }
        }
        if (name === 'next-auth/jwt') {
          return { getToken: async () => ({ id: 'u-1', role: 'user' }) }
        }
        if (isSecurityRuntimeSpecifier(name)) {
          return securityRuntime
        }
        throw new Error('unexpected require: ' + name)
      },
      module,
      module.exports,
      { env: { NEXTAUTH_SECRET: SECRET, TELEPORT_DB_CONNECTION_STRING: 'postgresql://x' } },
      QUIET_CONSOLE
    )
    return async (operation: string, body: Row, headers: Row) => {
      queries.length = 0
      const res = recordingResponse()
      await module.exports(
        { method: 'POST', query: { params: ['ds-1', operation] }, headers, body },
        res
      )
      return { status: res.statusCode, body: res.body, queries: queries.slice() }
    }
  }

  const SERVER_WRITE = {
    tableName: 'entries',
    columnMappings: { title: 'Hello' },
  }

  it('a server write (the app secret, no Origin) is answered as it always was', async () => {
    const run = bootDataRoute()
    const answer = await run('create', SERVER_WRITE, {
      ...SERVER,
      'x-internal-data-secret': SECRET,
    })
    expect(answer.status).toBe(200)
    expect(answer.queries.some((sql) => sql.startsWith('INSERT INTO'))).toBe(true)
  })

  it('a request from the site’s own page gets the answer a request without the headers gets', async () => {
    const run = bootDataRoute()
    const browserRead = { tableName: 'teleport_products' }
    for (const ownPage of [OWN_PAGE, OLDER_BROWSER_OWN_PAGE]) {
      const fromPage = await run('select', browserRead, { ...ownPage, cookie: SESSION_COOKIE })
      const plain = await run('select', browserRead, { ...SERVER, cookie: SESSION_COOKIE })
      expect(fromPage).toEqual(plain)
      expect(fromPage.status).not.toBe(403)
    }
  })

  it('the same write from another site’s page is refused, and nothing is run', async () => {
    const run = bootDataRoute()
    const answer = await run('create', SERVER_WRITE, {
      ...OTHER_SITE_PAGE,
      'x-internal-data-secret': SECRET,
    })
    expect(answer.status).toBe(403)
    expect(answer.queries).toEqual([])
  })
})

describe('a workflow step: the site’s own pages and server run it as before', () => {
  const savedSecret = process.env.NEXTAUTH_SECRET
  const savedFetch = (globalThis as any).fetch
  const dataCalls: string[] = []

  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = 'segment-origin-test-secret'
    ;(globalThis as any).fetch = async (url: string) => {
      dataCalls.push(url)
      return { ok: true, status: 200, json: async () => ({ success: true, item: { id: 'e-1' } }) }
    }
  })
  beforeEach(() => {
    dataCalls.length = 0
  })
  afterAll(() => {
    ;(globalThis as any).fetch = savedFetch
    if (savedSecret === undefined) {
      delete process.env.NEXTAUTH_SECRET
    } else {
      process.env.NEXTAUTH_SECRET = savedSecret
    }
  })

  const loadSecurityRuntime = () => {
    const module = { exports: {} as any }
    new Function(
      'module',
      'exports',
      'require',
      'process',
      'console',
      'Buffer',
      'Date',
      generateSecurityRuntimeCode()
    )(
      module,
      module.exports,
      (id: string) => {
        if (id === 'crypto') {
          return nodeCrypto
        }
        if (id === 'net') {
          return net
        }
        throw new Error("Cannot find module '" + id + "'")
      },
      { env: {} },
      QUIET_CONSOLE,
      Buffer,
      Date
    )
    return module.exports
  }

  const bootSegmentRoute = () => {
    const runtime = loadServerRuntime()
    const security = loadSecurityRuntime()
    const module = { exports: {} as any }
    new Function(
      'module',
      'exports',
      'require',
      'console',
      generateServerSegmentAPIRoute(ONE_STEP_SEGMENT, 'Save')
    )(
      module,
      module.exports,
      (id: string) =>
        id.endsWith('server-runtime') ? runtime : id.endsWith('security-runtime') ? security : {},
      QUIET_CONSOLE
    )
    return async (headers: Row) => {
      const res = recordingResponse()
      await module.exports(
        {
          method: 'POST',
          body: { context: {} },
          headers,
          socket: { remoteAddress: '203.0.113.7' },
        },
        res
      )
      return res
    }
  }

  it('runs the step for the site’s own page and for the site’s own server', async () => {
    const call = bootSegmentRoute()
    for (const headers of [OWN_PAGE, OLDER_BROWSER_OWN_PAGE, SERVER]) {
      const res = await call(headers)
      expect([headers, res.statusCode]).toEqual([headers, 200])
    }
    expect(dataCalls).toHaveLength(3)
  })

  it('runs nothing for a page of another site', async () => {
    const call = bootSegmentRoute()
    for (const headers of [OTHER_SITE_PAGE, CROSS_SITE_PAGE, OLDER_BROWSER_OTHER_SITE]) {
      const res = await call(headers)
      expect([headers, res.statusCode, res.body]).toEqual([headers, 403, { error: 'Forbidden' }])
    }
    expect(dataCalls).toEqual([])
  })
})
