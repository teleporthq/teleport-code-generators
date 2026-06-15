import {
  generateAuthOptionsFile,
  generateAuthDbFile,
  generateAuthAdapterFile,
  generateAuthRefreshFile,
} from '../src/auth-generator'

// These guard the single-table custom NextAuth adapter that persists OAuth
// users into the `users` table (no `accounts`/`sessions` tables), the
// refresh-token rotation, and the client-side token-secrecy guarantees.

const cred = (prefix: string, extra?: string) => {
  const c: Record<string, string> = {}
  c[`${prefix}_ID`] = `teleporthq.secrets.${prefix}_ID`
  c[`${prefix}_SECRET`] = `teleporthq.secrets.${prefix}_SECRET`
  if (extra) c[`${prefix}_${extra}`] = `teleporthq.secrets.${prefix}_${extra}`
  return c
}

const authWith = (opts: {
  providers?: any[]
  passwordAuthEnabled?: boolean
  dataSourceType?: string | null
  customUserProperties?: any[]
}): any => ({
  enabled: true,
  passwordAuthEnabled: opts.passwordAuthEnabled !== false,
  providers: opts.providers || [],
  dataSourceType: opts.dataSourceType === undefined ? 'teleport' : opts.dataSourceType,
  customUserProperties: opts.customUserProperties || [],
  authPages: { signIn: { route: '/sign-in' } },
})

const google = { id: 'google', name: 'Google', credentials: cred('AUTH_GOOGLE') }

describe('auth-generator — single-table OAuth adapter wiring', () => {
  it('wires the custom adapter when an OAuth provider AND a data source are present', () => {
    const out = generateAuthOptionsFile(authWith({ providers: [google] }), null)
    expect(out).toContain("const createAuthAdapter = require('./auth-adapter');")
    expect(out).toContain('adapter: createAuthAdapter(),')
    expect(out).toContain("const authDb = require('./auth-db');")
  })

  it('does NOT wire an adapter for a credentials-only project (no OAuth providers)', () => {
    const out = generateAuthOptionsFile(authWith({ providers: [] }), null)
    expect(out).not.toContain('createAuthAdapter')
    expect(out).not.toContain('adapter:')
    expect(out).not.toContain('auth-refresh')
    expect(out).not.toContain('OAUTH_PROVIDER_ENV')
    // credentials-only must keep the simple jwt callback (no token capture)
    expect(out).not.toContain('account.provider')
  })

  it('does NOT wire an adapter when providers exist but there is no data source', () => {
    const out = generateAuthOptionsFile(
      authWith({ providers: [google], dataSourceType: null }),
      null
    )
    expect(out).not.toContain('createAuthAdapter')
    expect(out).not.toContain('adapter:')
  })

  it('keeps the JWT strategy with a finite, rolling 24h session', () => {
    const out = generateAuthOptionsFile(authWith({ providers: [google] }), null)
    expect(out).toContain("strategy: 'jwt'")
    expect(out).toContain('maxAge: 86400')
    expect(out).toContain('updateAge: 3600')
  })

  it('emits the per-provider env map used to refresh tokens', () => {
    const out = generateAuthOptionsFile(authWith({ providers: [google] }), null)
    expect(out).toContain('const OAUTH_PROVIDER_ENV = {')
    expect(out).toContain('"google": { id: "AUTH_GOOGLE_ID", secret: "AUTH_GOOGLE_SECRET" }')
  })

  it('re-exports the credentials data-access helpers for the signup route + account nodes', () => {
    const out = generateAuthOptionsFile(authWith({ providers: [google] }), null)
    expect(out).toContain('module.exports.sanitizeUser = authDb.sanitizeUser;')
    expect(out).toContain('module.exports.findUserByEmail = authDb.findUserByEmail;')
    expect(out).toContain('module.exports.createUser = authDb.createUser;')
    expect(out).toContain('module.exports.userExistsByEmail = authDb.userExistsByEmail;')
  })
})

describe('auth-generator — provider config (offline access + auto-link)', () => {
  it('requests offline access for Google so a refresh_token is issued', () => {
    const out = generateAuthOptionsFile(authWith({ providers: [google] }), null)
    expect(out).toContain('authorization: { params: { "access_type": "offline" } }')
  })

  it('enables allowDangerousEmailAccountLinking ONLY for trusted, email-verifying providers', () => {
    const trusted = generateAuthOptionsFile(authWith({ providers: [google] }), null)
    expect(trusted).toContain('allowDangerousEmailAccountLinking: true')

    const untrusted = generateAuthOptionsFile(
      authWith({
        providers: [{ id: 'spotify', name: 'Spotify', credentials: cred('AUTH_SPOTIFY') }],
      }),
      null
    )
    expect(untrusted).not.toContain('allowDangerousEmailAccountLinking')
  })
})

describe('auth-generator — jwt callback token capture + refresh', () => {
  const out = generateAuthOptionsFile(authWith({ providers: [google] }), null)

  it('captures provider tokens from the OAuth account on sign-in (not for credentials)', () => {
    expect(out).toContain("account.type !== 'credentials'")
    expect(out).toContain('token.access_token = account.access_token')
    expect(out).toContain('token.refresh_token = account.refresh_token')
    expect(out).toContain('token.expires_at = account.expires_at')
  })

  it('refreshes the access token when expired and persists it, comparing in seconds', () => {
    expect(out).toContain('Math.floor(Date.now() / 1000) >= Number(token.expires_at)')
    expect(out).toContain(
      'refreshAccessToken(token.provider, refreshToken, clientId, clientSecret)'
    )
    expect(out).toContain('oauthUpdateTokens(token.id')
  })

  it('falls back to the DB-stored refresh token when the JWT lacks one', () => {
    expect(out).toContain('oauthGetTokensByUserId(token.id)')
  })

  it('keeps token.id consistent with token.sub on the OAuth path', () => {
    expect(out).toContain('if (token.id == null && token.sub != null) token.id = token.sub;')
  })
})

