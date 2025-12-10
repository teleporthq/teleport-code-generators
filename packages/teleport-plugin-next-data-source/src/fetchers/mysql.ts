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
  const database = mysqlConfig.database

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

const getConnection = () => {
  return mysql.createConnection({
    host: ${JSON.stringify(mysqlConfig.host)},
    port: ${mysqlConfig.port || 3306},
    user: ${resolvedUser !== null ? JSON.stringify(resolvedUser) : 'undefined'},
    password: ${replaceSecretReference(mysqlConfig.password)},
    database: ${JSON.stringify(mysqlConfig.database)},
    ssl: ${sslConfigString}
  })
}

export default async function handler(req, res) {
  const connection = await getConnection()
  
  try {
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, offset } = req.query
    
    const conditions = []
    const queryParams = []
    
    if (query) {
      let columns = []
      
      if (queryColumns) {
        // Use specified columns
        columns = JSON.parse(queryColumns)
      } else {
        // Fallback: Get all columns from information_schema
        try {
          const [schemaRows] = await connection.query(
            \`SELECT COLUMN_NAME FROM information_schema.COLUMNS 
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? 
             ORDER BY ORDINAL_POSITION\`,
            [${JSON.stringify(database)}, ${JSON.stringify(tableName)}]
          )
          columns = schemaRows.map(row => row.COLUMN_NAME)
        } catch (schemaError) {
          console.warn('Failed to fetch column names from information_schema:', schemaError.message)
          // Continue without search if we can't get columns
        }
      }
      
      if (columns.length > 0) {
        const searchConditions = columns.map((col) => \`CAST(\${mysql.escapeId(col)} AS CHAR) LIKE ?\`)
        columns.forEach(() => queryParams.push(\`%\${query}%\`))
        conditions.push(\`(\${searchConditions.join(' OR ')})\`)
      }
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
    
    const [rows] = await connection.query(sql, queryParams)
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
  } finally {
    if (connection) {
      try {
        await connection.end()
      } catch (error) {
        console.error('Error closing MySQL connection:', error)
      }
    }
  }
}
`
}

export const generateMySQLCountFetcher = (
  config: Record<string, unknown>,
  tableName: string
): string => {
  const mysqlConfig = config as MySQLConfig

  return `
async function getCount(req, res) {
  const connection = await getConnection()

  try {
    const { query, queryColumns, filters } = req.query
    const conditions = []
    const queryParams = []

    if (query) {
      let columns = []
      
      if (queryColumns) {
        // Use specified columns
        columns = typeof queryColumns === 'string' ? JSON.parse(queryColumns) : (Array.isArray(queryColumns) ? queryColumns : [queryColumns])
      } else {
        // Fallback: Get all columns from information_schema
        try {
          const [schemaRows] = await connection.execute(
            \`SELECT COLUMN_NAME FROM information_schema.COLUMNS 
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? 
             ORDER BY ORDINAL_POSITION\`,
            [${JSON.stringify(mysqlConfig.database)}, ${JSON.stringify(tableName)}]
          )
          columns = schemaRows.map(row => row.COLUMN_NAME)
        } catch (schemaError) {
          console.warn('Failed to fetch column names from information_schema:', schemaError.message)
          // Continue without search if we can't get columns
        }
      }
      
      if (columns.length > 0) {
        const searchConditions = columns.map(col => \`CAST(\${col} AS CHAR) LIKE ?\`).join(' OR ')
        conditions.push(\`(\${searchConditions})\`)
        columns.forEach(() => queryParams.push(\`%\${query}%\`))
      }
    }

    if (filters) {
      const parsedFilters = JSON.parse(filters)
      for (const filter of parsedFilters) {
        conditions.push(\`\${filter.column} \${filter.operator} ?\`)
        queryParams.push(filter.value)
      }
    }

    let countSql = \`SELECT COUNT(*) as count FROM ${tableName}\`
    if (conditions.length > 0) {
      countSql += \` WHERE \${conditions.join(' AND ')}\`
    }

    const [rows] = await connection.query(countSql, queryParams)
    const count = rows[0].count

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
    if (connection) {
      try {
        await connection.end()
      } catch (error) {
        console.error('Error closing MySQL connection:', error)
      }
    }
  }
}
`
}
