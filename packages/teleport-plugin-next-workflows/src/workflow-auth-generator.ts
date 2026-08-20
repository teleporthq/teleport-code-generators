import { UIDLWorkflowProtection } from '@teleporthq/teleport-types'
import { generateCommonJsSessionTokenResolverCode } from './session-cookie-resolver'

/**
 * The shared, stateless auth guard for generated workflow API routes, emitted
 * once at `utils/workflows/workflow-auth.js`.
 *
 * The policy is baked into each route at build time (from the workflow's page
 * protection + a scan of its graph for user-owned writes), so enforcement is a
 * single local JWT decode — `getToken` reads the session cookie the browser
 * already sends and verifies it with `NEXTAUTH_SECRET`. No DB, no network, no
 * round trip. `next-auth/jwt` is required LAZILY so a project generated without
 * authentication (where the package is absent) never fails to load this file —
 * such projects also carry no protected workflows, so the guard no-ops.
 *
 * ⛔ WHICH cookie that decode reads is resolved from the REQUEST, not from
 * `process.env.NEXTAUTH_URL` — see `session-cookie-resolver.ts` for the 401 that
 * taught us the difference. Every signed-in caller whose request landed on a
 * serverless instance that had not yet served an auth request was reported
 * anonymous, and the page-load workflow answered 401.
 */
export const generateWorkflowAuthHelperFile = (): string => {
  return `'use strict';

// GENERATED — see generateWorkflowAuthHelperFile in
// @teleporthq/teleport-plugin-next-workflows/src/workflow-auth-generator.ts.
//
// Stateless auth guard for workflow API routes. Each route bakes its own policy
// (const __WF_AUTH) computed by the GUI mapper from the protection of the
// page(s) that trigger the workflow plus a graph scan for user-owned writes.

${generateCommonJsSessionTokenResolverCode()}
function getSessionToken(req) {
  // Local cookie decode — no DB, no network.
  return __tqSessionToken(req);
}

function sessionUserId(token) {
  if (!token || typeof token !== 'object') {
    return null;
  }
  return token.id != null ? token.id : (token.sub != null ? token.sub : null);
}

function roleOf(token) {
  if (!token || typeof token !== 'object') {
    return null;
  }
  if (typeof token.role === 'string') {
    return token.role;
  }
  if (typeof token.roleName === 'string') {
    return token.roleName;
  }
  if (Array.isArray(token.roles) && token.roles.length > 0 && typeof token.roles[0] === 'string') {
    return token.roles[0];
  }
  return null;
}

// Overwrites context[nodeId] drilled down \`path\` with the session user id.
function bindPath(root, path, value) {
  if (!root || !path || path.length === 0) {
    return;
  }
  var obj = root;
  for (var i = 0; i < path.length - 1; i++) {
    var key = path[i];
    if (obj[key] == null || typeof obj[key] !== 'object') {
      obj[key] = {};
    }
    obj = obj[key];
  }
  obj[path[path.length - 1]] = value;
}

// Returns null when the request may proceed, or { status, message } to reject.
// Mutates \`context\` in place to bind user-owned columns to the session user.
async function guardWorkflowRequest(req, context, policy) {
  if (!policy) {
    return null;
  }

  // Trusted internal server-to-server calls (e.g. password reset, server jobs)
  // present the app secret in a header; only server code can read
  // NEXTAUTH_SECRET, so a browser cannot forge it. These bypass the check.
  var internal = req && req.headers && req.headers['x-internal-data-secret'];
  if (internal && process.env.NEXTAUTH_SECRET && internal === process.env.NEXTAUTH_SECRET) {
    return null;
  }

  var token = await getSessionToken(req);

  if (policy.requiresAuth && !token) {
    return { status: 401, message: 'Unauthenticated' };
  }

  var roles = policy.allowedRoles || [];
  if (policy.requiresAuth && roles.length > 0) {
    var role = roleOf(token);
    if (!role || roles.indexOf(role) < 0) {
      return { status: 403, message: 'Forbidden' };
    }
  }

  // Identity binding: force every user-owned column to the AUTHENTICATED session
  // id so a caller can never act on another user's rows. Only when a session is
  // present — a guest keeps their (anonymous) client identity, which is why a
  // guest-capable public write is not blocked here.
  if (policy.userScoped && context) {
    var sid = sessionUserId(token);
    if (sid != null) {
      var bindings = (policy.userScoped && policy.userScoped.bindings) || [];
      for (var i = 0; i < bindings.length; i++) {
        var b = bindings[i];
        if (b && b.nodeId) {
          if (context[b.nodeId] == null || typeof context[b.nodeId] !== 'object') {
            context[b.nodeId] = {};
          }
          bindPath(context[b.nodeId], b.path || [], sid);
        }
      }
    }
  }

  return null;
}

module.exports = { guardWorkflowRequest: guardWorkflowRequest };
`
}

/**
 * The route-side pieces that wire a workflow's protection policy into a
 * generated API-route handler. Empty strings when the workflow has no policy,
 * so an unprotected route is byte-identical to before.
 */
export interface WorkflowAuthInjection {
  // `require(...)` of the shared helper (placed with the other requires).
  requireLine: string
  // `const __WF_AUTH = {...};` — the baked policy.
  policyConst: string
  // The `await` guard call + early 401/403 response, placed after the request
  // context is assembled and BEFORE any node runs / any stream starts.
  guardCall: string
}

const EMPTY_INJECTION: WorkflowAuthInjection = { requireLine: '', policyConst: '', guardCall: '' }

export const buildWorkflowAuthInjection = (
  protection: UIDLWorkflowProtection | undefined
): WorkflowAuthInjection => {
  if (!protection || (!protection.requiresAuth && !protection.userScoped)) {
    return EMPTY_INJECTION
  }

  // Only the fields the runtime guard reads — `derivedFrom` is build-time only.
  const policy: {
    requiresAuth: boolean
    allowedRoles: string[]
    userScoped?: UIDLWorkflowProtection['userScoped']
  } = {
    requiresAuth: !!protection.requiresAuth,
    allowedRoles: protection.allowedRoles || [],
  }
  if (protection.userScoped) {
    policy.userScoped = protection.userScoped
  }

  return {
    requireLine: `const __wfAuth = require('../../../utils/workflows/workflow-auth');\n`,
    policyConst: `const __WF_AUTH = ${JSON.stringify(policy)};\n`,
    guardCall: `
    const __authError = await __wfAuth.guardWorkflowRequest(req, context, __WF_AUTH);
    if (__authError) {
      res.status(__authError.status).json({ error: __authError.message });
      return;
    }`,
  }
}
