import { DataSourceType, UIDLDataSource } from '@teleporthq/teleport-types'
import {
  generatePostgreSQLFetcher,
  generateMySQLFetcher,
  generateMariaDBFetcher,
  generateRedshiftFetcher,
  generateMongoDBFetcher,
  validateMongoDBConfig,
  generateRedisFetcher,
  validateRedisConfig,
  generateFirestoreFetcher,
  validateFirestoreConfig,
  generateClickHouseFetcher,
  validateClickHouseConfig,
  generateAirtableFetcher,
  validateAirtableConfig,
  generateSupabaseFetcher,
  validateSupabaseConfig,
  generateTursoFetcher,
  validateTursoConfig,
  generateRESTAPIFetcher,
  validateRESTAPIConfig,
  generateJavaScriptFetcher,
  validateJavaScriptConfig,
  generateCSVFileFetcher,
  validateCSVConfig,
  generateGoogleSheetsFetcher,
  validateGoogleSheetsConfig,
  generateTeleportFetcher,
  validateTeleportConfig,
  generateRawQueryFetcher,
  parseQueryTemplateVariables,
} from './fetchers'
import { validateDatabaseConfig } from './validation'
import { generateCountFetcher } from './count-fetchers'
import type { EntityTransformOptions } from './transformations'
import { DataCache, DataExposure, TableAccess } from '@teleporthq/teleport-shared'
import type { DataSourceServerCacheOptions } from './cache/types'
import { isViewDependentTable } from './fetchers/utils/browser-row-policy'
import {
  guardExternalDriverCount,
  guardExternalDriverModule,
} from './fetchers/utils/external-read-guard'
import { schemaOf } from './fetchers/utils/table-access-guard'

export { generateRawQueryFetcher, parseQueryTemplateVariables }

interface DataSourceFetcherDependencies {
  packages: string[]
  isDefaultImport?: boolean
}

export const isSupabaseConnectionStringFallback = (config: Record<string, unknown>): boolean => {
  return !!config?.connectionString && !config?.supabaseUrl
}

export const getDataSourceDependencies = (
  type: DataSourceType,
  config?: Record<string, unknown>
): DataSourceFetcherDependencies => {
  // Supabase with connectionString falls back to pg driver
  if (type === 'supabase' && config && isSupabaseConnectionStringFallback(config)) {
    return { packages: ['pg'], isDefaultImport: false }
  }

  const dependencyMap: Record<DataSourceType, DataSourceFetcherDependencies> = {
    'rest-api': { packages: ['node-fetch'], isDefaultImport: true },
    postgresql: { packages: ['pg'], isDefaultImport: false },
    mysql: { packages: ['mysql2'], isDefaultImport: false },
    mariadb: { packages: ['mariadb'], isDefaultImport: false },
    'amazon-redshift': { packages: ['pg'], isDefaultImport: false },
    mongodb: { packages: ['mongodb'], isDefaultImport: false },
    cockroachdb: { packages: ['pg'], isDefaultImport: false },
    tidb: { packages: ['mysql2'], isDefaultImport: false },
    redis: { packages: ['redis'], isDefaultImport: false },
    firestore: { packages: ['firebase-admin'], isDefaultImport: false },
    clickhouse: { packages: ['@clickhouse/client'], isDefaultImport: false },
    airtable: { packages: ['node-fetch'], isDefaultImport: true },
    supabase: { packages: ['@supabase/supabase-js'], isDefaultImport: false },
    turso: { packages: ['@libsql/client'], isDefaultImport: false },
    javascript: { packages: [], isDefaultImport: false },
    'google-sheets': { packages: ['node-fetch'], isDefaultImport: true },
    'csv-file': { packages: [], isDefaultImport: false },
    teleport: { packages: ['pg'], isDefaultImport: false },
  }

  return dependencyMap[type]
}

/**
 * Whether the driver's read route carries the table-access guard inline (the
 * TeleportHQ and Postgres-family fetchers); every other driver is wrapped by
 * `guardExternalDriverModule`.
 */
