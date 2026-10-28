import {
  replaceSecretReference,
  generateDateFormatterCode,
  generateSafeJSONParseCode,
  generateFilterTreeHelpersCode,
  generateSearchEscapeHelpersCode,
} from '../utils'
import { DataExposure } from '@teleporthq/teleport-shared'
import { generateSearchSqlHelpersCode, REDSHIFT_SEARCH_SQL } from '../search-relevance'

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

// No query waits on the database longer than this (enforced by the client).
const getClient = () => {
  return new Client({
    query_timeout: ${DataExposure.READ_QUERY_TIMEOUT_MS},
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

${generateFilterTreeHelpersCode()}

${generateSearchEscapeHelpersCode()}
${generateSearchSqlHelpersCode(REDSHIFT_SEARCH_SQL)}

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
    let search = null
    
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
      
      search = buildSearchSql(query, columns, paramIndex)
      if (search) {
        conditions.push(search.where)
        queryParams.push(...search.params)
        paramIndex = search.nextIndex
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
      const filterTree = normalizeFilterTree(safeJSONParse(filters))
      
      if (filterTree) {
        const buildCondition = (condition) => {
          const field = sanitizeIdentifier(condition.source)
          const normalizedCondition = normalizeInOperand(condition.operand, condition.destination)
          if (normalizedCondition === null) return null
          const value = normalizedCondition.value
          const operand = normalizedCondition.operand
          
          if (Array.isArray(value)) {
            if (value.length === 0) return null
            const placeholders = value.map(() => \`$\${paramIndex++}\`)
            queryParams.push(...value)
            return operand === '!='
              ? \`\${field} NOT IN (\${placeholders.join(', ')})\`
              : \`\${field} IN (\${placeholders.join(', ')})\`
          }
          
          if (value === null) {
            if (operand === '=') return \`\${field} IS NULL\`
            if (operand === '!=') return \`\${field} IS NOT NULL\`
            return null
          }
          
          const validOps = ['=', '!=', '>', '<', '>=', '<=']
          const sqlOperator = validOps.includes(operand) ? operand : '='
          const clause = \`\${field} \${sqlOperator} $\${paramIndex}\`
          queryParams.push(value)
          paramIndex++
          return clause
        }
        
        const clause = buildFilterTreeClause(filterTree, buildCondition)
        if (clause) conditions.push(clause)
      }
    }
    
    let sql = \`SELECT * FROM ${tableName}\`
    
    if (conditions.length > 0) {
      sql += \` WHERE \${conditions.join(' AND ')}\`
    }
    
    // Handle sorts - new array format. A search orders its matches by where
    // the words are first; the sort orders the rows within each of those groups.
    const orderClauses = search && search.rank ? [search.rank] : []
    if (sorts) {
      const parsedSorts = safeJSONParse(sorts)
      if (Array.isArray(parsedSorts) && parsedSorts.length > 0) {
        orderClauses.push(...parsedSorts.map((sort) => {
          if (!sort.field) return null
          const order = (sort.order || '').toUpperCase().startsWith('DESC') ? 'DESC' : 'ASC'
          return \`\${sanitizeIdentifier(sort.field)} \${order}\`
        }).filter(Boolean))
      }
    } else if (sortBy) {
      orderClauses.push(\`\${sanitizeIdentifier(sortBy)} \${(sortOrder || '').toUpperCase().startsWith('DESC') ? 'DESC' : 'ASC'}\`)
    }
    if (orderClauses.length > 0) {
      sql += \` ORDER BY \${orderClauses.join(', ')}\`
      if (search && search.rank) queryParams.push(...search.rankParams)
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
