import {
  generateDataSourceFetcher,
  generateDataSourceFetcherWithCore,
  getDataSourceDependencies,
} from '../src/data-source-fetchers'
import { validateDatabaseConfig } from '../src/validation'
import {
  validateMongoDBConfig,
  validateRedisConfig,
  validateRESTAPIConfig,
  validateJavaScriptConfig,
} from '../src/fetchers'
import {
  createPostgreSQLDataSource,
  createMySQLDataSource,
  createMongoDBDataSource,
  createRESTAPIDataSource,
  createJavaScriptDataSource,
  createRedisDataSource,
} from './mocks'

describe('getDataSourceDependencies', () => {
  it('returns correct dependencies for REST API', () => {
    const deps = getDataSourceDependencies('rest-api')
    expect(deps.packages).toContain('node-fetch')
    expect(deps.isDefaultImport).toBe(true)
  })

  it('returns correct dependencies for PostgreSQL', () => {
    const deps = getDataSourceDependencies('postgresql')
    expect(deps.packages).toContain('pg')
    expect(deps.isDefaultImport).toBe(false)
  })

  it('returns correct dependencies for MySQL', () => {
    const deps = getDataSourceDependencies('mysql')
    expect(deps.packages).toContain('mysql2')
  })

  it('returns correct dependencies for MongoDB', () => {
    const deps = getDataSourceDependencies('mongodb')
    expect(deps.packages).toContain('mongodb')
  })

  it('returns correct dependencies for Redis', () => {
    const deps = getDataSourceDependencies('redis')
    expect(deps.packages).toContain('redis')
  })

  it('returns empty dependencies for embedded sources', () => {
    expect(getDataSourceDependencies('javascript').packages).toEqual([])
    expect(getDataSourceDependencies('csv-file').packages).toEqual([])
  })

  it('handles all supported data source types', () => {
    const types = [
      'rest-api',
      'postgresql',
      'mysql',
      'mariadb',
      'amazon-redshift',
      'mongodb',
      'cockroachdb',
      'tidb',
      'redis',
      'firestore',
      'clickhouse',
      'airtable',
      'supabase',
      'turso',
      'javascript',
      'google-sheets',
      'csv-file',
    ]

    types.forEach((type) => {
      const deps = getDataSourceDependencies(type as any)
      expect(deps).toBeDefined()
      expect(Array.isArray(deps.packages)).toBe(true)
    })
  })
})

