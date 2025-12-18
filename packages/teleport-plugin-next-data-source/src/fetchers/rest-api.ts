import {
  generateDateFormatterCode,
  generateSortFilterHelperCode,
  generateSafeJSONParseCode,
} from '../utils'

export const validateRESTAPIConfig = (
  config: Record<string, unknown>
): { isValid: boolean; error?: string } => {
  if (!config || typeof config !== 'object') {
    return { isValid: false, error: 'Config must be a valid object' }
  }

  if (!config.url || typeof config.url !== 'string' || config.url.trim() === '') {
    return { isValid: false, error: 'URL is required' }
  }

  try {
    const url = new URL(config.url)
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { isValid: false, error: 'URL must use HTTP or HTTPS protocol' }
    }
  } catch {
    return { isValid: false, error: 'Invalid URL format' }
  }

  if (config.method) {
    const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
    if (typeof config.method !== 'string' || !validMethods.includes(config.method.toUpperCase())) {
      return { isValid: false, error: 'Invalid HTTP method' }
    }
  }

  return { isValid: true }
}

interface Authorization {
  type?: string
  credentials?: {
    apiKey?: string
    token?: string
    username?: string
    password?: string
    clientSecret?: string
  }
}

const generateAuthCode = (authorization: Authorization): string => {
  if (!authorization || authorization.type === 'none') {
    return ''
  }

  const { type, credentials } = authorization

  switch (type) {
    case 'api-key':
      return `headers['Authorization'] = 'ApiKey ${credentials.apiKey}'`
    case 'bearer-token':
    case 'jwt-bearer':
      return `headers['Authorization'] = 'Bearer ${credentials.token}'`
    case 'basic-auth':
      return `headers['Authorization'] = 'Basic ' + Buffer.from('${credentials.username}:${credentials.password}').toString('base64')`
    case 'oauth2':
      return `headers['Authorization'] = 'Bearer ${credentials.clientSecret}'`
    default:
      return ''
  }
}

interface RESTAPIConfig {
  url?: string
  method?: string
  headers?: Record<string, string>
  authorization?: Authorization
  bodyType?: string
}

