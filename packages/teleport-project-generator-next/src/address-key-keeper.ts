import { ProjectUIDL } from '@teleporthq/teleport-types'
import {
  RESET_TOKEN_STORAGE_KEY,
  readNewsletterSettings,
  resetTokenKeeperPagePaths,
} from '@teleporthq/teleport-plugin-next-workflows'

/**
 * The address-key keeper: the first script of every page's `<head>` (the first
 * global asset), ahead of the owner's scripts and custom head code. A link
 * that IS a credential — whoever holds it acts as its owner — must leave the
 * address before any other script of the page can read it: an analytics or ads
 * tag the owner added reads `location.href`, and the address travels on in a
 * Referer. Two links carry one:
 *
 * - A customer's booking link carries the booking's manage key: in its query
 *   (`/booking/BK-…?key=…` or `/booking?ref=BK-…&key=…`) on every link
 *   already emailed, in its fragment (`/booking/BK-…#key=…`) on the address the
 *   payment provider sends the customer back to (teleport-gui
 *   `buildManageUrlScript`; a fragment never reaches a server or a Referer).
 *   On a page whose address names a booking reference (`BK-` and at least six
 *   letters or digits, in `ref` or as the last path segment) and a `key`, the
 *   keeper keeps the key in the tab's sessionStorage under
 *   `tq-booking-key:<REFERENCE>` — so a customer who returns in another tab or
 *   browser still reaches the booking. The booking page's step that reads the
 *   link takes it from there (teleport-gui's `EXTRACT_MANAGE_LINK_SCRIPT`).
 * - A password-reset link carries its token: in its fragment (`#token=`) on
 *   every link sent now, in its query (`?token=`) on links already sent. On
 *   the reset page (the path the reset email links to, under a locale prefix
 *   too) the keeper keeps it under `RESET_TOKEN_STORAGE_KEY`; the reset page's
 *   steps read it from there (teleport-gui `READ_RESET_TOKEN_SCRIPT`).
 * - A newsletter link carries its token: in its fragment (`#t=`) on every
 *   link sent now, in its query (`?t=`) on links already sent; the token
 *   carries the subscriber's address. On the newsletter's confirm and unsubscribe pages
 *   (the paths the emails link to, under a locale prefix too) the keeper keeps
 *   it under `NEWSLETTER_TOKEN_STORAGE_KEY`; the pages' steps read it from
 *   there (teleport-gui `readNewsletterTokenScript`).
 *
 * In every case the address is replaced with the same one without the key
 * (`history.replaceState`). Where storage refuses the write (a locked-down
 * browser), the address is left as it was and the page reads the key from it
 * as before.
 *
 * Each rule ships only to a site whose workflows read what it keeps (they name
 * its storage key): a site exported by an editor that still reads the key from
 * the address keeps working exactly as it did.
 */

/** The sessionStorage key prefix the editor's booking scripts read (mirrored in teleport-gui). */
export const BOOKING_KEY_STORAGE_PREFIX = 'tq-booking-key:'

/** The sessionStorage key the newsletter pages read a link's token from (mirrored in teleport-gui). */
export const NEWSLETTER_TOKEN_STORAGE_KEY = 'tq-newsletter-token'

const BOOKING_KEEPER_MARKER = '/* tq-booking-key-keeper */'
const RESET_KEEPER_MARKER = '/* tq-reset-token-keeper */'
const NEWSLETTER_KEEPER_MARKER = '/* tq-newsletter-token-keeper */'

export interface AddressKeyKeeperRules {
  /** Keep a booking link's manage key (`key`). */
  bookingKeys?: boolean
  /** Keep a reset link's token (`token`) on these pages. */
  resetPagePaths?: string[]
  /** Keep a newsletter link's token (`t`) on these pages. */
  newsletterPagePaths?: string[]
}