describe('validateDatabaseConfig', () => {
  it('validates correct database config', () => {
    const result = validateDatabaseConfig({
      host: 'localhost',
      port: 5432,
      user: 'testuser',
      password: 'testpass',
      database: 'testdb',
    })
    expect(result.isValid).toBe(true)
  })

  it('accepts username instead of user', () => {
    const result = validateDatabaseConfig({
      host: 'localhost',
      username: 'testuser',
      password: 'testpass',
      database: 'testdb',
    })
    expect(result.isValid).toBe(true)
  })

  it('rejects missing host', () => {
    const result = validateDatabaseConfig({
      port: 5432,
      user: 'testuser',
      password: 'testpass',
      database: 'testdb',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Host')
  })

  it('rejects invalid port', () => {
    const result = validateDatabaseConfig({
      host: 'localhost',
      port: 99999,
      user: 'testuser',
      password: 'testpass',
      database: 'testdb',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Port')
  })

  it('rejects missing password', () => {
    const result = validateDatabaseConfig({
      host: 'localhost',
      user: 'testuser',
      database: 'testdb',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Password')
  })

  it('rejects missing database', () => {
    const result = validateDatabaseConfig({
      host: 'localhost',
      user: 'testuser',
      password: 'testpass',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Database')
  })

  it('allows optional port', () => {
    const result = validateDatabaseConfig({
      host: 'localhost',
      user: 'testuser',
      password: 'testpass',
      database: 'testdb',
    })
    expect(result.isValid).toBe(true)
  })
})

describe('validateMongoDBConfig', () => {
  it('validates with connection string', () => {
    const result = validateMongoDBConfig({
      connectionString: 'mongodb://localhost:27017/testdb',
      database: 'testdb',
    })
    expect(result.isValid).toBe(true)
  })

  it('validates mongodb+srv protocol', () => {
    const result = validateMongoDBConfig({
      connectionString: 'mongodb+srv://cluster.mongodb.net/testdb',
      database: 'testdb',
    })
    expect(result.isValid).toBe(true)
  })

  it('validates with host/port', () => {
    const result = validateMongoDBConfig({
      host: 'localhost',
      port: 27017,
      database: 'testdb',
    })
    expect(result.isValid).toBe(true)
  })

  it('rejects invalid connection string', () => {
    const result = validateMongoDBConfig({
      connectionString: 'invalid://connection',
      database: 'testdb',
    })
    expect(result.isValid).toBe(false)
  })

  it('requires database field even with connection string', () => {
    const result = validateMongoDBConfig({
      connectionString: 'mongodb://localhost:27017/testdb',
      database: 'testdb',
    })
    expect(result.isValid).toBe(true)
  })

  it('accepts secret references in connection string', () => {
    const result = validateMongoDBConfig({
      connectionString: 'teleporthq.secrets.MONGO_CONNECTION',
      database: 'testdb',
    })
    expect(result.isValid).toBe(true)
  })
})

describe('validateRedisConfig', () => {
  it('validates with host', () => {
    const result = validateRedisConfig({
      host: 'localhost',
    })
    expect(result.isValid).toBe(true)
  })

  it('validates with connection string', () => {
    const result = validateRedisConfig({
      connectionString: 'redis://localhost:6379',
    })
    expect(result.isValid).toBe(true)
  })

  it('validates with rediss protocol', () => {
    const result = validateRedisConfig({
      connectionString: 'rediss://localhost:6379',
    })
    expect(result.isValid).toBe(true)
  })

  it('validates with secret reference', () => {
    const result = validateRedisConfig({
      connectionString: 'teleporthq.secrets.REDIS_CONNECTION',
    })
    expect(result.isValid).toBe(true)
  })

  it('rejects invalid connection string', () => {
    const result = validateRedisConfig({
      connectionString: 'invalid://localhost',
    })
    expect(result.isValid).toBe(false)
  })

  it('requires either host or connectionString', () => {
    const result = validateRedisConfig({
      port: 6379,
    })
    expect(result.isValid).toBe(false)
  })
})

describe('validateRESTAPIConfig', () => {
  it('validates correct REST API config', () => {
    const result = validateRESTAPIConfig({
      url: 'https://api.example.com/data',
      method: 'GET',
    })
    expect(result.isValid).toBe(true)
  })

  it('accepts all valid HTTP methods', () => {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
    methods.forEach((method) => {
      const result = validateRESTAPIConfig({
        url: 'https://api.example.com',
        method,
      })
      expect(result.isValid).toBe(true)
    })
  })

  it('rejects invalid URL', () => {
    const result = validateRESTAPIConfig({
      url: 'not-a-url',
    })
    expect(result.isValid).toBe(false)
  })

  it('rejects non-HTTP protocols', () => {
    const result = validateRESTAPIConfig({
      url: 'ftp://example.com',
    })
    expect(result.isValid).toBe(false)
  })

  it('rejects invalid HTTP method', () => {
    const result = validateRESTAPIConfig({
      url: 'https://api.example.com',
      method: 'INVALID',
    })
    expect(result.isValid).toBe(false)
  })
})

describe('validateJavaScriptConfig', () => {
  it('validates correct JavaScript config', () => {
    const result = validateJavaScriptConfig({
      code: '[{id: 1, name: "Item 1"}]',
    })
    expect(result.isValid).toBe(true)
  })

  it('rejects missing code', () => {
    const result = validateJavaScriptConfig({})
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('code')
  })

  it('rejects empty code', () => {
    const result = validateJavaScriptConfig({
      code: '',
    })
    expect(result.isValid).toBe(false)
  })

  it('warns about dangerous patterns but still validates', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

    const result = validateJavaScriptConfig({
      code: 'require("fs")',
    })

    expect(result.isValid).toBe(true)
    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
  })
})

describe('generateDataSourceFetcher', () => {
  it('generates PostgreSQL fetcher', () => {
    const dataSource = createPostgreSQLDataSource('ds-1')
    const code = generateDataSourceFetcher(dataSource, 'users')

    expect(code).toContain('import { Client } from')
    expect(code).toContain('export default async function handler')
    expect(code).toContain('SELECT * FROM "users"')
    expect(code).toContain('localhost')
  })

  it('generates MySQL fetcher', () => {
    const dataSource = createMySQLDataSource('ds-1')
    const code = generateDataSourceFetcher(dataSource, 'products')

    expect(code).toContain('mysql')
    expect(code).toContain('products')
    expect(code).toContain('FROM')
  })

  it('splits a comma-joined array_overlap destination into multiple ids (multi-category filter)', () => {
    const dataSource = createPostgreSQLDataSource('ds-1')
    const code = generateDataSourceFetcher(dataSource, 'teleport_products')

    // The multi-select Category Filter writes ?categoryFilter=a,b,c; the scalar
    // array_overlap branch splits it so jsonb_exists_any matches the union.
    expect(code).toContain('array_overlap')
    expect(code).toContain('jsonb_exists_any')
    expect(code).toContain("String(value).split(',')")
  })

  it('generates MongoDB fetcher', () => {
    const dataSource = createMongoDBDataSource('ds-1')
    const code = generateDataSourceFetcher(dataSource, 'orders')

    expect(code).toContain('MongoClient')
    expect(code).toContain("collection('orders')")
  })

  it('generates REST API fetcher', () => {
    const dataSource = createRESTAPIDataSource('ds-1')
    const code = generateDataSourceFetcher(dataSource, '')

    expect(code).toContain('fetch')
    expect(code).toContain('https://api.example.com/data')
  })

  it('generates JavaScript fetcher', () => {
    const dataSource = createJavaScriptDataSource('ds-1')
    const code = generateDataSourceFetcher(dataSource, '')

    expect(code).toContain('executeCode')
    expect(code).toContain('new Function')
  })

  it('generates Redis fetcher', () => {
    const dataSource = createRedisDataSource('ds-1')
    const code = generateDataSourceFetcher(dataSource, '')

    expect(code).toContain('redis')
    expect(code).toContain('createClient')
  })

  it('handles CockroachDB as PostgreSQL', () => {
    const dataSource = {
      id: 'ds-1',
      name: 'CockroachDB',
      type: 'cockroachdb' as const,
      config: {
        host: 'localhost',
        port: 26257,
        user: 'root',
        password: 'password',
        database: 'testdb',
      },
    }
    const code = generateDataSourceFetcher(dataSource, 'users')

    expect(code).toContain('Client')
  })

  it('handles TiDB as MySQL', () => {
    const dataSource = {
      id: 'ds-1',
      name: 'TiDB',
      type: 'tidb' as const,
      config: {
        host: 'localhost',
        port: 4000,
        user: 'root',
        password: 'password',
        database: 'testdb',
      },
    }
    const code = generateDataSourceFetcher(dataSource, 'users')

    expect(code).toContain('mysql')
  })

  it('throws error for invalid data source', () => {
    expect(() => {
      generateDataSourceFetcher(null as any, 'users')
    }).toThrow('Invalid data source')
  })

  it('throws error for missing type', () => {
    expect(() => {
      generateDataSourceFetcher({ config: {} } as any, 'users')
    }).toThrow('type is required')
  })

  it('throws error for missing config', () => {
    expect(() => {
      generateDataSourceFetcher({ type: 'postgresql' } as any, 'users')
    }).toThrow('config is required')
  })

  it('throws error for unsupported type', () => {
    expect(() => {
      generateDataSourceFetcher({ type: 'unsupported', config: {} } as any, 'users')
    }).toThrow('Unsupported data source type')
  })

  it('handles validation errors', () => {
    expect(() => {
      generateDataSourceFetcher(
        {
          type: 'postgresql',
          config: { host: '' },
        } as any,
        'users'
      )
    }).toThrow('validation failed')
  })
})

describe('generateDataSourceFetcherWithCore', () => {
  it('generates both fetchData and handler functions', () => {
    const dataSource = createPostgreSQLDataSource('ds-1')
    const code = generateDataSourceFetcherWithCore(dataSource, 'users')

    expect(code).toContain('async function fetchData')
    expect(code).toContain('async function handler')
    expect(code).toContain('export { fetchData, fetchCount, handler, getCount }')
    expect(code).toContain('export default { fetchData, fetchCount, handler, getCount }')
  })

  it('includes simulation of req/res for fetchData', () => {
    const dataSource = createPostgreSQLDataSource('ds-1')
    const code = generateDataSourceFetcherWithCore(dataSource, 'users')

    expect(code).toContain('const req = {')
    expect(code).toContain('query: params')
    expect(code).toContain('const res = {')
    expect(code).toContain('status: (code)')
    expect(code).toContain('json: (data)')
  })

  it('includes error handling in fetchData', () => {
    const dataSource = createPostgreSQLDataSource('ds-1')
    const code = generateDataSourceFetcherWithCore(dataSource, 'users')

    expect(code).toContain('if (statusCode !== 200')
    expect(code).toContain('throw new Error')
  })

  it('works with all data source types', () => {
    const dataSources = [
      createPostgreSQLDataSource('ds-1'),
      createMySQLDataSource('ds-2'),
      createMongoDBDataSource('ds-3'),
      createRESTAPIDataSource('ds-4'),
      createJavaScriptDataSource('ds-5'),
    ]

    dataSources.forEach((dataSource) => {
      const code = generateDataSourceFetcherWithCore(dataSource, 'test')
      expect(code).toContain('async function fetchData')
      expect(code).toContain('async function handler')
    })
  })
})
