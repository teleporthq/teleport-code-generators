import { replaceSecretReference } from '../utils'

interface MySQLConfig {
  host?: string
  port?: number
  user?: string
  username?: string
  password?: string
  database?: string
  ssl?: boolean | { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean }
  sslConfig?: { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean }
}

export const generateMySQLFetcher = (
  config: Record<string, unknown>,
  tableName: string
): string => {
  const mysqlConfig = config as MySQLConfig
  const resolvedUser = mysqlConfig.user || mysqlConfig.username || null
  const hasCustomSSLConfig = !!mysqlConfig.sslConfig
  const defaultSSLEnabled = mysqlConfig.ssl !== false

  const sslConfigString = hasCustomSSLConfig
    ? `{
      ${mysqlConfig.sslConfig.ca ? `ca: ${replaceSecretReference(mysqlConfig.sslConfig.ca)},` : ''}
      ${
        mysqlConfig.sslConfig.cert
          ? `cert: ${replaceSecretReference(mysqlConfig.sslConfig.cert)},`
          : ''
      }
      ${
        mysqlConfig.sslConfig.key
          ? `key: ${replaceSecretReference(mysqlConfig.sslConfig.key)},`
          : ''
      }
      rejectUnauthorized: ${
        mysqlConfig.sslConfig.rejectUnauthorized !== undefined
          ? mysqlConfig.sslConfig.rejectUnauthorized
          : true
      }
    }`
    : defaultSSLEnabled
    ? `{ rejectUnauthorized: true }`
    : 'false'

  return `import mysql from 'mysql2/promise'

let pool = null

const getPool = () => {
  if (pool) return pool
  
  pool = mysql.createPool({
    host: ${JSON.stringify(mysqlConfig.host)},
    port: ${mysqlConfig.port || 3306},
    user: ${resolvedUser !== null ? JSON.stringify(resolvedUser) : 'undefined'},
    password: ${replaceSecretReference(mysqlConfig.password)},
    database: ${JSON.stringify(mysqlConfig.database)},
    ssl: ${sslConfigString}
  })
  
  return pool
}

export default async function handler(req, res) {
  try {
    const pool = getPool()
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, offset } = req.query
    
    const conditions = []
    const queryParams = []
    
    if (query && queryColumns) {
      const columns = JSON.parse(queryColumns)
      const searchConditions = columns.map((col) => \`\${mysql.escapeId(col)} LIKE ?\`)
      columns.forEach(() => queryParams.push(\`%\${query}%\`))
      conditions.push(\`(\${searchConditions.join(' OR ')})\`)
    }
    
    if (filters) {
      const parsedFilters = JSON.parse(filters)
      Object.entries(parsedFilters).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          const placeholders = value.map(() => '?').join(', ')
          queryParams.push(...value)
          conditions.push(\`\${mysql.escapeId(key)} IN (\${placeholders})\`)
        } else {
          conditions.push(\`\${mysql.escapeId(key)} = ?\`)
          queryParams.push(value)
        }
      })
    }
    
    let sql = \`SELECT * FROM \${mysql.escapeId('${tableName}')}\`
    
    if (conditions.length > 0) {
      sql += \` WHERE \${conditions.join(' AND ')}\`
    }
    
    if (sortBy) {
      sql += \` ORDER BY \${mysql.escapeId(sortBy)} \${sortOrder?.toUpperCase() || 'ASC'}\`
    }
    
    const limitValue = limit || perPage
    const offsetValue = offset !== undefined ? parseInt(offset) : (page && perPage ? (parseInt(page) - 1) * parseInt(perPage) : undefined)
    
    if (limitValue) {
      sql += \` LIMIT \${limitValue}\`
    }
    
    if (offsetValue !== undefined) {
      sql += \` OFFSET \${offsetValue}\`
    }
    
    const [rows] = await pool.query(sql, queryParams)
    const rowArray = Array.isArray(rows) ? rows : []
    const plainRows = rowArray.map((row) =>
      row && typeof row.toJSON === 'function' ? row.toJSON() : row
    )
    const safeData = JSON.parse(JSON.stringify(plainRows))

    return res.status(200).json({
      success: true,
      data: safeData,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('MySQL fetch error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch data',
      timestamp: Date.now()
    })
  }
}
`
}
