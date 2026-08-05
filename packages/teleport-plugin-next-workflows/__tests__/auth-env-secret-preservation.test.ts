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

  // Regression: every CMS type in the platform exposes its base URL + access
  // token through exactly two STABLE env keys — CMS_URL and CMS_ACCESS_TOKEN —
  // regardless of how the underlying secret is named. Whenever the value is a
  // `teleporthq.secrets.<name>` alias (env KEY != secret name), emptying it lost
  // the mapping: the deploy worker's empty-value fallback looked up a secret
  // named after the KEY (CMS_URL / CMS_ACCESS_TOKEN), which never exists — only
  // the referenced name (STRAPI_URL, CONTENTFUL_API_TOKEN2, …) does. So the CMS
  // base URL and/or token shipped blank and every CMS fetch on the deployed site
  // failed (empty CMS_URL → hostless `/api/...`; empty token → 401). The list
  // rendered in the GUI but was empty in the deployed project. These must all be
  // PRESERVED so the worker resolves them via its `teleporthq.secrets.*` branch.
  // Source of truth for the secret names: each integration's flow.ts
  // getUniqueNameForSecret(...) + to-uidl-mapper provideBaseUrl/provideAccessToken.
  describe('PRESERVES CMS alias placeholders for every CMS type', () => {
    const cmsAliasCases: Array<[string, string, string]> = [
      // [cmsType, env key, alias value emitted by the GUI mapper]
      ['contentful (token)', 'CMS_ACCESS_TOKEN', 'teleporthq.secrets.CONTENTFUL_API_TOKEN2'],
      ['strapi (url)', 'CMS_URL', 'teleporthq.secrets.STRAPI_URL'],
      ['strapi (token)', 'CMS_ACCESS_TOKEN', 'teleporthq.secrets.STRAPI_ACCESS_TOKEN'],
      ['flotiq (url)', 'CMS_URL', 'teleporthq.secrets.FLOTIQ_URL'],
      ['flotiq (token)', 'CMS_ACCESS_TOKEN', 'teleporthq.secrets.FLOTIQ_ACCESS_TOKEN'],
      ['caisy (token)', 'CMS_ACCESS_TOKEN', 'teleporthq.secrets.CAISY_ACCESS_TOKEN'],
      ['wordpress (url)', 'CMS_URL', 'teleporthq.secrets.WORDPRESS_URL'],
    ]
    it.each(cmsAliasCases)('%s alias survives', (_label, key, value) => {
      expect(resolveAuthEnvValue(key, value, oauthKeys)).toBe(value)
      // Holds even with no preserveKeys argument (the CMS set is unconditional).
      expect(resolveAuthEnvValue(key, value)).toBe(value)
    })

    // CMS_URL values that are NOT secret refs (Contentful delivery URL, caisy
    // GraphQL URL) pass through untouched whether or not they're in the preserve
    // set — listing CMS_URL is a harmless no-op for them.
    const cmsPlainUrlCases: Array<[string, string]> = [
      ['contentful', 'https://cdn.contentful.com/spaces/0g5imrx0o9y5/environments/master'],
      ['caisy', 'https://cloud.caisy.io/api/v3/e/PROJECT_ID/graphql'],
    ]
    it.each(cmsPlainUrlCases)('%s plain CMS_URL passes through untouched', (_label, url) => {
      expect(resolveAuthEnvValue('CMS_URL', url, oauthKeys)).toBe(url)
    })
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

  // Regression: next-auth v4 `react/index.js` runs `parseUrl(process.env.NEXTAUTH_URL)`
  // at module load, and `new URL('')` throws "Invalid URL" — crashing SSR for
  // every page that mounts SessionProvider. `createEnvFiles` writes every key,
  // so a BLANK NEXTAUTH_URL serializes as the crashing `NEXTAUTH_URL=`. The
  // blank case is self-perpetuating (the standalone harness re-injects the
  // on-disk empty value), so the resolver must heal it, not pass it through.
  describe('blank auth-critical keys heal to their local default', () => {
    it.each(['', '   ', undefined as unknown as string])(
      'NEXTAUTH_URL=%p becomes the localhost default rather than an empty assignment',
      (blank) => {
        expect(resolveAuthEnvValue('NEXTAUTH_URL', blank, oauthKeys)).toBe('http://localhost:3000')
      }
    )

    it('a blank NEXTAUTH_SECRET heals to the placeholder default', () => {
      expect(resolveAuthEnvValue('NEXTAUTH_SECRET', '', oauthKeys)).toBe(
        'CHANGE_ME_TO_A_RANDOM_SECRET'
      )
    })

    it('a real configured NEXTAUTH_URL / NEXTAUTH_SECRET is left untouched', () => {
      expect(resolveAuthEnvValue('NEXTAUTH_URL', 'https://shop.example.com', oauthKeys)).toBe(
        'https://shop.example.com'
      )
      expect(
        resolveAuthEnvValue('NEXTAUTH_SECRET', 'a-real-32-char-secret-value-xxxxx', oauthKeys)
      ).toBe('a-real-32-char-secret-value-xxxxx')
    })

    it('a blank NON-auth key still serializes blank — no behavior change outside the two auth keys', () => {
      expect(resolveAuthEnvValue('TELEPORT_DB_SSL', '', oauthKeys)).toBe('')
      expect(resolveAuthEnvValue('SOME_OTHER_KEY', '', oauthKeys)).toBe('')
    })
  })
})
