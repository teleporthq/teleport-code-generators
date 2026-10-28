/**
 * Resolving the NextAuth session token in a generated route, WITHOUT asking
 * `process.env.NEXTAUTH_URL` what the session cookie is called.
 *
 * ## ⛔ THE REPORTED DEFECT
 *
 * A published project showed "Failed to load dashboard data. Please refresh."
 * on the home page, "Failed to load meeting data." on the list page and "could
 * not fetch the templates" on a third — for a user who was signed in, on a page
 * whose own `/api/auth/session` returned that user. The failing call was the
 * page-load workflow's server segment, answering **401 `Unauthenticated`** from
 * `guardWorkflowRequest`. Reloading sometimes fixed it; fanning 50 concurrent
 * requests at the same route returned **33 × 401 and 17 × 200**, while 40
 * concurrent `/api/auth/session` calls resolved the user 40/40.
 *
 * ## The mechanism
 *
 * next-auth v4's `getToken()` derives the cookie it reads from an env var:
 *
 * ```js
 * secureCookie = process.env.NEXTAUTH_URL?.startsWith('https://') ?? !!process.env.VERCEL,
 * cookieName   = secureCookie ? '__Secure-next-auth.session-token' : 'next-auth.session-token',
 * ```
 *
 * A generated project ships `NEXTAUTH_URL=http://localhost:3000` — the build
 * cannot know the domain it will be published to, so `pages/api/auth/[...nextauth].js`
 * repairs `process.env.NEXTAUTH_URL` **from the incoming request** instead. That
 * repair is process-local: it fixes the value for whichever serverless instance
 * happened to serve an auth request, and for no other. Every other instance
 * still holds `http://localhost:3000`, so `startsWith('https://')` is `false`
 * (NOT `undefined` — the `??` fallback to `!!process.env.VERCEL` never runs),
 * `getToken` looks for `next-auth.session-token`, the browser is holding
 * `__Secure-next-auth.session-token`, nothing is found, and a signed-in user is
 * reported as anonymous.
 *
 * Hence the coin-flip: it depends on whether the instance that served your
 * request had previously served an auth request. Nothing about the session, the
 * secret or the cookie is wrong.
 *
 * The same defect is why the generated middleware carries a `hasSessionCookie`
 * fallback and a round trip to `/api/auth/session`, attributed there to an
 * "Edge runtime quirk" — the Edge process holds that same localhost value.
 *
 * ## The rule
 *
 * ⭐ **A request must be authenticated from the REQUEST, never from an ambient
 * env var that describes the deployment.** So this resolver reads which session
 * cookie the caller actually sent, and tells `getToken` exactly that — falling
 * back to the request's own protocol when the cookie header is unavailable.
 *
 * Emitted as plain ES5 text and inlined into each generated route: a route that
 * carries its own copy cannot be broken by a missing sibling module or an
 * untraced dependency, and every call site gets the identical implementation
 * from this one definition. It lives in teleport-shared because both the
 * workflow routes and the per-table data routes decode the session.
 */

/** The `__tq`-prefixed globals the emitted snippet declares. */
export const SESSION_TOKEN_RESOLVER_FN = '__tqResolveSessionToken'

/**
 * ## ⛔ The session cookie on https is `__Host-`, and nothing else is read
 *
 * Published sites share `*.teleporthq.app`, which is not on the Public Suffix
 * List: any sibling site can set a cookie for `.teleporthq.app` — including one
 * named like next-auth's default `__Secure-next-auth.session-token` or the
 * plain `next-auth.session-token` — and every other site would read it as its
 * visitor's session (cookie tossing: the visitor is silently signed in to the
 * attacker's account, a login CSRF). A `__Host-` cookie can only be set by the
 * site itself (no Domain, Path=/, Secure), so the generated auth options name
 * the session token (and the callback-url cookie) with it on https
 * (`generateAuthOptionsFile`), and every reader here reads that ONE name on an
 * https request and the plain name only on an http (local) one. There is no
 * fallback to the old names: reading them would re-open the hole. Visitors are
 * signed out once when a site is republished with this.
 */
