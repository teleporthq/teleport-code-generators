import { generateMiddlewareFile } from '../src/auth-generator'

// Guards the regression where a page published at the HOME route ("/") — e.g. a
// protected dashboard — was reachable by unauthenticated users after deploy.
//
// The `protectedRoutes` map already contained "/" (a prior mapper fix keyed the
// home page as "/" instead of "/homepage"), but the generated middleware's
// `config.matcher` only listed `'/((?!api|...).*)'`, which Next.js does NOT run
// for the bare root path. So middleware never fired on "/" and the protection
// entry was never consulted. The matcher must also include the literal '/'.
//
// Including '/' in turn means middleware now runs on "/", which exposes a second
// hazard: a wrong-role user is redirected to "/" — if "/" is itself protected,
// that loops forever. The role-denied redirect must be loop-safe.

const baseAuth: any = {
  enabled: true,
  dataSourceId: 'ds-1',
  dataSourceType: 'postgres',
  passwordAuthEnabled: true,
  providers: [],
  roles: ['admin'],
  tables: {},
  folderProtection: {},
  authPages: {
    signIn: { pageId: 'sign-in', pageName: 'sign-in', route: '/sign-in' },
    signUp: { pageId: 'sign-up', pageName: 'sign-up', route: '/sign-up' },
  },
  callbackBaseUrl: '',
  envKeys: {},
  customUserProperties: [],
}

const withHomeDashboard = (allowedRoles: string[]) =>
  generateMiddlewareFile({
    ...baseAuth,
    pageProtection: {
      HOME: {
        requiresAuth: true,
        allowedRoles,
        pageName: 'Dashboard',
        route: '/',
      },
    },
  } as any)

describe('generateMiddlewareFile: home-route ("/") protection', () => {
  it('emits the literal "/" matcher so middleware runs on the home page', () => {
    const code = withHomeDashboard(['admin'])
    // The matcher array must contain the bare root entry. Next.js compiles '/'
    // to ^/$, which matches the home page; without it middleware never fires
    // on "/".
    expect(code).toMatch(/matcher:\s*\['\/',/)
  })

  it('keeps the catch-all matcher for every deeper path', () => {
    const code = withHomeDashboard(['admin'])
    expect(code).toContain("'/((?!api|_next/static|_next/image|favicon")
  })

  it('still records "/" as a protected route in the protectedRoutes map', () => {
    const code = withHomeDashboard(['admin'])
    expect(code).toContain('"/":')
    expect(code).toContain('"admin"')
  })

  it('routes role-denied users through the loop-safe helper, not a hard redirect to "/"', () => {
    const code = withHomeDashboard(['admin'])
    // The role-denied branch must call the helper rather than unconditionally
    // redirecting to "/", which would loop when "/" is itself protected.
    expect(code).toContain('return roleDeniedRedirect(request, pathname);')
    expect(code).toContain('function roleDeniedRedirect(request, pathname)')
    // The helper falls back to sign-in when the home route is protected.
    expect(code).toContain("if (pathname !== '/' && !protectedRoutes['/'])")
  })

  it('uses a segment-safe auth-route bypass (no startsWith over-match)', () => {
    const code = withHomeDashboard(['admin'])
    expect(code).toContain(
      "if (pathname === authRoutes[i] || pathname.startsWith(authRoutes[i] + '/'))"
    )
    // The old prefix-only bypass must be gone.
    expect(code).not.toContain('if (pathname.startsWith(authRoutes[i])) {')
  })

  it('protects an auth-only home page (no role) the same way', () => {
    const code = withHomeDashboard([])
    expect(code).toMatch(/matcher:\s*\['\/',/)
    expect(code).toContain('"/":')
  })
})