export const generateRESTAPIFetcher = (config: Record<string, unknown>): string => {
  const restConfig = config as RESTAPIConfig
  const authCode = generateAuthCode(restConfig.authorization || {})

  return `import fetch from 'node-fetch'

${generateSafeJSONParseCode()}

${generateDateFormatterCode()}

${generateSortFilterHelperCode()}

export default async function handler(req, res) {
  try {
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, sorts, offset } = req.query
    
    const url = ${JSON.stringify(restConfig.url)}
    const method = ${JSON.stringify(restConfig.method || 'GET')}
    
    const headers = ${JSON.stringify(restConfig.headers || {})}
    ${authCode}
    
    const options = {
      method,
      headers
    }
    
    ${
      restConfig.method === 'POST' || restConfig.method === 'PUT' || restConfig.method === 'PATCH'
        ? `
    if (req.body) {
      options.body = ${
        restConfig.bodyType === 'json' || !restConfig.bodyType
          ? 'JSON.stringify(req.body)'
          : 'req.body'
      }
    }
    `
        : ''
    }
    
    const response = await fetch(url, options)
    
    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: \`HTTP \${response.status}: \${response.statusText}\`,
        timestamp: Date.now()
      })
    }
    
    let data = await response.json()
    
    if (Array.isArray(data)) {
      if (query && query.trim()) {
        const searchQuery = query.toLowerCase()
        
        if (queryColumns) {
          try {
            const parsed = safeJSONParse(queryColumns)
            const columns = Array.isArray(parsed) ? parsed : [parsed]
            data = data.filter((item) => {
              return columns.some((col) => {
                const value = getNestedValue(item, col)
                if (value === null || value === undefined) return false
                return String(value).toLowerCase().includes(searchQuery)
              })
            })
          } catch (err) {
            console.error('Error parsing queryColumns:', err)
          }
        } else {
          data = data.filter((item) => {
            try {
              const stringified = JSON.stringify(item).toLowerCase()
              return stringified.includes(searchQuery)
            } catch {
              return false
            }
          })
        }
      }
      
      if (filters) {
        try {
          const parsedFilters = safeJSONParse(filters)
          
          if (Array.isArray(parsedFilters)) {
            data = data.filter((item) => {
              return parsedFilters.every((filter) => {
                if (!filter.source || filter.destination === undefined) return true
                
                const field = filter.source
                const value = getNestedValue(item, field)
                const target = filter.destination
                const operand = filter.operand || '='
                
                if (Array.isArray(target)) {
                  if (operand === '!=') {
                    return !target.includes(value)
                  }
                  return target.includes(value)
                }
                
                return compareValues(value, target, operand)
              })
            })
          } else {
            data = data.filter((item) => {
              return Object.entries(parsedFilters).every(([key, value]) => {
                const itemValue = getNestedValue(item, key)
                if (Array.isArray(value)) {
                  return value.includes(itemValue)
                }
                return compareValues(itemValue, value, '=')
              })
            })
          }
        } catch (err) {
          console.error('Error parsing filters:', err)
        }
      }
      
      if (sorts) {
        try {
          const parsedSorts = safeJSONParse(sorts)
          if (Array.isArray(parsedSorts) && parsedSorts.length > 0) {
            data.sort((a, b) => {
              for (const sort of parsedSorts) {
                if (!sort.field) continue
                const aVal = getNestedValue(a, sort.field)
                const bVal = getNestedValue(b, sort.field)
                const sortOrderValue = sort.order?.toLowerCase() === 'desc' ? -1 : 1
                
                let comparison = 0
                if (aVal === null || aVal === undefined) {
                  comparison = bVal === null || bVal === undefined ? 0 : -1
                } else if (bVal === null || bVal === undefined) {
                  comparison = 1
                } else if (typeof aVal === 'number' && typeof bVal === 'number') {
                  comparison = aVal - bVal
                } else if (aVal instanceof Date && bVal instanceof Date) {
                  comparison = aVal.getTime() - bVal.getTime()
                } else {
                  const aStr = String(aVal)
                  const bStr = String(bVal)
                  if (aStr < bStr) comparison = -1
                  else if (aStr > bStr) comparison = 1
                }
                
                if (comparison !== 0) return comparison * sortOrderValue
              }
              return 0
            })
          }
        } catch (err) {
          console.error('Error parsing sorts:', err)
        }
      } else if (sortBy && sortBy.trim()) {
        data.sort((a, b) => {
          const aVal = getNestedValue(a, sortBy)
          const bVal = getNestedValue(b, sortBy)
          const sortOrderValue = sortOrder?.toLowerCase() === 'desc' ? -1 : 1
          
          let comparison = 0
          if (aVal === null || aVal === undefined) {
            comparison = bVal === null || bVal === undefined ? 0 : -1
          } else if (bVal === null || bVal === undefined) {
            comparison = 1
          } else if (typeof aVal === 'number' && typeof bVal === 'number') {
            comparison = aVal - bVal
          } else if (aVal instanceof Date && bVal instanceof Date) {
            comparison = aVal.getTime() - bVal.getTime()
          } else {
            const aStr = String(aVal)
            const bStr = String(bVal)
            if (aStr < bStr) comparison = -1
            else if (aStr > bStr) comparison = 1
          }
          
          return comparison * sortOrderValue
        })
      }
      
      const limitValue = limit || perPage
      const pageValue = page ? Math.max(1, parseInt(page)) : undefined
      const offsetValue = offset !== undefined ? Math.max(0, parseInt(offset)) : (pageValue && perPage ? (pageValue - 1) * Math.max(1, parseInt(perPage)) : 0)
      
      if (limitValue) {
        const limitInt = Math.max(1, parseInt(limitValue))
        data = data.slice(offsetValue, offsetValue + limitInt)
      } else if (offsetValue > 0) {
        data = data.slice(offsetValue)
      }
    }
    
    const safeData = JSON.parse(JSON.stringify(data, dateReplacer))
    
    return res.status(200).json({
      success: true,
      data: safeData,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('REST API fetch error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch data',
      timestamp: Date.now()
    })
  }
}
`
}