const hasInlineReadGuard = (dataSource: UIDLDataSource): boolean =>
  dataSource.type === 'teleport' ||
  dataSource.type === 'postgresql' ||
  dataSource.type === 'cockroachdb' ||
  (dataSource.type === 'supabase' && isSupabaseConnectionStringFallback(dataSource.config))

/**
 * The read route of `tableName` over `dataSource`: its driver's fetcher, behind
 * the read guard (see `fetchers/utils/table-access-guard.ts`).
 */
export function generateDataSourceFetcher(
  dataSource: UIDLDataSource,
  tableName: string,
  transformOptions: EntityTransformOptions = {}
): string {
  const routeExposure = routeExposureOf(dataSource, tableName, transformOptions)
  const driverCode = generateDriverFetcher(dataSource, tableName, {
    ...transformOptions,
    routeExposure,
  })
  if (hasInlineReadGuard(dataSource)) {
    return driverCode
  }
  return guardExternalDriverModule(driverCode, {
    tableName,
    dataSourceType: dataSource.type,
    exposure: routeExposure,
    trustedReaderRoles: transformOptions.trustedReaderRoles || [],
    schema: schemaOf(dataSource.config, tableName),
    reader: transformOptions,
  })
}

/** The exposure of the route of `tableName` over `dataSource` (by source id and table). */
const routeExposureOf = (
  dataSource: UIDLDataSource,
  tableName: string,
  transformOptions: EntityTransformOptions
) =>
  transformOptions.routeExposure ||
  DataExposure.readExposureFor(transformOptions.dataExposure, {
    tableName,
    dataSourceId: dataSource && dataSource.id,
    dataSourceType: dataSource && dataSource.type,
  })

