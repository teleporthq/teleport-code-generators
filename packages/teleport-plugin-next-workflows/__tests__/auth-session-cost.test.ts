/* tslint:disable:no-eval */
import {
  generateAuthOptionsFile,
  generateSessionProviderWrapper,
  generateNextAuthUrlGuardModule,
  buildSessionUserFields,
  SENSITIVE_USER_FIELDS,
  USER_REFRESH_INTERVAL_MS,
} from '../src/auth-generator'
import { accountGetCurrent } from '../src/nodes/account/account-get-current'
import { UIDLAuthentication, UIDLAuthTableColumn } from '@teleporthq/teleport-types'

// /api/auth/session measured ~925ms on a published deployment against ~210ms
// for the same route with no session cookie. The whole delta was the `jwt`
// callback re-reading the `users` row through a fresh unpooled pg connection on
// EVERY request — while `strategy: 'jwt'` exists precisely so a session costs no
// database round trip. On top of that, `account-get-current` fetched that
// endpoint again on every click that resolves the current user, serially ahead
// of the workflow's own request, for a session `_app`'s SessionProvider already
// held in memory. And the payload carried every column `SELECT *` returned,
// including the OAuth single-table adapter's provider tokens.

// The canonical `users` columns the GUI emits (authentication/flows/utils.ts),
// which the UIDL mapper then appends one column per custom account property to.
const CANONICAL_USERS_COLUMNS: UIDLAuthTableColumn[] = [
  { name: 'id', type: 'UUID', nullable: false, isPrimaryKey: true },
  { name: 'name', type: 'VARCHAR(255)', nullable: true },
  { name: 'email', type: 'VARCHAR(255)', nullable: true },
  { name: 'phone', type: 'VARCHAR(255)', nullable: true },
  { name: 'details', type: 'TEXT', nullable: true },
  { name: 'email_verified', type: 'TIMESTAMPTZ', nullable: true },
  { name: 'password', type: 'TEXT', nullable: true },
  { name: 'provider', type: 'VARCHAR(255)', nullable: true },
  { name: 'provider_account_id', type: 'VARCHAR(255)', nullable: true },
  { name: 'provider_type', type: 'VARCHAR(255)', nullable: true },
  { name: 'access_token', type: 'TEXT', nullable: true },
  { name: 'refresh_token', type: 'TEXT', nullable: true },
  { name: 'expires_at', type: 'BIGINT', nullable: true },
  { name: 'id_token', type: 'TEXT', nullable: true },
  { name: 'scope', type: 'TEXT', nullable: true },
  { name: 'session_state', type: 'TEXT', nullable: true },
  { name: 'token_type', type: 'TEXT', nullable: true },
  { name: 'email_unsubscribed', type: 'BOOLEAN', nullable: false },
  { name: 'sms_unsubscribed', type: 'BOOLEAN', nullable: false },
  { name: 'image', type: 'TEXT', nullable: true },
  { name: 'role', type: 'VARCHAR(255)', nullable: false },
  { name: 'created_at', type: 'TIMESTAMPTZ', nullable: false },
  { name: 'updated_at', type: 'TIMESTAMPTZ', nullable: false },
]

const CUSTOM_PROPS = [
  {
    key: 'company',
    label: 'Company',
    columnType: 'VARCHAR(255)',
    attributeType: 'string' as const,
  },
  {
    key: 'loyalty_points',
    label: 'Loyalty Points',
    columnType: 'INTEGER',
    attributeType: 'number' as const,
  },
]

const buildAuth = (overrides: Partial<UIDLAuthentication> = {}): UIDLAuthentication =>
  ({
    enabled: true,
    dataSourceId: 'ds-1',
    dataSourceType: 'postgresql',
    passwordAuthEnabled: true,
    providers: [],
    roles: ['user', 'admin'],
    tables: {
      users: [
        ...CANONICAL_USERS_COLUMNS,
        { name: 'company', type: 'VARCHAR(255)', nullable: true },
        { name: 'loyalty_points', type: 'INTEGER', nullable: true },
      ],
    },
    pageProtection: {},
    folderProtection: {},
    authPages: {},
    callbackBaseUrl: '/api/auth/callback',
    envKeys: {},
    customUserProperties: CUSTOM_PROPS,
    ...overrides,
  } as UIDLAuthentication)

/**
 * Boots the generated auth-options file with `pg` stubbed, and reports how many
 * `SELECT ... FROM users` queries the callbacks actually issue.
 */
