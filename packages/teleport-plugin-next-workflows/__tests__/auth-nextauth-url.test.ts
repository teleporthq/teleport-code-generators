/* tslint:disable:no-eval */
import { generateNextAuthRouteFile } from '../src/auth-generator'

// The generated .env ships a localhost NEXTAUTH_URL (the deploy domain is
// unknown at build time). NextAuth builds OAuth callback/redirect URLs from
// NEXTAUTH_URL, so on a published domain that localhost value would break the
// OAuth round-trip. The generated /api/auth/[...nextauth] route now derives the
// real origin from the incoming request — without hardcoding it — while
// respecting an explicitly-set NEXTAUTH_URL and leaving local dev alone.

// Load the emitted route with `next-auth` + auth-options stubbed so we can
// exercise the per-request NEXTAUTH_URL derivation against a fake request.
function loadRoute(): (req: any, res: any) => any {
  const code = generateNextAuthRouteFile()
  const fakeNextAuth = () => (_req: any, _res: any) => ({ usedUrl: process.env.NEXTAUTH_URL })
  const fakeRequire = (id: string) => (id === 'next-auth' ? fakeNextAuth : {})
  const moduleObj: { exports: any } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('require', 'module', 'process', code)
  fn(fakeRequire, moduleObj, process)
  return moduleObj.exports
}

describe('generated NextAuth route — dynamic NEXTAUTH_URL', () => {
  const handler = loadRoute()
  let saved: string | undefined

  beforeEach(() => {
    saved = process.env.NEXTAUTH_URL
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.NEXTAUTH_URL
    else process.env.NEXTAUTH_URL = saved
  })

  it('derives the origin from the request host when NEXTAUTH_URL is the localhost default', () => {
    process.env.NEXTAUTH_URL = 'http://localhost:3000'
    handler({ headers: { host: 'my-app.teleporthq.dev', 'x-forwarded-proto': 'https' } }, {})
    expect(process.env.NEXTAUTH_URL).toBe('https://my-app.teleporthq.dev')
  })

  it('uses x-forwarded-host and defaults the protocol to https', () => {
    process.env.NEXTAUTH_URL = ''
    handler({ headers: { 'x-forwarded-host': 'sugary.teleporthq.dev', host: 'internal:3000' } }, {})
    expect(process.env.NEXTAUTH_URL).toBe('https://sugary.teleporthq.dev')
  })

  it('respects an explicitly-configured real NEXTAUTH_URL (does not clobber it)', () => {
    process.env.NEXTAUTH_URL = 'https://custom-domain.com'
    handler({ headers: { host: 'my-app.teleporthq.dev', 'x-forwarded-proto': 'https' } }, {})
    expect(process.env.NEXTAUTH_URL).toBe('https://custom-domain.com')
  })

  it('leaves local development untouched', () => {
    process.env.NEXTAUTH_URL = 'http://localhost:3000'
    handler({ headers: { host: 'localhost:3000' } }, {})
    expect(process.env.NEXTAUTH_URL).toBe('http://localhost:3000')
  })

  // Project a62338f9 published with `NEXTAUTH_URL=teleporthq.secrets.NEXTAUTH_URL`.
  // The old check saw a non-empty, non-localhost string and treated it as
  // explicitly configured, so NextAuth normalised it to
  // `https://teleporthq.secrets.nextauth_url`, advertised that as the sign-in
  // origin and issued `__Host-`/`__Secure-` cookies against it. Sign-in failed
  // with a bare `credentialsSignin`. An unresolved placeholder is now treated
  // as unset, so an already-published site self-heals on its next request.
  it('overrides an unresolved secret placeholder on a published domain', () => {
    process.env.NEXTAUTH_URL = 'teleporthq.secrets.NEXTAUTH_URL'
    handler(
      { headers: { host: 'rare-last-dunlin.teleporthq.dev', 'x-forwarded-proto': 'https' } },
      {}
    )
    expect(process.env.NEXTAUTH_URL).toBe('https://rare-last-dunlin.teleporthq.dev')
  })

  it('falls back to an http origin locally, so cookies are not Secure-prefixed', () => {
    process.env.NEXTAUTH_URL = 'teleporthq.secrets.NEXTAUTH_URL'
    handler({ headers: { host: 'localhost:3001' } }, {})
    expect(process.env.NEXTAUTH_URL).toBe('http://localhost:3001')
  })

  it('overrides any value that is not an absolute http(s) origin', () => {
    process.env.NEXTAUTH_URL = 'my-app.teleporthq.dev'
    handler({ headers: { host: 'my-app.teleporthq.dev', 'x-forwarded-proto': 'https' } }, {})
    expect(process.env.NEXTAUTH_URL).toBe('https://my-app.teleporthq.dev')
  })
})
