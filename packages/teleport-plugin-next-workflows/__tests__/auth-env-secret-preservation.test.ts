import { resolveAuthEnvValue, collectOAuthCredentialEnvKeys } from '../src/workflow-project-plugin'

// Regression: OAuth provider credentials never reached the deployed env →
// NextAuth `error=OAuthSignin` ("Continue with Google" does nothing). The auth
// plugin's `resolveAuthEnvValue` EMPTIED every `teleporthq.secrets.X` env value
// that wasn't NEXTAUTH_*, so the deploy worker had no placeholder to resolve and
// `process.env.AUTH_GOOGLE_ID` came out blank. The fix preserves the
// `teleporthq.secrets.<key>` placeholder for OAuth provider credential keys.

describe('collectOAuthCredentialEnvKeys', () => {
  it('collects every credential field key across providers', () => {
    const auth: any = {
      providers: [
        {
          id: 'google',
          credentials: {
            AUTH_GOOGLE_ID: 'teleporthq.secrets.AUTH_GOOGLE_ID',
            AUTH_GOOGLE_SECRET: 'teleporthq.secrets.AUTH_GOOGLE_SECRET1',
          },
        },
        { id: 'auth0', credentials: { AUTH_AUTH0_ID: 'x', AUTH_AUTH0_ISSUER: 'y' } },
      ],
    }
    const keys = collectOAuthCredentialEnvKeys(auth)
    expect(Array.from(keys).sort()).toEqual(
      ['AUTH_AUTH0_ID', 'AUTH_AUTH0_ISSUER', 'AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET'].sort()
    )
  })

  it('is empty for no/invalid auth', () => {
    expect(collectOAuthCredentialEnvKeys(undefined).size).toBe(0)
    expect(collectOAuthCredentialEnvKeys({ providers: [] } as any).size).toBe(0)
  })
})

describe('resolveAuthEnvValue', () => {
  const oauthKeys = new Set(['AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET'])

  it('PRESERVES the placeholder for OAuth provider credential keys', () => {
    expect(
      resolveAuthEnvValue('AUTH_GOOGLE_ID', 'teleporthq.secrets.AUTH_GOOGLE_ID', oauthKeys)
    ).toBe('teleporthq.secrets.AUTH_GOOGLE_ID')
    // Collision case: the env key AUTH_GOOGLE_SECRET references the uniquified
    // secret key AUTH_GOOGLE_SECRET1 — the placeholder must survive verbatim so
    // the worker resolves projectSecrets['AUTH_GOOGLE_SECRET1'].
    expect(
      resolveAuthEnvValue('AUTH_GOOGLE_SECRET', 'teleporthq.secrets.AUTH_GOOGLE_SECRET1', oauthKeys)
    ).toBe('teleporthq.secrets.AUTH_GOOGLE_SECRET1')
  })

  it('still empties the orphan/duplicate env key that is not a real credential field', () => {
    // AUTH_GOOGLE_SECRET1 is a stray globals.env key, not a provider credential
    // field — nothing reads it, so it stays emptied (harmless).
    expect(
      resolveAuthEnvValue(
        'AUTH_GOOGLE_SECRET1',
        'teleporthq.secrets.AUTH_GOOGLE_SECRET1',
        oauthKeys
      )
    ).toBe('')
  })

  it('keeps NEXTAUTH defaults and leaves non-auth behavior unchanged', () => {
    expect(
      resolveAuthEnvValue('NEXTAUTH_SECRET', 'teleporthq.secrets.NEXTAUTH_SECRET', oauthKeys)
    ).toBe('CHANGE_ME_TO_A_RANDOM_SECRET')
    expect(resolveAuthEnvValue('NEXTAUTH_URL', 'teleporthq.secrets.NEXTAUTH_URL', oauthKeys)).toBe(
      'http://localhost:3000'
    )
    // Non-OAuth secret-refs (handled by other plugins / the worker) are still
    // emptied here — unchanged behavior, no regression.
    expect(
      resolveAuthEnvValue('EMAIL_POSTMARK_SERVERTOKEN', 'teleporthq.secrets.X', oauthKeys)
    ).toBe('')
    // Plain (non-secret) values pass through untouched.
    expect(resolveAuthEnvValue('TELEPORT_DB_SSL', 'true', oauthKeys)).toBe('true')
    expect(resolveAuthEnvValue('AUTH_CREDENTIALS_ENABLED', 'true', oauthKeys)).toBe('true')
  })
})
