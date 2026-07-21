import {
  replaceSecretReference,
  generateDateFormatterCode,
  generateSafeJSONParseCode,
  generateSearchEscapeHelpersCode,
} from '../utils'

interface PostgreSQLConfig {
  connectionString?: string
  host?: string
  port?: number
  user?: string
  username?: string
  password?: string
  database?: string
  ssl?: boolean | { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean }
  sslConfig?: { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean }
  options?: { schema?: string }
}

export const generatePostgreSQLFetcher = (
  config: Record<string, unknown>,
  tableName: string
): string => {
  const pgConfig = config as PostgreSQLConfig
  const schema = pgConfig.options?.schema

  const clientConfig = pgConfig.connectionString
    ? `{
    connectionString: ${replaceSecretReference(pgConfig.connectionString)},
  }`
    : `{
    host: ${JSON.stringify(pgConfig.host)},
    port: ${pgConfig.port || 5432},
    user: ${JSON.stringify(pgConfig.user || pgConfig.username)},
    password: ${replaceSecretReference(pgConfig.password)},
    database: ${JSON.stringify(pgConfig.database)},
    ssl: ${
      pgConfig.ssl === false
        ? 'false'
        : pgConfig.sslConfig
        ? `{
      ${pgConfig.sslConfig.ca ? `ca: ${replaceSecretReference(pgConfig.sslConfig.ca)},` : ''}
      ${pgConfig.sslConfig.cert ? `cert: ${replaceSecretReference(pgConfig.sslConfig.cert)},` : ''}
      ${pgConfig.sslConfig.key ? `key: ${replaceSecretReference(pgConfig.sslConfig.key)},` : ''}
      rejectUnauthorized: false
    }`
        : '{ rejectUnauthorized: false }'
    }
  }`

  return `import { Client } from 'pg'

const getClient = () => {
  return new Client(${clientConfig})
}

${generateSafeJSONParseCode()}

${generateSearchEscapeHelpersCode()}

// Helper function to process filters and build conditions
const processFilters = (filters, conditions, queryParams, paramIndex) => {
  if (!filters) return paramIndex
  
  const parsedFilters = safeJSONParse(filters)
  
  if (Array.isArray(parsedFilters)) {
    parsedFilters.forEach((filter) => {
      if (!filter.source || filter.destination === undefined) return
      
      const field = filter.source
      const value = filter.destination
      const operand = filter.operand || '='
      
      if (Array.isArray(value)) {
        if (value.length === 0) return
        if (operand === 'array_overlap') {
          conditions.push(\`jsonb_exists_any(NULLIF(\${field}, '')::jsonb, $\${paramIndex}::text[])\`)
          queryParams.push(value.map((entry) => String(entry)))
          paramIndex++
          return
        }
        const placeholders = value.map(() => \`$\${paramIndex++}\`)
        queryParams.push(...value)
        if (operand === '!=') {
          conditions.push(\`\${field} NOT IN (\${placeholders.join(', ')})\`)
        } else {
          conditions.push(\`\${field} IN (\${placeholders.join(', ')})\`)
        }
      } else {
        if (operand === 'array_overlap') {
          if (value === '' || value === null || value === undefined) return
          // A single comma-joined string (the multi-select Category Filter's
          // ?categoryFilter=a,b,c) expands to multiple ids; one id stays one.
          const overlapValues = String(value).split(',').map((entry) => entry.trim()).filter(Boolean)
          if (overlapValues.length === 0) return
          conditions.push(\`jsonb_exists_any(NULLIF(\${field}, '')::jsonb, $\${paramIndex}::text[])\`)
          queryParams.push(overlapValues)
          paramIndex++
          return
        }
        if (value === null) {
          if (operand === '=') {
            conditions.push(\`\${field} IS NULL\`)
          } else if (operand === '!=') {
            conditions.push(\`\${field} IS NOT NULL\`)
          }
        } else {
          const validOps = ['=', '!=', '>', '<', '>=', '<=']
          const sqlOperator = validOps.includes(operand) ? operand : '='
          conditions.push(\`\${field} \${sqlOperator} $\${paramIndex}\`)
          queryParams.push(value)
          paramIndex++
        }
      }
    })
  } else {
    Object.entries(parsedFilters).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        const placeholders = value.map(() => \`$\${paramIndex++}\`)
        queryParams.push(...value)
        conditions.push(\`\${key} IN (\${placeholders.join(', ')})\`)
      } else {
        conditions.push(\`\${key} = $\${paramIndex}\`)
        queryParams.push(value)
        paramIndex++
      }
    })
  }
  
  return paramIndex
}

${generateDateFormatterCode()}

export default async function handler(req, res) {
  const client = getClient()
  
  try {
    await client.connect()
    ${schema ? `await client.query('SET search_path TO ${schema}')` : ''}
    
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, sorts, offset } = req.query
    
    const conditions = []
    const queryParams = []
    let paramIndex = 1
    
    if (query) {
      let columns = []
      
      if (queryColumns) {
        // Use specified columns. Wrap non-arrays so that a single
        // column passed as a bare string doesn't get iterated as chars.
        const parsed = safeJSONParse(queryColumns)
        columns = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : [])
      } else {
        // Fallback: Get all columns from information_schema
        try {
          const schemaQuery = \`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = $1
            ${schema ? `AND table_schema = $2` : ''}
            ORDER BY ordinal_position
          \`
          const schemaParams = schema 
            ? [${JSON.stringify(tableName)}, ${JSON.stringify(schema)}]
            : [${JSON.stringify(tableName)}]
          
          const schemaResult = await client.query(schemaQuery, schemaParams)
          columns = schemaResult.rows.map(row => row.column_name)
        } catch (schemaError) {
          console.warn('Failed to fetch column names from information_schema:', schemaError.message)
          // Continue without search if we can't get columns
        }
      }
      
      if (columns.length > 0) {
        const pattern = '%' + escapeLikePattern(query) + '%'
        const placeholder = '$' + paramIndex
        paramIndex++
        queryParams.push(pattern)
        const searchConditions = columns.map(
          (col) => '"' + sanitizeSearchIdentifier(col) + '"::text ILIKE ' + placeholder + " ESCAPE '|'"
        )
        conditions.push('(' + searchConditions.join(' OR ') + ')')
      }
    }

    // Apply filters using helper function
    paramIndex = processFilters(filters, conditions, queryParams, paramIndex)
    
    let sql = \`SELECT * FROM "${tableName}"\`
    
    if (conditions.length > 0) {
      sql += \` WHERE \${conditions.join(' AND ')}\`
    }
    
    // Handle sorts - new array format
    if (sorts) {
      const parsedSorts = safeJSONParse(sorts)
      if (Array.isArray(parsedSorts) && parsedSorts.length > 0) {
        const orderClauses = parsedSorts.map((sort) => {
          if (!sort.field) return null
          const order = (sort.order || '').toUpperCase().startsWith('DESC') ? 'DESC' : 'ASC'
          return \`\${sort.field} \${order}\`
        }).filter(Boolean)

        if (orderClauses.length > 0) {
          sql += \` ORDER BY \${orderClauses.join(', ')}\`
        }
      }
    } else if (sortBy) {
      sql += \` ORDER BY \${sortBy} \${(sortOrder || '').toUpperCase().startsWith('DESC') ? 'DESC' : 'ASC'}\`
    }
    
    const limitValue = limit || perPage
    const offsetValue = offset !== undefined ? parseInt(offset) : (page && perPage ? (parseInt(page) - 1) * parseInt(perPage) : undefined)
    
    if (limitValue) {
      sql += \` LIMIT \${limitValue}\`
    }
    
    if (offsetValue !== undefined) {
      sql += \` OFFSET \${offsetValue}\`
    }
    
    const result = await client.query(sql, queryParams)
    const rows = Array.isArray(result?.rows) ? result.rows : []
    const plainRows = rows.map((row) =>
      row && typeof row.toJSON === 'function' ? row.toJSON() : row
    )
    const safeData = JSON.parse(JSON.stringify(plainRows, dateReplacer))

    return res.status(200).json({
      success: true,
      data: safeData,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('PostgreSQL fetch error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch data',
      timestamp: Date.now()
    })
  } finally {
    if (client) {
      try {
        await client.end()
      } catch (error) {
        console.error('Error closing PostgreSQL client:', error)
      }
    }
  }
}
`
}

