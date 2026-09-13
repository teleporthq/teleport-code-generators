import { CACHE_SECRET_ENV } from '../cache/constants'
import { REVALIDATE_MAX_PATHS } from './constants'

/**
 * `POST /api/tq-revalidate`
 *
 * Re-runs `getStaticProps` for each given path, so a row an admin just created,
 * edited or deleted reaches the public URL immediately instead of at the end of
 * the page's ISR window. `res.revalidate` is a Pages-Router API-route method, so
 * this route is the only place in a generated project that can do it — which is
 * why the workflow node calls it over HTTP rather than doing the work itself.
 *
 * Reuses the cache secret rather than minting a second one: both endpoints
 * authorise the same actor (the app's own server, mid-workflow) and a project
 * already has this secret provisioned.
 *
 * Fails CLOSED when no secret is configured, for the same reason the cache
 * route does: an unauthenticated rebuild endpoint on every published site is a
 * free way to make a project re-render its pages on demand.
 *
 * Each path is rebuilt inside its OWN try/catch. `res.revalidate` throws for a
 * path that was never generated (a deleted row's URL, a slug that no longer
 * resolves), and one such path must not cost the caller the rebuilds it asked
 * for alongside it — so failures are collected and reported, never thrown.
 */
export const generatePageRevalidateRoute = (): string => `import crypto from 'crypto'

const MAX_PATHS = ${REVALIDATE_MAX_PATHS}

function isAuthorized(req) {
  const secret = process.env.${CACHE_SECRET_ENV}
  const provided = req.headers['x-tq-cache-secret']
  if (!secret || typeof provided !== 'string') {
    return false
  }
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  // timingSafeEqual throws on a length mismatch, so the length is compared first.
  if (a.length !== b.length) {
    return false
  }
  return crypto.timingSafeEqual(a, b)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  const paths = (Array.isArray(body.paths) ? body.paths : [])
    .filter((path) => typeof path === 'string' && path.trim())
    .map((path) => (path.trim().charAt(0) === '/' ? path.trim() : '/' + path.trim()))
    .slice(0, MAX_PATHS)

  const revalidated = []
  const failed = []

  for (const path of paths) {
    try {
      await res.revalidate(path)
      revalidated.push(path)
    } catch (error) {
      // A path that was never statically generated throws here. That is the
      // normal case for a page whose row was just deleted, so it is reported
      // rather than raised.
      failed.push(path)
    }
  }

  return res.status(200).json({ ok: true, revalidated, failed })
}
`
