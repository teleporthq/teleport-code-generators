import { ProjectUIDL } from '@teleporthq/teleport-types'

/**
 * The vocabulary every generated email sender shares to decide WHICH language a
 * customer email goes out in. The module itself is emitted by
 * `ensureEmailLocaleModule` (see `index.ts`); this file only holds the names
 * the route generators, the workflow runtime and the UIDL mapper agree on.
 */

export const EMAIL_LOCALE_FILE_KEY = 'email-locale'
export const EMAIL_LOCALE_PATH = ['utils', 'email']
export const EMAIL_LOCALE_FILE_NAME = 'email-locale'

/**
 * Request header the generated client runtime sends with every call to the
 * app's own API routes, carrying the locale of the page the visitor is on.
 */
export const EMAIL_LOCALE_HEADER = 'x-teleport-locale'

/** The cookie Next.js reads for locale detection; honoured as a fallback. */
export const NEXT_LOCALE_COOKIE = 'NEXT_LOCALE'

/**
 * Export-only node config key written by the editor's domain→UIDL mapper on a
 * component-bodied email node: the per-language copies of its body/subject,
 * keyed by locale short code (main language excluded). Consumed by the runtime
 * (`resolveConfig`) and never by a handler.
 */
export const LOCALIZED_TEMPLATES_CONFIG_KEY = 'localizedTemplates'

/**
 * Node config key that pins an email to a language independently of the
 * request: a lifecycle email bound to the order's stored locale, a reminder
 * bound to the cart's. When the key is present its resolved value is
 * authoritative — an empty one means the default language, never the locale of
 * whoever triggered the workflow (an admin shipping an order is not the buyer).
 */
export const EMAIL_LOCALE_CONFIG_KEY = 'emailLocale'

/** Workflow-context key carrying the request locale through a run. */
export const WORKFLOW_CONTEXT_LOCALE_KEY = '__locale'

/**
 * The locales the generated app serves, as the email senders need them: the
 * full list to validate an incoming value against and the default to fall back
 * to. A project without internationalization has no locales at all — every
 * sender then keeps its single template and nothing is ever localized.
 */
export interface EmailLocaleConfig {
  locales: string[]
  defaultLocale: string
}

export const resolveEmailLocaleConfig = (uidl: ProjectUIDL): EmailLocaleConfig => {
  const i18n = uidl.internationalization
  if (!i18n) {
    return { locales: [], defaultLocale: '' }
  }
  const defaultLocale = i18n.main?.locale || ''
  const locales = Object.keys(i18n.languages || {})
  if (defaultLocale && locales.indexOf(defaultLocale) === -1) {
    locales.unshift(defaultLocale)
  }
  return { locales, defaultLocale }
}
