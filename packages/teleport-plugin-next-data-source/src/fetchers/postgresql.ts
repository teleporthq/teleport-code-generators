import { replaceSecretReference } from '../utils'

interface PostgreSQLConfig {
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

  return `import { Client } from 'pg'

const getClient = () => {
  return new Client({
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
  })
}

export default async function handler(req, res) {
  const client = getClient()
  
  try {
    await client.connect()
    ${schema ? `await client.query('SET search_path TO ${schema}')` : ''}
    
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, offset } = req.query
    
    const conditions = []
    const queryParams = []
    let paramIndex = 1
    
    if (query) {
      let columns = []
      
      if (queryColumns) {
        // Use specified columns
        columns = JSON.parse(queryColumns)
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
        const searchConditions = columns.map((col) => {
          const condition = \`\${col}::text ILIKE $\${paramIndex}\`
          paramIndex++
          return condition
        })
        columns.forEach(() => queryParams.push(\`%\${query}%\`))
        conditions.push(\`(\${searchConditions.join(' OR ')})\`)
      }
    }
    
    if (filters) {
      const parsedFilters = JSON.parse(filters)
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
    
    let sql = \`SELECT * FROM ${tableName}\`
    
    if (conditions.length > 0) {
      sql += \` WHERE \${conditions.join(' AND ')}\`
    }
    
    if (sortBy) {
      sql += \` ORDER BY \${sortBy} \${sortOrder?.toUpperCase() || 'ASC'}\`
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
    const safeData = JSON.parse(JSON.stringify(plainRows))

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
        columns = typeof queryColumns === 'string' ? JSON.parse(queryColumns) : (Array.isArray(queryColumns) ? queryColumns : [queryColumns])
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
        const searchConditions = columns.map(col => \`\${col}::text ILIKE $\${paramIndex++}\`).join(' OR ')
        conditions.push(\`(\${searchConditions})\`)
        columns.forEach(() => queryParams.push(\`%\${query}%\`))
      }
    }

    if (filters) {
      const parsedFilters = JSON.parse(filters)
      for (const filter of parsedFilters) {
        conditions.push(\`\${filter.column} \${filter.operator} $\${paramIndex++}\`)
        queryParams.push(filter.value)
      }
    }

    let countSql = \`SELECT COUNT(*) FROM ${tableName}\`
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
