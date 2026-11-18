import { UIDLLanguageDetails } from '@teleporthq/teleport-types'

type LanguageDetails = Record<string, UIDLLanguageDetails> | undefined

/** A language as the `locales` and `locale` globals give it to the site's components. */
export interface LocaleEntry {
  name: string
  short: string
  nativeName?: string
  flag?: string
}

/**
 * The project's languages in order: each with its code and English name and, when the editor sent
 * them, its own name and its flag. Without details an entry is `{ name, short }`, as before.
 */
export const localeEntries = (
  languages: Record<string, string>,
  details: LanguageDetails
): LocaleEntry[] =>
  Object.keys(languages).map((code) => {
    const { nativeName, flag } = details?.[code] ?? {}
    return {
      name: languages[code],
      short: code,
      ...(nativeName && { nativeName }),
      ...(flag && { flag }),
    }
  })

/** Each language's name in each of the project's languages: `{ fr: { de: 'Französisch' } }`. */
export const localizedNames = (
  languages: Record<string, string>,
  details: LanguageDetails
): Record<string, Record<string, string>> =>
  Object.keys(languages).reduce((acc: Record<string, Record<string, string>>, code) => {
    const names = details?.[code]?.names
    if (names && Object.keys(names).length > 0) {
      acc[code] = names
    }
    return acc
  }, {})

/**
 * The global context's language state, as source: `moduleSource` goes above the provider,
 * `hooksSource` at the top of it, and the provider gives `localizedLocales` as `locales`. Each
 * language's `localizedName` is its name in the language of the page, picked while rendering, so
 * the server render and the browser agree on it.
 */
export const localeStateSource = (
  languages: Record<string, string>,
  main: { locale: string },
  details: LanguageDetails
) => ({
  moduleSource: `const localizedNames = ${JSON.stringify(localizedNames(languages, details))};`,
  hooksSource: `  const localeValue = useLocale()
  const [locales, setLocales] = useState(initialLocales ?? ${JSON.stringify(
    localeEntries(languages, details)
  )})
  const localizedLocales = useMemo(() => {
    if (!locales) {
      return locales
    }
    return locales.map((entry) => ({
      ...entry,
      localizedName: (localizedNames[entry.short] || {})[localeValue] || entry.name,
    }))
  }, [locales, localeValue])
${currentLocaleSource(main.locale)}`,
})

/**
 * The current language, found from the page's locale while rendering, so the server render
 * already shows the page's language; one set by hand (`setLocale`) holds until the locale changes.
 * Before, `locale` started at the main language and an effect corrected it after the first render.
 */
const currentLocaleSource = (
  mainLocale: string
) => `  const [chosenLocale, setLocale] = useState(null)
  useEffect(() => {
    setLocale(null)
  }, [localeValue])
  const locale = useMemo(() => {
    if (chosenLocale) {
      return chosenLocale
    }
    const all = localizedLocales || []
    return (
      all.find((el) => el.short === localeValue) ||
      all.find((el) => el.short === ${JSON.stringify(mainLocale)})
    )
  }, [chosenLocale, localizedLocales, localeValue])`
