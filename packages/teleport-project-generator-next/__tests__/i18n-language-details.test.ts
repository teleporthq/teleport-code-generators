import { createNextPartialGenerator } from '../src/partial'
import { NextProjectPlugini18nConfig } from '../src/internationalization/project'
import { localeEntries, localeStateSource } from '../src/internationalization/locale-state'
import { baseUidl, buildStructure, fileContent } from './_helpers/pwa-fixtures'

/**
 * A language switcher can show each language by its own name ("Français"), by its name in the
 * language of the page ("Französisch" on the German page) and with a flag. The editor sends these
 * as `internationalization.languageDetails`; the global context gives them to the site's
 * components on every entry of `locales` and on `locale`, with `localizedName` picked while
 * rendering from the page's locale, so the server and the browser agree.
 */

const LANGUAGES = { en: 'English', fr: 'French', de: 'German' }
const MAIN = { name: 'English', locale: 'en' }
const flag = (country: string) => `https://play.teleporthq.io/static/flags/4x3/${country}.svg`

const LANGUAGE_DETAILS = {
  en: {
    nativeName: 'English',
    names: { en: 'English', fr: 'Anglais', de: 'Englisch' },
    flag: flag('us'),
  },
  fr: {
    nativeName: 'Français',
    names: { en: 'French', fr: 'Français', de: 'Französisch' },
    flag: flag('fr'),
  },
  de: {
    nativeName: 'Deutsch',
    names: { en: 'German', fr: 'Allemand', de: 'Deutsch' },
    flag: flag('de'),
  },
}

interface Rendered {
  locales: Array<Record<string, string>>
  locale: Record<string, string> | undefined
}

/**
 * One render of the provider's language state on the page of `pageLocale`, as the server does it:
 * effects do not run and state holds its first value.
 */
function renderOnce(source: ReturnType<typeof localeStateSource>, pageLocale: string): Rendered {
  const body = `${source.moduleSource}
return function (initialLocales) {
${source.hooksSource}
  return { locales: localizedLocales, locale }
}`
  const provider = new Function('useState', 'useMemo', 'useEffect', 'useLocale', body)(
    (initial: unknown) => [initial, () => undefined],
    (compute: () => unknown) => compute(),
    () => undefined,
    () => pageLocale
  )
  return provider(undefined)
}

const i18n = (extra: Record<string, unknown> = {}) => ({
  main: MAIN,
  languages: LANGUAGES,
  translations: { en: {}, fr: {}, de: {} },
  ...extra,
})

describe('the language entries', () => {
  it('carry each language’s own name and flag when the editor sent them', () => {
    expect(localeEntries(LANGUAGES, LANGUAGE_DETAILS)).toEqual([
      { name: 'English', short: 'en', nativeName: 'English', flag: flag('us') },
      { name: 'French', short: 'fr', nativeName: 'Français', flag: flag('fr') },
      { name: 'German', short: 'de', nativeName: 'Deutsch', flag: flag('de') },
    ])
  })

  it('are `{ name, short }` as before without them', () => {
    expect(localeEntries(LANGUAGES, undefined)).toEqual([
      { name: 'English', short: 'en' },
      { name: 'French', short: 'fr' },
      { name: 'German', short: 'de' },
    ])
  })
})

describe('the global context’s languages', () => {
  it('name every language in the language of the page', () => {
    const rendered = renderOnce(localeStateSource(LANGUAGES, MAIN, LANGUAGE_DETAILS), 'de')

    expect(rendered.locales.map((entry) => entry.localizedName)).toEqual([
      'Englisch',
      'Französisch',
      'Deutsch',
    ])
    expect(rendered.locales[1]).toMatchObject({ nativeName: 'Français', flag: flag('fr') })
  })

  it('fall back to the English name where a name is missing', () => {
    const rendered = renderOnce(localeStateSource(LANGUAGES, MAIN, undefined), 'fr')

    expect(rendered.locales.map((entry) => entry.localizedName)).toEqual([
      'English',
      'French',
      'German',
    ])
  })
})

describe('the current language', () => {
  // Before, `locale` started at the main language and an effect corrected it after the first
  // render: the server render of the French page showed "English" until the page hydrated.
  it('is the page’s language from the first render', () => {
    const rendered = renderOnce(localeStateSource(LANGUAGES, MAIN, LANGUAGE_DETAILS), 'fr')

    expect(rendered.locale).toMatchObject({
      short: 'fr',
      nativeName: 'Français',
      localizedName: 'Français',
    })
  })

  it('is the main language when the page’s locale is not one of the project’s', () => {
    const rendered = renderOnce(localeStateSource(LANGUAGES, MAIN, LANGUAGE_DETAILS), 'pt')

    expect(rendered.locale).toMatchObject({ short: 'en' })
  })
})

describe('global-context.js', () => {
  it('is written with the language details by the project generator', async () => {
    const uidl = baseUidl({ internationalization: i18n({ languageDetails: LANGUAGE_DETAILS }) })
    const structure = await new NextProjectPlugini18nConfig().runAfter(
      buildStructure(uidl, { withNextConfig: false })
    )
    const source = fileContent(structure, 'global-context.js', 'global-context') as string

    expect(source).toContain('"nativeName":"Français"')
    expect(source).toContain(`"flag":"${flag('fr')}"`)
    expect(source).toContain('"de":"Französisch"')
    expect(source).toContain('locales: localizedLocales,')
  })

  it('is written with them by the partial generator', () => {
    const [file] = createNextPartialGenerator().generateGlobalContext(
      i18n({ languageDetails: LANGUAGE_DETAILS }) as never
    ).files

    expect(file.content).toContain('"nativeName":"Français"')
    expect(file.content).toContain('"de":"Französisch"')
    expect(file.content).toContain('locales: localizedLocales,')
  })

  it('lists the languages as before for a project the editor sent no details for', async () => {
    const structure = await new NextProjectPlugini18nConfig().runAfter(
      buildStructure(baseUidl({ internationalization: i18n() }), { withNextConfig: false })
    )
    const source = fileContent(structure, 'global-context.js', 'global-context') as string

    expect(source).toContain(
      '[{"name":"English","short":"en"},{"name":"French","short":"fr"},{"name":"German","short":"de"}]'
    )
    expect(source).toContain('const localizedNames = {};')
  })
})