const bootAuthOptions = (auth: UIDLAuthentication) => {
  const code = generateAuthOptionsFile(auth, null)
  const queries: string[] = []

  class FakeClient {
    public async connect(): Promise<void> {
      return undefined
    }
    public async query(text: string): Promise<{ rows: Array<Record<string, unknown>> }> {
      queries.push(text)
      return { rows: [{ id: 'u-1', email: 'ada@example.com', name: 'Ada', role: 'admin' }] }
    }
    public async end(): Promise<void> {
      return undefined
    }
  }

  const fakeRequire = (name: string): any => {
    if (name === 'pg') {
      return { Client: FakeClient }
    }
    const provider = (config: unknown) => config
    ;(provider as any).default = provider
    return provider
  }

  const moduleObject: { exports: any } = { exports: {} }
  // tslint:disable-next-line:function-constructor
  new Function('require', 'module', 'exports', 'process', code)(
    fakeRequire,
    moduleObject,
    moduleObject.exports,
    { env: { TELEPORT_DB_CONNECTION_STRING: 'postgres://stub' } }
  )

  return { authOptions: moduleObject.exports, queries, code }
}

describe('sanitizeUser allow-list', () => {
  it('keeps every custom account property the project declared', () => {
    const fields = buildSessionUserFields(buildAuth().tables, CUSTOM_PROPS)
    expect(fields).toContain('company')
    expect(fields).toContain('loyalty_points')
  })

  it('keeps custom properties even when the UIDL carries no users table', () => {
    const fields = buildSessionUserFields(undefined, CUSTOM_PROPS)
    expect(fields).toContain('company')
    expect(fields).toContain('loyalty_points')
    expect(fields).toEqual(expect.arrayContaining(['id', 'name', 'email', 'image', 'role']))
  })

  it('keeps the non-credential profile columns pages bind to', () => {
    const fields = buildSessionUserFields(buildAuth().tables, CUSTOM_PROPS)
    for (const field of [
      'id',
      'name',
      'email',
      'image',
      'role',
      'phone',
      'details',
      'email_verified',
      'email_unsubscribed',
      'sms_unsubscribed',
      'created_at',
      'updated_at',
      // Just the provider's name ("google") — account-social-login declares it.
      'provider',
    ]) {
      expect(fields).toContain(field)
    }
  })

  it('keeps the alternate role spellings the generated middleware falls back to', () => {
    const fields = buildSessionUserFields(buildAuth().tables, CUSTOM_PROPS)
    expect(fields).toContain('roleName')
    expect(fields).toContain('roles')
  })

  it('drops the password hash and every OAuth provider credential', () => {
    const fields = buildSessionUserFields(buildAuth().tables, CUSTOM_PROPS)
    for (const secret of SENSITIVE_USER_FIELDS) {
      expect(fields).not.toContain(secret)
    }
    expect(fields).not.toContain('access_token')
    expect(fields).not.toContain('refresh_token')
    expect(fields).not.toContain('id_token')
  })

  it('folds _id into id rather than emitting both', () => {
    const fields = buildSessionUserFields(
      { users: [{ name: '_id', type: 'TEXT', nullable: false }] },
      []
    )
    expect(fields).not.toContain('_id')
    expect(fields).toContain('id')
  })

  it('cannot be re-opened by a custom property named after a credential', () => {
    const fields = buildSessionUserFields(buildAuth().tables, [
      {
        key: 'access_token',
        label: 'Access Token',
        columnType: 'TEXT',
        attributeType: 'string' as const,
      },
    ])
    expect(fields).not.toContain('access_token')
  })

  it('strips credentials from a real row at runtime', () => {
    const { authOptions } = bootAuthOptions(buildAuth())
    const safe = (authOptions as any).sanitizeUser({
      id: 'u-1',
      email: 'ada@example.com',
      name: 'Ada',
      role: 'admin',
      company: 'Teleport',
      loyalty_points: 42,
      password: '$2b$10$hash',
      access_token: 'ya29.secret',
      refresh_token: '1//refresh-secret',
      id_token: 'eyJhbGciOi.secret',
      session_state: 'state-secret',
      scope: 'openid email',
      token_type: 'Bearer',
      provider_account_id: '11223344',
    })

    expect(safe).toEqual({
      id: 'u-1',
      email: 'ada@example.com',
      name: 'Ada',
      role: 'admin',
      company: 'Teleport',
      loyalty_points: 42,
    })
    expect(JSON.stringify(safe)).not.toContain('secret')
  })
})

