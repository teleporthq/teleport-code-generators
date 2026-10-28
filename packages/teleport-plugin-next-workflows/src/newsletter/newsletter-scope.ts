import type { ProjectUIDL, UIDLNewsletterSettings } from '@teleporthq/teleport-types'

/**
 * The newsletter: a subscriber is a person of the site's `users` table whose
 * `newsletter_status` is `subscribed` (`pending` waits for the emailed
 * confirmation link, `unsubscribed` left, NULL was never on it). The generated
 * app adds people, confirms them and lets them leave on its own server:
 *
 * - `utils/newsletter/newsletter.js`, the helper every writer goes through
 *   (helper-code.ts);
 * - `pages/api/newsletter/{subscribe,confirm,unsubscribe}.js` (routes-code.ts);
 * - the `newsletter-subscribe` server node, and the `newsletter-confirm` /
 *   `newsletter-unsubscribe` client nodes the confirm and unsubscribe pages run.
 *
 * All of it is generated only when the project carries `newsletterSettings`
 * on the TeleportHQ database (v1).
 */

export const NEWSLETTER_HELPER_FILE_KEY = 'newsletter-helper'
export const NEWSLETTER_HELPER_PATH = ['utils', 'newsletter']
export const NEWSLETTER_HELPER_FILE_NAME = 'newsletter'
export const NEWSLETTER_ROUTES_FILE_KEY = 'newsletter-routes'
export const NEWSLETTER_ROUTES_PATH = ['pages', 'api', 'newsletter']

export const NEWSLETTER_SUBSCRIBE_URL = '/api/newsletter/subscribe'
export const NEWSLETTER_CONFIRM_URL = '/api/newsletter/confirm'
export const NEWSLETTER_UNSUBSCRIBE_URL = '/api/newsletter/unsubscribe'

/** The table the newsletter state lives on (teleport-gui `NEWSLETTER_USER_COLUMNS`). */
export const NEWSLETTER_USERS_TABLE = 'users'

export const DEFAULT_NEWSLETTER_CONFIRM_PATH = '/newsletter/confirm'
export const DEFAULT_NEWSLETTER_UNSUBSCRIBE_PATH = '/newsletter/unsubscribe'

/** `users.newsletter_source` (teleport-gui `NEWSLETTER_SOURCES`). */
export const NEWSLETTER_SOURCES = [
  'block',
  'footer',
  'popup',
  'signup',
  'account',
  'checkout',
  'booking',
  'form',
  'import',
  'manual',
  'admin',
] as const

/**
 * The sign-up points a visitor's request may name (the public route's body,
 * the node's config): the owner's own (`import`, `manual`, `admin`) never.
 * Anything else is `block`.
 */
export const VISITOR_SIGN_UP_POINTS = [
  'block',
  'footer',
  'popup',
  'form',
  'checkout',
  'booking',
  'signup',
  'account',
] as const

/**
 * The sign-up points of the site's own pages: what the public sign-up route
 * takes from its body (anything else is `block`). The checkout, a booking and
 * the account sign-up subscribe on the server, never through that route.
 */
export const PUBLIC_ROUTE_SIGN_UP_POINTS = ['block', 'footer', 'popup', 'form'] as const

/** Confirmation links an address that opted out may be sent per day. */
export const NEWSLETTER_OPTED_OUT_CONFIRMATIONS_PER_DAY = 1

/** Every outcome of a sign-up answers this, in about the same time. */
export const NEWSLETTER_MIN_RESPONSE_MS = 800

/** Sign-ups one address may make per hour, and one visitor per hour. */
export const NEWSLETTER_ADDRESS_LIMIT = 5
export const NEWSLETTER_VISITOR_LIMIT = 5
/**
 * The visitor budget the sign-up route and the sign-up workflows share: the
 * steps' `visitorLimit.scope`, counted as `visitor-limit:<scope>`.
 */
export const NEWSLETTER_VISITOR_SCOPE = 'newsletter-signup'

/** The `require` specifier of the helper from a file `relativePrefix` below the project root. */
export const newsletterHelperSpecifier = (relativePrefix: string): string =>
  `${relativePrefix}/${NEWSLETTER_HELPER_PATH.join('/')}/${NEWSLETTER_HELPER_FILE_NAME}`

/**
 * The project's newsletter settings when the generated app gets the newsletter:
 * `newsletterSettings` on the TeleportHQ database. Null otherwise (nothing is
 * generated then).
 */
export const readNewsletterSettings = (
  uidl: Pick<ProjectUIDL, 'newsletterSettings'>
): UIDLNewsletterSettings | null => {
  const settings = uidl.newsletterSettings
  if (!settings || typeof settings !== 'object') {
    return null
  }
  if (settings.dataSourceType !== 'teleport' || typeof settings.dataSourceId !== 'string') {
    return null
  }
  return settings.dataSourceId ? settings : null
}

/** The sign-up form's ticked consent box also subscribes the person (R-N15). */
export const newsletterSignupSubscribes = (
  uidl: Pick<ProjectUIDL, 'newsletterSettings'>
): boolean => {
  const settings = readNewsletterSettings(uidl)
  return !!settings && !!settings.signUp && settings.signUp.signupCheckbox === true
}