export const generatePostgreSQLCountFetcher = (
  config: Record<string, unknown>,
  tableName: string
): string => {
  const pgConfig = config as PostgreSQLConfig
  const hasSchema = !!pgConfig.options?.schema

  return `
async function getCount(req, res) {
  const client = getClient()

  try {
    await client.connect()
    const { query, queryColumns, filters } = req.query
    const conditions = []
    const queryParams = []
    let paramIndex = 1

    if (query) {
      let columns = []
      
      if (queryColumns) {
        // Use specified columns
        const parsed = safeJSONParse(queryColumns)
        columns = Array.isArray(parsed) ? parsed : [parsed]
      } else {
        // Fallback: Get all columns from information_schema
        try {
          const schemaQuery = \`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = $1
            ${hasSchema ? `AND table_schema = $2` : ''}
            ORDER BY ordinal_position
          \`
          const schemaParams = ${
            hasSchema
              ? `[${JSON.stringify(tableName)}, ${JSON.stringify(pgConfig.options!.schema)}]`
              : `[${JSON.stringify(tableName)}]`
          }
          
          const schemaResult = await client.query(schemaQuery, schemaParams)
          columns = schemaResult.rows.map(row => row.column_name)
        } catch (schemaError) {
          console.warn('Failed to fetch column names from information_schema:', schemaError.message)
          // Continue without search if we can't get columns
        }
      }
      
      if (columns.length > 0) {
        const pattern = '%' + escapeLikePattern(query) + '%'
        const placeholder = '$' + paramIndex
        paramIndex++
        queryParams.push(pattern)
        const searchConditions = columns
          .map(
            (col) => '"' + sanitizeSearchIdentifier(col) + '"::text ILIKE ' + placeholder + " ESCAPE '|'"
          )
          .join(' OR ')
        conditions.push('(' + searchConditions + ')')
      }
    }

    // Apply filters using helper function
    paramIndex = processFilters(filters, conditions, queryParams, paramIndex)

    let countSql = \`SELECT COUNT(*) FROM "${tableName}"\`
    if (conditions.length > 0) {
      countSql += \` WHERE \${conditions.join(' AND ')}\`
    }

    const result = await client.query(countSql, queryParams)
    const count = parseInt(result.rows[0].count, 10)

    return res.status(200).json({
      success: true,
      count: count,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('Error getting count:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to get count',
      timestamp: Date.now()
    })
  } finally {
    if (client) {
      try {
        await client.end()
      } catch (error) {
        console.error('Error closing PostgreSQL client:', error)
      }
    }
  }
}
`
}
