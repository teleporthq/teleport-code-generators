import { replaceSecretReference, generateDateFormatterCode } from '../utils'

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
  const database = mariaConfig.database

  return `import mariadb from 'mariadb'

// Helper function to process filters and build conditions
const processFilters = (filters, conditions, queryParams) => {
  if (!filters) return
  
  const parsedFilters = JSON.parse(filters)
  
  if (Array.isArray(parsedFilters)) {
    parsedFilters.forEach((filter) => {
      if (!filter.source || filter.destination === undefined) return
      
      const field = \`\\\`\${filter.source}\\\`\`
      const value = filter.destination
      const operand = filter.operand || '='
      
      if (Array.isArray(value)) {
        if (value.length === 0) return
        const placeholders = value.map(() => '?').join(', ')
        queryParams.push(...value)
        if (operand === '!=') {
          conditions.push(\`\${field} NOT IN (\${placeholders})\`)
        } else {
          conditions.push(\`\${field} IN (\${placeholders})\`)
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
          conditions.push(\`\${field} \${sqlOperator} ?\`)
          queryParams.push(value)
        }
      }
    })
  } else {
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
}

${generateDateFormatterCode()}

export default async function handler(req, res) {
  let connection = null
  try {
    connection = await mariadb.createConnection({
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
    
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, sorts, offset } = req.query
    
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
          const schemaRows = await connection.query(
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
        const searchConditions = columns.map((col) => \`CAST(\\\`\${col}\\\` AS CHAR) LIKE ?\`)
        columns.forEach(() => queryParams.push(\`%\${query}%\`))
        conditions.push(\`(\${searchConditions.join(' OR ')})\`)
      }
    }
    
    // Apply filters using helper function
    processFilters(filters, conditions, queryParams)
    
    let sql = \`SELECT * FROM \\\`${tableName}\\\`\`
    
    if (conditions.length > 0) {
      sql += \` WHERE \${conditions.join(' AND ')}\`
    }
    
    // Handle sorts - new array format
    if (sorts) {
      const parsedSorts = JSON.parse(sorts)
      if (Array.isArray(parsedSorts) && parsedSorts.length > 0) {
        const orderClauses = parsedSorts.map((sort) => {
          if (!sort.field) return null
          const order = sort.order?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
          return \`\\\`\${sort.field}\\\` \${order}\`
        }).filter(Boolean)
        
        if (orderClauses.length > 0) {
          sql += \` ORDER BY \${orderClauses.join(', ')}\`
        }
      }
    } else if (sortBy) {
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
    const safeData = JSON.parse(JSON.stringify(plainRows, dateReplacer))
    
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
    if (connection) {
      try {
        await connection.end()
      } catch (error) {
        console.error('Error closing MariaDB connection:', error)
      }
    }
  }
}
`
}

export const generateMariaDBCountFetcher = (
  config: Record<string, unknown>,
  tableName: string
): string => {
  const mariaConfig = config as MariaDBConfig
  const database = mariaConfig.database

  return `
async function getCount(req, res) {
  let connection = null

  try {
    connection = await mariadb.createConnection({
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
          const schemaRows = await connection.query(
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
        const searchConditions = columns.map(col => \`CAST(\${col} AS CHAR) LIKE ?\`).join(' OR ')
        conditions.push(\`(\${searchConditions})\`)
        columns.forEach(() => queryParams.push(\`%\${query}%\`))
      }
    }

    // Apply filters using helper function
    processFilters(filters, conditions, queryParams)

    let countSql = \`SELECT COUNT(*) as count FROM ${tableName}\`
    if (conditions.length > 0) {
      countSql += \` WHERE \${conditions.join(' AND ')}\`
    }

    const rows = await connection.query(countSql, queryParams)
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
        console.error('Error closing MariaDB connection:', error)
      }
    }
  }
}
`
}
