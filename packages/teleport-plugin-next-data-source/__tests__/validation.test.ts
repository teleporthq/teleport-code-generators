import {
  validateFirestoreConfig,
  validateClickHouseConfig,
  validateAirtableConfig,
  validateSupabaseConfig,
  validateTursoConfig,
  validateGoogleSheetsConfig,
  validateCSVConfig,
} from '../src/fetchers'

describe('validateFirestoreConfig', () => {
  it('validates with service account JSON string', () => {
    const result = validateFirestoreConfig({
      serviceAccount: JSON.stringify({
        project_id: 'test-project',
        private_key: 'test-key',
        client_email: 'test@test.com',
      }),
    })
    expect(result.isValid).toBe(true)
  })

  it('validates with secret reference', () => {
    const result = validateFirestoreConfig({
      serviceAccount: 'teleporthq.secrets.FIRESTORE_SERVICE_ACCOUNT',
    })
    expect(result.isValid).toBe(true)
  })

  it('rejects missing config', () => {
    const result = validateFirestoreConfig({})
    expect(result.isValid).toBe(false)
  })

  it('rejects invalid service account JSON', () => {
    const result = validateFirestoreConfig({
      serviceAccount: 'invalid-json',
    })
    expect(result.isValid).toBe(false)
  })

  it('rejects incomplete service account JSON', () => {
    const result = validateFirestoreConfig({
      serviceAccount: JSON.stringify({
        project_id: 'test-project',
      }),
    })
    expect(result.isValid).toBe(false)
  })
})

