import { generateAuthOptionsFile } from '../src/auth-generator'

// Regression guards for OAuth provider code-gen. Previously the generated
// auth-options emitted `const <Capitalized(id)>Provider = require(...)`, which:
//  - produced an INVALID JS identifier for hyphen/digit ids (e.g. azure-ad →
//    `const Azure-adProvider` = syntax error), and
//  - `require('next-auth/providers/<id>')` threw at import for renamed/missing
//    modules, taking down ALL auth (credentials + every provider).
// The generator now builds the `providers` array imperatively, requiring each
// OAuth module inside its own try/catch with a local binding.

const authWith = (providers: any[], passwordAuthEnabled = true): any => ({
  enabled: true,
  passwordAuthEnabled,
  providers,
  authPages: { signIn: { route: '/sign-in' } },
  dataSourceType: 'postgresql',
  customUserProperties: [],
})

const cred = (prefix: string, extra?: string) => {
  const c: Record<string, string> = {}
  c[`${prefix}_ID`] = `teleporthq.secrets.${prefix}_ID`
  c[`${prefix}_SECRET`] = `teleporthq.secrets.${prefix}_SECRET`
  if (extra) c[`${prefix}_${extra}`] = `teleporthq.secrets.${prefix}_${extra}`
  return c
}

describe('auth-generator OAuth providers', () => {
  it('never emits an invalid JS identifier for hyphen/digit provider ids', () => {
    const out = generateAuthOptionsFile(
      authWith([
        { id: 'azure-ad', name: 'Azure AD', credentials: cred('AUTH_AZURE_AD') },
        { id: '42-school', name: '42 School', credentials: cred('AUTH_42_SCHOOL') },
        { id: 'azure-ad-b2c', name: 'Azure B2C', credentials: cred('AUTH_AZURE_AD_B2C', 'ISSUER') },
      ]),
      null
    )
    // No `const <ident-with-hyphen>` anywhere (the old bug). Match a const/var
    // declaration whose name contains a hyphen.
    expect(out).not.toMatch(/\b(?:const|var|let)\s+[A-Za-z0-9$_]*-[A-Za-z0-9$_-]*\s*=/)
    // Correct module paths are still required (just locally, in a guard).
    expect(out).toContain("require('next-auth/providers/azure-ad')")
    expect(out).toContain("require('next-auth/providers/42-school')")
  })

  it('wraps every OAuth provider in its own try/catch and pushes to a providers array', () => {
    const out = generateAuthOptionsFile(
      authWith([{ id: 'google', name: 'Google', credentials: cred('AUTH_GOOGLE') }]),
      null
    )
    expect(out).toContain('const providers = [];')
    expect(out).toContain('providers: providers,')
    expect(out).toMatch(
      /try \{[\s\S]*require\('next-auth\/providers\/google'\)[\s\S]*providers\.push\(/
    )
    expect(out).toContain('catch')
    expect(out).toContain('clientId: process.env.AUTH_GOOGLE_ID')
    expect(out).toContain('clientSecret: process.env.AUTH_GOOGLE_SECRET')
  })

  it('maps the renamed module names (boxyhq / duende / identityserver4)', () => {
    const out = generateAuthOptionsFile(
      authWith([
        { id: 'boxyhq', name: 'BoxyHQ', credentials: cred('AUTH_BOXYHQ_SAML', 'ISSUER') },
        {
          id: 'duende',
          name: 'Duende',
          credentials: cred('AUTH_DUENDE_IDENTITYSERVER_6', 'ISSUER'),
        },
        {
          id: 'identityserver4',
          name: 'IS4',
          credentials: cred('AUTH_IDENTITY_SERVER4', 'ISSUER'),
        },
      ]),
      null
    )
    expect(out).toContain("require('next-auth/providers/boxyhq-saml')")
    expect(out).toContain("require('next-auth/providers/duende-identity-server6')")
    expect(out).toContain("require('next-auth/providers/identity-server4')")
  })

  it('emits issuer for OIDC providers that have an issuer/domain/tenant field', () => {
    const out = generateAuthOptionsFile(
      authWith([{ id: 'auth0', name: 'Auth0', credentials: cred('AUTH_AUTH0', 'ISSUER') }]),
      null
    )
    expect(out).toContain('issuer: process.env.AUTH_AUTH0_ISSUER')
  })

  it('still emits the CredentialsProvider when password auth is enabled', () => {
    const out = generateAuthOptionsFile(authWith([], true), null)
    expect(out).toContain("require('next-auth/providers/credentials')")
    expect(out).toContain('providers.push(CredentialsProvider(')
  })
})
