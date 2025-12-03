import { replaceSecretReference } from '../utils'

export const validateTursoConfig = (
  config: Record<string, unknown>
): { isValid: boolean; error?: string } => {
  if (!config || typeof config !== 'object') {
    return { isValid: false, error: 'Config must be a valid object' }
  }

  if (!config.databaseUrl || typeof config.databaseUrl !== 'string') {
    return { isValid: false, error: 'Turso database URL is required' }
  }

  if (!config.token || typeof config.token !== 'string') {
    return { isValid: false, error: 'Turso authentication token is required' }
  }

  return { isValid: true }
}

interface TursoConfig {
  url?: string
  authToken?: string
  databaseUrl?: string
  token?: string
}

export const generateTursoFetcher = (
  config: Record<string, unknown>,
  tableName: string
): string => {
  const tursoConfig = config as TursoConfig
  const databaseUrl = tursoConfig.databaseUrl
  const token = tursoConfig.token

  return `import { createClient } from '@libsql/client'

export default async function handler(req, res) {
  let client = null
  try {
    client = createClient({
      url: ${JSON.stringify(databaseUrl)},
      authToken: ${replaceSecretReference(token)}
    })
    
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, offset } = req.query
    
    let sql = \`SELECT * FROM ${tableName}\`
    const whereClauses = []
    const queryParams = []
    let searchQueryColumns = null
    
    if (query) {
      if (queryColumns) {
        const columns = typeof queryColumns === 'string' ? JSON.parse(queryColumns) : (Array.isArray(queryColumns) ? queryColumns : [queryColumns])
        const searchConditions = columns.map((col) => \`\${col} LIKE ?\`)
        whereClauses.push(\`(\${searchConditions.join(' OR ')})\`)
        columns.forEach(() => {
          queryParams.push(\`%\${query}%\`)
        })
      } else {
        // Store query for post-filtering if columns not specified
        searchQueryColumns = query
      }
    }
    
    if (filters) {
      const parsedFilters = JSON.parse(filters)
      Object.entries(parsedFilters).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          const placeholders = value.map(() => '?').join(', ')
          queryParams.push(...value)
          whereClauses.push(\`\${key} IN (\${placeholders})\`)
        } else {
          whereClauses.push(\`\${key} = ?\`)
          queryParams.push(value)
        }
      })
    }
    
    if (whereClauses.length > 0) {
      sql += \` WHERE \${whereClauses.join(' AND ')}\`
    }
    
    if (sortBy) {
      const sortOrderValue = sortOrder?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
      sql += \` ORDER BY \${sortBy} \${sortOrderValue}\`
    }
    
    const limitValue = limit || perPage
    const offsetValue = offset !== undefined ? parseInt(offset) : (page && perPage ? (parseInt(page) - 1) * parseInt(perPage) : undefined)
    
    // Only apply SQL pagination if we're not doing post-filtering
    if (!searchQueryColumns) {
      if (limitValue) {
        sql += \` LIMIT ?\`
        queryParams.push(parseInt(limitValue))
      }
      
      if (offsetValue !== undefined) {
        sql += \` OFFSET ?\`
        queryParams.push(offsetValue)
      }
    }
    
    const result = await client.execute({
      sql,
      args: queryParams
    })
    
    let data = result.rows.map((row) => {
      const obj = {}
      result.columns.forEach((col, idx) => {
        obj[col] = row[col]
      })
      return obj
    })
    
    // Apply post-filtering for search without queryColumns
    if (searchQueryColumns) {
      const searchQuery = searchQueryColumns.toLowerCase()
      data = data.filter((item) => {
        try {
          const stringified = JSON.stringify(item).toLowerCase()
          return stringified.includes(searchQuery)
        } catch {
          return false
        }
      })
      
      // Apply pagination after filtering
      if (limitValue) {
        const start = offsetValue || 0
        data = data.slice(start, start + parseInt(limitValue))
      } else if (offsetValue) {
        data = data.slice(offsetValue)
      }
    }
    
    const safeData = JSON.parse(JSON.stringify(data))
    
    return res.status(200).json({
      success: true,
      data: safeData,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('Turso fetch error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch data',
      timestamp: Date.now()
    })
  } finally {
    if (client) {
      client.close()
    }
  }
}
`
}
