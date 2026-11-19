import { FileType, GeneratedFile, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { injectImportIntoApp } from '../app-import-injection'

export const I18N_RUNTIME_DIR = ['utils']
export const I18N_RUNTIME_MODULE = 'tq-i18n'
export const I18N_RUNTIME_IMPORT = `import { useTqI18n } from '../utils/${I18N_RUNTIME_MODULE}'`
export const I18N_RUNTIME_CALL = 'useTqI18n(pageProps)'

/**
 * The range `@teleporthq/react-components` asks for: the same range lets npm
 * install ONE dayjs that `_app` and `DateTimePrimitive` share. Two copies would
 * each keep their own language, and the dates would stay in English.
 */
export const DAYJS_VERSION = '^1.11.8'

/** The language files dayjs 1.11 ships (`dayjs/locale/<name>.js`), the same from 1.11.8 on. */
const DAYJS_LOCALES = new Set(
  (
    'af am ar-dz ar-iq ar-kw ar-ly ar-ma ar-sa ar-tn ar az be bg bi bm bn-bd bn bo br bs ca cs cv ' +
    'cy da de-at de-ch de dv el en-au en-ca en-gb en-ie en-il en-in en-nz en-sg en-tt en eo es-do ' +
    'es-mx es-pr es-us es et eu fa fi fo fr-ca fr-ch fr fy ga gd gl gom-latn gu he hi hr ht hu ' +
    'hy-am id is it-ch it ja jv ka kk km kn ko ku ky lb lo lt lv me mi mk ml mn mr ms-my ms mt my ' +
    'nb ne nl-be nl nn oc-lnc pa-in pl pt-br pt rn ro ru rw sd se si sk sl sq sr-cyrl sr ss sv-fi ' +
    'sv sw ta te tet tg th tk tl-ph tlh tr tzl tzm-latn tzm ug-cn uk ur uz-latn uz vi yo zh-cn ' +
    'zh-hk zh-tw zh'
  ).split(' ')
)

/** Language codes the editor offers that dayjs files under another name. */
const DAYJS_ALIASES: Record<string, string> = {
  no: 'nb',
  tl: 'tl-ph',
  pa: 'pa-in',
  hy: 'hy-am',
  ug: 'ug-cn',
  oc: 'oc-lnc',
  yue: 'zh-hk',
  sh: 'sr',
  kok: 'gom-latn',
}

/** The dayjs language of a site language (`pt-BR` → `pt-br`, `no` → `nb`), or null when dayjs has none. */
export const dayjsLocaleOf = (code: string): string | null => {
  const lower = String(code || '').toLowerCase()
  const base = lower.split('-')[0]
  const candidates = [lower, DAYJS_ALIASES[lower], base, DAYJS_ALIASES[base]]
  return candidates.find((candidate) => candidate && DAYJS_LOCALES.has(candidate)) || null
}

/**
 * `utils/tq-i18n.js`: the hook `_app` calls first thing on every render, so
 * everything the page renders below it reads the page's language.
 *
 * - Dates: `DateTimePrimitive` formats with dayjs's global language, which is
 *   English unless something sets it. The hook sets it to the page's language
 *   (English when dayjs has no file for it), on the server and in the browser
 *   alike, so the server's HTML and the browser's first render agree.
 * - `window.__TQ_I18N__ = { locale, defaultLocale, messages }`, in the browser
 *   only: workflow scripts run outside React and cannot reach the page's
 *   `translate`, so they read the page's language and words from here.
 *
 * One server process renders every language. Every render sets the language
 * (never keeps the one before), before any of the page renders, and React 17's
 * `renderToString` renders the whole page in one synchronous pass, so no other
 * request's render can run between the two. Nothing else in a generated
 * project formats dates with dayjs.
 */
export const buildI18nRuntimeSource = (locales: string[], defaultLocale: string): string => {
  const dateLocales: Record<string, string> = {}
  locales.forEach((locale) => {
    const dayjsLocale = dayjsLocaleOf(locale)
    if (dayjsLocale) {
      dateLocales[locale] = dayjsLocale
    }
  })
  const imports = Array.from(new Set(Object.values(dateLocales)))
    .filter((name) => name !== 'en')
    .sort()
    .map((name) => `import 'dayjs/locale/${name}'\n`)
    .join('')

  return `import { useRouter } from 'next/router'
import dayjs from 'dayjs'
${imports}
// Each language of the site as dayjs names it. A language dayjs has no file
// for reads its dates in English.
var DATE_LOCALES = ${JSON.stringify(dateLocales)}
var DEFAULT_LOCALE = ${JSON.stringify(defaultLocale)}

// Called first thing in _app on every render: the page's language for its
// dates, and for the scripts its workflows run (window.__TQ_I18N__).
export function useTqI18n(pageProps) {
  var router = useRouter()
  var locale = (router && router.locale) || DEFAULT_LOCALE
  var defaultLocale = (router && router.defaultLocale) || DEFAULT_LOCALE
  dayjs.locale(DATE_LOCALES[locale] || 'en')
  if (typeof window !== 'undefined') {
    window.__TQ_I18N__ = {
      locale: locale,
      defaultLocale: defaultLocale,
      messages: pageProps && pageProps.messages,
    }
  }
}
`
}

const findAppFile = (structure: ProjectPluginStructure): GeneratedFile | null => {
  for (const [key, record] of Array.from(structure.files.entries())) {
    if (key === '_app' || key.includes('_app')) {
      const found = record.files?.find(
        (file) => file.name === '_app' && (file.fileType === 'js' || file.fileType === 'tsx')
      )
      if (found) {
        return found
      }
    }
  }
  return null
}

const APP_FUNCTION_OPENING = /export default function MyApp\s*\([^)]*\)\s*\{/

/**
 * Ships `utils/tq-i18n.js`, calls its hook first thing in `_app`'s body and
 * pins `dayjs`, which `_app` now imports. Only for a project with
 * internationalization; leaves `_app` untouched when it cannot find its body.
 */
export const addI18nRuntime = (
  structure: ProjectPluginStructure,
  locales: string[],
  defaultLocale: string
): void => {
  const appFile = findAppFile(structure)
  if (!appFile || typeof appFile.content !== 'string') {
    return
  }
  if (!appFile.content.includes(I18N_RUNTIME_CALL)) {
    const opening = appFile.content.match(APP_FUNCTION_OPENING)
    if (!opening || opening.index === undefined) {
      return
    }
    const at = opening.index + opening[0].length
    appFile.content = `${appFile.content.slice(
      0,
      at
    )}\n  ${I18N_RUNTIME_CALL}${appFile.content.slice(at)}`
    injectImportIntoApp(structure, I18N_RUNTIME_IMPORT)
  }

  structure.files.set('tq-i18n-runtime', {
    path: I18N_RUNTIME_DIR,
    files: [
      {
        name: I18N_RUNTIME_MODULE,
        fileType: FileType.JS,
        content: buildI18nRuntimeSource(locales, defaultLocale),
      },
    ],
  })

  if (!structure.dependencies.dayjs) {
    structure.dependencies.dayjs = DAYJS_VERSION
  }
}
