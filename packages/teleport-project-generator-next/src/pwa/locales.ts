import { ProjectUIDL } from '@teleporthq/teleport-types'

/**
 * The languages the published app serves, as Next.js routes them: the default
 * language unprefixed, every other one under `/<locale>`.
 */
export interface AppLocales {
  defaultLocale: string
  /** Every locale, the default first. */
  locales: string[]
  /** The locales served under a `/<locale>` prefix. */
  prefixedLocales: string[]
  /**
   * The code Next.js ALSO serves the default language under (`/en/checkout`
   * answers like `/checkout`): its own default locale, which is `en` for a
   * project without languages even when the site's language is another.
   */
  defaultLocalePrefix: string
  isRightToLeft(locale: string): boolean
}

export const resolveAppLocales = (uidl: ProjectUIDL): AppLocales => {
  const { settings } = uidl.globals
  const i18n = uidl.internationalization
  const defaultLocale = i18n?.main?.locale || settings.language || 'en'
  const configured = i18n?.languages ? Object.keys(i18n.languages) : []
  const locales = [defaultLocale, ...configured.filter((locale) => locale !== defaultLocale)]
  const rtlLocales = new Set(settings.rtlLocales ?? [])
  const projectIsRtl = settings.dir === 'rtl'

  return {
    defaultLocale,
    locales,
    prefixedLocales: locales.filter((locale) => locale !== defaultLocale),
    // The default of the i18n block the internationalization plugin writes.
    defaultLocalePrefix: i18n?.main?.locale || 'en',
    isRightToLeft: (locale: string) =>
      rtlLocales.has(locale) || (projectIsRtl && locale === defaultLocale),
  }
}

/** `/` for the default language, `/<locale>` for the others. */
export const localeStartUrl = (locales: AppLocales, locale: string): string =>
  locale === locales.defaultLocale ? '/' : `/${locale}`