describe('validateClickHouseConfig', () => {
  it('validates with required fields', () => {
    const result = validateClickHouseConfig({
      url: 'http://localhost:8123',
      username: 'default',
      password: 'password',
    })
    expect(result.isValid).toBe(true)
  })

  it('rejects missing URL', () => {
    const result = validateClickHouseConfig({
      username: 'default',
      password: 'password',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('URL')
  })

  it('rejects missing username', () => {
    const result = validateClickHouseConfig({
      url: 'http://localhost:8123',
      password: 'password',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('username')
  })

  it('rejects missing password', () => {
    const result = validateClickHouseConfig({
      url: 'http://localhost:8123',
      username: 'default',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('password')
  })
})

describe('validateAirtableConfig', () => {
  it('validates with required fields', () => {
    const result = validateAirtableConfig({
      personalAccessToken: 'patXXXXXXXXXXXXXX',
      baseId: 'appXXXXXXXXXXXXXX',
    })
    expect(result.isValid).toBe(true)
  })

  it('rejects missing personalAccessToken', () => {
    const result = validateAirtableConfig({
      baseId: 'appXXXXXXXXXXXXXX',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('personal access token')
  })

  it('rejects missing baseId', () => {
    const result = validateAirtableConfig({
      personalAccessToken: 'patXXXXXXXXXXXXXX',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('base ID')
  })

  it('rejects invalid config types', () => {
    const result = validateAirtableConfig({
      personalAccessToken: 123,
      baseId: {},
    })
    expect(result.isValid).toBe(false)
  })

  it('accepts secret references', () => {
    const result = validateAirtableConfig({
      personalAccessToken: 'teleporthq.secrets.AIRTABLE_TOKEN',
      baseId: 'appXXXXXXXXXXXXXX',
    })
    expect(result.isValid).toBe(true)
  })
})

describe('validateSupabaseConfig', () => {
  it('validates with public API key', () => {
    const result = validateSupabaseConfig({
      supabaseUrl: 'https://xxx.supabase.co',
      publicApiKey: 'eyXXXXXXXXXXXXXX',
    })
    expect(result.isValid).toBe(true)
  })

  it('validates with service role key', () => {
    const result = validateSupabaseConfig({
      supabaseUrl: 'https://xxx.supabase.co',
      serviceRoleKey: 'eyXXXXXXXXXXXXXX',
    })
    expect(result.isValid).toBe(true)
  })

  it('rejects missing URL', () => {
    const result = validateSupabaseConfig({
      publicApiKey: 'eyXXXXXXXXXXXXXX',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('URL')
  })

  it('rejects missing API keys', () => {
    const result = validateSupabaseConfig({
      supabaseUrl: 'https://xxx.supabase.co',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('API key')
  })

  it('rejects invalid URL format', () => {
    const result = validateSupabaseConfig({
      supabaseUrl: 'not-a-url',
      publicApiKey: 'eyXXXXXXXXXXXXXX',
    })
    expect(result.isValid).toBe(false)
  })
})

describe('validateTursoConfig', () => {
  it('validates with required fields', () => {
    const result = validateTursoConfig({
      databaseUrl: 'libsql://xxx.turso.io',
      token: 'eyXXXXXXXXXXXXXX',
    })
    expect(result.isValid).toBe(true)
  })

  it('rejects missing databaseUrl', () => {
    const result = validateTursoConfig({
      token: 'eyXXXXXXXXXXXXXX',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('URL')
  })

  it('rejects missing token', () => {
    const result = validateTursoConfig({
      databaseUrl: 'libsql://xxx.turso.io',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('token')
  })

  it('validates libsql protocol', () => {
    const result = validateTursoConfig({
      databaseUrl: 'libsql://xxx.turso.io',
      token: 'eyXXXXXXXXXXXXXX',
    })
    expect(result.isValid).toBe(true)
  })

  it('accepts https URLs', () => {
    const result = validateTursoConfig({
      databaseUrl: 'https://xxx.turso.io',
      token: 'eyXXXXXXXXXXXXXX',
    })
    expect(result.isValid).toBe(true)
  })

  it('accepts secret references', () => {
    const result = validateTursoConfig({
      databaseUrl: 'libsql://xxx.turso.io',
      token: 'teleporthq.secrets.TURSO_TOKEN',
    })
    expect(result.isValid).toBe(true)
  })
})

describe('validateGoogleSheetsConfig', () => {
  it('validates with sheet ID', () => {
    const result = validateGoogleSheetsConfig({
      sheetId: '1XXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    })
    expect(result.isValid).toBe(true)
  })

  it('validates with sheet URL', () => {
    const result = validateGoogleSheetsConfig({
      sheetUrl: 'https://docs.google.com/spreadsheets/d/1XXXXX/edit',
    })
    expect(result.isValid).toBe(true)
  })

  it('rejects missing sheet ID and URL', () => {
    const result = validateGoogleSheetsConfig({
      apiKey: 'XXXXXXXXXXXXXXXXXXXXX',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Google Sheets ID or URL')
  })

  it('rejects invalid sheet URL', () => {
    const result = validateGoogleSheetsConfig({
      sheetUrl: 'https://example.com/notgooglesheets',
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Invalid Google Sheets URL')
  })

  it('accepts optional sheet name', () => {
    const result = validateGoogleSheetsConfig({
      sheetId: '1XXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      sheetName: 'Sheet1',
    })
    expect(result.isValid).toBe(true)
  })
})

describe('validateCSVConfig', () => {
  it('validates with parsed data array', () => {
    const result = validateCSVConfig({
      parsedData: [
        { name: 'John', age: 30 },
        { name: 'Jane', age: 25 },
      ],
    })
    expect(result.isValid).toBe(true)
  })

  it('validates with empty parsed data', () => {
    const result = validateCSVConfig({
      parsedData: [],
    })
    expect(result.isValid).toBe(true)
  })

  it('rejects missing parsedData and fileContent', () => {
    const result = validateCSVConfig({})
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Either fileContent or parsedData')
  })

  it('rejects invalid data type', () => {
    const result = validateCSVConfig({
      parsedData: 'not-an-array',
    })
    expect(result.isValid).toBe(false)
  })

  it('accepts with columns definition', () => {
    const result = validateCSVConfig({
      parsedData: [{ name: 'John', age: 30 }],
      columns: [
        { id: 'name', label: 'Name' },
        { id: 'age', label: 'Age' },
      ],
    })
    expect(result.isValid).toBe(true)
  })

  it('rejects invalid columns', () => {
    const result = validateCSVConfig({
      parsedData: [],
      columns: [{ label: 'Name' }],
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('column must have a valid id')
  })

  it('accepts fileContent instead of parsedData', () => {
    const result = validateCSVConfig({
      fileContent: 'name,age\nJohn,30',
    })
    expect(result.isValid).toBe(true)
  })

  it('rejects invalid fileContent type', () => {
    const result = validateCSVConfig({
      fileContent: 123,
    })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('File content must be a string')
  })

  it('accepts both fileContent and autoDetectHeader', () => {
    const result = validateCSVConfig({
      fileContent: 'name,age\nJohn,30',
      autoDetectHeader: true,
    })
    expect(result.isValid).toBe(true)
  })

  it('accepts both fileContent and firstRowIsHeader', () => {
    const result = validateCSVConfig({
      fileContent: 'name,age\nJohn,30',
      firstRowIsHeader: true,
    })
    expect(result.isValid).toBe(true)
  })
})

describe('edge cases for all validators', () => {
  it('handles null config', () => {
    expect(validateFirestoreConfig(null as any).isValid).toBe(false)
    expect(validateGoogleSheetsConfig(null as any).isValid).toBe(false)
    expect(validateCSVConfig(null as any).isValid).toBe(false)
  })

  it('handles undefined config', () => {
    expect(validateFirestoreConfig(undefined as any).isValid).toBe(false)
    expect(validateGoogleSheetsConfig(undefined as any).isValid).toBe(false)
    expect(validateCSVConfig(undefined as any).isValid).toBe(false)
  })

  it('handles invalid types', () => {
    expect(
      validateFirestoreConfig({
        serviceAccount: 123,
      } as any).isValid
    ).toBe(false)

    expect(
      validateGoogleSheetsConfig({
        sheetId: 123,
      } as any).isValid
    ).toBe(false)

    expect(
      validateCSVConfig({
        parsedData: 'not-an-array',
      }).isValid
    ).toBe(false)
  })
})
