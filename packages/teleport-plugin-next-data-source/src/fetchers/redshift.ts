import {
  replaceSecretReference,
  generateDateFormatterCode,
  generateSafeJSONParseCode,
  generateSearchEscapeHelpersCode,
} from '../utils'

interface RedshiftConfig {
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  ssl?: boolean | { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean }
  sslConfig?: { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean }
  options?: { schema?: string }
}

export const generateRedshiftFetcher = (
  config: Record<string, unknown>,
  tableName: string
): string => {
  const redshiftConfig = config as RedshiftConfig
  const host = redshiftConfig.host
  const port = redshiftConfig.port
  const user = redshiftConfig.user
  const password = redshiftConfig.password
  const database = redshiftConfig.database
  const ssl = redshiftConfig.ssl
  const sslConfig = redshiftConfig.sslConfig
  const schema = redshiftConfig.options?.schema

  return `import { Client } from 'pg'

const getClient = () => {
  return new Client({
    host: ${JSON.stringify(host)},
    port: ${port || 5439},
    user: ${JSON.stringify(user)},
    password: ${replaceSecretReference(password)},
    database: ${JSON.stringify(database)},
    ssl: ${
      ssl === false
        ? '{ rejectUnauthorized: false }'
        : sslConfig
        ? `{
      ${sslConfig.ca ? `ca: ${replaceSecretReference(sslConfig.ca)},` : ''}
      ${sslConfig.cert ? `cert: ${replaceSecretReference(sslConfig.cert)},` : ''}
      ${sslConfig.key ? `key: ${replaceSecretReference(sslConfig.key)},` : ''}
      rejectUnauthorized: ${sslConfig.rejectUnauthorized !== false}
    }`
        : '{ rejectUnauthorized: false }' // Default to SSL with no cert verification for Redshift
    }
  })
}

${generateSafeJSONParseCode()}

${generateSearchEscapeHelpersCode()}

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
        const parsed = safeJSONParse(queryColumns)
        columns = Array.isArray(parsed) ? parsed : [parsed]
      } else {
        // Fallback: Get all columns from information_schema
        try {
          const schemaQuery = 'SELECT column_name FROM information_schema.columns WHERE table_name = $1' + 
            ${schema ? `' AND table_schema = $2'` : `''`} + 
            ' ORDER BY ordinal_position'
          const schemaParams = ${
            schema
              ? `[${JSON.stringify(tableName)}, ${JSON.stringify(schema)}]`
              : `[${JSON.stringify(tableName)}]`
          }
          const schemaResult = await client.query(schemaQuery, schemaParams)
          columns = schemaResult.rows.map(row => row.column_name)
        } catch (schemaError) {
          console.warn('Failed to fetch column names from information_schema:', schemaError.message)
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
    
    // Helper to sanitize identifier (prevent SQL injection in column names)
    const sanitizeIdentifier = (name) => {
      // Only allow alphanumeric, underscore, and dot (for schema.table)
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        throw new Error(\`Invalid identifier: \${name}\`)
      }
      return \`"\${name}"\`
    }
    
    if (filters) {
      const parsedFilters = safeJSONParse(filters)
      
      if (Array.isArray(parsedFilters)) {
        parsedFilters.forEach((filter) => {
          if (!filter.source || filter.destination === undefined) return
          
          const field = sanitizeIdentifier(filter.source)
          const value = filter.destination
          const operand = filter.operand || '='
          
          if (Array.isArray(value)) {
            if (value.length === 0) return
            const placeholders = value.map(() => \`$\${paramIndex++}\`)
            queryParams.push(...value)
            if (operand === '!=') {
              conditions.push(\`\${field} NOT IN (\${placeholders.join(', ')})\`)
            } else {
              conditions.push(\`\${field} IN (\${placeholders.join(', ')})\`)
            }
          } else {
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
          const field = sanitizeIdentifier(key)
          if (Array.isArray(value)) {
            const placeholders = value.map(() => \`$\${paramIndex++}\`)
            queryParams.push(...value)
            conditions.push(\`\${field} IN (\${placeholders.join(', ')})\`)
          } else {
            conditions.push(\`\${field} = $\${paramIndex}\`)
            queryParams.push(value)
            paramIndex++
          }
        })
      }
    }
    
    let sql = \`SELECT * FROM ${tableName}\`
    
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
          return \`\${sanitizeIdentifier(sort.field)} \${order}\`
        }).filter(Boolean)

        if (orderClauses.length > 0) {
          sql += \` ORDER BY \${orderClauses.join(', ')}\`
        }
      }
    } else if (sortBy) {
      sql += \` ORDER BY \${sanitizeIdentifier(sortBy)} \${(sortOrder || '').toUpperCase().startsWith('DESC') ? 'DESC' : 'ASC'}\`
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
    console.error('Redshift fetch error:', error)
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
        console.error('Error closing Redshift client:', error)
      }
    }
  }
}
`
}
