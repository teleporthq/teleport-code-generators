import {
  EMAIL_LOCALE_CONFIG_KEY,
  EMAIL_LOCALE_HEADER,
  EmailLocaleConfig,
  LOCALIZED_TEMPLATES_CONFIG_KEY,
  NEXT_LOCALE_COOKIE,
  WORKFLOW_CONTEXT_LOCALE_KEY,
} from './email-locale-scope'

/**
 * The locale helpers every generated email sender and every generated
 * navigation runs. Emitted twice from this one source: as the standalone
 * `utils/email/email-locale.js` module (the account routes, the invoice
 * sender, the cart route and the cart provider use it) and inlined into the
 * workflow runtime (`runtime-utils.js`), which is bundled for the browser as
 * well and must not depend on a sibling file being resolvable.
 *
 * Every function is total: an unknown or missing locale resolves to the
 * project's default language, so a sender can never pick a template that does
 * not exist and a navigation can never be sent to a locale the app does not
 * serve.
 */
export const generateEmailLocaleHelpersCode = (config: EmailLocaleConfig): string => `
var EMAIL_LOCALES = ${JSON.stringify(config.locales)};
var DEFAULT_EMAIL_LOCALE = ${JSON.stringify(config.defaultLocale)};
var EMAIL_LOCALE_HEADER = ${JSON.stringify(EMAIL_LOCALE_HEADER)};
var NEXT_LOCALE_COOKIE = ${JSON.stringify(NEXT_LOCALE_COOKIE)};

// The project locale a raw value names, or null. Case-insensitive so a
// visitor-supplied "ES" still matches, but always answers the canonical code.
function normalizeEmailLocale(value) {
  if (typeof value !== 'string') return null;
  var trimmed = value.trim();
  if (!trimmed) return null;
  var lower = trimmed.toLowerCase();
  for (var i = 0; i < EMAIL_LOCALES.length; i++) {
    if (String(EMAIL_LOCALES[i]).toLowerCase() === lower) return EMAIL_LOCALES[i];
  }
  return null;
}

function readCookieValue(cookieHeader, name) {
  if (typeof cookieHeader !== 'string' || !cookieHeader) return null;
  var parts = cookieHeader.split(';');
  for (var i = 0; i < parts.length; i++) {
    var pair = parts[i].trim();
    var eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() !== name) continue;
    try { return decodeURIComponent(pair.slice(eq + 1).trim()); } catch (e) { return pair.slice(eq + 1).trim(); }
  }
  return null;
}

// The locale prefix of a localized page path ("/es/checkout" → "es"). The
// default language is served unprefixed, which resolves to null here and to
// the default further down.
function localeFromPathname(pathname) {
  if (typeof pathname !== 'string') return null;
  var segments = pathname.split('/');
  for (var i = 0; i < segments.length; i++) {
    if (segments[i]) return normalizeEmailLocale(segments[i]);
  }
  return null;
}

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

// The language of the page a request came from: the explicit header the
// generated client runtime sends, else the locale prefix of the referring page
// (the page the browser is actually on), else the Next.js locale cookie (a
// stored preference, which a request without a referer is all we have), else
// the default language.
function resolveRequestLocale(req) {
  var headers = req && req.headers ? req.headers : null;
  if (!headers) return DEFAULT_EMAIL_LOCALE;
  var fromHeader = normalizeEmailLocale(firstHeaderValue(headers[EMAIL_LOCALE_HEADER]));
  if (fromHeader) return fromHeader;
  var referer = firstHeaderValue(headers.referer || headers.referrer);
  if (typeof referer === 'string' && referer) {
    try {
      var fromReferer = localeFromPathname(new URL(referer).pathname);
      if (fromReferer) return fromReferer;
    } catch (e) { /* not an absolute URL — nothing to read */ }
  }
  var fromCookie = normalizeEmailLocale(readCookieValue(firstHeaderValue(headers.cookie), NEXT_LOCALE_COOKIE));
  if (fromCookie) return fromCookie;
  return DEFAULT_EMAIL_LOCALE;
}

// The locale of the page the browser is on, read LIVE off the Next.js router.
// After a client-side language switch the page data
// (window.__NEXT_DATA__.locale) still names the locale the document was
// served in, while the router — and the <html lang> attribute it keeps in
// sync on every transition — already name the one the visitor switched to.
// Null outside a browser, or when no candidate is a project locale.
function getClientLocale() {
  if (typeof window === 'undefined') return null;
  var candidates = [];
  try { candidates.push(window.next && window.next.router && window.next.router.locale); } catch (e) { /* router not mounted */ }
  try { candidates.push(document.documentElement && document.documentElement.lang); } catch (e) { /* no document */ }
  try { candidates.push(window.__NEXT_DATA__ && window.__NEXT_DATA__.locale); } catch (e) { /* no page data */ }
  for (var i = 0; i < candidates.length; i++) {
    var resolved = normalizeEmailLocale(candidates[i]);
    if (resolved) return resolved;
  }
  return null;
}

// The href a navigation should use so the visitor stays in \`locale\`. Next.js
// serves the default language unprefixed and every other language under
// "/<locale>", so a site-relative page path gets that prefix. Left untouched:
// anything that is not a site-relative path (an external URL, a hash, a
// mailto:), an API route or a Next.js internal path (never localized), a file
// served from /public (not served under a locale prefix) and a path that
// already names a project locale. The default language, an unknown locale and
// a project without languages all leave the href as it is.
function localizeHref(href, locale) {
  if (typeof href !== 'string' || href.charAt(0) !== '/' || href.charAt(1) === '/') return href;
  var resolved = normalizeEmailLocale(locale);
  if (!resolved || resolved === DEFAULT_EMAIL_LOCALE) return href;
  var pathEnd = href.length;
  var queryStart = href.indexOf('?');
  if (queryStart !== -1) pathEnd = queryStart;
  var hashStart = href.indexOf('#');
  if (hashStart !== -1 && hashStart < pathEnd) pathEnd = hashStart;
  var pathname = href.slice(0, pathEnd);
  if (pathname === '/api' || pathname.indexOf('/api/') === 0) return href;
  if (pathname.indexOf('/_next/') === 0) return href;
  if (/\\.[A-Za-z0-9]{1,5}$/.test(pathname)) return href;
  if (localeFromPathname(pathname)) return href;
  return '/' + resolved + (pathname === '/' ? '' : pathname) + href.slice(pathEnd);
}

// The copy of a template that goes out in \`locale\`: its own body, its own
// subject when it has one (else the base subject), or the base copy for the
// default language and for any language that has no copy.
function pickLocalizedTemplate(base, localized, locale) {
  var baseCopy = base || {};
  var resolved = normalizeEmailLocale(locale) || DEFAULT_EMAIL_LOCALE;
  var fallback = { subject: baseCopy.subject, body: baseCopy.body, locale: DEFAULT_EMAIL_LOCALE };
  if (!resolved || resolved === DEFAULT_EMAIL_LOCALE) return fallback;
  if (!localized || typeof localized !== 'object') return fallback;
  var copy = localized[resolved];
  if (!copy || typeof copy !== 'object' || typeof copy.body !== 'string' || !copy.body) return fallback;
  return {
    subject: typeof copy.subject === 'string' && copy.subject ? copy.subject : baseCopy.subject,
    body: copy.body,
    locale: resolved,
  };
}
`

