import crypto from 'crypto'
import vm from 'vm'
import { buildWebPushServerModule } from '../../src/web-push/server-module-source'
import {
  buildSendRouteSource,
  buildSubscriptionsRouteSource,
} from '../../src/web-push/routes-source'

/**
 * Runs the generated push module and routes for real against a recording
 * Postgres client, a scriptable `web-push`, a scriptable clock and a recording
 * `fetch` (the send route relays the rest of a large audience to itself).
 */

export interface QueryCall {
  text: string
  params: unknown[]
}

export interface FakeDatabase {
  queries: QueryCall[]
  /** Rows answered to each SELECT, in order; empty once exhausted. */
  selectPages: Array<Array<Record<string, unknown>>>
  /** Rows an INSERT … ON CONFLICT reports: 0 when the stored row has another secret. */
  upsertRowCount: number
  deleteRowCount: number
  failWith: { code: string; message: string } | null
}

export interface FakeWebPush {
  sends: Array<{ endpoint: string; payload: string; options: Record<string, unknown> }>
  /** Status code to fail a given endpoint with. */
  failures: Record<string, number>
}

/** What `Date.now()` answers inside the generated code; each send can advance it. */
export interface FakeClock {
  now: number
  advancePerSend: number
}

export interface FakeFetch {
  calls: Array<{ url: string; init: Record<string, unknown> }>
}

export const fakeDatabase = (overrides: Partial<FakeDatabase> = {}): FakeDatabase => ({
  queries: [],
  selectPages: [],
  upsertRowCount: 1,
  deleteRowCount: 1,
  failWith: null,
  ...overrides,
})

export const fakeWebPush = (failures: Record<string, number> = {}): FakeWebPush => ({
  sends: [],
  failures,
})

export const fakeClock = (advancePerSend = 0): FakeClock => ({ now: 1_000_000, advancePerSend })

export const fakeFetch = (): FakeFetch => ({ calls: [] })

/** A VAPID pair as the editor makes it: the raw P-256 point and the 32-byte scalar. */
export const vapidKeyPair = (): { publicKey: string; privateKey: string } => {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = privateKey.export({ format: 'jwk' }) as { d: string; x: string; y: string }
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ])
  return { publicKey: point.toString('base64url'), privateKey: jwk.d }
}

const VAPID = vapidKeyPair()
export const PRIVATE_KEY = VAPID.privateKey
export const PUBLIC_KEY = VAPID.publicKey

/** A browser's subscription key: a real point on the P-256 curve. */
export const browserKey = (): string => {
  const ecdh = crypto.createECDH('prime256v1')
  ecdh.generateKeys()
  return ecdh.getPublicKey().toString('base64url')
}

export const pushEnv = (overrides: Record<string, string> = {}) => ({
  WEB_PUSH_VAPID_PUBLIC_KEY: PUBLIC_KEY,
  WEB_PUSH_VAPID_PRIVATE_KEY: PRIVATE_KEY,
  TELEPORT_DB_CONNECTION_STRING: 'postgresql://user:pass@db.test/app',
  ...overrides,
})

export const sendToken = (key = PRIVATE_KEY) =>
  crypto.createHmac('sha256', key).update('teleport-web-push-send').digest('hex')

interface Fakes {
  database: FakeDatabase
  webPush: FakeWebPush
  clock: FakeClock
  fetch: FakeFetch
}

const createRequire =
  ({ database, webPush, clock }: Fakes) =>
  (name: string) => {
    if (name === 'crypto') {
      return crypto
    }
    if (name === 'pg') {
      return {
        Client: class {
          async connect() {
            if (database.failWith) {
              throw Object.assign(new Error(database.failWith.message), database.failWith)
            }
          }
          async query(text: string, params: unknown[]) {
            database.queries.push({ text, params })
            if (text.startsWith('SELECT')) {
              return { rows: database.selectPages.shift() || [] }
            }
            if (text.startsWith('DELETE')) {
              return { rowCount: database.deleteRowCount }
            }
            return { rowCount: database.upsertRowCount }
          }
          async end(): Promise<void> {
            return undefined
          }
        },
      }
    }
    if (name === 'web-push') {
      return {
        sendNotification: async (
          subscription: { endpoint: string },
          payload: string,
          options: Record<string, unknown>
        ) => {
          webPush.sends.push({ endpoint: subscription.endpoint, payload, options })
          clock.now += clock.advancePerSend
          const status = webPush.failures[subscription.endpoint]
          if (status) {
            throw Object.assign(new Error(`push service answered ${status}`), {
              statusCode: status,
            })
          }
          return { statusCode: 201 }
        },
      }
    }
    throw new Error(`Unexpected require: ${name}`)
  }

