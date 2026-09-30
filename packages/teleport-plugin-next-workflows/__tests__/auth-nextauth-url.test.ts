/* tslint:disable:no-eval */
import { generateNextAuthRouteFile } from '../src/auth-generator'

// The generated .env ships a localhost (or empty) NEXTAUTH_URL — the deploy
// domain is unknown at build time. NextAuth builds OAuth callback/redirect URLs
// AND picks its cookie names ("__Secure-" on https) from NEXTAUTH_URL, so the
// generated /api/auth/[...nextauth] route derives the origin from the incoming
// request — without hardcoding it — while respecting an explicitly-set real
// NEXTAUTH_URL.
//
// The configured value is read ONCE per process, before any request; every request
// then gets its own origin. It used to be written back and kept, so one request
// through an https tunnel (ngrok forwarding webhooks to a local dev server)
// turned every later localhost request into an https one: NextAuth issued
// "__Secure-" cookies on localhost beside the plain ones, and the middleware,
// reading the stale plain cookie, refused a signed-in admin.

type Handler = (req: unknown, res: unknown) => unknown

const CONFIGURED_STORE_KEY = '__tqConfiguredNextAuthUrl'

// Loads the emitted route with `next-auth` + auth-options stubbed, under the
// NEXTAUTH_URL the deployment configured — as a fresh process would, unless
// `hotReload` re-evaluates it inside the same process. Returns the handler and
// a reader for the origin NextAuth saw on the last call.
function loadRoute(
  configured: string | undefined,
  options: { hotReload?: boolean } = {}
): {
  handler: Handler
  originSeen: () => string | undefined
} {
  if (!options.hotReload) {
    delete (globalThis as Record<string, unknown>)[CONFIGURED_STORE_KEY]
    if (configured === undefined) {
      delete process.env.NEXTAUTH_URL
    } else {
      process.env.NEXTAUTH_URL = configured
    }
  }
  let seen: string | undefined
  const fakeNextAuth = () => () => {
    // NextAuth reads the env var synchronously when the handler is entered.
    seen = process.env.NEXTAUTH_URL
  }
  const fakeRequire = (id: string) => (id === 'next-auth' ? fakeNextAuth : {})
  const moduleObj: { exports: Handler } = { exports: (() => undefined) as Handler }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('require', 'module', 'process', 'console', generateNextAuthRouteFile())
  fn(fakeRequire, moduleObj, process, { error: () => undefined })
  return { handler: moduleObj.exports, originSeen: () => seen }
}

const request = (headers: Record<string, string | string[]>) => ({ headers })