function generateDriverFetcher(
  dataSource: UIDLDataSource,
  tableName: string,
  transformOptions: EntityTransformOptions = {}
): string {
  if (!dataSource || typeof dataSource !== 'object') {
    throw new Error('Invalid data source: data source must be a valid object')
  }

  const { type, config } = dataSource

  if (!type || typeof type !== 'string') {
    throw new Error('Invalid data source: type is required and must be a string')
  }

  if (!config || typeof config !== 'object') {
    throw new Error(`Invalid data source: config is required for ${type}`)
  }

  try {
    switch (type) {
      case 'postgresql':
      case 'cockroachdb': {
        const validation = validateDatabaseConfig(config)
        if (!validation.isValid) {
          throw new Error(`PostgreSQL/CockroachDB config validation failed: ${validation.error}`)
        }
        return generatePostgreSQLFetcher(
          config,
          tableName,
          transformOptions.trustedReaderRoles,
          transformOptions.dataExposure,
          transformOptions.routeExposure,
          transformOptions
        )
      }

      case 'mysql':
      case 'tidb': {
        const validation = validateDatabaseConfig(config)
        if (!validation.isValid) {
          throw new Error(`MySQL/TiDB config validation failed: ${validation.error}`)
        }
        return generateMySQLFetcher(config, tableName)
      }

      case 'mariadb': {
        const validation = validateDatabaseConfig(config)
        if (!validation.isValid) {
          throw new Error(`MariaDB config validation failed: ${validation.error}`)
        }
        return generateMariaDBFetcher(config, tableName)
      }

      case 'amazon-redshift': {
        const validation = validateDatabaseConfig(config)
        if (!validation.isValid) {
          throw new Error(`Amazon Redshift config validation failed: ${validation.error}`)
        }
        return generateRedshiftFetcher(config, tableName)
      }

      case 'mongodb': {
        const validation = validateMongoDBConfig(config)
        if (!validation.isValid) {
          throw new Error(`MongoDB config validation failed: ${validation.error}`)
        }
        return generateMongoDBFetcher(config, tableName)
      }

      case 'redis': {
        const validation = validateRedisConfig(config)
        if (!validation.isValid) {
          throw new Error(`Redis config validation failed: ${validation.error}`)
        }
        return generateRedisFetcher(config)
      }

      case 'firestore': {
        const validation = validateFirestoreConfig(config)
        if (!validation.isValid) {
          throw new Error(`Firestore config validation failed: ${validation.error}`)
        }
        return generateFirestoreFetcher(config, tableName)
      }

      case 'clickhouse': {
        const validation = validateClickHouseConfig(config)
        if (!validation.isValid) {
          throw new Error(`ClickHouse config validation failed: ${validation.error}`)
        }
        return generateClickHouseFetcher(config, tableName)
      }

      case 'airtable': {
        const validation = validateAirtableConfig(config)
        if (!validation.isValid) {
          throw new Error(`Airtable config validation failed: ${validation.error}`)
        }
        return generateAirtableFetcher(config, tableName)
      }

      case 'supabase': {
        // Fall back to PostgreSQL driver when connectionString is provided without supabaseUrl
        if (isSupabaseConnectionStringFallback(config)) {
          const pgValidation = validateDatabaseConfig(config)
          if (!pgValidation.isValid) {
            throw new Error(
              `Supabase (PostgreSQL fallback) config validation failed: ${pgValidation.error}`
            )
          }
          return generatePostgreSQLFetcher(
            config,
            tableName,
            transformOptions.trustedReaderRoles,
            transformOptions.dataExposure,
            transformOptions.routeExposure,
            transformOptions
          )
        }

        const validation = validateSupabaseConfig(config)
        if (!validation.isValid) {
          throw new Error(`Supabase config validation failed: ${validation.error}`)
        }
        return generateSupabaseFetcher(config, tableName)
      }

      case 'turso': {
        const validation = validateTursoConfig(config)
        if (!validation.isValid) {
          throw new Error(`Turso config validation failed: ${validation.error}`)
        }
        return generateTursoFetcher(config, tableName)
      }

      case 'rest-api': {
        const validation = validateRESTAPIConfig(config)
        if (!validation.isValid) {
          throw new Error(`REST API config validation failed: ${validation.error}`)
        }
        return generateRESTAPIFetcher(config)
      }

      case 'javascript': {
        const validation = validateJavaScriptConfig(config)
        if (!validation.isValid) {
          throw new Error(`JavaScript config validation failed: ${validation.error}`)
        }
        return generateJavaScriptFetcher(config)
      }

      case 'csv-file': {
        const validation = validateCSVConfig(config)
        if (!validation.isValid) {
          throw new Error(`CSV config validation failed: ${validation.error}`)
        }
        return generateCSVFileFetcher(config)
      }

      case 'google-sheets': {
        const validation = validateGoogleSheetsConfig(config)
        if (!validation.isValid) {
          throw new Error(`Google Sheets config validation failed: ${validation.error}`)
        }
        return generateGoogleSheetsFetcher(config)
      }

      case 'teleport': {
        const validation = validateTeleportConfig(config)
        if (!validation.isValid) {
          throw new Error(`Teleport config validation failed: ${validation.error}`)
        }
        return generateTeleportFetcher(config, tableName, transformOptions)
      }

      default:
        throw new Error(`Unsupported data source type: ${type}`)
    }
  } catch (error) {
    // Re-throw with more context
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Failed to generate fetcher for ${type}: ${errorMessage}`)
  }
}

/**
 * Generates a fetcher with both a core fetchData function (for server-side use in getStaticProps)
 * and an API handler (for client-side use)
 */
export function generateDataSourceFetcherWithCore(
  dataSource: UIDLDataSource,
  tableName: string,
  isApiRoute: boolean = false,
  transformOptions: EntityTransformOptions = {},
  cacheOptions?: DataSourceServerCacheOptions
): string {
  // A row-owned page's read answers each session its own rows: nothing about
  // it may be cached for another (see DataReadExposure.ownerRules).
  const ownedExposure = routeExposureOf(dataSource, tableName, transformOptions)
  const routeCacheOptions =
    ownedExposure.public || ownedExposure.anySession || !(ownedExposure.ownerRules || []).length
      ? cacheOptions
      : undefined
  const apiHandler = generateDataSourceFetcher(dataSource, tableName, transformOptions)

  // Extract the handler function body from the API route
  // The API route is structured as: export default async function handler(req, res) { ... }
  // We need to create a fetchData function that can be called directly

  // Remove "export default" from the handler and make it a regular function
  const handlerCode = apiHandler.replace(
    'export default async function handler',
    'async function handler'
  )

  // Extract imports from handlerCode (they should be at the top)
  const importRegex = /^import\s+.*?$/gm
  const imports = handlerCode.match(importRegex) || []
  const handlerWithoutImports = handlerCode.replace(importRegex, '').trim()

  // Generate count fetcher code and extract its imports. An external driver's
  // count runs behind the same guard as its rows.
  const driverCountCode = generateCountFetcher(dataSource, tableName)
  const countFetcherCode = hasInlineReadGuard(dataSource)
    ? driverCountCode
    : guardExternalDriverCount(driverCountCode)
  const countImports = countFetcherCode.match(importRegex) || []
  const countFetcherWithoutImports = countFetcherCode.replace(importRegex, '').trim()

  // Combine and deduplicate imports
  const allImports = Array.from(new Set([...imports, ...countImports]))

  // Caching is applied HERE rather than in the API route because four separate
  // places emit an `api/<file>` route and a fifth path (`getStaticProps` →
  // `fetchData` → `handler`) never goes through a route at all. Wrapping the
  // module's exports is the one point that covers all five, and leaves every
  // route emitter untouched.
  //
  // The import depth differs by destination: this module is written to
  // `utils/data-sources/` normally, but the `isApiRoute` variant is inlined
  // straight into `pages/api/`.
  const cachePreamble = routeCacheOptions
    ? `import { tqWithCache } from '${isApiRoute ? '../../' : '../'}tq-cache/server'`
    : ''
  // A module carrying the browser row policy (the Postgres-family routes) keys
  // its cache by who is reading; see `__tqCacheByView` below.
  const splitsCacheByView = handlerCode.indexOf('function __brpSharesPublicView(') !== -1
  // Only a table every visitor may read can sit in a shared (CDN) cache, and a
  // table only some sessions may read is checked BEFORE the cache: a cached
  // answer never reaches a visitor the route itself would refuse.
  const routeExposure = routeExposureOf(dataSource, tableName, transformOptions)
  const routeIsPublic = routeExposure.public
  const sharedCacheSeconds = (seconds: number | undefined): number =>
    routeIsPublic ? seconds || 0 : 0

  const cacheWiring = routeCacheOptions
    ? `
const __tqDataCache = ${JSON.stringify({
        scope: routeCacheOptions.scope,
        ttl: routeCacheOptions.ttlSeconds,
        sMaxAge: sharedCacheSeconds(routeCacheOptions.sMaxAge),
        swr: sharedCacheSeconds(routeCacheOptions.staleWhileRevalidate),
      })}
const __tqCountCache = ${JSON.stringify({
        scope: DataCache.countScopeFor(routeCacheOptions.scope),
        // Its OWN keyspace, but the DATA scope's version row. A write bumps one
        // row; if the count kept a separate version nothing would ever bump it,
        // and the total would stay stale after every create and delete — the
        // grid showing one more row than the pager counts.
        versionScope: routeCacheOptions.scope,
        ttl: routeCacheOptions.ttlSeconds,
        sMaxAge: sharedCacheSeconds(routeCacheOptions.sMaxAge),
        swr: sharedCacheSeconds(routeCacheOptions.staleWhileRevalidate),
      })}

${
  splitsCacheByView
    ? `// The store's own server code and its administrators may be served rows a
// visitor is not (see __brpSharesPublicView), so they read and fill a cache of
// their own — one never marked for a shared (CDN) cache either.
const __tqViewDependent = ${JSON.stringify(
        isViewDependentTable(tableName, [
          ...TableAccess.PROTECTED_TABLES,
          ...Object.keys(TableAccess.PUBLIC_FEED_TABLES),
        ])
      )}
function __tqCacheByView(fn, opts) {
  const publicView = tqWithCache(fn, opts)
  const trustedView = tqWithCache(fn, Object.assign({}, opts, {
    scope: opts.scope + ':trusted',
    versionScope: opts.versionScope || opts.scope,
    sMaxAge: 0,
    swr: 0,
  }))
  // The app's own server code reads whole tables; a browser's read is capped
  // (__taReadWindow). Neither is ever served the other's answer.
  const serverView = tqWithCache(fn, Object.assign({}, opts, {
    scope: opts.scope + ':server',
    versionScope: opts.versionScope || opts.scope,
    sMaxAge: 0,
    swr: 0,
  }))
  return async function (req, res) {
    if (__taIsInternalRequest(req)) return serverView(req, res)
    return (await __brpSharesPublicView(req, __tqViewDependent)) ? publicView(req, res) : trustedView(req, res)
  }
}
${
  routeIsPublic
    ? ''
    : `
// Readable only by some sessions (see __TA_ROUTE_EXPOSURE): the session is
// checked before any cached answer is handed out.
function __tqExposureFirst(fn) {
  return async function (req, res) {
    const __denied = await __taGuardExposure(req)
    if (__denied) {
      return res.status(__denied.status).json({ success: false, error: __denied.message, timestamp: Date.now() })
    }
    return fn(req, res)
  }
}
`
}
const cachedHandler = ${
        routeIsPublic
          ? '__tqCacheByView(handler, __tqDataCache)'
          : '__tqExposureFirst(__tqCacheByView(handler, __tqDataCache))'
      }
const cachedGetCount = ${
        routeIsPublic
          ? '__tqCacheByView(getCount, __tqCountCache)'
          : '__tqExposureFirst(__tqCacheByView(getCount, __tqCountCache))'
      }`
    : `const cachedHandler = tqWithCache(handler, __tqDataCache)
const cachedGetCount = tqWithCache(getCount, __tqCountCache)`
}
`
    : ''

  const handlerExport = routeCacheOptions ? 'cachedHandler' : 'handler'
  const countExport = routeCacheOptions ? 'cachedGetCount' : 'getCount'

  // For API routes, export just the handler function
  // For utils files, export the full object with all functions
  //
  // The uncached branch is spelled out verbatim rather than interpolated, so an
  // uncached project keeps generating byte-identical output — `handler as
  // handler` would be harmless at runtime and still a diff in every snapshot.
  const exports = !routeCacheOptions
    ? isApiRoute
      ? 'export default handler'
      : `export { fetchData, fetchCount, handler, getCount }
export default { fetchData, fetchCount, handler, getCount }`
    : isApiRoute
    ? `export default ${handlerExport}`
    : `export { fetchData, fetchCount, ${handlerExport} as handler, ${countExport} as getCount }
export default { fetchData, fetchCount, handler: ${handlerExport}, getCount: ${countExport} }`

  return `${[...allImports, cachePreamble].filter(Boolean).join('\n')}

async function fetchData(params = {}) {
  // A server-side call from this process (getStaticProps, a page-load
  // workflow): the money-table guard trusts the marker, which no HTTP request
  // can carry.
  const req = {
    query: params,
    method: 'GET',
    __tqServerCall: true,
  }
  
  let result = null
  let statusCode = 200
  
  const res = {
    status: (code) => {
      statusCode = code
      return res
    },
    json: (data) => {
      result = data
      return res
    },
  }
  
  await ${handlerExport}(req, res)
  
  if (statusCode !== 200 || !result || !result.success) {
    throw new Error(result?.error || 'Failed to fetch data')
  }
  
  return result.data
}

async function fetchCount(params = {}) {
  const req = {
    query: params,
    method: 'GET',
    __tqServerCall: true,
  }
  
  let result = null
  let statusCode = 200
  
  const res = {
    status: (code) => {
      statusCode = code
      return res
    },
    json: (data) => {
      result = data
      return res
    },
  }
  
  await ${countExport}(req, res)
  
  if (statusCode !== 200 || !result || !result.success) {
    throw new Error(result?.error || 'Failed to get count')
  }
  
  return result.count
}

${countFetcherWithoutImports}

${handlerWithoutImports}
${cacheWiring}
${exports}
`
}
