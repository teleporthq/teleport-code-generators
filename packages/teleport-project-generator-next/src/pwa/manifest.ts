import { UIDLInstallableWebApp, UIDLWebAppScreenshot } from '@teleporthq/teleport-types'
import { AppLocales, localeStartUrl } from './locales'
import { ICON_FILES, MANIFEST_FILE_NAME, pwaPublicPath } from './constants'

export interface WebManifestFile {
  locale: string
  /** File name under `public/`, without the extension. */
  fileName: string
  /** The URL the page links to. */
  href: string
  content: string
}

interface ManifestIcon {
  src: string
  sizes: string
  type: string
  purpose: 'any' | 'maskable'
}

const manifestIcons = (app: UIDLInstallableWebApp): ManifestIcon[] =>
  app.icons
    ? [
        {
          src: pwaPublicPath(ICON_FILES.any192),
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: pwaPublicPath(ICON_FILES.any512),
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: pwaPublicPath(ICON_FILES.maskable512),
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ]
    : []

interface ManifestScreenshot {
  src: string
  sizes: string
  type: string
  form_factor: 'narrow' | 'wide'
  label: string
}

// Chrome shows the larger install dialog only with screenshots that follow its
// rules: each side 320 to 3840 px, the long side at most 2.3 times the short
// one, PNG or JPEG, one shape per form factor, eight at most. The editor cuts
// them to fit; a UIDL that does not is filtered rather than trusted.
const SCREENSHOT_MIN_SIDE = 320
const SCREENSHOT_MAX_SIDE = 3840
const SCREENSHOT_MAX_ASPECT = 2.3
const SCREENSHOT_SHAPE_TOLERANCE = 0.01
const SCREENSHOT_TYPES = ['image/png', 'image/jpeg']
const MAX_SCREENSHOTS = 8
// An absolute https URL (the project's asset host) or a path on the site itself.
const SCREENSHOT_SOURCE = /^(?:https:\/\/|\/(?!\/))/

const isValidSide = (side: number): boolean =>
  Number.isInteger(side) && side >= SCREENSHOT_MIN_SIDE && side <= SCREENSHOT_MAX_SIDE

const isValidScreenshot = (screenshot: UIDLWebAppScreenshot): boolean =>
  SCREENSHOT_SOURCE.test(screenshot.src) &&
  isValidSide(screenshot.width) &&
  isValidSide(screenshot.height) &&
  Math.max(screenshot.width, screenshot.height) <=
    Math.min(screenshot.width, screenshot.height) * SCREENSHOT_MAX_ASPECT &&
  SCREENSHOT_TYPES.includes(screenshot.type)

const aspect = (screenshot: UIDLWebAppScreenshot): number => screenshot.width / screenshot.height

/** The app's screenshots as the manifest lists them, named after the app. */
const manifestScreenshots = (app: UIDLInstallableWebApp): ManifestScreenshot[] => {
  const kept: UIDLWebAppScreenshot[] = []
  for (const screenshot of app.screenshots || []) {
    const sameFormFactor = kept.find((other) => other.formFactor === screenshot.formFactor)
    const fits =
      isValidScreenshot(screenshot) &&
      (!sameFormFactor ||
        Math.abs(aspect(sameFormFactor) - aspect(screenshot)) <= SCREENSHOT_SHAPE_TOLERANCE)
    if (fits && kept.length < MAX_SCREENSHOTS) {
      kept.push(screenshot)
    }
  }
  return kept.map((screenshot) => ({
    src: screenshot.src,
    sizes: `${screenshot.width}x${screenshot.height}`,
    type: screenshot.type,
    form_factor: screenshot.formFactor,
    label: app.name,
  }))
}

/** Locale codes are `[A-Za-z0-9-]` in practice; anything else is folded so it stays a file name. */
const fileSafeLocale = (locale: string): string => locale.replace(/[^A-Za-z0-9-]/g, '-')

export const manifestFileNameFor = (locales: AppLocales, locale: string): string =>
  locale === locales.defaultLocale
    ? MANIFEST_FILE_NAME
    : `${MANIFEST_FILE_NAME}-${fileSafeLocale(locale)}`

/**
 * One manifest per language. They share `id`, so a visitor who installs from a
 * Spanish page and later browses in English still has ONE app — but the app
 * they installed opens on the Spanish home page, in Spanish.
 */
export const buildWebManifests = (
  app: UIDLInstallableWebApp,
  locales: AppLocales,
  colors: { themeColor: string; backgroundColor: string }
): WebManifestFile[] => {
  const icons = manifestIcons(app)
  const screenshots = manifestScreenshots(app)

  return locales.locales.map((locale) => {
    const fileName = manifestFileNameFor(locales, locale)
    const manifest = {
      id: '/',
      name: app.name,
      short_name: app.shortName,
      ...(app.description ? { description: app.description } : {}),
      lang: locale,
      ...(locales.isRightToLeft(locale) ? { dir: 'rtl' } : {}),
      start_url: localeStartUrl(locales, locale),
      scope: '/',
      display: 'standalone',
      background_color: colors.backgroundColor,
      theme_color: colors.themeColor,
      ...(icons.length > 0 ? { icons } : {}),
      ...(screenshots.length > 0 ? { screenshots } : {}),
    }

    return {
      locale,
      fileName,
      href: `/${fileName}.json`,
      content: JSON.stringify(manifest, null, 2),
    }
  })
}
