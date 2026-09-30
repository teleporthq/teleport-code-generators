/**
 * Where a visitor lands once signed in or signed up: back on the page they
 * were sent to sign in from, else the home page — in the language of the run.
 *
 * The middleware sends a visitor who opens a protected page to the sign-in
 * page with `callbackUrl=<that page>`, and "Sign in to comment" style links do
 * the same. Only an address on this site is honoured: following any other
 * would turn the sign-in page into an open redirect (`//evil.example`,
 * `/\evil.example` and `javascript:` all resolve to another origin). A
 * callback that already names its language keeps it (see `localizeHref`).
 *
 * Inlined into `runtime-utils.js` after the locale helpers, whose
 * `localizeHref` it uses. Browser only: anywhere else it answers the
 * localized home page.
 */
export const generateSignedInDestinationCode = (): string => `
function signedInDestination(locale) {
  var destination = '/';
  try {
    var requested = new URLSearchParams(window.location.search).get('callbackUrl');
    if (requested) {
      var target = new URL(requested, window.location.origin);
      if (target.origin === window.location.origin) {
        destination = target.pathname + target.search + target.hash;
      }
    }
  } catch (e) {
    // No browser, or an address that does not parse: the home page.
  }
  return localizeHref(destination, locale);
}
`