const BOOKING_RULE_LINES = [
  '    var key = String(query.get("key") || fragment.get("key") || "").trim().toLowerCase();',
  '    if (key) {',
  '      var pattern = new RegExp("^BK-[A-Za-z0-9]{6,}$");',
  '      var reference = String(query.get("ref") || "").trim();',
  '      if (!reference) {',
  '        var segments = String(here.pathname || "").split("/").filter(function (s) { return s.length > 0; });',
  '        var last = segments.length > 0 ? segments[segments.length - 1] : "";',
  '        try { last = decodeURIComponent(last); } catch (e) { /* as is */ }',
  '        reference = last;',
  '      }',
  '      reference = reference.toUpperCase();',
  '      if (pattern.test(reference)) {',
  `        window.sessionStorage.setItem(${JSON.stringify(
    BOOKING_KEY_STORAGE_PREFIX
  )} + reference, key);`,
  '        taken.push("key");',
  '      }',
  '    }',
]

const resetRuleLines = (resetPagePaths: string[]): string[] => [
  `    var resetPages = ${JSON.stringify(resetPagePaths)};`,
  '    var path = String(here.pathname || "");',
  '    if (path.length > 1) { path = path.replace(new RegExp("/+$"), ""); }',
  // The page itself, or the page under one locale segment (`/fr/reset-password`).
  '    var onResetPage = resetPages.some(function (page) {',
  '      if (path === page) { return true; }',
  '      if (page === "/" || path.length <= page.length) { return false; }',
  '      var prefix = path.slice(0, path.length - page.length);',
  '      return path.slice(path.length - page.length) === page && prefix.split("/").length === 2;',
  '    });',
  '    var token = String(fragment.get("token") || query.get("token") || "").trim();',
  '    if (onResetPage && token) {',
  `      window.sessionStorage.setItem(${JSON.stringify(RESET_TOKEN_STORAGE_KEY)}, token);`,
  '      taken.push("token");',
  '    }',
]

// Same page match as the reset rule's, on its own names.
const newsletterRuleLines = (newsletterPagePaths: string[]): string[] => [
  `    var newsletterPages = ${JSON.stringify(newsletterPagePaths)};`,
  '    var newsletterPath = String(here.pathname || "");',
  '    if (newsletterPath.length > 1) { newsletterPath = newsletterPath.replace(new RegExp("/+$"), ""); }',
  '    var onNewsletterPage = newsletterPages.some(function (page) {',
  '      if (newsletterPath === page) { return true; }',
  '      if (page === "/" || newsletterPath.length <= page.length) { return false; }',
  '      var prefix = newsletterPath.slice(0, newsletterPath.length - page.length);',
  '      return newsletterPath.slice(newsletterPath.length - page.length) === page && prefix.split("/").length === 2;',
  '    });',
  '    var newsletterToken = String(fragment.get("t") || query.get("t") || "").trim();',
  '    if (onNewsletterPage && newsletterToken) {',
  `      window.sessionStorage.setItem(${JSON.stringify(
    NEWSLETTER_TOKEN_STORAGE_KEY
  )}, newsletterToken);`,
  '      taken.push("t");',
  '    }',
]

/** Authored as source text with no backslash: it is emitted verbatim. */
export const generateAddressKeyKeeperSource = (rules: AddressKeyKeeperRules): string => {
  const resetPagePaths = rules.resetPagePaths || []
  const newsletterPagePaths = rules.newsletterPagePaths || []
  return [
    ...(rules.bookingKeys ? [BOOKING_KEEPER_MARKER] : []),
    ...(resetPagePaths.length > 0 ? [RESET_KEEPER_MARKER] : []),
    ...(newsletterPagePaths.length > 0 ? [NEWSLETTER_KEEPER_MARKER] : []),
    '(function () {',
    '  try {',
    '    var here = window.location;',
    '    var query = new URLSearchParams(here.search || "");',
    '    var fragment = new URLSearchParams(String(here.hash || "").slice(1));',
    '    var taken = [];',
    ...(rules.bookingKeys ? BOOKING_RULE_LINES : []),
    ...(resetPagePaths.length > 0 ? resetRuleLines(resetPagePaths) : []),
    ...(newsletterPagePaths.length > 0 ? newsletterRuleLines(newsletterPagePaths) : []),
    '    if (taken.length === 0) { return; }',
    '    var inFragment = taken.some(function (name) { return fragment.has(name); });',
    '    taken.forEach(function (name) { query.delete(name); fragment.delete(name); });',
    '    var rest = query.toString();',
    '    var restFragment = inFragment ? fragment.toString() : String(here.hash || "").slice(1);',
    '    window.history.replaceState(window.history.state, "", here.pathname + (rest ? "?" + rest : "") + (restFragment ? "#" + restFragment : ""));',
    '  } catch (e) {',
    '    /* storage or history refused: the address keeps the key, the page reads it there */',
    '  }',
    '})();',
  ].join('\n')
}

