import { replaceSecretReference } from '../utils'

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

  return `import { Pool } from 'pg'

let pool = null

const getPool = () => {
  if (pool) return pool
  
  pool = new Pool({
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
  
  return pool
}

export default async function handler(req, res) {
  try {
    const pool = getPool()
    ${schema ? `await pool.query('SET search_path TO ${schema}')` : ''}
    
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
    console.error('Redshift fetch error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch data',
      timestamp: Date.now()
    })
  }
}
`
}