describe('auth-generator — session callback never leaks tokens to the client', () => {
  it('excludes every token field from the session when OAuth is enabled', () => {
    const out = generateAuthOptionsFile(authWith({ providers: [google] }), null)
    const skipMatch = out.match(/const skip = (\{[^}]*\});/)
    expect(skipMatch).toBeTruthy()
    const skip = skipMatch![1]
    for (const key of [
      'access_token',
      'refresh_token',
      'expires_at',
      'id_token',
      'session_state',
      'token_type',
      'scope',
      'provider_account_id',
      'provider_type',
    ]) {
      expect(skip).toContain(`${key}: 1`)
    }
  })

  it('keeps the minimal skip set for a credentials-only project (no behavior change)', () => {
    const out = generateAuthOptionsFile(authWith({ providers: [] }), null)
    expect(out).toContain('const skip = { iat: 1, exp: 1, jti: 1, sub: 1 };')
  })
})

describe('auth-generator — auth-db.js', () => {
  it('strips the password AND every token column from sanitizeUser', () => {
    const out = generateAuthDbFile(authWith({ providers: [google] }), null)
    expect(out).toContain('var SENSITIVE_USER_FIELDS = {')
    for (const key of [
      'password',
      'access_token',
      'refresh_token',
      'id_token',
      'session_state',
      'expires_at',
      'token_type',
      'scope',
      'provider_account_id',
      'provider_type',
    ]) {
      expect(out).toContain(`${key}: 1`)
    }
  })

  it('queries the single users table by provider + provider_account_id (no accounts table)', () => {
    const out = generateAuthDbFile(authWith({ providers: [google] }), null)
    expect(out).toContain('FROM users WHERE provider = $1 AND provider_account_id = $2')
    expect(out).not.toMatch(/FROM\s+accounts/)
    expect(out).not.toMatch(/INTO\s+accounts/)
  })

  it('stores the provider linkage + tokens ON the user row (linkAccount = UPDATE users)', () => {
    const out = generateAuthDbFile(authWith({ providers: [google] }), null)
    expect(out).toContain('async function oauthLinkAccount(account)')
    expect(out).toMatch(/UPDATE users SET provider = \$1, provider_account_id = \$2/)
    // never null out the password / verify email since the provider asserted it
    expect(out).toContain('email_verified = COALESCE(email_verified, NOW())')
  })

  it('exports the OAuth helpers + toAdapterUser when persistence is needed', () => {
    const out = generateAuthDbFile(authWith({ providers: [google] }), null)
    for (const fn of [
      'toAdapterUser',
      'oauthGetUserById',
      'oauthGetUserByAccount',
      'oauthCreateUser',
      'oauthUpdateUser',
      'oauthLinkAccount',
      'oauthUpdateTokens',
      'oauthGetTokensByUserId',
    ]) {
      expect(out).toContain(`${fn}: ${fn}`)
    }
  })

  it('emits NO OAuth helpers for a credentials-only project', () => {
    const out = generateAuthDbFile(authWith({ providers: [] }), null)
    expect(out).not.toContain('oauthLinkAccount')
    expect(out).not.toContain('toAdapterUser')
    // still exports the credentials helpers
    expect(out).toContain('findUserByEmail: findUserByEmail')
  })

  it('uses dialect-appropriate placeholders (mysql uses ?)', () => {
    const out = generateAuthDbFile(authWith({ providers: [google], dataSourceType: 'mysql' }), null)
    expect(out).toContain(
      'SELECT * FROM users WHERE provider = ? AND provider_account_id = ? LIMIT 1'
    )
  })

  it('falls back to stubs when there is no data source', () => {
    const out = generateAuthDbFile(authWith({ providers: [google], dataSourceType: null }), null)
    expect(out).toContain('async function findUserByEmail() { return null; }')
    expect(out).not.toContain('oauthLinkAccount')
  })
})

describe('auth-generator — auth-adapter.js', () => {
  const out = generateAuthAdapterFile()

  it('implements the adapter methods NextAuth invokes on OAuth sign-in', () => {
    for (const method of [
      'async createUser(',
      'async getUser(',
      'async getUserByEmail(',
      'async getUserByAccount(',
      'async updateUser(',
      'async linkAccount(',
    ]) {
      expect(out).toContain(method)
    }
  })

  it('provides safe no-ops for the session/verification methods unused under jwt', () => {
    for (const method of [
      'async createSession(',
      'async getSessionAndUser(',
      'async deleteSession(',
      'async createVerificationToken(',
      'async useVerificationToken(',
    ]) {
      expect(out).toContain(method)
    }
  })

  it('delegates to auth-db and exports a factory', () => {
    expect(out).toContain("const authDb = require('./auth-db');")
    expect(out).toContain('module.exports = createAuthAdapter;')
  })
})

describe('auth-generator — auth-refresh.js', () => {
  const out = generateAuthRefreshFile()

  it('maps the common provider token endpoints', () => {
    expect(out).toContain("google: 'https://oauth2.googleapis.com/token'")
    expect(out).toContain("github: 'https://github.com/login/oauth/access_token'")
  })

  it('refreshes via grant_type=refresh_token and returns expiry in absolute seconds', () => {
    expect(out).toContain("grant_type: 'refresh_token'")
    expect(out).toContain('Math.floor(Date.now() / 1000) + expiresIn')
  })

  it('never throws (returns null on any failure)', () => {
    expect(out).toContain('} catch (e) {\n    return null;\n  }')
    expect(out).toContain('if (!res.ok) return null;')
  })
})