describe('jwt callback does not re-read the database on every session request', () => {
  it('reads the user once, then serves the token from the JWT for the interval', async () => {
    const { authOptions, queries } = bootAuthOptions(buildAuth())
    const token: Record<string, unknown> = { email: 'ada@example.com' }

    await authOptions.callbacks.jwt({ token })
    expect(queries.length).toBe(1)

    await authOptions.callbacks.jwt({ token })
    await authOptions.callbacks.jwt({ token })
    await authOptions.callbacks.jwt({ token })
    expect(queries.length).toBe(1)
  })

  it('refreshes immediately on trigger "update" — a profile save is never stale', async () => {
    const { authOptions, queries } = bootAuthOptions(buildAuth())
    const token: Record<string, unknown> = { email: 'ada@example.com' }

    await authOptions.callbacks.jwt({ token })
    expect(queries.length).toBe(1)

    await authOptions.callbacks.jwt({ token, trigger: 'update' })
    expect(queries.length).toBe(2)
  })

  it('re-reads once the interval has elapsed', async () => {
    const { authOptions, queries } = bootAuthOptions(buildAuth())
    const token: Record<string, unknown> = { email: 'ada@example.com' }

    await authOptions.callbacks.jwt({ token })
    expect(queries.length).toBe(1)

    // Backdate the stamp past the interval instead of waiting on a real clock.
    token.__userRefreshedAt = Date.now() - USER_REFRESH_INTERVAL_MS - 1
    await authOptions.callbacks.jwt({ token })
    expect(queries.length).toBe(2)
  })

  it('treats a backwards clock jump as stale rather than trusting the stamp', async () => {
    const { authOptions, queries } = bootAuthOptions(buildAuth())
    const token: Record<string, unknown> = { email: 'ada@example.com' }

    await authOptions.callbacks.jwt({ token })
    expect(queries.length).toBe(1)

    token.__userRefreshedAt = Date.now() + 60 * 60 * 1000
    await authOptions.callbacks.jwt({ token })
    expect(queries.length).toBe(2)
  })

  it('does NOT stamp on the login branch, so an OAuth user still gets their role', async () => {
    const { authOptions, queries } = bootAuthOptions(buildAuth())
    // An OAuth `user` is the provider profile: no `role`, which lives only on
    // the users row. Stamping here would leave the visitor role-less for a whole
    // interval and silently fail role-protected routes.
    const token: Record<string, unknown> = {}
    await authOptions.callbacks.jwt({
      token,
      user: { id: 'u-1', email: 'ada@example.com', name: 'Ada', image: null },
    })
    expect(queries.length).toBe(0)
    expect(token.__userRefreshedAt).toBeUndefined()

    await authOptions.callbacks.jwt({ token })
    expect(queries.length).toBe(1)
    expect(token.role).toBe('admin')
  })

  it('costs one attempt per interval — not one per request — when the database is down', async () => {
    const auth = buildAuth()
    const code = generateAuthOptionsFile(auth, null)
    let attempts = 0

    class BrokenClient {
      public async connect(): Promise<void> {
        attempts += 1
        throw new Error('ECONNREFUSED')
      }
      public async query(): Promise<{ rows: Array<Record<string, unknown>> }> {
        return { rows: [] }
      }
      public async end(): Promise<void> {
        return undefined
      }
    }

    const fakeRequire = (name: string): any => {
      if (name === 'pg') {
        return { Client: BrokenClient }
      }
      const provider = (config: unknown) => config
      ;(provider as any).default = provider
      return provider
    }
    const moduleObject: { exports: any } = { exports: {} }
    // tslint:disable-next-line:function-constructor
    new Function('require', 'module', 'exports', 'process', code)(
      fakeRequire,
      moduleObject,
      moduleObject.exports,
      { env: { TELEPORT_DB_CONNECTION_STRING: 'postgres://stub' } }
    )

    const token: Record<string, unknown> = { email: 'ada@example.com' }
    await moduleObject.exports.callbacks.jwt({ token })
    await moduleObject.exports.callbacks.jwt({ token })
    await moduleObject.exports.callbacks.jwt({ token })

    expect(attempts).toBe(1)
    // Never signs the user out on a DB hiccup.
    expect(token.email).toBe('ada@example.com')
  })

  it('never copies the refresh bookkeeping onto session.user', async () => {
    const { authOptions } = bootAuthOptions(buildAuth())
    const token: Record<string, unknown> = { email: 'ada@example.com' }
    await authOptions.callbacks.jwt({ token })
    expect(token.__userRefreshedAt).toEqual(expect.any(Number))

    const session = await authOptions.callbacks.session({ session: { user: {} }, token })
    expect(session.user.__userRefreshedAt).toBeUndefined()
    expect(session.user.iat).toBeUndefined()
    expect(session.user.exp).toBeUndefined()
    expect(session.user.email).toBe('ada@example.com')
  })
})

