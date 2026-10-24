import * as crypto from 'crypto'
import { UIDLAuthentication } from '@teleporthq/teleport-types'
import { generateAuthOptionsFile, USER_REFRESH_INTERVAL_MS } from '../src/auth-generator'

/**
 * A password change, a password reset included, signs the account out of every
 * session opened before it. The session token carries a short fingerprint of
 * the stored password hash (never the hash); the periodic refresh compares it
 * with the account's current hash and ends a session whose fingerprint no
 * longer matches. Sign-in with the new password works as before. Run on the
 * EMITTED auth options.
 */

const EMAIL = 'ada@example.com'
const FINGERPRINT = '__passwordFingerprint'

const auth = {
  enabled: true,
  dataSourceId: 'ds-1',
  dataSourceType: 'postgresql',
  passwordAuthEnabled: true,
  providers: [],
  roles: ['user'],
  tables: {
    users: [
      { name: 'id', type: 'UUID', nullable: false, isPrimaryKey: true },
      { name: 'name', type: 'VARCHAR(255)', nullable: true },
      { name: 'email', type: 'VARCHAR(255)', nullable: true },
      { name: 'password', type: 'TEXT', nullable: true },
      { name: 'role', type: 'VARCHAR(255)', nullable: false },
    ],
  },
  pageProtection: {},
  folderProtection: {},
  authPages: {},
  callbackBaseUrl: '/api/auth/callback',
  envKeys: {},
  customUserProperties: [],
} as unknown as UIDLAuthentication

// The stand-in for utils/auth/hash-password.js: a "hash" the test can name.
const hashOf = (password: string) => `hash:${password}`

const bootAuthOptions = () => {
  const store: { row: Record<string, unknown> | null; failReads: boolean } = {
    row: { id: 'u-1', email: EMAIL, name: 'Ada', role: 'user', password: hashOf('old secret') },
    failReads: false,
  }
  class FakeClient {
    public async connect(): Promise<void> {
      return undefined
    }
    public async query(): Promise<{ rows: Array<Record<string, unknown>> }> {
      if (store.failReads) {
        throw new Error('connection refused')
      }
      return { rows: store.row ? [{ ...store.row }] : [] }
    }
    public async end(): Promise<void> {
      return undefined
    }
  }
  const fakeRequire = (name: string): unknown => {
    if (name === 'pg') {
      return { Client: FakeClient }
    }
    if (name === 'crypto') {
      return crypto
    }
    if (name === './hash-password') {
      return { verifyPassword: (password: string, hash: string) => hash === hashOf(password) }
    }
    if (name === './db-health') {
      return { classifyAuthInfrastructureError: () => 'unknown' }
    }
    const provider = (config: unknown) => config
    ;(provider as any).default = provider
    return provider
  }
  const moduleObject: { exports: any } = { exports: {} }
  // tslint:disable-next-line:function-constructor
  new Function('require', 'module', 'exports', 'process', generateAuthOptionsFile(auth, null))(
    fakeRequire,
    moduleObject,
    moduleObject.exports,
    {
      env: { TELEPORT_DB_CONNECTION_STRING: 'postgres://stub', NEXTAUTH_SECRET: 'secret-1' },
    }
  )
  const authOptions = moduleObject.exports
  const authorize = (password: string) =>
    authOptions.providers[0].authorize({ email: EMAIL, password })
  const signIn = async (password: string) =>
    authOptions.callbacks.jwt({ token: {}, user: await authorize(password) })
  // The refresh /api/auth/session runs once the token's interval has passed.
  const refresh = (token: Record<string, unknown>) =>
    authOptions.callbacks.jwt({
      token: { ...token, __userRefreshedAt: Date.now() - USER_REFRESH_INTERVAL_MS - 1 },
    })
  return { authOptions, store, authorize, signIn, refresh }
}

describe('a password change ends the sessions opened before it', () => {
  it('keeps a session whose password has not changed', async () => {
    const site = bootAuthOptions()
    const token = await site.signIn('old secret')

    expect(typeof token[FINGERPRINT]).toBe('string')
    const refreshed = await site.refresh(token)
    expect(refreshed.email).toBe(EMAIL)
    expect(refreshed[FINGERPRINT]).toBe(token[FINGERPRINT])
  })

  it('refuses the older session at its next refresh once the hash changed', async () => {
    const site = bootAuthOptions()
    const before = await site.signIn('old secret')

    site.store.row!.password = hashOf('new secret')

    await expect(site.refresh(before)).rejects.toThrow()
    // A profile save refreshes at once, and is refused the same way.
    await expect(
      site.authOptions.callbacks.jwt({ token: { ...before }, trigger: 'update' })
    ).rejects.toThrow()
  })

  it('signs in with the new password, and keeps that session', async () => {
    const site = bootAuthOptions()
    site.store.row!.password = hashOf('new secret')

    await expect(site.authorize('old secret')).rejects.toThrow('InvalidCredentials')
    const after = await site.signIn('new secret')
    const refreshed = await site.refresh(after)
    expect(refreshed.email).toBe(EMAIL)
  })

  it('fingerprints a session that has none at its first refresh, then holds it to that', async () => {
    const site = bootAuthOptions()
    const legacy = { id: 'u-1', email: EMAIL, name: 'Ada', role: 'user' }

    const adopted = await site.refresh(legacy)
    expect(typeof adopted[FINGERPRINT]).toBe('string')

    site.store.row!.password = hashOf('new secret')
    await expect(site.refresh(adopted)).rejects.toThrow()
  })

  it('never carries the hash, and never shows the fingerprint on session.user', async () => {
    const site = bootAuthOptions()
    const token = await site.signIn('old secret')

    expect(JSON.stringify(token)).not.toContain(hashOf('old secret'))
    const session = await site.authOptions.callbacks.session({
      session: { user: {}, expires: '' },
      token,
    })
    expect(session.user.email).toBe(EMAIL)
    expect(FINGERPRINT in session.user).toBe(false)
  })

  it('keeps the session when the database cannot be read', async () => {
    const site = bootAuthOptions()
    const token = await site.signIn('old secret')

    site.store.failReads = true
    const kept = await site.refresh(token)
    expect(kept.email).toBe(EMAIL)
  })

  it('reads nothing within the refresh interval', async () => {
    const site = bootAuthOptions()
    const token = await site.refresh(await site.signIn('old secret'))

    site.store.row!.password = hashOf('new secret')
    const within = await site.authOptions.callbacks.jwt({ token: { ...token } })
    expect(within.email).toBe(EMAIL)
  })
})
