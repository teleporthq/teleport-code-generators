/**
 * The server half of page protection: `utils/auth/page-access.js`, emitted
 * beside the middleware for every project whose authentication protects a
 * page or a folder.
 *
 * The middleware (`generateMiddlewareFile` in auth-generator.ts) stays the
 * first net, but a request can reach a page without it — a Next 12
 * Pages-Router app with i18n serves `/_next/data/<build>/<page>.json` without
 * running it (CVE-2026-44573), and its matcher skips every path that merely
 * starts with "api". So every page it gates renders with getServerSideProps
 * whose first statement is `guardPageAccess(context, <policy>)`: the policy is
 * baked into the page at build time (`PageAccess.resolvePageAccessPolicy` in
 * teleport-shared, the middleware's own route table), and a denied request
 * gets a redirect or a 404 before any of the page's data is read.
 *
 * The session is decoded from the request the way the workflow routes decode
 * it (`session-cookie-resolver`), the role read the way their guard reads it
 * (`ROLE_OF_TOKEN_CODE`), and a subscription checked with the one entitlement
 * query the subscriber-access route runs (`utils/auth/subscriber-access.js`).
 */
import { UIDLAuthentication } from '@teleporthq/teleport-types'
import { generateCommonJsSessionTokenResolverCode } from './session-cookie-resolver'
import { ROLE_OF_TOKEN_CODE } from './workflow-auth-generator'
import { hasSubscriberOnlyPages } from './subscriber-access-route-generator'

const subscriberAccessLoader = (withSubscriberAccess: boolean): string =>
  withSubscriberAccess
    ? `// The entitlement query the subscriber-access route runs.
function subscriberAccessModule() {
  return require('./subscriber-access');
}`
    : `// No page is subscriber-only, so no entitlement query was emitted: a policy
// that still asks for a subscription fails closed.
function subscriberAccessModule() {
  throw new Error('No subscriber-only pages in this project');
}`

export const generatePageAccessGuardModule = (auth: UIDLAuthentication): string => {
  const signInRoute = auth.authPages?.signIn?.route || '/auth/sign-in'

  return `'use strict';

// GENERATED — see generatePageAccessGuardModule in
// @teleporthq/teleport-plugin-next-workflows/src/page-access-guard-generator.ts.
//
// Every page the middleware protects calls guardPageAccess first in its
// getServerSideProps: a request can reach a page without the middleware (Next 12
// serves a page's /_next/data/<build>/<page>.json without running it when the
// site has languages), so the page checks the session itself.

${generateCommonJsSessionTokenResolverCode('../..')}
${ROLE_OF_TOKEN_CODE}

${subscriberAccessLoader(hasSubscriberOnlyPages(auth))}

var SIGN_IN_ROUTE = ${JSON.stringify(signInRoute)};

function sessionUserId(token) {
  if (!token || typeof token !== 'object') {
    return null;
  }
  return token.id != null ? token.id : (token.sub != null ? token.sub : null);
}

// Next.js strips the language prefix before the page runs; a redirect puts it
// back. The default language is served unprefixed.
function localizedPath(context, path) {
  var locale = context && context.locale;
  var defaultLocale = context && context.defaultLocale;
  if (!locale || !defaultLocale || locale === defaultLocale) {
    return path;
  }
  return '/' + locale + (path === '/' ? '' : path);
}

// The page asked for, as a same-site path without its query.
function requestedPath(context) {
  var url = context && typeof context.resolvedUrl === 'string' ? context.resolvedUrl : '/';
  var path = url.split('?')[0].split('#')[0];
  if (path.charAt(0) !== '/' || path.indexOf('//') === 0 || path.indexOf('\\\\') !== -1) {
    return '/';
  }
  return path;
}

function signInRedirect(context) {
  return {
    redirect: {
      destination:
        localizedPath(context, SIGN_IN_ROUTE) +
        '?callbackUrl=' +
        encodeURIComponent(localizedPath(context, requestedPath(context))),
      permanent: false,
    },
  };
}

// null when the visitor may see the page; otherwise what getServerSideProps
// returns instead — sign-in without a session, a 404 for a session without the
// role or the subscription. Every failure (no app secret, a cookie that does not
// decode, a database error) answers "not allowed".
async function guardPageAccess(context, policy) {
  var res = context && context.res;
  if (res && typeof res.setHeader === 'function') {
    // A page behind a sign-in is never kept by a shared cache.
    res.setHeader('Cache-Control', 'private, no-store');
  }

  var token = null;
  try {
    token = await __tqSessionToken(context && context.req);
  } catch (e) {
    token = null;
  }
  if (!token) {
    return signInRedirect(context);
  }

  var roles = (policy && policy.allowedRoles) || [];
  if (roles.length > 0) {
    var role = roleOf(token);
    if (!role || roles.indexOf(role) < 0) {
      return { notFound: true };
    }
  }

  if (policy && policy.requiresSubscription) {
    var userId = sessionUserId(token);
    var entitled = false;
    try {
      entitled =
        userId != null &&
        String(userId) !== '' &&
        (await subscriberAccessModule().isSubscriberEntitled(
          String(userId),
          policy.subscriptionProductIds || []
        )) === true;
    } catch (e) {
      console.error('[page-access] subscription check failed:', e && e.message ? e.message : e);
      entitled = false;
    }
    if (!entitled) {
      return { notFound: true };
    }
  }

  return null;
}

module.exports = {
  guardPageAccess: guardPageAccess,
};
`
}