/**
 * The runtime-only helpers, on top of the shared ones: how a workflow run
 * learns its locale and how an email node's config resolves the language it
 * sends in. Inlined into \`runtime-utils.js\` right after
 * \`generateEmailLocaleHelpersCode\`.
 */
export const generateWorkflowLocaleHelpersCode = (): string => `
// The locale a server route runs a segment in: the one the client runtime put
// on the context (validated — it crossed the network), else the request's.
function resolveWorkflowLocale(req, incomingContext) {
  var fromContext = incomingContext ? normalizeEmailLocale(incomingContext[${JSON.stringify(
    WORKFLOW_CONTEXT_LOCALE_KEY
  )}]) : null;
  return fromContext || resolveRequestLocale(req);
}

// The language an email node sends in. A config that BINDS the locale (the
// order's, the cart's) is authoritative even when the binding resolved to
// nothing — the request locale belongs to whoever triggered the workflow, which
// for an admin action is not the recipient. Otherwise the run's locale, then
// the default language.
function resolveEmailLocale(resolvedConfig, context) {
  var config = resolvedConfig || {};
  if (Object.prototype.hasOwnProperty.call(config, ${JSON.stringify(EMAIL_LOCALE_CONFIG_KEY)})) {
    return normalizeEmailLocale(config[${JSON.stringify(
      EMAIL_LOCALE_CONFIG_KEY
    )}]) || DEFAULT_EMAIL_LOCALE;
  }
  var fromRun = context ? normalizeEmailLocale(context[${JSON.stringify(
    WORKFLOW_CONTEXT_LOCALE_KEY
  )}]) : null;
  return fromRun || DEFAULT_EMAIL_LOCALE;
}

// Swaps a component-bodied email node's body/subject for the copy of the
// language it sends in, then drops the per-language map and the binding so
// neither reaches a provider handler or the sent-email ledger. Runs BEFORE the
// {{token}} fill: the copies carry the same merge fields as the base body.
function applyLocalizedEmailTemplate(resolvedConfig, context) {
  var localized = resolvedConfig[${JSON.stringify(LOCALIZED_TEMPLATES_CONFIG_KEY)}];
  var hasLocalized = !!localized && typeof localized === 'object';
  var hasBinding = Object.prototype.hasOwnProperty.call(resolvedConfig, ${JSON.stringify(
    EMAIL_LOCALE_CONFIG_KEY
  )});
  if (!hasLocalized && !hasBinding) return;
  if (hasLocalized) {
    var picked = pickLocalizedTemplate(
      { subject: resolvedConfig.subject, body: resolvedConfig.body },
      localized,
      resolveEmailLocale(resolvedConfig, context)
    );
    if (typeof picked.body === 'string') resolvedConfig.body = picked.body;
    if (typeof picked.subject === 'string') resolvedConfig.subject = picked.subject;
    delete resolvedConfig[${JSON.stringify(LOCALIZED_TEMPLATES_CONFIG_KEY)}];
  }
  if (hasBinding) delete resolvedConfig[${JSON.stringify(EMAIL_LOCALE_CONFIG_KEY)}];
}
`

/** `utils/email/email-locale.js` — the shared helpers as a CommonJS module. */
export const generateEmailLocaleModuleCode = (config: EmailLocaleConfig): string => `/**
 * Email locale resolution.
 *
 * A customer email goes out in the language of the page it was triggered from;
 * the store owner's notifications always use the project's main language. This
 * module answers "which locale?" for the senders that live outside the workflow
 * runtime (the account routes, the invoice sender, the cart route) — the
 * runtime carries the same helpers inline.
 *
 * Auto-generated. Edit the generator at
 * teleport-plugin-next-workflows/src/email-locale/email-locale-code.ts.
 */
${generateEmailLocaleHelpersCode(config)}
module.exports = {
  EMAIL_LOCALES: EMAIL_LOCALES,
  DEFAULT_EMAIL_LOCALE: DEFAULT_EMAIL_LOCALE,
  EMAIL_LOCALE_HEADER: EMAIL_LOCALE_HEADER,
  normalizeEmailLocale: normalizeEmailLocale,
  resolveRequestLocale: resolveRequestLocale,
  getClientLocale: getClientLocale,
  localizeHref: localizeHref,
  pickLocalizedTemplate: pickLocalizedTemplate,
};
`
