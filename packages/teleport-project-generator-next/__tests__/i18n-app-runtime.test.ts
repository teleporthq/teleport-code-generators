import { NextProjectPlugini18nConfig } from '../src/internationalization/project'
import {
  buildI18nRuntimeSource,
  dayjsLocaleOf,
  DAYJS_VERSION,
} from '../src/internationalization/app-i18n-runtime'
import { APP_SOURCE, baseUidl, buildStructure, fileContent } from './_helpers/pwa-fixtures'

/**
 * A site with internationalization hands the page's language to everything
 * below `_app`: dates (`DateTimePrimitive` formats with dayjs's global
 * language) and workflow scripts (`window.__TQ_I18N__`), which run outside
 * React and cannot reach the page's `translate`.
 */

const i18n = (languages: Record<string, string> = { en: 'English', es: 'Spanish' }) => ({
  main: { name: 'English', locale: 'en' },
  languages,
  translations: Object.keys(languages).reduce(
    (all, code) => ({ ...all, [code]: {} }),
    {} as Record<string, Record<string, never>>
  ),
})

const run = async (extra: Record<string, unknown>) =>
  new NextProjectPlugini18nConfig().runAfter(
    buildStructure(baseUidl(extra), { withNextConfig: false })
  )

const appOf = (structure: Awaited<ReturnType<typeof run>>) =>
  fileContent(structure, '_app', '_app') as string

interface Page {
  locale?: string
  defaultLocale?: string
  messages?: Record<string, string>
}

/**
 * The emitted module run as one render after another in a single process, as
 * the server renders every language: returns dayjs's language after each.
 */
const renderPages = (source: string, pages: Page[], options: { browser: boolean }) => {
  let dayjsLocale = 'en'
  const dayjs = {
    locale: (name: string) => {
      dayjsLocale = name
      return name
    },
  }
  const imported: string[] = []
  let router: Page = {}
  const body = source
    .replace(/^import \{ useRouter \} from 'next\/router'$/m, '')
    .replace(/^import dayjs from 'dayjs'$/m, '')
    .replace(/^import '(dayjs\/locale\/[^']+)'$/gm, (_line, name) => {
      imported.push(name)
      return ''
    })
    .replace('export function useTqI18n', 'function useTqI18n')
  expect(body).not.toMatch(/^(import|export) /m)
  const scope: { __TQ_I18N__?: unknown } = {}
  const useTqI18n = new Function('useRouter', 'dayjs', 'window', `${body}\nreturn useTqI18n`)(
    () => router,
    dayjs,
    options.browser ? scope : undefined
  )
  const seen = pages.map((page) => {
    router = { locale: page.locale, defaultLocale: page.defaultLocale }
    useTqI18n({ messages: page.messages })
    return { dayjs: dayjsLocale, global: scope.__TQ_I18N__ }
  })
  return { seen, imported }
}

describe('the page language in _app', () => {
  it('calls the hook first thing in _app, imports it, and pins the dayjs _app imports', async () => {
    const structure = await run({ internationalization: i18n() })
    const app = appOf(structure)

    expect(app).toMatch(
      /export default function MyApp\(\{ Component, pageProps \}\) \{\n {2}useTqI18n\(pageProps\)\n {2}return \(/
    )
    expect(app.indexOf("import { useTqI18n } from '../utils/tq-i18n'\n")).toBe(0)
    expect(structure.files.get('tq-i18n-runtime')?.path).toEqual(['utils'])
    expect(fileContent(structure, 'tq-i18n-runtime', 'tq-i18n')).toContain(
      "import 'dayjs/locale/es'"
    )
    expect(structure.dependencies.dayjs).toBe(DAYJS_VERSION)
  })

  it('changes nothing for a project without internationalization', async () => {
    const structure = await run({})

    expect(appOf(structure)).toBe(APP_SOURCE)
    expect(structure.files.has('tq-i18n-runtime')).toBe(false)
    expect(structure.dependencies.dayjs).toBeUndefined()
  })

  it('adds the call once when the plugin runs again', async () => {
    const structure = await run({ internationalization: i18n() })
    await new NextProjectPlugini18nConfig().runAfter(structure)

    expect(appOf(structure).match(/useTqI18n\(pageProps\)/g)).toHaveLength(1)
    expect(appOf(structure).match(/import \{ useTqI18n \}/g)).toHaveLength(1)
  })

  it('keeps a dayjs version the project already pins', async () => {
    const structure = buildStructure(baseUidl({ internationalization: i18n() }), {
      withNextConfig: false,
    })
    structure.dependencies.dayjs = '1.11.10'
    await new NextProjectPlugini18nConfig().runAfter(structure)

    expect(structure.dependencies.dayjs).toBe('1.11.10')
  })
})

describe('the date language', () => {
  it.each([
    ['es', 'es'],
    ['pt-BR', 'pt-br'],
    ['de-LI', 'de'],
    ['no', 'nb'],
    ['tl', 'tl-ph'],
    ['en', 'en'],
    ['zz', null],
  ])('of %s is dayjs’s %s', (code, expected) => {
    expect(dayjsLocaleOf(code)).toBe(expected)
  })

  it('imports the file of each language dayjs knows, English being built in', () => {
    const source = buildI18nRuntimeSource(['en', 'es', 'pt-BR', 'zz'], 'en')

    expect(source.match(/^import 'dayjs\/locale\/[^']+'$/gm)).toEqual([
      "import 'dayjs/locale/es'",
      "import 'dayjs/locale/pt-br'",
    ])
    expect(source).toContain('var DATE_LOCALES = {"en":"en","es":"es","pt-BR":"pt-br"}')
  })

  /**
   * One server process renders every language. A render must never keep the
   * language the one before it set — not even for a language dayjs has no
   * file for, which reads in English.
   */
  it('sets every render’s own language, never the previous page’s', () => {
    const source = buildI18nRuntimeSource(['en', 'es', 'zz'], 'en')
    const { seen, imported } = renderPages(
      source,
      [
        { locale: 'es', defaultLocale: 'en' },
        { locale: 'en', defaultLocale: 'en' },
        { locale: 'es', defaultLocale: 'en' },
        { locale: 'zz', defaultLocale: 'en' },
        {},
      ],
      { browser: false }
    )

    expect(imported).toEqual(['dayjs/locale/es'])
    expect(seen.map((render) => render.dayjs)).toEqual(['es', 'en', 'es', 'en', 'en'])
    // The server never writes a window global.
    expect(seen.map((render) => render.global)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })

  it('hands scripts the page’s language and words in the browser', () => {
    const messages = { 'forum-word_title-needed': 'Ponle un título a tu tema.' }
    const { seen } = renderPages(
      buildI18nRuntimeSource(['en', 'es'], 'en'),
      [
        { locale: 'es', defaultLocale: 'en', messages },
        { locale: 'en', defaultLocale: 'en' },
      ],
      { browser: true }
    )

    expect(seen[0].global).toEqual({ locale: 'es', defaultLocale: 'en', messages })
    expect(seen[1].global).toEqual({ locale: 'en', defaultLocale: 'en', messages: undefined })
  })
})