/** A site with Bookings whose booking pages read the key the keeper keeps. */
export const shouldKeepBookingKeysOutOfTheAddress = (uidl: ProjectUIDL): boolean => {
  if (!uidl.bookingSettings || !uidl.workflows) {
    return false
  }
  try {
    return JSON.stringify(uidl.workflows).includes(BOOKING_KEY_STORAGE_PREFIX)
  } catch (error) {
    return false
  }
}

/** A same-site page path the emails link to (never an API route), else null. */
const newsletterPagePathOf = (value: unknown): string | null => {
  const path = typeof value === 'string' ? value.trim() : ''
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.startsWith('/api/') ||
    path.indexOf('..') !== -1 ||
    /[?#\s"'<>\\]/.test(path)
  ) {
    return null
  }
  return path.length > 1 ? path.replace(/\/+$/, '') : null
}

/**
 * The newsletter pages the keeper watches: the confirm and unsubscribe pages
 * the emails link to, on a site whose workflows read the token it keeps (they
 * name NEWSLETTER_TOKEN_STORAGE_KEY) — a site exported before reads `?t=` as
 * it did.
 */
export const newsletterTokenKeeperPagePaths = (uidl: ProjectUIDL): string[] => {
  const settings = readNewsletterSettings(uidl)
  if (!settings || !uidl.workflows) {
    return []
  }
  try {
    if (!JSON.stringify(uidl.workflows).includes(NEWSLETTER_TOKEN_STORAGE_KEY)) {
      return []
    }
  } catch (error) {
    return []
  }
  const pages = settings.pages || { confirm: '', unsubscribe: '' }
  const paths = [newsletterPagePathOf(pages.confirm), newsletterPagePathOf(pages.unsubscribe)]
  return paths.filter((path, index): path is string => !!path && paths.indexOf(path) === index)
}

const isKeeperAsset = (asset: unknown): boolean => {
  const content =
    asset && typeof asset === 'object' ? (asset as { content?: unknown }).content : null
  return (
    typeof content === 'string' &&
    (content.startsWith(BOOKING_KEEPER_MARKER) ||
      content.startsWith(RESET_KEEPER_MARKER) ||
      content.startsWith(NEWSLETTER_KEEPER_MARKER))
  )
}

/**
 * Makes the keeper of the project's rules the first global asset: the first
 * script of `<head>`. Idempotent; a project neither rule applies to is left
 * as it was.
 */
export const injectAddressKeyKeeper = (uidl: ProjectUIDL): void => {
  const rules: AddressKeyKeeperRules = {
    bookingKeys: shouldKeepBookingKeysOutOfTheAddress(uidl),
    resetPagePaths: resetTokenKeeperPagePaths(uidl),
    newsletterPagePaths: newsletterTokenKeeperPagePaths(uidl),
  }
  if (
    !rules.bookingKeys &&
    rules.resetPagePaths.length === 0 &&
    rules.newsletterPagePaths.length === 0
  ) {
    return
  }
  const assets = (uidl.globals.assets || []).filter((asset) => !isKeeperAsset(asset))
  uidl.globals.assets = [
    { type: 'script', content: generateAddressKeyKeeperSource(rules) },
    ...assets,
  ]
}
