/**
 * A mapper's caching setup once the UIDL has been read and the defaults filled
 * in. `client` and `server` are independent — both layers may run at once.
 */
export interface ResolvedDataSourceCache {
  scope: string
  ttlSeconds: number
  client: boolean
  server: boolean
  /** `Cache-Control: s-maxage`. Zero unless a shared window was granted. */
  sMaxAge: number
  staleWhileRevalidate?: number
}

/**
 * Cache configuration as it reaches the emitters.
 *
 * Resolved per generated data-source FILE, not per array mapper: the
 * `utils/data-sources/<file>.js` module is shared by every mapper reading the
 * same `(type, table, dataSourceId)` triple, so two mappers on two pages must
 * agree on one server-side setup. See `mergeServerCacheOptions`.
 */
export interface DataSourceServerCacheOptions {
  /** `<dataSourceId>:<tableName>` — the unit of invalidation. */
  scope: string
  /** In-process TTL, seconds. `0` disables the server cache. */
  ttlSeconds: number
  /** `Cache-Control: s-maxage`, seconds. `0` keeps the response private. */
  sMaxAge?: number
  staleWhileRevalidate?: number
}