describe('nextauth-url guard prevents the empty-NEXTAUTH_URL SSR crash', () => {
  // next-auth v4 `react/index.js` calls `parseUrl(process.env.NEXTAUTH_URL)` at
  // MODULE LOAD; `new URL('')` throws "Invalid URL", crashing SSR for every page
  // that mounts SessionProvider. The guard runs first and normalizes the value.
  const guard = generateNextAuthUrlGuardModule()

  // Execute the guard body against a stubbed process, the way it runs at import.
  const runGuard = (
    env: Record<string, string | undefined>
  ): Record<string, string | undefined> => {
    const body = guard.replace(/export\s*\{\s*\}\s*;?\s*$/, '')
    const stubProcess = { env }
    // tslint:disable-next-line:function-constructor
    new Function('process', body)(stubProcess)
    return env
  }

  it('deletes an empty NEXTAUTH_URL so next-auth falls back to its default', () => {
    const env: Record<string, string | undefined> = { NEXTAUTH_URL: '' }
    runGuard(env)
    expect('NEXTAUTH_URL' in env).toBe(false)
  })

  it('deletes a whitespace-only NEXTAUTH_URL', () => {
    const env: Record<string, string | undefined> = { NEXTAUTH_URL: '   ' }
    runGuard(env)
    expect('NEXTAUTH_URL' in env).toBe(false)
  })

  it('also normalizes empty NEXTAUTH_URL_INTERNAL and VERCEL_URL', () => {
    const env: Record<string, string | undefined> = {
      NEXTAUTH_URL_INTERNAL: '',
      VERCEL_URL: '   ',
    }
    runGuard(env)
    expect('NEXTAUTH_URL_INTERNAL' in env).toBe(false)
    expect('VERCEL_URL' in env).toBe(false)
  })

  it('leaves a real configured NEXTAUTH_URL untouched', () => {
    const env: Record<string, string | undefined> = { NEXTAUTH_URL: 'https://shop.example.com' }
    runGuard(env)
    expect(env.NEXTAUTH_URL).toBe('https://shop.example.com')
  })

  it('leaves an UNSET NEXTAUTH_URL unset (never introduces a bogus value)', () => {
    const env: Record<string, string | undefined> = {}
    runGuard(env)
    expect('NEXTAUTH_URL' in env).toBe(false)
  })

  it('a stubbed next-auth/react module-load pattern no longer throws after the guard runs', () => {
    // Mirror of next-auth/react's module-scope `parseUrl(process.env.NEXTAUTH_URL)`
    // (parse-url.js: `new URL(url ?? default)` — empty string is NOT nullish, so
    // it reaches new URL and throws).
    const nextAuthModuleLoad = (processEnv: Record<string, string | undefined>) => {
      const url = processEnv.NEXTAUTH_URL
      // eslint-disable-next-line no-new
      new URL(url != null ? url : 'http://localhost:3000/api/auth')
    }
    const env: Record<string, string | undefined> = { NEXTAUTH_URL: '' }
    expect(() => nextAuthModuleLoad(env)).toThrow() // reproduces the crash
    runGuard(env)
    expect(() => nextAuthModuleLoad(env)).not.toThrow() // fixed by the guard
  })
})

