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
  generateStaticCollectionFetcher,
  validateStaticCollectionConfig,
  generateGoogleSheetsFetcher,
  validateGoogleSheetsConfig,
} from './fetchers'
import { validateDatabaseConfig } from './validation'
import { generateCountFetcher } from './count-fetchers'

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
    'static-collection': { packages: [], isDefaultImport: false },
  }

  return dependencyMap[type]
}

export function generateDataSourceFetcher(dataSource: UIDLDataSource, tableName: string): string {
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
        return generatePostgreSQLFetcher(config, tableName)
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
          return generatePostgreSQLFetcher(config, tableName)
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

      case 'static-collection': {
        const validation = validateStaticCollectionConfig(config)
        if (!validation.isValid) {
          throw new Error(`Static collection config validation failed: ${validation.error}`)
        }
        return generateStaticCollectionFetcher(config)
      }

      case 'google-sheets': {
        const validation = validateGoogleSheetsConfig(config)
        if (!validation.isValid) {
          throw new Error(`Google Sheets config validation failed: ${validation.error}`)
        }
        return generateGoogleSheetsFetcher(config)
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
  isApiRoute: boolean = false
): string {
  const apiHandler = generateDataSourceFetcher(dataSource, tableName)

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

  // Generate count fetcher code and extract its imports
  const countFetcherCode = generateCountFetcher(dataSource, tableName)
  const countImports = countFetcherCode.match(importRegex) || []
  const countFetcherWithoutImports = countFetcherCode.replace(importRegex, '').trim()

  // Combine and deduplicate imports
  const allImports = Array.from(new Set([...imports, ...countImports]))

  // For API routes, export just the handler function
  // For utils files, export the full object with all functions
  const exports = isApiRoute
    ? 'export default handler'
    : `export { fetchData, fetchCount, handler, getCount }
export default { fetchData, fetchCount, handler, getCount }`

  return `${allImports.join('\n')}

async function fetchData(params = {}) {
  const req = {
    query: params,
    method: 'GET',
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
  
  await handler(req, res)
  
  if (statusCode !== 200 || !result || !result.success) {
    throw new Error(result?.error || 'Failed to fetch data')
  }
  
  return result.data
}

async function fetchCount(params = {}) {
  const req = {
    query: params,
    method: 'GET',
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
  
  await getCount(req, res)
  
  if (statusCode !== 200 || !result || !result.success) {
    throw new Error(result?.error || 'Failed to get count')
  }
  
  return result.count
}

${countFetcherWithoutImports}

${handlerWithoutImports}

${exports}
`
}
