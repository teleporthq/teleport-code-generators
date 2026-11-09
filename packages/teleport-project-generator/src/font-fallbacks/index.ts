import { ProjectUIDL, UIDLGlobalAsset } from '@teleporthq/teleport-types'
import { FallbackReference, GOOGLE_FONT_FALLBACK_METRICS } from './google-font-fallbacks.generated'

/**
 * Size-matched stand-ins for a project's Google fonts.
 *
 * A Google font arrives a moment after the page has drawn its text, and until
 * then the browser sets that text in whatever font it has: usually Times or
 * Arial, which are 3–11% narrower or wider. When the real font lands every
 * paragraph re-wraps and everything below it jumps; Google's page speed
 * report counts that as layout shift (help.teleporthq.io's articles moved 20px
 * at 2.45 s on a phone).
 *
 * The fix is to give the browser a better font to draw with in the meantime:
 * an `@font-face` named "<Family> Fallback" that points at a font every
 * visitor has (Arial, Times New Roman or Courier New) and stretches it, with
 * `size-adjust` and the ascent/descent/line-gap overrides, to take exactly the
 * room the Google font will take. Putting that name right after the Google
 * family in every font stack makes it what the browser draws with while it
 * waits, so the swap changes the letter shapes but moves nothing. The numbers
 * are measured per family (scripts/measure-google-font-fallbacks.mjs).
 *
 * Runs once on the parsed project, before any code is generated, so every
 * output (Next, HTML, …) and every place a font is named — element styles,
 * classes, design tokens, the project's style sheets and custom CSS — gets the
 * same stacks.
 */

const GOOGLE_FONTS_STYLESHEET_HOST = 'fonts.googleapis.com'

/**
 * The fonts each stand-in may be found under. Liberation and Arimo/Tinos/
 * Cousine are the metric-compatible twins Linux ships; Roboto stands in for
 * Arial on Android, where Arial is missing (0.5% narrower on running text).
 */
const LOCAL_NAMES: Record<FallbackReference, string[]> = {
  Arimo: ['Arial', 'ArialMT', 'Liberation Sans', 'Arimo', 'Roboto', 'Roboto-Regular'],
  Tinos: ['Times New Roman', 'TimesNewRomanPSMT', 'Liberation Serif', 'Tinos'],
  Cousine: ['Courier New', 'CourierNewPSMT', 'Liberation Mono', 'Cousine'],
}

const STYLE_CONTAINER_KEYS = new Set(['style', 'styles', 'referencedStyles', 'styleSetDefinitions'])
const FONT_FAMILY_KEYS = new Set(['fontFamily', 'font-family'])

const familyKey = (family: string) => family.toLowerCase().replace(/\s+/g, '')

const unquote = (name: string) =>
  name
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim()

/** A family name written the way CSS accepts it everywhere it may be pasted. */
const cssFamilyName = (name: string) =>
  name.split(/\s+/).every((word) => /^[A-Za-z_][\w-]*$/.test(word)) ? name : `'${name}'`

export const fallbackFamilyName = (family: string) => `${family} Fallback`

/** Every family a Google Fonts stylesheet URL asks for (css2 and the older css API). */
export const googleFamiliesInStylesheetUrl = (url: string): string[] => {
  if (!url.includes(GOOGLE_FONTS_STYLESHEET_HOST)) {
    return []
  }
  let params: URLSearchParams
  try {
    params = new URL(url.startsWith('//') ? `https:${url}` : url).searchParams
  } catch {
    return []
  }
  return params
    .getAll('family')
    .flatMap((value) => value.split('|'))
    .map((entry) => entry.split(':')[0].trim())
    .filter(Boolean)
}

/**
 * The Google families this project loads and has measurements for, by key,
 * each with its name as the project wrote it.
 */
export const googleFamiliesWithFallbacks = (
  assets: ReadonlyArray<UIDLGlobalAsset>
): Map<string, string> => {
  const families = new Map<string, string>()
  for (const asset of assets) {
    if ((asset.type !== 'font' && asset.type !== 'style') || !('path' in asset)) {
      continue
    }
    for (const family of googleFamiliesInStylesheetUrl(asset.path)) {
      const key = familyKey(family)
      if (GOOGLE_FONT_FALLBACK_METRICS[key] && !families.has(key)) {
        families.set(key, family)
      }
    }
  }
  return families
}

const percent = (fraction: number) => `${Number((fraction * 100).toFixed(2))}%`

/** One `@font-face` per family: the stand-in the browser draws with until the font arrives. */
export const fontFallbackFaces = (families: Map<string, string>): string =>
  Array.from(families.entries())
    .map(([key, family]) => {
      const [reference, sizeAdjust, ascent, descent, lineGap] = GOOGLE_FONT_FALLBACK_METRICS[key]
      return [
        '@font-face {',
        `  font-family: ${cssFamilyName(fallbackFamilyName(family))};`,
        `  src: ${LOCAL_NAMES[reference].map((name) => `local("${name}")`).join(', ')};`,
        `  size-adjust: ${percent(sizeAdjust)};`,
        `  ascent-override: ${percent(ascent)};`,
        `  descent-override: ${percent(descent)};`,
        `  line-gap-override: ${percent(lineGap)};`,
        '}',
      ].join('\n')
    })
    .join('\n')