export const SECURE_SESSION_COOKIE_NAME = '__Host-next-auth.session-token'
export const PLAIN_SESSION_COOKIE_NAME = 'next-auth.session-token'
export const SECURE_CALLBACK_URL_COOKIE_NAME = '__Host-next-auth.callback-url'

/**
 * ES5 source for the shared session-token resolver, safe to inline into any
 * generated CommonJS route or ESM middleware.
 *
 * Declares:
 *  - `__tqCookieNamesPresent(req)` — the set of cookie names on the request,
 *    parsed properly (a substring test would see `next-auth.session-token`
 *    inside `__Secure-next-auth.session-token` and pick the wrong one).
 *  - `__tqRequestIsSecure(req)` — https as the REQUEST reports it.
 *  - `__tqSessionTokenCandidates(req)` — the one `{cookieName, secureCookie}` the
 *    request's protocol allows (`__Host-` on https, plain on http), or none.
 *  - `__tqResolveSessionToken(getToken, req, secret)` — the token, or null.
 *
 * `getToken` is passed IN rather than required here, so the same body serves a
 * CommonJS route (lazy `require('next-auth/jwt')`) and the Edge middleware
 * (static `import`). Pure, total, never throws, no env reads.
 */
export const generateSessionTokenResolverCode = (): string => {
  return `// GENERATED — see generateSessionTokenResolverCode in
// @teleporthq/teleport-shared/src/utils/session-cookie-resolver.ts.
//
// next-auth's getToken() picks the session cookie name from
// process.env.NEXTAUTH_URL, which a generated project ships as a localhost
// default — so on a published https domain it looks for the non-secure cookie
// and reports a signed-in user as anonymous. These helpers read the cookie the
// request actually carries and tell getToken exactly which one it is.
// The session cookie on https ("__Host-": only this site can set it) and on
// http (a local server). No other name is ever read: a sibling site on the
// shared parent domain could plant one (see session-cookie-resolver.ts).
var __TQ_SESSION_COOKIE_SECURE = '${SECURE_SESSION_COOKIE_NAME}';
var __TQ_SESSION_COOKIE_PLAIN = '${PLAIN_SESSION_COOKIE_NAME}';

// Every cookie NAME on the request. Parsed on the "; " separator rather than
// matched as a substring: "next-auth.session-token" occurs inside
// "__Secure-next-auth.session-token", so a substring test reports the plain
// cookie as present whenever the secure one is, and getToken then decodes the
// wrong (missing) cookie.
function __tqCookieNamesPresent(req) {
  var present = {};
  var raw = '';
  try {
    var headers = req && req.headers;
    if (headers && typeof headers.get === 'function') {
      // Edge / fetch Headers.
      raw = headers.get('cookie') || '';
    } else if (headers) {
      var value = headers.cookie || headers.Cookie;
      raw = Array.isArray(value) ? value.join('; ') : value || '';
    }
  } catch (e) {
    raw = '';
  }
  var parts = String(raw).split(';');
  for (var i = 0; i < parts.length; i++) {
    var eq = parts[i].indexOf('=');
    if (eq > 0) {
      present[parts[i].slice(0, eq).trim()] = true;
    }
  }
  // Second source: the runtime's own parsed cookies. A Next.js API route hands
  // over a plain object; the Edge RequestCookies exposes getAll().
  try {
    var cookies = req && req.cookies;
    if (cookies && typeof cookies.getAll === 'function') {
      var all = cookies.getAll() || [];
      for (var a = 0; a < all.length; a++) {
        if (all[a] && all[a].name) {
          present[all[a].name] = true;
        }
      }
    } else if (cookies && typeof cookies === 'object') {
      for (var key in cookies) {
        if (Object.prototype.hasOwnProperty.call(cookies, key)) {
          present[key] = true;
        }
      }
    }
  } catch (e) {
    /* the header pass above is enough */
  }
  return present;
}

function __tqIsLocalHost(host) {
  var name = String(host || '').toLowerCase();
  return (
    !name ||
    name.indexOf('localhost') === 0 ||
    name.indexOf('127.0.0.1') === 0 ||
    name.indexOf('[::1]') === 0 ||
    name.indexOf('0.0.0.0') === 0
  );
}

// Is this request https? Read from the proxy header the platform sets, then the
// socket, then the URL — never from an env var describing the deployment. With
// none of those, a non-local host is https and a local one http: the rule the
// NextAuth route names the cookie by (resolveRequestOrigin).
function __tqRequestIsSecure(req) {
  try {
    var headers = (req && req.headers) || {};
    var proto =
      typeof headers.get === 'function'
        ? headers.get('x-forwarded-proto')
        : headers['x-forwarded-proto'];
    if (Array.isArray(proto)) {
      proto = proto[0];
    }
    if (typeof proto === 'string' && proto) {
      // A chain of proxies appends: "https,http" — the client-facing hop is first.
      return proto.split(',')[0].trim().toLowerCase() === 'https';
    }
    if (req && req.nextUrl && req.nextUrl.protocol === 'https:') {
      return true;
    }
    if (req && req.socket && req.socket.encrypted) {
      return true;
    }
    if (req && req.connection && req.connection.encrypted) {
      return true;
    }
    if (typeof (req && req.url) === 'string' && req.url.indexOf('https://') === 0) {
      return true;
    }
    if (typeof (req && req.url) === 'string' && req.url.indexOf('http://') === 0) {
      return false;
    }
    var host = typeof headers.get === 'function' ? headers.get('host') : headers.host;
    return !__tqIsLocalHost(Array.isArray(host) ? host[0] : host);
  } catch (e) {
    /* fall through to false */
  }
  return false;
}

// The { cookieName, secureCookie } of the session cookie this request carries:
// the "__Host-" one on https, the plain one on http, or none. A cookie of any
// other name — the old "__Secure-" default included — is never a session.
function __tqSessionTokenCandidates(req) {
  var present = __tqCookieNamesPresent(req);
  var secure = __tqRequestIsSecure(req);
  var name = secure ? __TQ_SESSION_COOKIE_SECURE : __TQ_SESSION_COOKIE_PLAIN;
  if (present[name] || present[name + '.0']) {
    return [{ cookieName: name, secureCookie: secure }];
  }
  return [];
}

// The decoded session token, or null: the one cookie the request's protocol
// allows, decoded with exactly that name. Never throws.
function ${SESSION_TOKEN_RESOLVER_FN}(getToken, req, secret) {
  if (!secret || typeof getToken !== 'function') {
    return Promise.resolve(null);
  }
  var candidate = __tqSessionTokenCandidates(req)[0];
  if (!candidate) {
    return Promise.resolve(null);
  }
  var params = {
    req: req,
    secret: secret,
    secureCookie: candidate.secureCookie,
    cookieName: candidate.cookieName,
  };
  return Promise.resolve()
    .then(function () {
      return getToken(params);
    })
    .then(function (token) {
      return token || null;
    })
    .catch(function () {
      return null;
    });
}
`
}

