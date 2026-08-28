/**
 * Shared constants for the generated data cache.
 *
 * Lives in `teleport-shared` because two generators emit against it — the
 * array-mapper plugin (`teleport-plugin-next-data-source`) and the workflow
 * cache nodes (`teleport-plugin-next-workflows`) — and they must agree on the
 * key format or one would never read what the other wrote.
 */

/** Table the platform provisions to hold per-scope invalidation versions. */
export const CACHE_VERSIONS_TABLE = 'teleport_cache_versions'

/** Emitted runtime paths, relative to the generated project root. */
export const CACHE_RUNTIME_DIR = ['utils', 'tq-cache']
export const CACHE_CLIENT_MODULE = 'client'
export const CACHE_SERVER_MODULE = 'server'
export const CACHE_VERSION_STORE_MODULE = 'version-store'

/** Emitted API routes. */
export const CACHE_API_DIR = ['pages', 'api', 'tq-cache']
export const CACHE_VERSION_ROUTE = 'version'
export const CACHE_INVALIDATE_ROUTE = 'invalidate'

/** Env var holding the shared secret the invalidate route requires. */
export const CACHE_SECRET_ENV = 'TQ_CACHE_SECRET'

export const DEFAULT_CACHE_TTL_SECONDS = 300

/**
 * How long a serverless instance may reuse a version it already read.
 *
 * This is the invalidation latency floor: after a write bumps the row, an
 * instance keeps serving its existing entries until its memoised version goes
 * stale. Ten seconds keeps the database cost to at most one trivial single-row
 * read per instance per ten seconds while staying well inside "the merchant
 * edited a product and refreshed the shop".
 */
export const VERSION_MEMO_MS = 10_000

/** Per-process entry cap. Bounded because list payloads are unbounded. */
export const SERVER_MAX_ENTRIES = 200

/** Per-tab entry cap for the browser cache. */
export const CLIENT_MAX_ENTRIES = 60

/**
 * One browser entry may not exceed this, or a single very large list would
 * evict everything else in the tab on its way into storage.
 */
export const CLIENT_MAX_ENTRY_BYTES = 262_144

/**
 * Data sources the emitted version store can actually reach.
 *
 * Only `teleport`. The emitted client is the shared `generatePgClientCode`
 * boilerplate, which connects through the `TELEPORT_DB_*` environment — the
 * platform's own database. A project whose only database is the user's own
 * Postgres has no such credentials, so its version store would be a no-op that
 * silently degrades to TTL-only expiry.
 *
 * Widening this list means teaching the version store to build a client from an
 * arbitrary data source's config FIRST. Until then it stays honest: the
 * inspector reads the matching list in the GUI to decide whether to promise
 * automatic invalidation, and promising it here without delivering it would be
 * worse than the TTL fallback it replaces.
 */
export const VERSION_STORE_TYPES = ['teleport']

/** `<dataSourceId>:<tableName>` — the unit of invalidation. */
export const cacheScopeFor = (dataSourceId: string, tableName: string): string =>
  `${dataSourceId}:${tableName}`

/** The count endpoint caches under its own sub-scope but the SAME version. */
export const countScopeFor = (scope: string): string => `${scope}:count`
