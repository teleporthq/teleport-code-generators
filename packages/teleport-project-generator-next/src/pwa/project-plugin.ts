import {
  FileType,
  ProjectPlugin,
  ProjectPluginStructure,
  ProjectUIDL,
  UIDLInstallableWebApp,
} from '@teleporthq/teleport-types'
import { injectSiblingIntoApp } from '../app-sibling-injection'
import { resolveWorkerPlan, WorkerPlan } from './worker-plan'
import { AppLocales, localeStartUrl, resolveAppLocales } from './locales'
import { resolveAppColors } from './colors'
import { buildWebManifests } from './manifest'
import { writeAppIcons } from './icons'
import { buildOfflinePageHtml } from './offline-page'
import { resolvePwaMessagesForLocales } from './messages'
import { collectNetworkOnlyPatterns } from './network-only-paths'
import { computeWorkerVersion } from './worker-version'
import {
  buildRetiringWorkerSource,
  buildServiceWorkerSource,
  ServiceWorkerConfig,
} from './service-worker-source'
import { buildClientRuntimeSource, ClientRuntimeConfig } from './client-runtime-source'
import { buildClientStyles } from './client-styles'
import { injectServiceWorkerHeaders } from './next-config-headers'
import {
  ICON_FILES,
  SERVICE_WORKER_COMPONENT_FILE,
  SERVICE_WORKER_COMPONENT_NAME,
  pwaPublicPath,
} from './constants'

/** Where the project generator puts the manifest built from `globals.manifest`. */
const LEGACY_MANIFEST_FILE_KEY = 'manifest'

const writeServiceWorker = (structure: ProjectPluginStructure, content: string): void => {
  structure.files.set('pwa-service-worker', {
    path: ['public'],
    files: [{ name: 'sw', fileType: FileType.JS, content }],
  })
}

const writeClientRuntime = (structure: ProjectPluginStructure, content: string): void => {
  structure.files.set('pwa-service-worker-component', {
    path: ['components'],
    files: [{ name: SERVICE_WORKER_COMPONENT_FILE, fileType: FileType.JS, content }],
  })
  injectSiblingIntoApp(structure, {
    componentName: SERVICE_WORKER_COMPONENT_NAME,
    importStatement: `import ${SERVICE_WORKER_COMPONENT_NAME} from '../components/${SERVICE_WORKER_COMPONENT_FILE}';\n`,
  })
}

/** The project's favicon, the icon a notification falls back to when the app has no icon set. */
const faviconPath = (uidl: ProjectUIDL): string | null => {
  const favicon = uidl.globals.assets.find((asset) => asset.type === 'icon')
  return favicon && 'path' in favicon && typeof favicon.path === 'string' ? favicon.path : null
}

const matchesPattern = (path: string, patterns: string[]): boolean =>
  patterns.some((pattern) =>
    pattern === '/' ? path === '/' : path === pattern || path.startsWith(`${pattern}/`)
  )

