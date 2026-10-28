import { CACHE_SECRET_ENV } from './constants'

/**
 * `GET /api/tq-cache/version?scope=a,b,c`
 *
 * The one cheap request a page makes on load and on tab focus, for every scope
 * on it at once. This is what closes the hole where a browser served everything
 * from its own cache, never talked to the server, and so never learned that a
 * product had changed.
 *
 * A version number is not sensitive, so the route is public and CDN-cacheable
 * for a few seconds — which is also what stops a busy page turning it into
 * meaningful load.
 */
export const generateCacheVersionRoute =
  (): string => `import { tqReadVersions } from '../../../utils/tq-cache/server'

const MAX_SCOPES = 32

export default async function handler(req, res) {
  const scopes = String(req.query.scope || '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean)
    .slice(0, MAX_SCOPES)

  let versions = {}
  try {
    versions = await tqReadVersions(scopes)
  } catch (error) {
    // Fail open: a version lookup that cannot answer must never break a page.
    versions = {}
  }

  res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=30')
  return res.status(200).json({ versions })
}
`

/**
 * `POST /api/tq-cache/invalidate`
 *
 * Its real job is to bump the SHARED version row — that is what reaches every
 * serverless instance and every browser. The in-process purge it also does only
 * affects the single instance that happened to receive the request, which is a
 * bonus and must never be described as the guarantee.
 *
 * Fails CLOSED when no secret is configured: treating "no secret" as "no
 * authentication required" would leave a public cache-busting endpoint on every
 * published site.
 */
export const generateCacheInvalidateRoute = (): string => `import crypto from 'crypto'
import { tqBumpVersions, tqPurge } from '../../../utils/tq-cache/server'

// The export's unresolved placeholder: a value anyone can read in the code.
const UNRESOLVED_SECRET_PREFIX = 'teleporthq.secrets.'

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isAuthorized(req) {
  const secret = trimmed(process.env.${CACHE_SECRET_ENV})
  const provided = trimmed(req.headers['x-tq-cache-secret'])
  // Unset, blank or still the placeholder: nobody is authorised.
  if (!secret || secret.indexOf(UNRESOLVED_SECRET_PREFIX) === 0 || !provided) {
    return false
  }
  // Digests of both sides: always the same length, so the compare reveals
  // nothing about the secret — not even how long it is.
  const a = crypto.createHash('sha256').update(provided).digest()
  const b = crypto.createHash('sha256').update(secret).digest()
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
  const scopes = Array.isArray(body.scopes) && body.scopes.length ? body.scopes : ['*']

  scopes.forEach(tqPurge)

  try {
    const versions = await tqBumpVersions(scopes.filter((scope) => scope !== '*'))
    return res.status(200).json({ ok: true, versions })
  } catch (error) {
    // The local purge landed but the shared bump did not, so other instances
    // still hold their entries. The caller must treat this as a failure.
    return res.status(200).json({ ok: true, localOnly: true, error: String(error && error.message) })
  }
}
`
