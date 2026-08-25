import { DataCache } from '@teleporthq/teleport-shared'
import { UIDLDataCacheConfig } from '@teleporthq/teleport-types'
import { DataSourceServerCacheOptions, ResolvedDataSourceCache } from './types'

/**
 * Reads the `cache` block off a `cms-list-repeater`.
 *
 * Returns `undefined` — meaning "emit exactly what this generator emitted
 * before caching existed" — for anything that is off, incomplete, or caches
 * into neither layer.
 */
export const resolveCacheFromRepeaterContent = (
  cache: UIDLDataCacheConfig | undefined,
  resourceDefinition: { dataSourceId?: string; tableName?: string } | undefined
): ResolvedDataSourceCache | undefined => {
  if (!cache || cache.enabled !== true) {
    return undefined
  }

  const client = cache.client === true
  const server = cache.server === true
  if (!client && !server) {
    return undefined
  }

  const scope =
    cache.versionScope ||
    (resourceDefinition?.dataSourceId && resourceDefinition?.tableName
      ? DataCache.cacheScopeFor(resourceDefinition.dataSourceId, resourceDefinition.tableName)
      : '')
  if (!scope) {
    return undefined
  }

  const ttlSeconds =
    typeof cache.ttlSeconds === 'number' && cache.ttlSeconds > 0
      ? Math.trunc(cache.ttlSeconds)
      : DataCache.DEFAULT_CACHE_TTL_SECONDS

  return {
    scope,
    ttlSeconds,
    client,
    server,
    sMaxAge: typeof cache.cdnSMaxAge === 'number' && cache.cdnSMaxAge > 0 ? cache.cdnSMaxAge : 0,
    staleWhileRevalidate:
      typeof cache.cdnStaleWhileRevalidate === 'number' && cache.cdnStaleWhileRevalidate > 0
        ? cache.cdnStaleWhileRevalidate
        : undefined,
  }
}

/**
 * Folds several mappers' requests for the same generated file into one.
 *
 * Enabled if ANY mapper wants it, but with the SHORTEST requested TTL and the
 * shortest shared-cache window — a mapper that asked for fresher data must
 * never be made staler by a sibling that asked for less.
 */
export const mergeServerCacheOptions = (
  entries: DataSourceServerCacheOptions[]
): DataSourceServerCacheOptions | undefined => {
  const enabled = entries.filter((entry) => entry.ttlSeconds > 0 || (entry.sMaxAge || 0) > 0)
  if (!enabled.length) {
    return undefined
  }

  const positive = (values: number[]) => values.filter((value) => value > 0)
  const ttls = positive(enabled.map((entry) => entry.ttlSeconds))
  const sMaxAges = positive(enabled.map((entry) => entry.sMaxAge || 0))
  const swrs = positive(enabled.map((entry) => entry.staleWhileRevalidate || 0))

  return {
    scope: enabled[0].scope,
    ttlSeconds: ttls.length ? Math.min(...ttls) : 0,
    sMaxAge: sMaxAges.length ? Math.min(...sMaxAges) : 0,
    staleWhileRevalidate: swrs.length ? Math.min(...swrs) : undefined,
  }
}
