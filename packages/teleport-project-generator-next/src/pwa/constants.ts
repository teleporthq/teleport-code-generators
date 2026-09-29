/** Served from the site root, so its scope covers every page of the app. */
export const SERVICE_WORKER_PATH = '/sw.js'

/** Where the installable-app files live under `public/`. */
export const PWA_PUBLIC_FOLDER = 'pwa'

/** The default language's manifest; every other language gets `manifest-<locale>.json`. */
export const MANIFEST_FILE_NAME = 'manifest'

/**
 * Every cache the worker opens starts with this prefix, so a later worker — or
 * the one that retires the app — can find and delete them without touching a
 * cache the site's own code created.
 */
export const CACHE_NAME_PREFIX = 'tq-pwa-'

/** The page asks a waiting worker to take over with this message. */
export const ACTIVATE_UPDATE_MESSAGE = 'TQ_SW_ACTIVATE_UPDATE'

/** The page asks a worker which version of the app it was built for with this message. */
export const VERSION_MESSAGE = 'TQ_SW_VERSION'

/** The generated component that registers the worker and renders the app chrome. */
export const SERVICE_WORKER_COMPONENT_NAME = 'TeleportServiceWorker'
export const SERVICE_WORKER_COMPONENT_FILE = 'teleport-service-worker'

/** How long a dismissed install banner stays hidden. */
export const INSTALL_BANNER_SNOOZE_DAYS = 30

export const ICON_FILES = {
  any192: 'icon-192.png',
  any512: 'icon-512.png',
  maskable512: 'icon-maskable-512.png',
  appleTouch180: 'apple-touch-icon.png',
} as const

export const pwaPublicPath = (fileName: string): string => `/${PWA_PUBLIC_FOLDER}/${fileName}`
