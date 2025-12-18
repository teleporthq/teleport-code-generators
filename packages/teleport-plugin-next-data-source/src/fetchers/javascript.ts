import {
  generateDateFormatterCode,
  generateSortFilterHelperCode,
  generateSafeJSONParseCode,
} from '../utils'

export const validateJavaScriptConfig = (
  config: Record<string, unknown>
): { isValid: boolean; error?: string } => {
  if (!config || typeof config !== 'object') {
    return { isValid: false, error: 'Config must be a valid object' }
  }

  if (!config.code || typeof config.code !== 'string' || config.code.trim() === '') {
    return { isValid: false, error: 'JavaScript code is required' }
  }

  const dangerousPatterns = [
    /require\s*\(/i,
    /import\s+/i,
    /eval\s*\(/i,
    /Function\s*\(/i,
    /process\./i,
    /global\./i,
    /\.exec\s*\(/i,
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(config.code)) {
      console.warn('[Data Source] Warning: JavaScript code contains potentially dangerous patterns')
      break
    }
  }

  return { isValid: true }
}

interface JavaScriptConfig {
  code?: string
}

export const generateJavaScriptFetcher = (config: Record<string, unknown>): string => {
  const jsConfig = config as JavaScriptConfig
  return `${generateSafeJSONParseCode()}

${generateDateFormatterCode()}

${generateSortFilterHelperCode()}

export default async function handler(req, res) {
  try {
    const { limit, offset, page, perPage, query, queryColumns, sortBy, sortOrder, filters, sorts } = req.query
    
    const code = ${JSON.stringify(jsConfig.code)}
    const executeCode = new Function('return ' + code)
    let data = executeCode()
    
    if (Array.isArray(data)) {
      if (query && query.trim()) {
        const searchQuery = query.toLowerCase()
        
        if (queryColumns) {
          try {
            const parsed = safeJSONParse(queryColumns)
            const columns = Array.isArray(parsed) ? parsed : [parsed]
            data = data.filter(item => {
              return columns.some(col => {
                const value = getNestedValue(item, col)
                if (value === null || value === undefined) return false
                return String(value).toLowerCase().includes(searchQuery)
              })
            })
          } catch (err) {
            console.error('Error parsing queryColumns:', err)
          }
        } else {
          data = data.filter(item => {
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
    console.error('JavaScript execution error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to execute code',
      timestamp: Date.now()
    })
  }
}
`
}

// tslint:disable-next-line:variable-name
export const generateJavaScriptCountFetcher = (_config: any): string => {
  return `
async function getCount(req, res) {
  try {
    const { query, queryColumns } = req.query
    const fakeReq = { query: { query, queryColumns }, method: 'GET' }
    let result = null
    let statusCode = 200
    
    const fakeRes = {
      status: (code) => {
        statusCode = code
        return fakeRes
      },
      json: (data) => {
        result = data
        return fakeRes
      },
    }
    
    await handler(fakeReq, fakeRes)
    
    if (statusCode !== 200 || !result || !result.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to get data for counting',
        timestamp: Date.now()
      })
    }
    
    const count = Array.isArray(result.data) ? result.data.length : 0
    
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
  }
}
`
}
