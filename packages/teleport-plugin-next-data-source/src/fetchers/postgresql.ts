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
  return `import { Pool } from 'pg'

let pool = null

const getPool = () => {
  if (pool) return pool
  
  pool = new Pool({
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
  
  return pool
}

export default async function handler(req, res) {
  try {
    const pool = getPool()
    ${
      pgConfig.options?.schema
        ? `await pool.query('SET search_path TO ${pgConfig.options.schema}')`
        : ''
    }
    
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, offset } = req.query
    
    const conditions = []
    const queryParams = []
    let paramIndex = 1
    
    if (query && queryColumns) {
      const columns = JSON.parse(queryColumns)
      const searchConditions = columns.map((col) => {
        const condition = \`\${col}::text ILIKE $\${paramIndex}\`
        paramIndex++
        return condition
      })
      columns.forEach(() => queryParams.push(\`%\${query}%\`))
      conditions.push(\`(\${searchConditions.join(' OR ')})\`)
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
    
    const result = await pool.query(sql, queryParams)
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
  }
}
`
}
