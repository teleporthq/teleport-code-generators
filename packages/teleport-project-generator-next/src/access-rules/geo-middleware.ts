import { escapeHtml, toJsLiteral } from '../pwa/source-literals'
import { AccessRulesSettings } from './settings'

/**
 * The country rule, decided at the edge before a page is served: the
 * visitor's country from the platform (`request.geo`, else the
 * `x-vercel-ip-country` header) against the listed countries. A blocked
 * visitor is served the project's own Unavailable page in place of what was
 * asked for (a plain notice, HTTP 451, when the project has none).
 * API routes are never blocked — the site's own server segments call them —
 * nor files (robots.txt, the manifest, images: the Unavailable page's own
 * assets among them).
 */

/** The plain notice, for a project whose Unavailable page is gone. */
const UNAVAILABLE_MESSAGE = 'This site is not available in your country.'

/** The `<html>` of the plain notice. */
const buildUnavailablePage = (message: string): string => {
  const safe = escapeHtml(message)
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${safe}</title>`,
    '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f5f5f5;color:#111}main{max-width:480px;text-align:center}p{font-size:18px;line-height:1.5;margin:0}</style>',
    `</head><body><main><p>${safe}</p></main></body></html>`,
  ].join('')
}

/**
 * The helpers and `__tqGeoResponse(request)`: the response a blocked visitor
 * gets, `null` for everyone else. Expects `NextResponse` in scope.
 */
export const buildGeoMiddlewareSegment = (
  settings: AccessRulesSettings,
  unavailableRoute: string | null
): string => {
  const geo = {
    mode: settings.geoMode,
    countries: settings.geoCountries,
    unknown: settings.geoUnknownCountry,
    unavailableRoute,
  }
  return `// Age gate & geo block: the country rule.
var __tqGeo = ${toJsLiteral(geo)};
var __tqGeoUnavailablePage = ${toJsLiteral(buildUnavailablePage(UNAVAILABLE_MESSAGE))};

function __tqGeoCountry(request) {
  var country = (request.geo && request.geo.country) || request.headers.get('x-vercel-ip-country') || '';
  return String(country).toUpperCase();
}

function __tqGeoBlocked(request) {
  if (__tqGeo.mode === 'off' || __tqGeo.countries.length === 0) return false;
  var country = __tqGeoCountry(request);
  if (!country) return __tqGeo.unknown === 'block';
  var listed = __tqGeo.countries.indexOf(country) >= 0;
  return __tqGeo.mode === 'block' ? listed : !listed;
}

function __tqGeoResponse(request) {
  var pathname = request.nextUrl.pathname;
  if (pathname === '/api' || pathname.indexOf('/api/') === 0 || pathname.indexOf('/_next/') === 0) {
    return null;
  }
  // A file (its last segment has an extension), never a page.
  if (/\\.[a-z0-9]{1,8}$/i.test(pathname)) return null;
  if (!__tqGeoBlocked(request)) return null;
  if (__tqGeo.unavailableRoute) {
    // The project's own Unavailable page, served in place of what was asked for.
    var route = __tqGeo.unavailableRoute;
    if (pathname === route || pathname.indexOf(route + '/') === 0) return null;
    var unavailable = request.nextUrl.clone();
    unavailable.pathname = route;
    unavailable.search = '';
    var rewritten = NextResponse.rewrite(unavailable);
    rewritten.headers.set('x-robots-tag', 'noindex');
    rewritten.headers.set('cache-control', 'no-store');
    return rewritten;
  }
  return new NextResponse(__tqGeoUnavailablePage, {
    status: 451,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
`
}

const DEFAULT_EXPORT = 'export default middleware;'

/**
 * The authentication middleware with the country rule in front of it: the
 * segment is appended, and the default export wrapped, so the file keeps
 * every auth helper untouched. Null when the file has no default export to
 * wrap (then the rule is left out rather than a broken middleware written).
 */
export const wrapMiddlewareWithGeo = (content: string, segment: string): string | null => {
  if (!content.includes(DEFAULT_EXPORT) || content.includes('__tqGeoResponse')) {
    return null
  }
  return content.replace(
    DEFAULT_EXPORT,
    `${segment}
function __tqWithGeo(next) {
  return function (request) {
    return __tqGeoResponse(request) || next(request);
  };
}

export default __tqWithGeo(middleware);`
  )
}

/** A middleware of the rule's own, for a project without the authentication one. */
export const buildStandaloneGeoMiddleware = (
  segment: string
): string => `import { NextResponse } from 'next/server';

${segment}
function middleware(request) {
  return __tqGeoResponse(request) || NextResponse.next();
}

export default middleware;
export const config = {
  // '/' on its own, because Next.js does not run the second matcher on the root path.
  matcher: ['/', '/((?!api/|_next/static|_next/image|favicon\\\\.ico).*)'],
};
`