const splitFontStack = (value: string): string[] => {
  const items: string[] = []
  let current = ''
  let quote: string | null = null
  for (const char of value) {
    if (quote) {
      quote = char === quote ? null : quote
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === ',') {
      items.push(current)
      current = ''
      continue
    }
    current += char
  }
  items.push(current)
  return items
}

/**
 * The font stack with each loaded Google family followed by its stand-in.
 * Anything it does not recognise (generic families, `var(…)`, other fonts) is
 * left exactly as written; a stack that already names the stand-in is unchanged.
 */
export const withFontFallbacks = (stack: string, families: Map<string, string>): string => {
  if (stack.includes('${')) {
    return stack
  }
  const items = splitFontStack(stack)
  const result: string[] = []
  let changed = false
  items.forEach((item, index) => {
    const family = families.get(familyKey(unquote(item)))
    const next = items[index + 1]
    if (
      !family ||
      (next !== undefined && familyKey(unquote(next)) === familyKey(fallbackFamilyName(family)))
    ) {
      result.push(item)
      return
    }
    const [, name, trailingSpace] = item.match(/^([\s\S]*?)(\s*)$/)
    result.push(name, ` ${cssFamilyName(fallbackFamilyName(family))}${trailingSpace}`)
    changed = true
  })
  return changed ? result.join(',') : stack
}

const FONT_DECLARATION = /((?:^|[\s;{])(?:font-family|--[\w-]*font[\w-]*)\s*:)([^;{}<]*)/gi
// Inside @font-face, `font-family` names the face being defined: one name, no stack.
const FONT_FACE_RULE = /(@font-face\s*\{[^}]*\})/i

/** Font stacks inside CSS text: `font-family` declarations and font custom properties. */
export const withFontFallbacksInCss = (css: string, families: Map<string, string>): string =>
  css
    .split(FONT_FACE_RULE)
    .map((part) =>
      FONT_FACE_RULE.test(part)
        ? part
        : part.replace(FONT_DECLARATION, (match, property: string, value: string) => {
            const important = value.match(/\s*!important\s*$/i)
            const stack = important ? value.slice(0, important.index) : value
            const rewritten = withFontFallbacks(stack, families)
            return rewritten === stack
              ? match
              : `${property}${rewritten}${important ? important[0] : ''}`
          })
    )
    .join('')

/** The `<style>` blocks of custom head/body HTML. */
const withFontFallbacksInHtml = (html: string, families: Map<string, string>): string =>
  html.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_match, open: string, css: string, close: string) =>
      `${open}${withFontFallbacksInCss(css, families)}${close}`
  )

const rewriteStaticStack = (value: unknown, families: Map<string, string>): unknown => {
  if (typeof value === 'string') {
    return withFontFallbacks(value, families)
  }
  if (
    value &&
    typeof value === 'object' &&
    (value as { type?: string }).type === 'static' &&
    typeof (value as { content?: unknown }).content === 'string'
  ) {
    const content = (value as { content: string }).content
    const rewritten = withFontFallbacks(content, families)
    return rewritten === content ? value : { ...(value as object), content: rewritten }
  }
  return value
}

const rewriteStyleObjects = (
  value: unknown,
  families: Map<string, string>,
  inStyle: boolean
): void => {
  if (Array.isArray(value)) {
    value.forEach((item) => rewriteStyleObjects(item, families, inStyle))
    return
  }
  if (!value || typeof value !== 'object') {
    return
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (inStyle && FONT_FAMILY_KEYS.has(key)) {
      record[key] = rewriteStaticStack(record[key], families)
      continue
    }
    rewriteStyleObjects(record[key], families, inStyle || STYLE_CONTAINER_KEYS.has(key))
  }
}

const rewriteFontTokens = (
  tokens: Record<string, unknown> | undefined,
  families: Map<string, string>
) => {
  for (const name of Object.keys(tokens || {})) {
    if (/font/i.test(name)) {
      tokens[name] = rewriteStaticStack(tokens[name], families)
    }
  }
}

export const FONT_FALLBACKS_STYLE_TAG = 'font-fallbacks'

/**
 * Adds the stand-ins to a parsed project: one inline style with their
 * `@font-face` rules, and the stand-in's name after every loaded Google family
 * in every font stack. A project that loads no Google font is left untouched.
 */
export const applyFontFallbacks = (uidl: ProjectUIDL): void => {
  const assets = uidl.globals?.assets || []
  const families = googleFamiliesWithFallbacks(assets)
  if (families.size === 0) {
    return
  }

  for (const component of [uidl.root, ...Object.values(uidl.components || {})]) {
    rewriteStyleObjects(component, families, false)
    rewriteFontTokens(component?.designLanguage?.tokens, families)
  }

  for (const asset of assets) {
    if (asset.type === 'style' && 'content' in asset && typeof asset.content === 'string') {
      asset.content = withFontFallbacksInCss(asset.content, families)
    }
  }

  const customCode = uidl.globals.customCode
  if (customCode?.head) {
    customCode.head = withFontFallbacksInHtml(customCode.head, families)
  }
  if (customCode?.body) {
    customCode.body = withFontFallbacksInHtml(customCode.body, families)
  }

  assets.push({
    type: 'style',
    content: fontFallbackFaces(families),
    attrs: { 'data-tag': { type: 'static', content: FONT_FALLBACKS_STYLE_TAG } },
  })
}
