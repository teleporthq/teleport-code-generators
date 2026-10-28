/**
 * How a generated site's server code calls its own API routes outside the
 * workflow runtime (whose nodes get the same from `internalRequestHeaders`,
 * executor-generator): the data API's low-stock alert, the legacy payment
 * webhooks' invoice and order-notification calls, the invoice PDF upload, the
 * automations' dispatch kick.
 *
 * Every such call presents the app secret (only server code can read
 * NEXTAUTH_SECRET) and, on a deployment behind Vercel's password wall (a
 * workspace not paying for hosting, or an owner's own password), the
 * deployment's protection bypass — `VERCEL_AUTOMATION_BYPASS_SECRET`, which
 * the services worker sets on such a deployment. Without it the site's own
 * call meets the wall and answers 401, and nothing it should do happens.
 *
 * One emitted function, `__selfCallHeaders(headers)`: the headers given
 * (`Content-Type`, for one), plus those. Inlined into each route that calls
 * itself, so no route needs another module to exist.
 */
export const SELF_CALL_HEADERS_FUNCTION = '__selfCallHeaders'

/**
 * Emitted statements that add the deployment's protection bypass to the
 * headers object named `target`, where the deployment has one — the one place
 * the bypass header is built. `__selfCallHeaders` below, the workflow
 * runtime's `internalRequestHeaders` (executor-generator.ts: the visitor's
 * cookies and the bypass, never the app secret) and the push send route's
 * relay (web-push/routes-source.ts in the Next project generator) all emit it.
 * `indent` is the indentation of the `if`.
 */
export const generateProtectionBypassHeaderStatements = (target: string, indent = '  '): string =>
  `${indent}if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
${indent}  ${target}['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
${indent}  // Vercel would otherwise hand the bypass back as a cookie.
${indent}  ${target}['x-vercel-set-bypass-cookie'] = 'false';
${indent}}`

export const generateSelfCallHeadersCode =
  (): string => `// The headers this deployment's server code calls its own routes with: the app
// secret, and the password wall's bypass where the deployment has one (see
// self-call-headers.ts in the code generators).
function ${SELF_CALL_HEADERS_FUNCTION}(headers) {
  var out = Object.assign({}, headers || {});
  out['x-internal-data-secret'] = process.env.NEXTAUTH_SECRET || '';
${generateProtectionBypassHeaderStatements('out')}
  return out;
}`