describe('generated NextAuth route — per-request NEXTAUTH_URL', () => {
  let saved: string | undefined

  beforeEach(() => {
    saved = process.env.NEXTAUTH_URL
  })
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[CONFIGURED_STORE_KEY]
    if (saved === undefined) {
      delete process.env.NEXTAUTH_URL
    } else {
      process.env.NEXTAUTH_URL = saved
    }
  })

  it('derives the origin from the request host when NEXTAUTH_URL is the localhost default', () => {
    const { handler, originSeen } = loadRoute('http://localhost:3000')
    handler(request({ host: 'my-app.teleporthq.dev', 'x-forwarded-proto': 'https' }), {})
    expect(originSeen()).toBe('https://my-app.teleporthq.dev')
  })

  it('uses x-forwarded-host and defaults the protocol to https for a real domain', () => {
    const { handler, originSeen } = loadRoute('')
    handler(request({ 'x-forwarded-host': 'sugary.teleporthq.dev', host: 'internal:3000' }), {})
    expect(originSeen()).toBe('https://sugary.teleporthq.dev')
  })

  it('respects an explicitly-configured real NEXTAUTH_URL on every request', () => {
    const { handler, originSeen } = loadRoute('https://custom-domain.com')
    handler(request({ host: 'my-app.teleporthq.dev', 'x-forwarded-proto': 'https' }), {})
    expect(originSeen()).toBe('https://custom-domain.com')
    handler(request({ host: 'localhost:3001' }), {})
    expect(originSeen()).toBe('https://custom-domain.com')
  })

  it('gives local development its own plain-http origin, port included', () => {
    const { handler, originSeen } = loadRoute('http://localhost:3000')
    handler(request({ host: 'localhost:3000' }), {})
    expect(originSeen()).toBe('http://localhost:3000')
    handler(request({ host: 'localhost:3001' }), {})
    expect(originSeen()).toBe('http://localhost:3001')
    handler(request({ host: '[::1]:3001' }), {})
    expect(originSeen()).toBe('http://[::1]:3001')
  })

  it('THE DEFECT: a request through an https tunnel does not change the origin of the next localhost request', () => {
    const { handler, originSeen } = loadRoute('')
    handler(
      request({
        host: 'localhost:3001',
        'x-forwarded-host': 'b16a-example.ngrok-free.app',
        'x-forwarded-proto': 'https',
      }),
      {}
    )
    expect(originSeen()).toBe('https://b16a-example.ngrok-free.app')

    // The next browser request on localhost: plain http again, so NextAuth
    // keeps using (and refreshing) the plain session cookie.
    handler(request({ host: 'localhost:3001' }), {})
    expect(originSeen()).toBe('http://localhost:3001')
  })

  it('a dev server reloading the route after a tunnel request still knows what was configured', () => {
    const first = loadRoute('')
    first.handler(
      request({ host: 'b16a-example.ngrok-free.app', 'x-forwarded-proto': 'https' }),
      {}
    )
    // process.env now holds the tunnel origin; the module is evaluated again.
    const reloaded = loadRoute(undefined, { hotReload: true })
    reloaded.handler(request({ host: 'localhost:3001' }), {})
    expect(reloaded.originSeen()).toBe('http://localhost:3001')
  })

  it('reads the client-facing hop of a proxy chain', () => {
    const { handler, originSeen } = loadRoute(undefined)
    handler(request({ host: 'my-app.teleporthq.dev', 'x-forwarded-proto': 'https,http' }), {})
    expect(originSeen()).toBe('https://my-app.teleporthq.dev')
    handler(request({ host: ['shop.example.com'], 'x-forwarded-proto': ['https'] }), {})
    expect(originSeen()).toBe('https://shop.example.com')
  })

  // Project a62338f9 published with `NEXTAUTH_URL=teleporthq.secrets.NEXTAUTH_URL`.
  // The old check saw a non-empty, non-localhost string and treated it as
  // explicitly configured, so NextAuth normalised it to
  // `https://teleporthq.secrets.nextauth_url`, advertised that as the sign-in
  // origin and issued `__Host-`/`__Secure-` cookies against it. An unresolved
  // placeholder is treated as unset, so an already-published site self-heals.
  it('overrides an unresolved secret placeholder on a published domain', () => {
    const { handler, originSeen } = loadRoute('teleporthq.secrets.NEXTAUTH_URL')
    handler(request({ host: 'rare-last-dunlin.teleporthq.dev', 'x-forwarded-proto': 'https' }), {})
    expect(originSeen()).toBe('https://rare-last-dunlin.teleporthq.dev')
  })

  it('falls back to an http origin locally, so cookies are not Secure-prefixed', () => {
    const { handler, originSeen } = loadRoute('teleporthq.secrets.NEXTAUTH_URL')
    handler(request({ host: 'localhost:3001' }), {})
    expect(originSeen()).toBe('http://localhost:3001')
  })

  it('overrides any value that is not an absolute http(s) origin', () => {
    const { handler, originSeen } = loadRoute('my-app.teleporthq.dev')
    handler(request({ host: 'my-app.teleporthq.dev', 'x-forwarded-proto': 'https' }), {})
    expect(originSeen()).toBe('https://my-app.teleporthq.dev')
  })

  it('keeps the configured value when the request names no host at all', () => {
    const { handler, originSeen } = loadRoute('http://localhost:3000')
    handler(request({}), {})
    expect(originSeen()).toBe('http://localhost:3000')
    const bare = loadRoute(undefined)
    bare.handler(request({}), {})
    expect(bare.originSeen()).toBe('http://localhost:3000')
  })
})
