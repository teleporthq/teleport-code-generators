import {
  sanitizeFileName,
  isNonEmptyString,
  validateResourceDefinition,
  validateNodeContent,
  validateDataSourceConfig,
  generateSafeFileName,
  isEmbeddedDataSource,
  replaceSecretReference,
  sanitizeNumericParam,
  sanitizePort,
  isValidUrl,
  sanitizeIdentifier,
} from '../src/utils'

describe('sanitizeFileName', () => {
  it('removes path traversal attempts', () => {
    expect(sanitizeFileName('../../../etc/passwd')).toBe('etc-passwd')
    expect(sanitizeFileName('..\\..\\windows')).toBe('windows')
  })

  it('removes invalid filename characters', () => {
    expect(sanitizeFileName('file<>:"|?*name')).toBe('filename')
    expect(sanitizeFileName('test\x00\x1Ffile')).toBe('testfile')
  })

  it('replaces spaces with dashes', () => {
    expect(sanitizeFileName('my file name')).toBe('my-file-name')
    expect(sanitizeFileName('multiple   spaces')).toBe('multiple-spaces')
  })

  it('removes leading/trailing dashes and dots', () => {
    expect(sanitizeFileName('---file---')).toBe('file')
    expect(sanitizeFileName('...file...')).toBe('file')
    expect(sanitizeFileName('_-file-_')).toBe('file')
  })

  it('limits length to 200 characters', () => {
    const longString = 'a'.repeat(300)
    expect(sanitizeFileName(longString).length).toBe(200)
  })

  it('returns "unknown" for invalid input', () => {
    expect(sanitizeFileName('')).toBe('unknown')
    expect(sanitizeFileName(null as any)).toBe('unknown')
    expect(sanitizeFileName(undefined as any)).toBe('unknown')
    expect(sanitizeFileName(123 as any)).toBe('unknown')
  })

  it('handles normal filenames correctly', () => {
    expect(sanitizeFileName('my-file-name')).toBe('my-file-name')
    expect(sanitizeFileName('postgresql-users-12345678')).toBe('postgresql-users-12345678')
  })
})

describe('isNonEmptyString', () => {
  it('returns true for non-empty strings', () => {
    expect(isNonEmptyString('hello')).toBe(true)
    expect(isNonEmptyString('test')).toBe(true)
  })

  it('returns false for empty or whitespace strings', () => {
    expect(isNonEmptyString('')).toBe(false)
    expect(isNonEmptyString('   ')).toBe(false)
    expect(isNonEmptyString('\t\n')).toBe(false)
  })

  it('returns false for non-string values', () => {
    expect(isNonEmptyString(null)).toBe(false)
    expect(isNonEmptyString(undefined)).toBe(false)
    expect(isNonEmptyString(123)).toBe(false)
    expect(isNonEmptyString({})).toBe(false)
  })
})