/** The token claim the session stamp rides in (see `session-revocation-generator.ts`). */
export const SESSION_STAMP_KEY = '__sessionStamp'

/** Where the shared revocation check lives in a generated project, from its root. */
export const SESSION_REVOCATION_MODULE_PATH = 'utils/auth/session-revocation'

/**
 * The resolver plus a lazy `require('next-auth/jwt')`, for a CommonJS route,
 * and `__tqSessionToken(req)`: THE session reader of every generated server
 * file. With authentication (`withRevocation`, the default) it also hands each
 * stamped session to the shared check `utils/auth/session-revocation.js`, which
 * reads the account by the token's id: a session whose account changed its
 * password (or `session_version`) since the token was stamped, or is gone, is
 * no session, and a live one carries the account's stored email and role (a
 * demotion counts at once). Every consumer — account deletion, the data API,
 * realtime, uploads, push, page access, the route guards — agrees on who the
 * visitor is. A stamped session whose check cannot be loaded, or whose account
 * cannot be read, is no session (fail closed).
 *
 * ⛔ The one accepted exception is the generated Edge middleware
 * (`generateMiddlewareFile`): the Edge runtime has no database, so it decodes
 * the session with `__tqResolveSessionToken` and does no revocation check. It is
 * only the first net: every page it protects also runs `guardPageAccess` in its
 * own getServerSideProps (enforced by `page-access-guard-plugin.ts`, which fails
 * the generation for a protected page it cannot guard), and that guard reads
 * through this reader.
 *
 * `projectRoot` leads from the file the code is inlined into to the project
 * root (`'../../..'` for `pages/api/<folder>/<route>.js`, `'../..'` for
 * `utils/<dir>/<file>.js`). A project without authentication passes
 * `withRevocation: false` and gets the reader without the check: it has no such
 * module and no stamped session.
 *
 * The `next-auth/jwt` require is lazy and guarded because a project generated
 * WITHOUT authentication does not ship `next-auth`; such a project also has no
 * session to read, so resolving to `null` there is the correct answer rather
 * than a module-load crash.
 */
