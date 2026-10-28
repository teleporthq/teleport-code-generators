/**
 * `NEXTAUTH_URL` as the deployment configured it, as a generated-JS
 * expression.
 *
 * The generated NextAuth route rewrites `process.env.NEXTAUTH_URL` on every
 * request (to the request's own origin, from `X-Forwarded-Host` / `Host`, when
 * the configured value is local or unset), after keeping the configured value
 * on `globalThis.__tqConfiguredNextAuthUrl` once per process (auth-generator.ts;
 * the automations bus keeps it the same way when it reads it first). Every rule
 * that sends the app's credentials to "its own origin" reads this expression,
 * never the live variable: read live, a forged header on `/api/auth` would
 * become the origin those calls carry the app secret to. Without a snapshot no
 * auth route has run in the process, so the variable still holds the
 * configured value.
 */
export const CONFIGURED_NEXTAUTH_URL_EXPRESSION =
  "(typeof globalThis.__tqConfiguredNextAuthUrl === 'string' ? globalThis.__tqConfiguredNextAuthUrl : process.env.NEXTAUTH_URL)"