const silent = (): undefined => undefined

/** The jest environment has no AbortController; the relay only needs its shape. */
class FakeAbortController {
  signal = { aborted: false }

  abort(): void {
    this.signal.aborted = true
  }
}

const evaluate = (
  code: string,
  env: Record<string, string>,
  requireFn: (name: string) => unknown,
  fakes: Fakes
): Record<string, unknown> => {
  const module = { exports: {} as Record<string, unknown> }
  const context = vm.createContext({
    module,
    exports: module.exports,
    require: requireFn,
    process: { env },
    Buffer,
    URL,
    console: { error: silent, warn: silent, log: silent },
    Promise,
    JSON,
    Map,
    Date: { now: () => fakes.clock.now },
    setTimeout: () => 0,
    clearTimeout: silent,
    AbortController: FakeAbortController,
    fetch: async (url: string, init: Record<string, unknown>) => {
      fakes.fetch.calls.push({ url, init })
      return { ok: true, status: 200, json: async () => ({ success: true }) }
    },
  })
  vm.runInContext(code, context)
  return module.exports
}

const withDefaults = (fakes: Partial<Fakes>): Fakes => ({
  database: fakes.database || fakeDatabase(),
  webPush: fakes.webPush || fakeWebPush(),
  clock: fakes.clock || fakeClock(),
  fetch: fakes.fetch || fakeFetch(),
})

export interface PushServer {
  configurationProblem(): string
  isCurrentKey(value: unknown): boolean
  normalizeSubscription(input: unknown): Record<string, string> | null
  normalizeUserId(value: unknown): string | null
  saveSubscription(subscription: unknown, options: Record<string, unknown>): Promise<boolean>
  deleteSubscription(endpoint: unknown, auth: unknown): Promise<boolean>
  sendNotification(
    request: Record<string, unknown>,
    subject: string
  ): Promise<Record<string, unknown>>
  verifySendToken(value: unknown): boolean
}

export const loadPushServer = (
  env: Record<string, string>,
  database: FakeDatabase,
  webPush: FakeWebPush,
  clock: FakeClock = fakeClock()
): PushServer => {
  const fakes = withDefaults({ database, webPush, clock })
  return evaluate(
    buildWebPushServerModule(),
    env,
    createRequire(fakes),
    fakes
  ) as unknown as PushServer
}

export interface RouteResponse {
  statusCode: number
  body: unknown
  headers: Record<string, string>
}

type RouteHandler = (req: Record<string, unknown>, res: Record<string, unknown>) => Promise<unknown>

export interface RouteRequest {
  method: string
  headers?: Record<string, string>
  body?: unknown
}

export interface RouteOptions {
  env?: Record<string, string>
  database?: FakeDatabase
  webPush?: FakeWebPush
  clock?: FakeClock
  fetch?: FakeFetch
  session?: Record<string, unknown> | null
}

/** One instance of a route, called as many times as a test needs — like a warm server. */
export const createRouteCaller = (route: 'subscriptions' | 'send', options: RouteOptions = {}) => {
  const fakes = withDefaults(options)
  const env = options.env || pushEnv()
  const serverRequire = createRequire(fakes)
  const server = evaluate(buildWebPushServerModule(), env, serverRequire, fakes)
  const routeRequire = (name: string) => {
    if (name.endsWith('/utils/push/web-push-server')) {
      return server
    }
    if (name === 'next-auth/jwt') {
      return { getToken: async () => options.session ?? null }
    }
    return serverRequire(name)
  }
  const source = route === 'send' ? buildSendRouteSource() : buildSubscriptionsRouteSource()
  const handler = evaluate(
    source.replace(
      'export default async function handler',
      'module.exports = async function handler'
    ),
    env,
    routeRequire,
    fakes
  ) as unknown as RouteHandler

  return async (request: RouteRequest): Promise<RouteResponse> => {
    const response: RouteResponse = { statusCode: 0, body: undefined, headers: {} }
    const res = {
      setHeader: (name: string, value: string) => {
        response.headers[name.toLowerCase()] = value
      },
      status: (code: number) => {
        response.statusCode = code
        return res
      },
      json: (body: unknown) => {
        response.body = body
        return res
      },
    }
    await handler(
      {
        method: request.method,
        headers: { host: 'shop.test', ...(request.headers || {}) },
        cookies: {},
        body: request.body,
      },
      res
    )
    return response
  }
}

export const callRoute = (
  route: 'subscriptions' | 'send',
  request: RouteRequest,
  options: RouteOptions = {}
): Promise<RouteResponse> => createRouteCaller(route, options)(request)
