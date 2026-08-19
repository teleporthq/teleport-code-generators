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
 * from this one definition.
 */

/** The `__tq`-prefixed globals the emitted snippet declares. */
export const SESSION_TOKEN_RESOLVER_FN = '__tqResolveSessionToken'

/**
 * Session-cookie names next-auth/Auth.js writes, with the `secureCookie` flag
 * that produces each. Order within a protocol is irrelevant — only ONE of these
 * is ever present — but the https/http split decides which pair is tried first.
 *
 * `__Host-` is deliberately absent: next-auth uses it only for the CSRF and
 * callback cookies, never for the session token.
 */
const KNOWN_SESSION_COOKIES: ReadonlyArray<{ name: string; secure: boolean }> = [
  { name: '__Secure-next-auth.session-token', secure: true },
  { name: 'next-auth.session-token', secure: false },
  { name: '__Secure-authjs.session-token', secure: true },
  { name: 'authjs.session-token', secure: false },
]

/**
 * ES5 source for the shared session-token resolver, safe to inline into any
 * generated CommonJS route or ESM middleware.
 *
 * Declares:
 *  - `__tqCookieNamesPresent(req)` — the set of cookie names on the request,
 *    parsed properly (a substring test would see `next-auth.session-token`
 *    inside `__Secure-next-auth.session-token` and pick the wrong one).
 *  - `__tqRequestIsSecure(req)` — https as the REQUEST reports it.
 *  - `__tqSessionTokenCandidates(req)` — `{cookieName, secureCookie}` pairs to try.
 *  - `__tqResolveSessionToken(getToken, req, secret)` — the token, or null.
 *
 * `getToken` is passed IN rather than required here, so the same body serves a
 * CommonJS route (lazy `require('next-auth/jwt')`) and the Edge middleware
 * (static `import`). Pure, total, never throws, no env reads.
 */
export const generateSessionTokenResolverCode = (): string => {
  return `// GENERATED — see generateSessionTokenResolverCode in
// @teleporthq/teleport-plugin-next-workflows/src/session-cookie-resolver.ts.
//
// next-auth's getToken() picks the session cookie name from
// process.env.NEXTAUTH_URL, which a generated project ships as a localhost
// default — so on a published https domain it looks for the non-secure cookie
// and reports a signed-in user as anonymous. These helpers read the cookie the
// request actually carries and tell getToken exactly which one it is.
var __TQ_SESSION_COOKIES = ${JSON.stringify(KNOWN_SESSION_COOKIES.map((c) => [c.name, c.secure]))};

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

// Is this request https? Read from the proxy header the platform sets, then the
// socket, then the URL — never from an env var describing the deployment.
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
  } catch (e) {
    /* fall through to false */
  }
  return false;
}

// The { cookieName, secureCookie } pairs worth trying, most likely first.
// Normally exactly one cookie is present and this returns a single entry; the
// list only grows when a site has been reached over both http and https.
function __tqSessionTokenCandidates(req) {
  var present = __tqCookieNamesPresent(req);
  var secure = __tqRequestIsSecure(req);
  var candidates = [];
  for (var i = 0; i < __TQ_SESSION_COOKIES.length; i++) {
    var name = __TQ_SESSION_COOKIES[i][0];
    var isSecureName = __TQ_SESSION_COOKIES[i][1];
    if (present[name] || present[name + '.0']) {
      candidates.push({ cookieName: name, secureCookie: isSecureName });
    }
  }
  candidates.sort(function (a, b) {
    if (a.secureCookie === b.secureCookie) {
      return 0;
    }
    return a.secureCookie === secure ? -1 : 1;
  });
  if (candidates.length === 0) {
    // No cookie we recognise. The project may configure a custom cookie name in
    // authOptions, so hand getToken the request's own protocol and let it apply
    // its defaults — same behaviour as before this resolver existed, minus the
    // localhost env var.
    candidates.push({ secureCookie: secure });
  }
  return candidates;
}

// The decoded session token, or null. Tries each candidate cookie in turn so a
// project that renamed its cookie, or one reached over both protocols, still
// resolves. Never throws.
function ${SESSION_TOKEN_RESOLVER_FN}(getToken, req, secret) {
  if (!secret || typeof getToken !== 'function') {
    return Promise.resolve(null);
  }
  var candidates = __tqSessionTokenCandidates(req);
  var attempt = function (index) {
    if (index >= candidates.length) {
      return Promise.resolve(null);
    }
    var candidate = candidates[index];
    var params = { req: req, secret: secret, secureCookie: candidate.secureCookie };
    if (candidate.cookieName) {
      params.cookieName = candidate.cookieName;
    }
    return Promise.resolve()
      .then(function () {
        return getToken(params);
      })
      .catch(function () {
        return null;
      })
      .then(function (token) {
        return token || attempt(index + 1);
      });
  };
  return attempt(0);
}
`
}

/**
 * The resolver plus a lazy `require('next-auth/jwt')`, for a CommonJS route.
 *
 * The require is lazy and guarded because a project generated WITHOUT
 * authentication does not ship `next-auth`; such a project also has no session
 * to read, so resolving to `null` there is the correct answer rather than a
 * module-load crash.
 */
export const generateCommonJsSessionTokenResolverCode = (): string => {
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
