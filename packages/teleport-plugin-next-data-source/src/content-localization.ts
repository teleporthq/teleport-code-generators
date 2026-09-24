import type { GeneratorOptions } from '@teleporthq/teleport-types'

/**
 * The languages a project's DATABASE content is stored in.
 *
 * Translatable columns of the platform tables (`teleport_products.name`,
 * `teleport_blog_posts.title`, …) hold the MAIN language, and every other
 * language of the project owns a `<locale>_<column>` copy (`es_name`) — the
 * editor creates those columns when a language is added. The generated
 * fetcher resolves a row against the locale the visitor is reading in, so it
 * needs to know which locale is the main one (never prefixed) and which
 * locales may have a prefixed copy.
 */
export interface ContentLocalization {
  /** The locale whose values live in the base columns, never in a prefixed copy. */
  mainLocale: string
  /** Every other locale of the project — each may own a `<locale>_<column>` copy. */
  secondaryLocales: string[]
}

/**
 * The options both a generator pass (`GeneratorOptions`) and a project plugin
 * (the `ProjectUIDL` itself) can hand over — the two carry the same
 * `internationalization` shape.
 */
export type LocalizedProjectOptions = Pick<GeneratorOptions, 'internationalization'>

/**
 * Derives the content localization from the project's i18n settings, or
 * `undefined` for a single-language project — in which case nothing about a
 * generated fetch mentions a locale, exactly as before languages existed.
 */
export const resolveContentLocalization = (
  options: LocalizedProjectOptions
): ContentLocalization | undefined => {
  const internationalization = options.internationalization
  const mainLocale = internationalization?.main?.locale
  if (!mainLocale) {
    return undefined
  }
  const secondaryLocales = Object.keys(internationalization.languages || {}).filter(
    (locale) => locale !== mainLocale
  )
  return { mainLocale, secondaryLocales }
}

/**
 * True when the project has a language setup at all — the same condition under
 * which the Next generator emits its i18n routing (`skipI18n`), and therefore
 * the condition under which a fetch has to say which language it is for.
 */
export const isLocalizedProject = (options: LocalizedProjectOptions): boolean =>
  resolveContentLocalization(options) !== undefined
