import { WALL_HELPER_NAME, WALL_HELPER_PATH, WALL_MATCHER } from './constants'

const helperImport = `import { wallConfig, wallConfigured, isOpenPath, cookieValueFor, sameValue, fetchWallState, WALL_COOKIE, PASSWORD_PAGE, SIGN_IN_ROUTE } from './${[
  ...WALL_HELPER_PATH,
  WALL_HELPER_NAME,
].join('/')}';`

/**
 * The gate: the first thing the site's middleware does. Answers null when the
 * request may go on, else the password page in place of what was asked for.
 *
 * The wall's state starts as the publish wrote it and is re-read from the
 * platform once a minute per instance, in the background, so no request ever
 * waits for the platform and the site keeps its last known state when the
 * platform cannot be reached: a trial site stays walled, a paid site stays as
 * last published.
 */
const gateFunctions = `
var __tqWallState = { on: wallConfig.defaultOn, version: wallConfig.defaultVersion, checkedAt: 0 };
var __tqWallCookie = { version: null, value: null };
var __TQ_WALL_RECHECK_MS = 60000;

function __tqWallReadCookie(request, name) {
  try {
    var cookie = request.cookies.get(name);
    if (!cookie) return null;
    return typeof cookie === 'string' ? cookie : cookie.value || null;
  } catch (e) {
    return null;
  }
}

async function __tqWallRefresh() {
  try {
    var next = await fetchWallState();
    __tqWallState.on = next.on;
    __tqWallState.version = next.version;
  } catch (e) {
    // The platform could not be reached or answered nonsense: keep the last
    // known state rather than opening or closing the site on a blip.
  }
}

export async function __tqWallGate(request, event) {
  try {
    if (!wallConfigured()) return null;
    var pathname = request.nextUrl.pathname;
    if (isOpenPath(pathname)) return null;

    var now = Date.now();
    if (now - __tqWallState.checkedAt > __TQ_WALL_RECHECK_MS) {
      __tqWallState.checkedAt = now;
      var refresh = __tqWallRefresh();
      if (event && typeof event.waitUntil === 'function') {
        event.waitUntil(refresh);
      }
    }
    if (!__tqWallState.on) return null;

    // The page's own address: the page, as a page (200).
    if (pathname === PASSWORD_PAGE) {
      return __tqWallPage(request, true);
    }

    if (__tqWallCookie.version !== __tqWallState.version) {
      __tqWallCookie = {
        version: __tqWallState.version,
        value: await cookieValueFor(__tqWallState.version),
      };
    }
    var presented = __tqWallReadCookie(request, WALL_COOKIE);
    if (presented && sameValue(presented, __tqWallCookie.value)) return null;

    return __tqWallPage(request, false);
  } catch (e) {
    // A fault in the gate must not open a walled site: the publish-time state
    // decides. A site published without a wall goes on as before.
    if (wallConfig.defaultOn) {
      return __tqWallPage(request, false);
    }
    return null;
  }
}

// The password page in place of what was asked for: served by the sign-in
// route, with a 401 unless the visitor came to the page's own address. The
// browser keeps the address it asked for, so a reload after signing in lands
// on the page the visitor wanted.
function __tqWallPage(request, direct) {
  var url = request.nextUrl.clone();
  url.pathname = SIGN_IN_ROUTE;
  url.search = '';
  url.searchParams.set('page', '1');
  if (direct) url.searchParams.set('direct', '1');
  var response = NextResponse.rewrite(url);
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-robots-tag', 'noindex');
  return response;
}
`

/** `middleware.js` for a site that has no middleware of its own. */
export const buildStandaloneWallMiddleware =
  (): string => `import { NextResponse } from 'next/server';
${helperImport}
${gateFunctions}
export default async function middleware(request, event) {
  var gate = await __tqWallGate(request, event);
  return gate || NextResponse.next();
}

export const config = {
  matcher: ${WALL_MATCHER},
};
`

const DEFAULT_EXPORT = 'export default middleware;'
const MATCHER_LINE = /matcher: \[[^\]]*\],/

/**
 * Puts the gate in front of the middleware the workflows plugin generated for
 * members-only pages: its `middleware` keeps its name and body, the module's
 * default export becomes the gate followed by it, and the matcher widens to
 * the wall's (a superset of the auth one; the auth code already answers
 * `next()` for every path it does not protect).
 */
export const wrapMiddlewareWithWall = (authMiddlewareSource: string): string => {
  if (authMiddlewareSource.indexOf(DEFAULT_EXPORT) === -1) {
    throw new Error(
      'The site middleware has no default export to put the password wall in front of'
    )
  }
  if (!MATCHER_LINE.test(authMiddlewareSource)) {
    throw new Error('The site middleware has no matcher to widen for the password wall')
  }
  const wrapped = authMiddlewareSource
    .replace(
      DEFAULT_EXPORT,
      `async function __tqWalledMiddleware(request, event) {
  var gate = await __tqWallGate(request, event);
  if (gate) return gate;
  return middleware(request, event);
}

export default __tqWalledMiddleware;`
    )
    .replace(MATCHER_LINE, `matcher: ${WALL_MATCHER},`)
  return `${helperImport}\n${wrapped}\n${gateFunctions}`
}
