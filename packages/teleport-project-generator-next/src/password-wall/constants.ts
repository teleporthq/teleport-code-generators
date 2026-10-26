/**
 * The address of the password page. Not a page of the site: the middleware
 * rewrites it, like every gated request, to the sign-in route, which serves
 * the page with the status the wall needs.
 */
export const PASSWORD_PAGE_ROUTE = '/site-password'
/** The site's own route the password page posts to (same origin, so it stays open). */
export const SIGN_IN_ROUTE = '/api/site-password'
/** The cookie a visitor holds once the password was accepted. */
export const WALL_COOKIE = 'tq_wall'

/**
 * Written into the site's `.env` empty; the platform fills them at publish.
 * Empty, the wall stays off: a downloaded site and a local run behave as if
 * the files were not there.
 */
export const WALL_ENV_KEYS = [
  'TELEPORT_WALL',
  'TELEPORT_WALL_VERSION',
  'TELEPORT_WALL_SECRET',
  'TELEPORT_PROJECT_ID',
  'TELEPORT_API_URL',
] as const

/** Where the shared helper lands, imported by the middleware and the sign-in route. */
export const WALL_HELPER_PATH = ['utils']
export const WALL_HELPER_NAME = 'site-wall'
/** The password page as HTML, next to the helper; the sign-in route serves it. */
export const WALL_PAGE_HELPER_NAME = 'site-wall-page'

/** The `files` key the workflows plugin uses for the site's middleware. */
export const MIDDLEWARE_FILES_KEY = 'auth-middleware'

/**
 * The middleware runs on every page and asset except the site's own hashed
 * scripts and styles (no content in them) and its API routes: payment
 * webhooks, cron runs and the site's own server-side calls must keep working,
 * and the password page posts to one of them. The bare '/' entry is required
 * because Next.js does not run a negative-lookahead matcher for the root path.
 */
export const WALL_MATCHER = `['/', '/((?!api|_next/static).*)']`