const writeInstallableApp = (
  structure: ProjectPluginStructure,
  plan: WorkerPlan,
  app: UIDLInstallableWebApp,
  locales: AppLocales
): void => {
  const { uidl } = structure
  const colors = resolveAppColors(app)
  const manifests = buildWebManifests(app, locales, colors)
  const messages = resolvePwaMessagesForLocales(locales.locales)
  const networkOnly = collectNetworkOnlyPatterns(uidl, app)
  const appIcon = app.icons ? pwaPublicPath(ICON_FILES.any192) : null

  // A UIDL can still carry the old `globals.manifest`, whose `manifest.json`
  // would take the place of the default language's manifest.
  structure.files.delete(LEGACY_MANIFEST_FILE_KEY)
  structure.files.set('pwa-manifests', {
    path: ['public'],
    files: manifests.map((manifest) => ({
      name: manifest.fileName,
      fileType: FileType.JSON,
      content: manifest.content,
    })),
  })
  if (app.icons) {
    writeAppIcons(structure, app.icons)
  }

  const offlinePages = locales.locales.reduce<Record<string, string>>((pages, locale) => {
    pages[locale] = buildOfflinePageHtml({
      appName: app.name,
      locale,
      rightToLeft: locales.isRightToLeft(locale),
      messages: messages[locale],
      colors,
    })
    return pages
  }, {})

  // Every language's home page opens offline — unless the home page itself is
  // private, in which case nothing is fetched ahead of the visitor.
  const precacheUrls =
    app.cacheContent && !matchesPattern('/', networkOnly)
      ? locales.locales.map((locale) => localeStartUrl(locales, locale))
      : []

  const version = computeWorkerVersion(uidl)
  const workerConfig: ServiceWorkerConfig = {
    version,
    mode: 'app',
    appName: app.name,
    cacheContent: app.cacheContent,
    precacheUrls,
    networkOnly,
    defaultLocale: locales.defaultLocale,
    prefixedLocales: locales.prefixedLocales,
    defaultLocalePrefix: locales.defaultLocalePrefix,
    notificationIcon: appIcon ?? faviconPath(uidl),
    push: plan.push,
  }
  writeServiceWorker(structure, buildServiceWorkerSource(workerConfig, offlinePages))

  const clientConfig: ClientRuntimeConfig = {
    mode: 'app',
    version,
    appName: app.name,
    shortName: app.shortName,
    defaultLocale: locales.defaultLocale,
    prefixedLocales: locales.prefixedLocales,
    defaultLocalePrefix: locales.defaultLocalePrefix,
    manifests: manifests.reduce<Record<string, string>>((hrefs, manifest) => {
      hrefs[manifest.locale] = manifest.href
      return hrefs
    }, {}),
    themeColor: colors.themeColor,
    appleTouchIcon: app.icons ? pwaPublicPath(ICON_FILES.appleTouch180) : null,
    bannerIcon: appIcon,
    // The maskable icon is opaque and sharp at 512 px; its logo already keeps
    // clear of the rounded corners the launch screen gives it.
    launchScreen: {
      backgroundColor: colors.backgroundColor,
      icon: app.icons ? pwaPublicPath(ICON_FILES.maskable512) : null,
    },
    installBanner: app.installBanner,
    networkOnly,
    push: plan.push,
  }
  writeClientRuntime(
    structure,
    buildClientRuntimeSource({ config: clientConfig, messages, styles: buildClientStyles(colors) })
  )

  injectServiceWorkerHeaders(
    structure,
    manifests.map((manifest) => manifest.href)
  )
}

const writeNotificationWorker = (
  structure: ProjectPluginStructure,
  plan: WorkerPlan,
  locales: AppLocales
): void => {
  const { uidl } = structure
  const appName = uidl.globals.settings.title || uidl.name

  const version = computeWorkerVersion(uidl)
  const workerConfig: ServiceWorkerConfig = {
    version,
    mode: 'notify',
    appName,
    cacheContent: false,
    precacheUrls: [],
    networkOnly: [],
    defaultLocale: locales.defaultLocale,
    prefixedLocales: locales.prefixedLocales,
    defaultLocalePrefix: locales.defaultLocalePrefix,
    notificationIcon: faviconPath(uidl),
    push: plan.push,
  }
  writeServiceWorker(structure, buildServiceWorkerSource(workerConfig, {}))

  const clientConfig: ClientRuntimeConfig = {
    mode: 'notify',
    version,
    appName,
    shortName: appName,
    defaultLocale: locales.defaultLocale,
    prefixedLocales: locales.prefixedLocales,
    defaultLocalePrefix: locales.defaultLocalePrefix,
    manifests: {},
    themeColor: '',
    appleTouchIcon: null,
    bannerIcon: null,
    launchScreen: null,
    installBanner: false,
    networkOnly: [],
    push: plan.push,
  }
  writeClientRuntime(
    structure,
    buildClientRuntimeSource({ config: clientConfig, messages: {}, styles: '' })
  )

  injectServiceWorkerHeaders(structure, [])
}

/**
 * The installable app: one service worker at `/sw.js` for the whole project,
 * a manifest per language, the home-screen icons, and the page-side runtime
 * rendered from `_app` on every page — admin and signed-in pages included.
 * Also ships the notifications-only worker a project needs for its push and
 * notification workflow nodes, and the worker that retires an earlier app.
 * A project that needs none of the three comes out exactly as before.
 */
export class NextPwaProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const plan = resolveWorkerPlan(structure.uidl)

    if (plan.mode === 'retire') {
      writeServiceWorker(structure, buildRetiringWorkerSource())
      injectServiceWorkerHeaders(structure, [])
      return structure
    }

    const locales = resolveAppLocales(structure.uidl)
    if (plan.app) {
      writeInstallableApp(structure, plan, plan.app, locales)
    } else if (plan.mode === 'notify') {
      writeNotificationWorker(structure, plan, locales)
    }

    return structure
  }
}