describe('validateResourceDefinition', () => {
  it('validates a correct resource definition', () => {
    const result = validateResourceDefinition({
      dataSourceId: 'ds-123',
      tableName: 'users',
      dataSourceType: 'postgresql',
    })
    expect(result.isValid).toBe(true)
  })

  it('rejects missing or invalid input', () => {
    expect(validateResourceDefinition(null).isValid).toBe(false)
    expect(validateResourceDefinition(undefined).isValid).toBe(false)
    expect(validateResourceDefinition('string').isValid).toBe(false)
  })

  it('rejects missing dataSourceId', () => {
    const result = validateResourceDefinition({
      tableName: 'users',
      dataSourceType: 'postgresql',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Data source ID')
  })

  it('rejects missing dataSourceType', () => {
    const result = validateResourceDefinition({
      dataSourceId: 'ds-123',
      tableName: 'users',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Data source type')
  })

  it('rejects invalid dataSourceType', () => {
    const result = validateResourceDefinition({
      dataSourceId: 'ds-123',
      tableName: 'users',
      dataSourceType: 'invalid-type',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Invalid data source type')
  })

  it('accepts all valid data source types', () => {
    const validTypes = [
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
      'static-collection',
    ]

    validTypes.forEach((type) => {
      const result = validateResourceDefinition({
        dataSourceId: 'ds-123',
        dataSourceType: type,
      })
      expect(result.isValid).toBe(true)
    })
  })

  it('allows missing tableName', () => {
    const result = validateResourceDefinition({
      dataSourceId: 'ds-123',
      dataSourceType: 'rest-api',
    })
    expect(result.isValid).toBe(true)
  })

  it('rejects invalid tableName when provided', () => {
    const result = validateResourceDefinition({
      dataSourceId: 'ds-123',
      dataSourceType: 'postgresql',
      tableName: '',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Table name')
  })
})

describe('validateNodeContent', () => {
  it('validates correct node content', () => {
    const result = validateNodeContent({
      resourceDefinition: {
        dataSourceId: 'ds-123',
        dataSourceType: 'postgresql',
      },
    })
    expect(result.isValid).toBe(true)
  })

  it('rejects missing or invalid input', () => {
    expect(validateNodeContent(null).isValid).toBe(false)
    expect(validateNodeContent(undefined).isValid).toBe(false)
  })

  it('rejects missing resourceDefinition', () => {
    const result = validateNodeContent({})
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Resource definition')
  })
})

describe('validateDataSourceConfig', () => {
  it('validates correct data source config', () => {
    const result = validateDataSourceConfig({
      id: 'ds-123',
      name: 'Test DS',
      type: 'postgresql',
      config: { host: 'localhost' },
    } as any)
    expect(result.isValid).toBe(true)
  })

  it('rejects missing or invalid input', () => {
    expect(validateDataSourceConfig(null as any).isValid).toBe(false)
    expect(validateDataSourceConfig(undefined as any).isValid).toBe(false)
  })

  it('rejects missing id', () => {
    const result = validateDataSourceConfig({
      type: 'postgresql',
      config: {},
    } as any)
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Data source ID')
  })

  it('rejects missing type', () => {
    const result = validateDataSourceConfig({
      id: 'ds-123',
      config: {},
    } as any)
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Data source type')
  })

  it('rejects missing or invalid config', () => {
    const result = validateDataSourceConfig({
      id: 'ds-123',
      type: 'postgresql',
    } as any)
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('config')
  })
})

describe('generateSafeFileName', () => {
  it('generates safe filenames from components', () => {
    const result = generateSafeFileName('postgresql', 'users', 'abcd1234-efgh-5678')
    expect(result).toContain('postgresql')
    expect(result).toContain('users')
    expect(result).toContain('abcd1234')
  })

  it('handles missing tableName', () => {
    const result = generateSafeFileName('rest-api', '', 'ds-12345678')
    expect(result).toContain('data')
    expect(result).toContain('rest-api')
  })

  it('converts to dash case', () => {
    const result = generateSafeFileName('PostgreSQL', 'UsersTable', 'DS123')
    expect(result).toMatch(/^[a-z0-9-]+$/)
  })

  it('limits ID to 8 characters', () => {
    const result = generateSafeFileName('postgresql', 'users', 'verylongidentifier123456')
    expect(result).toContain('verylong')
  })
})

describe('isEmbeddedDataSource', () => {
  it('identifies embedded data sources', () => {
    expect(isEmbeddedDataSource('javascript')).toBe(true)
    expect(isEmbeddedDataSource('csv-file')).toBe(true)
    expect(isEmbeddedDataSource('static-collection')).toBe(true)
  })

  it('identifies non-embedded data sources', () => {
    expect(isEmbeddedDataSource('postgresql')).toBe(false)
    expect(isEmbeddedDataSource('rest-api')).toBe(false)
    expect(isEmbeddedDataSource('mongodb')).toBe(false)
  })
})

describe('replaceSecretReference', () => {
  describe('with templateLiteral = false (default)', () => {
    it('replaces secret references with process.env', () => {
      const result = replaceSecretReference('teleporthq.secrets.API_KEY')
      expect(result).toBe('process.env.API_KEY')
    })

    it('validates environment variable names', () => {
      const result = replaceSecretReference('teleporthq.secrets.VALID_ENV_VAR_123')
      expect(result).toBe('process.env.VALID_ENV_VAR_123')
    })

    it('handles invalid env var names as regular strings', () => {
      const result = replaceSecretReference('teleporthq.secrets.123-invalid')
      expect(result).toBe('"teleporthq.secrets.123-invalid"')
    })

    it('stringifies regular strings', () => {
      expect(replaceSecretReference('regular-string')).toBe('"regular-string"')
    })

    it('handles null', () => {
      expect(replaceSecretReference(null)).toBe('null')
    })

    it('handles undefined', () => {
      expect(replaceSecretReference(undefined)).toBe('undefined')
    })

    it('stringifies non-string values', () => {
      expect(replaceSecretReference(123)).toBe('123')
      expect(replaceSecretReference(true)).toBe('true')
      expect(replaceSecretReference({ key: 'value' })).toBe('{"key":"value"}')
    })
  })

  describe('with templateLiteral = true', () => {
    it('replaces secret references for template literals', () => {
      const result = replaceSecretReference('teleporthq.secrets.API_KEY', { templateLiteral: true })
      expect(result).toBe(`\${process.env.API_KEY}`)
    })

    it('still stringifies regular strings', () => {
      const result = replaceSecretReference('regular-string', { templateLiteral: true })
      expect(result).toBe('"regular-string"')
    })
  })
})

describe('sanitizeNumericParam', () => {
  it('returns valid numbers', () => {
    expect(sanitizeNumericParam(10)).toBe(10)
    expect(sanitizeNumericParam(0)).toBe(0)
    expect(sanitizeNumericParam(100.5)).toBe(100)
  })

  it('floors decimal numbers', () => {
    expect(sanitizeNumericParam(10.9)).toBe(10)
    expect(sanitizeNumericParam(5.1)).toBe(5)
  })

  it('returns 0 for negative numbers', () => {
    expect(sanitizeNumericParam(-5)).toBe(0)
    expect(sanitizeNumericParam(-100)).toBe(0)
  })

  it('parses string numbers', () => {
    expect(sanitizeNumericParam('10')).toBe(10)
    expect(sanitizeNumericParam('100')).toBe(100)
  })

  it('returns default for invalid values', () => {
    expect(sanitizeNumericParam('invalid')).toBe(0)
    expect(sanitizeNumericParam(NaN)).toBe(0)
    expect(sanitizeNumericParam(Infinity)).toBe(0)
    expect(sanitizeNumericParam(null)).toBe(0)
  })

  it('uses custom default value', () => {
    expect(sanitizeNumericParam('invalid', 42)).toBe(42)
    expect(sanitizeNumericParam(null, 100)).toBe(100)
  })
})

describe('sanitizePort', () => {
  it('returns valid ports', () => {
    expect(sanitizePort(3000, 8080)).toBe(3000)
    expect(sanitizePort(65535, 8080)).toBe(65535)
    expect(sanitizePort(1, 8080)).toBe(1)
  })

  it('returns default for invalid port ranges', () => {
    expect(sanitizePort(0, 8080)).toBe(8080)
    expect(sanitizePort(65536, 8080)).toBe(8080)
    expect(sanitizePort(-100, 8080)).toBe(8080)
  })

  it('parses string ports', () => {
    expect(sanitizePort('3000', 8080)).toBe(3000)
    expect(sanitizePort('5432', 5432)).toBe(5432)
  })

  it('returns default for invalid strings', () => {
    expect(sanitizePort('invalid', 8080)).toBe(8080)
  })
})

describe('isValidUrl', () => {
  it('validates HTTP URLs', () => {
    expect(isValidUrl('http://example.com')).toBe(true)
    expect(isValidUrl('https://api.example.com/data')).toBe(true)
  })

  it('validates database URLs', () => {
    expect(isValidUrl('postgresql://localhost:5432/db')).toBe(true)
    expect(isValidUrl('mysql://localhost:3306/db')).toBe(true)
    expect(isValidUrl('mongodb://localhost:27017/db')).toBe(true)
    expect(isValidUrl('redis://localhost:6379')).toBe(true)
  })

  it('rejects invalid protocols', () => {
    expect(isValidUrl('ftp://example.com')).toBe(false)
    expect(isValidUrl('file:///path/to/file')).toBe(false)
  })

  it('rejects invalid URLs', () => {
    expect(isValidUrl('not-a-url')).toBe(false)
    expect(isValidUrl('')).toBe(false)
    expect(isValidUrl(null)).toBe(false)
    expect(isValidUrl(123)).toBe(false)
  })
})

describe('sanitizeIdentifier', () => {
  it('keeps safe characters', () => {
    expect(sanitizeIdentifier('safe_identifier-123')).toBe('safe_identifier-123')
    expect(sanitizeIdentifier('validName')).toBe('validName')
  })

  it('removes dangerous characters', () => {
    expect(sanitizeIdentifier('unsafe<script>')).toBe('unsafescript')
    expect(sanitizeIdentifier('path/../../../etc')).toBe('pathetc')
  })

  it('limits length to 64 characters', () => {
    const longString = 'a'.repeat(100)
    expect(sanitizeIdentifier(longString).length).toBe(64)
  })

  it('returns empty string for invalid input', () => {
    expect(sanitizeIdentifier('')).toBe('')
    expect(sanitizeIdentifier(null)).toBe('')
    expect(sanitizeIdentifier(undefined)).toBe('')
  })
})