describe('session provider republishes the in-memory session', () => {
  const code = generateSessionProviderWrapper()

  it('imports the nextauth-url guard FIRST, before next-auth/react', () => {
    const guardIdx = code.indexOf("import './nextauth-url-guard'")
    const nextAuthIdx = code.indexOf("from 'next-auth/react'")
    expect(guardIdx).toBeGreaterThanOrEqual(0)
    expect(nextAuthIdx).toBeGreaterThan(guardIdx)
    // It must be the very first non-empty line so nothing imports next-auth/react
    // before it in the module graph.
    expect(code.trimStart().startsWith("import './nextauth-url-guard'")).toBe(true)
  })

  it('subscribes to the session context from inside SessionProvider', () => {
    expect(code).toContain(
      "import { SessionProvider, signIn, signOut, useSession } from 'next-auth/react'"
    )
    expect(code).toContain('function SessionSnapshotBridge()')
    expect(code).toContain('React.createElement(SessionSnapshotBridge')
  })

  it('exposes getSession and refreshSession on the existing window bridge', () => {
    expect(code).toContain('window.__teleportNextAuth = teleportNextAuth')
    expect(code).toContain('getSession: function ()')
    expect(code).toContain('refreshSession: function ()')
    // The bridge object is assigned to window ONCE and mutated in place, so a
    // handler that captured it earlier still observes the current session.
    expect(code).toContain('teleportNextAuth.status = status')
    expect(code).toContain('teleportNextAuth.session = data || null')
  })

  it('stops refetching the session on every window focus', () => {
    expect(code).toContain('refetchOnWindowFocus: false')
  })

  it('mirrors in an effect, never during render', () => {
    expect(code).toContain('React.useEffect(')
    const renderBody = code.slice(code.indexOf('function SessionSnapshotBridge()'))
    expect(renderBody.indexOf('React.useEffect(')).toBeLessThan(renderBody.indexOf('return null'))
  })
})