export const generateCommonJsSessionTokenResolverCode = (
  projectRoot: string = '../../..',
  options: { withRevocation?: boolean } = {}
): string => {
  if (options.withRevocation === false) {
    return `${generateSessionTokenResolverCode()}
// Lazy + guarded: a project generated without authentication has no next-auth
// installed, and no session to read either — null is the right answer there.
function __tqGetTokenFn() {
  try {
    var jwt = require('next-auth/jwt');
    return jwt && typeof jwt.getToken === 'function' ? jwt.getToken : null;
  } catch (e) {
    return null;
  }
}

// The session token for this request, or null. Reads NEXTAUTH_SECRET itself.
function __tqSessionToken(req) {
  var secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return Promise.resolve(null);
  }
  return ${SESSION_TOKEN_RESOLVER_FN}(__tqGetTokenFn(), req, secret);
}
`
  }
  return `${generateSessionTokenResolverCode()}
// Lazy + guarded: a project generated without authentication has no next-auth
// installed, and no session to read either — null is the right answer there.
function __tqGetTokenFn() {
  try {
    var jwt = require('next-auth/jwt');
    return jwt && typeof jwt.getToken === 'function' ? jwt.getToken : null;
  } catch (e) {
    return null;
  }
}

// The shared session-stamp check (utils/auth/session-revocation.js).
function __tqSessionRevocation() {
  try {
    var revocation = require('${projectRoot}/${SESSION_REVOCATION_MODULE_PATH}');
    return revocation && typeof revocation.liveSessionToken === 'function' ? revocation : null;
  } catch (e) {
    return null;
  }
}

// The token as it still counts — with its account's stored email and role —
// or null: its account changed its password (or session_version) since it was
// stamped, or is gone, or cannot be read right now. An unstamped token (an
// OAuth sign-in, a token from before stamps) needs no check.
function __tqLiveSession(token) {
  if (!token || typeof token !== 'object' || typeof token['${SESSION_STAMP_KEY}'] !== 'string') {
    return Promise.resolve(token || null);
  }
  var revocation = __tqSessionRevocation();
  if (!revocation) {
    return Promise.resolve(null);
  }
  return Promise.resolve()
    .then(function () {
      return revocation.liveSessionToken(token);
    })
    .then(
      function (live) {
        return live && typeof live === 'object' ? live : null;
      },
      function () {
        return null;
      }
    );
}

// The session token for this request, or null — a revoked session included.
// Reads NEXTAUTH_SECRET itself.
function __tqSessionToken(req) {
  var secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return Promise.resolve(null);
  }
  return ${SESSION_TOKEN_RESOLVER_FN}(__tqGetTokenFn(), req, secret).then(__tqLiveSession);
}
`
}
