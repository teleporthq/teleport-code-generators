import { DataCache } from '@teleporthq/teleport-shared'

/**
 * The REST API data source's response cache: `config.cache` as the editor
 * stores it on the data source.
 */
export interface RESTAPICacheConfig {
  enabled?: boolean
  ttlSeconds?: number
}

/** A year: past that, the window only ever ends with the next deployment. */
const MAX_TTL_SECONDS = 31_536_000

/**
 * Bounds for the one store every REST API data source in a server process
 * shares. Entries are raw JSON text, so the character budget is close to the
 * memory the cache holds.
 */
const MAX_ENTRIES = 100
const MAX_CHARS = 33_554_432

/**
 * How long a request may wait on an upstream call another request started.
 * An older call is treated as stuck and a new one is made, so one hung socket
 * cannot hold every later visitor.
 */
const IN_FLIGHT_JOIN_MS = 10_000

/**
 * The window, in whole seconds, a REST API data source caches its upstream
 * response for — or `undefined` when caching is off, which keeps the emitted
 * fetcher exactly what it was before this option existed.
 */
export const resolveRESTAPICacheTTLSeconds = (
  cache: RESTAPICacheConfig | undefined
): number | undefined => {
  if (!cache || typeof cache !== 'object' || cache.enabled !== true) {
    return undefined
  }

  const { ttlSeconds } = cache
  const seconds =
    typeof ttlSeconds === 'number' && Number.isFinite(ttlSeconds) && ttlSeconds > 0
      ? Math.max(1, Math.floor(ttlSeconds))
      : DataCache.DEFAULT_CACHE_TTL_SECONDS

  return Math.min(seconds, MAX_TTL_SECONDS)
}

/**
 * Runtime helpers of a cached REST API fetcher.
 *
 * The cache sits under the handler, around the upstream `fetch` only: every
 * caller — the API route, `getStaticProps` through `fetchData`, the count
 * route, the global-state route — asks the same URL, and search, filters, sort
 * and paging are applied to the cached payload afterwards. One upstream call
 * per window therefore serves every page, filter and visitor.
 *
 * - The store lives on `globalThis`, so every data-source module in the
 *   process (each API route is its own bundle) shares it. On a serverless host
 *   that is one store per warm instance; the `s-maxage` header below is what
 *   carries the window to the CDN in front of all of them.
 * - Entries are keyed by the whole upstream request (method, URL, headers,
 *   body) and hold the response TEXT: every reader parses its own copy, so a
 *   handler that sorts in place can never reorder another request's rows.
 * - Freshness is judged by the READER's window, so two data sources calling
 *   the same URL with different windows each get what they asked for.
 * - Only a 2xx JSON response is kept. Errors, non-JSON bodies and network
 *   failures reach the caller as before and are retried by the next request.
 *
 * Emitted inside a template literal: no backticks or template placeholders in
 * here, not even in comments.
 */
export const generateRESTAPIResponseCacheCode = (ttlSeconds: number): string => {
  return `const REST_API_CACHE_TTL_MS = ${ttlSeconds * 1000}
const REST_API_CACHE_MAX_ENTRIES = ${MAX_ENTRIES}
const REST_API_CACHE_MAX_CHARS = ${MAX_CHARS}
const REST_API_IN_FLIGHT_JOIN_MS = ${IN_FLIGHT_JOIN_MS}

// One store per server process, shared by every REST API data source module.
if (!globalThis.__tqRestApiCache) {
  globalThis.__tqRestApiCache = { entries: new Map(), inFlight: new Map(), chars: 0 }
}
const restApiCache = globalThis.__tqRestApiCache

function restApiCacheKey(url, options) {
  return JSON.stringify([options.method, url, options.headers, options.body === undefined ? null : options.body])
}

function forgetRestApiResponse(key) {
  const entry = restApiCache.entries.get(key)
  if (entry) {
    restApiCache.entries.delete(key)
    restApiCache.chars -= entry.bodyText.length
  }
}

function rememberRestApiResponse(key, entry) {
  forgetRestApiResponse(key)
  if (entry.bodyText.length > REST_API_CACHE_MAX_CHARS) {
    return
  }
  restApiCache.entries.set(key, entry)
  restApiCache.chars += entry.bodyText.length
  // A Map iterates in insertion order and every hit re-inserts its entry, so
  // the first key is always the least recently used one.
  while (
    restApiCache.entries.size > REST_API_CACHE_MAX_ENTRIES ||
    restApiCache.chars > REST_API_CACHE_MAX_CHARS
  ) {
    forgetRestApiResponse(restApiCache.entries.keys().next().value)
  }
}

async function requestRestApi(url, options) {
  const response = await fetch(url, options)
  if (!response.ok) {
    return { ok: false, status: response.status, statusText: response.statusText }
  }
  const bodyText = await response.text()
  // Parsed once here so a body that is not JSON fails this request, as
  // response.json() would, instead of being cached and failing every request
  // until the window ends.
  JSON.parse(bodyText)
  return {
    ok: true,
    status: response.status,
    statusText: response.statusText,
    bodyText,
    fetchedAt: Date.now(),
  }
}

function fetchRestApiWithCache(url, options) {
  const key = restApiCacheKey(url, options)
  const now = Date.now()

  const cached = restApiCache.entries.get(key)
  if (cached && now >= cached.fetchedAt && now - cached.fetchedAt < REST_API_CACHE_TTL_MS) {
    restApiCache.entries.delete(key)
    restApiCache.entries.set(key, cached)
    return Promise.resolve(cached)
  }

  // Concurrent misses share one upstream call instead of each making their own.
  const pending = restApiCache.inFlight.get(key)
  if (pending && now - pending.startedAt < REST_API_IN_FLIGHT_JOIN_MS) {
    return pending.promise
  }

  const flight = { startedAt: now, promise: null }
  const release = () => {
    if (restApiCache.inFlight.get(key) === flight) {
      restApiCache.inFlight.delete(key)
    }
  }
  flight.promise = requestRestApi(url, options).then(
    (result) => {
      release()
      if (result.ok) {
        rememberRestApiResponse(key, result)
      }
      return result
    },
    (error) => {
      release()
      throw error
    }
  )
  restApiCache.inFlight.set(key, flight)
  return flight.promise
}

// Lets the CDN answer this exact URL until the upstream response it was built
// from expires, so neither layer serves it longer than the window. Only a real
// GET response gets the header: fetchData, fetchCount and tqWithCache call the
// handler with a bare { status, json } object.
function applyRestApiCacheHeaders(req, res, fetchedAt) {
  if (!req || req.method !== 'GET' || !res || typeof res.setHeader !== 'function') {
    return
  }
  const remainingSeconds = Math.floor((fetchedAt + REST_API_CACHE_TTL_MS - Date.now()) / 1000)
  if (remainingSeconds > 0) {
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=' + remainingSeconds)
  }
}`
}