describe('account-get-current reads the in-memory session before the network', () => {
  const evalHandler = (): any => eval('(' + accountGetCurrent.generateHandler() + ')')

  const withWindow = async (
    bridge: unknown,
    fetchImpl: () => Promise<unknown>,
    run: (handler: any) => Promise<void>
  ) => {
    const store: Record<string, string> = {}
    ;(global as any).window = {
      __teleportNextAuth: bridge,
      localStorage: {
        getItem: (key: string) => (key in store ? store[key] : null),
        setItem: (key: string, value: string) => {
          store[key] = value
        },
        removeItem: (key: string) => {
          delete store[key]
        },
      },
    }
    ;(global as any).fetch = fetchImpl
    try {
      await run(evalHandler())
    } finally {
      delete (global as any).window
      delete (global as any).fetch
    }
  }

  const authenticatedBridge = (user: unknown) => ({
    getSession: () => ({ status: 'authenticated', session: { user } }),
  })

  it('returns the signed-in user without touching /api/auth/session', async () => {
    const user = { id: 'u-1', email: 'ada@example.com', name: 'Ada', role: 'admin' }
    let fetched = 0
    await withWindow(
      authenticatedBridge(user),
      async () => {
        fetched += 1
        return { ok: true, json: async () => ({ user }) }
      },
      async (handler) => {
        const out = await handler({}, {})
        expect(fetched).toBe(0)
        // Same contract as the network path: flat fields AND `.user`.
        expect(out.id).toBe('u-1')
        expect(out.email).toBe('ada@example.com')
        expect(out.user).toEqual(user)
      }
    )
  })

  it('still fetches while the provider is loading', async () => {
    const user = { id: 'u-2', email: 'grace@example.com' }
    let fetched = 0
    await withWindow(
      { getSession: () => ({ status: 'loading', session: null as unknown }) },
      async () => {
        fetched += 1
        return { ok: true, json: async () => ({ user }) }
      },
      async (handler) => {
        const out = await handler({}, {})
        expect(fetched).toBe(1)
        expect(out.id).toBe('u-2')
      }
    )
  })

  it('still fetches when the provider reports unauthenticated', async () => {
    // next-auth also reports 'unauthenticated' when its own fetch FAILED, so
    // trusting it would send a signed-in visitor down the guest branch.
    const user = { id: 'u-3', email: 'alan@example.com' }
    let fetched = 0
    await withWindow(
      { getSession: () => ({ status: 'unauthenticated', session: null as unknown }) },
      async () => {
        fetched += 1
        return { ok: true, json: async () => ({ user }) }
      },
      async (handler) => {
        const out = await handler({}, {})
        expect(fetched).toBe(1)
        expect(out.id).toBe('u-3')
      }
    )
  })

  it('falls back to the network when no bridge is published at all', async () => {
    const user = { id: 'u-4', email: 'edsger@example.com' }
    let fetched = 0
    await withWindow(
      undefined,
      async () => {
        fetched += 1
        return { ok: true, json: async () => ({ user }) }
      },
      async (handler) => {
        const out = await handler({}, {})
        expect(fetched).toBe(1)
        expect(out.id).toBe('u-4')
      }
    )
  })

  it('mirrors the in-memory user into localStorage for the offline fallback', async () => {
    const user = { id: 'u-5', email: 'barbara@example.com' }
    await withWindow(
      authenticatedBridge(user),
      async () => {
        throw new Error('network is down')
      },
      async (handler) => {
        await handler({}, {})
        const cached = (global as any).window.localStorage.getItem('teleport_auth_user')
        expect(JSON.parse(cached)).toEqual(user)
      }
    )
  })

  it('confirms a sign-out ONCE per page load, then stops re-fetching', async () => {
    // next-auth reports 'unauthenticated' both for "signed out" and "my fetch
    // failed", so the FIRST guest resolution verifies against the endpoint.
    // Once that verification succeeds with no user, repeating it on every
    // click only burns a round trip — the memo short-circuits it.
    let fetched = 0
    await withWindow(
      { getSession: () => ({ status: 'unauthenticated', session: null as unknown }) },
      async () => {
        fetched += 1
        return { ok: true, json: async () => ({}) }
      },
      async (handler) => {
        const first = await handler({}, {})
        expect(fetched).toBe(1)
        expect(first.user).toBeNull()

        const second = await handler({}, {})
        expect(fetched).toBe(1)
        expect(second.user).toBeNull()
      }
    )
  })

  it('never memoizes sign-out from a FAILED confirmation fetch', async () => {
    let fetched = 0
    const user = { id: 'u-7', email: 'joan@example.com' }
    await withWindow(
      { getSession: () => ({ status: 'unauthenticated', session: null as unknown }) },
      async () => {
        fetched += 1
        if (fetched === 1) {
          throw new Error('network blip')
        }
        return { ok: true, json: async () => ({ user }) }
      },
      async (handler) => {
        await handler({}, {})
        // The blip must not count as confirmation — the next call re-verifies
        // and finds the real signed-in session.
        const second = await handler({}, {})
        expect(fetched).toBe(2)
        expect(second.id).toBe('u-7')
      }
    )
  })

  it('a confirmation fetch that finds a user does NOT memoize sign-out', async () => {
    let fetched = 0
    const user = { id: 'u-8', email: 'lin@example.com' }
    await withWindow(
      { getSession: () => ({ status: 'unauthenticated', session: null as unknown }) },
      async () => {
        fetched += 1
        return { ok: true, json: async () => ({ user }) }
      },
      async (handler) => {
        const first = await handler({}, {})
        expect(first.id).toBe('u-8')
        const second = await handler({}, {})
        // Still verifying every time — the memo only forms on a confirmed
        // empty session, never while a user is being returned.
        expect(fetched).toBe(2)
        expect(second.id).toBe('u-8')
      }
    )
  })

  it('an authenticated bridge clears a previously memoized sign-out', async () => {
    // Sequence: guest confirms sign-out (memo forms) → user signs in (bridge
    // flips to authenticated) → signs out again (bridge back to
    // unauthenticated). The sign-in must clear the memo... and it does, but
    // even if it did not, correctness holds: the memo is only consulted while
    // next-auth itself reports 'unauthenticated'.
    let status = 'unauthenticated'
    let fetched = 0
    const user = { id: 'u-9', email: 'kay@example.com' }
    await withWindow(
      { getSession: () => ({ status, session: status === 'authenticated' ? { user } : null }) },
      async () => {
        fetched += 1
        return { ok: true, json: async () => ({}) }
      },
      async (handler) => {
        await handler({}, {})
        expect(fetched).toBe(1)
        expect((global as any).window.__tqSessionConfirmedSignedOut).toBe(true)

        status = 'authenticated'
        const signedIn = await handler({}, {})
        expect(signedIn.id).toBe('u-9')
        expect((global as any).window.__tqSessionConfirmedSignedOut).toBe(false)

        status = 'unauthenticated'
        await handler({}, {})
        // Memo was cleared by the sign-in, so sign-out is re-confirmed once.
        expect(fetched).toBe(2)
      }
    )
  })

  it('ignores a malformed bridge rather than throwing', async () => {
    const user = { id: 'u-6', email: 'ken@example.com' }
    let fetched = 0
    await withWindow(
      {
        getSession: () => {
          throw new Error('bridge exploded')
        },
      },
      async () => {
        fetched += 1
        return { ok: true, json: async () => ({ user }) }
      },
      async (handler) => {
        const out = await handler({}, {})
        expect(fetched).toBe(1)
        expect(out.id).toBe('u-6')
      }
    )
  })
})
