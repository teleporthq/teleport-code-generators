/**
 * `__tqIsSameOriginRequest(req)`: whether a request comes from one of the
 * site's own pages. Every route that changes something for a signed-in browser
 * (a workflow step, a data write, an account, sign-up and password, an upload,
 * a realtime message, an invoice) answers 403 to any other page.
 *
 * The request's origin is what tells this site's own pages apart:
 * - the browser's `Sec-Fetch-Site`, when sent, must say `same-origin`;
 * - without it (an older browser), the `Origin` must name this host;
 * - a request with neither comes from no browser page: the site's own server
 *   calling its routes (workflow steps, self-calls, jobs), a scheduler or a
 *   provider. It goes on to the route's own checks (the session, the app
 *   secret, a signature).
 *
 * One emitted function, inlined into each route that calls it, so no route
 * needs another module to exist.
 */
export const SAME_ORIGIN_REQUEST_FUNCTION = '__tqIsSameOriginRequest'

export const SAME_ORIGIN_REQUEST_SOURCE = `// Whether one of this site's own pages sent the request (see same-origin-request.ts
// in the code generators); a request from no page at all is a server's.
function ${SAME_ORIGIN_REQUEST_FUNCTION}(req) {
  var headers = (req && req.headers) || {};
  var site = headers['sec-fetch-site'];
  if (site) {
    return site === 'same-origin';
  }
  var origin = headers.origin;
  if (!origin) {
    return true;
  }
  try {
    return new URL(origin).host === headers.host;
  } catch (error) {
    return false;
  }
}
`
