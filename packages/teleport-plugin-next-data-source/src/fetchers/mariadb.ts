import { replaceSecretReference } from '../utils'

interface MariaDBConfig {
  host?: string
  port?: number
  user?: string
  username?: string
  password?: string
  database?: string
  ssl?: boolean | { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean }
  sslConfig?: { ca?: string; cert?: string; key?: string; rejectUnauthorized?: boolean }
}

export const generateMariaDBFetcher = (
  config: Record<string, unknown>,
  tableName: string
): string => {
  const mariaConfig = config as MariaDBConfig
  return `import mariadb from 'mariadb'

export default async function handler(req, res) {
  let pool = null
  try {
    pool = mariadb.createPool({
      host: ${JSON.stringify(mariaConfig.host)},
      port: ${mariaConfig.port || 3306},
      user: ${JSON.stringify(mariaConfig.user)},
      password: ${replaceSecretReference(mariaConfig.password)},
      database: ${JSON.stringify(mariaConfig.database)},
      ssl: ${mariaConfig.ssl || false}${
    mariaConfig.sslConfig
      ? `,
      sslConfig: {
        ${
          mariaConfig.sslConfig.ca ? `ca: ${replaceSecretReference(mariaConfig.sslConfig.ca)},` : ''
        }
        ${
          mariaConfig.sslConfig.cert
            ? `cert: ${replaceSecretReference(mariaConfig.sslConfig.cert)},`
            : ''
        }
        ${
          mariaConfig.sslConfig.key
            ? `key: ${replaceSecretReference(mariaConfig.sslConfig.key)},`
            : ''
        }
        rejectUnauthorized: ${mariaConfig.sslConfig.rejectUnauthorized !== false}
      }`
      : ''
  }
    })
    
    const connection = await pool.getConnection()
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, offset } = req.query
    
    const conditions = []
    const queryParams = []
    
    if (query && queryColumns) {
      const columns = JSON.parse(queryColumns)
      const searchConditions = columns.map((col) => \`\\\`\${col}\\\` LIKE ?\`)
      columns.forEach(() => queryParams.push(\`%\${query}%\`))
      conditions.push(\`(\${searchConditions.join(' OR ')})\`)
    }
    
    if (filters) {
      const parsedFilters = JSON.parse(filters)
      Object.entries(parsedFilters).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          const placeholders = value.map(() => '?').join(', ')
          queryParams.push(...value)
          conditions.push(\`\\\`\${key}\\\` IN (\${placeholders})\`)
        } else {
          conditions.push(\`\\\`\${key}\\\` = ?\`)
          queryParams.push(value)
        }
      })
    }
    
    let sql = \`SELECT * FROM \\\`${tableName}\\\`\`
    
    if (conditions.length > 0) {
      sql += \` WHERE \${conditions.join(' AND ')}\`
    }
    
    if (sortBy) {
      sql += \` ORDER BY \\\`\${sortBy}\\\` \${sortOrder?.toUpperCase() || 'ASC'}\`
    }
    
    const limitValue = limit || perPage
    const offsetValue = offset !== undefined ? parseInt(offset) : (page && perPage ? (parseInt(page) - 1) * parseInt(perPage) : undefined)
    
    if (limitValue) {
      sql += \` LIMIT \${limitValue}\`
    }
    
    if (offsetValue !== undefined) {
      sql += \` OFFSET \${offsetValue}\`
    }
    
    const rows = await connection.query(sql, queryParams)
    const rowArray = Array.isArray(rows) ? rows : []
    const plainRows = rowArray.map((row) =>
      row && typeof row.toJSON === 'function' ? row.toJSON() : row
    )
    const safeData = JSON.parse(JSON.stringify(plainRows))
    connection.release()
    
    return res.status(200).json({
      success: true,
      data: safeData,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('MariaDB fetch error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch data',
      timestamp: Date.now()
    })
  } finally {
    if (pool) {
      await pool.end()
    }
  }
}
`
}
