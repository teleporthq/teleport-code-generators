import {
  generateDateFormatterCode,
  generateSortFilterHelperCode,
  generateSafeJSONParseCode,
} from '../utils'

export const validateStaticCollectionConfig = (
  config: Record<string, unknown>
): { isValid: boolean; error?: string } => {
  if (!config || typeof config !== 'object') {
    return { isValid: false, error: 'Config must be a valid object' }
  }

  if (!config.data || !Array.isArray(config.data)) {
    return { isValid: false, error: 'Data must be an array' }
  }

  return { isValid: true }
}

interface StaticCollectionConfig {
  data?: unknown[]
}

export const generateStaticCollectionFetcher = (config: Record<string, unknown>): string => {
  const staticConfig = config as StaticCollectionConfig
  return `const data = ${JSON.stringify(staticConfig.data || [])}

${generateSafeJSONParseCode()}

${generateDateFormatterCode()}

${generateSortFilterHelperCode()}

export default async function handler(req, res) {
  try {
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, sorts, offset: offsetParam } = req.query
    
    let filteredData = [...data]
    
    if (query) {
      const searchQuery = query.toLowerCase()
      
      if (queryColumns) {
        const columns = safeJSONParse(queryColumns)
        filteredData = filteredData.filter((item) => {
          return columns.some((col) => {
            const value = getNestedValue(item, col)
            return value && String(value).toLowerCase().includes(searchQuery)
          })
        })
      } else {
        filteredData = filteredData.filter((item) => {
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
      const parsedFilters = safeJSONParse(filters)
      
      if (Array.isArray(parsedFilters)) {
        filteredData = filteredData.filter((item) => {
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
        filteredData = filteredData.filter((item) => {
          return Object.entries(parsedFilters).every(([key, value]) => {
            const itemValue = getNestedValue(item, key)
            if (Array.isArray(value)) {
              return value.includes(itemValue)
            }
            return compareValues(itemValue, value, '=')
          })
        })
      }
    }
    
    if (sorts) {
      const parsedSorts = safeJSONParse(sorts)
      if (Array.isArray(parsedSorts) && parsedSorts.length > 0) {
        filteredData.sort((a, b) => {
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
    } else if (sortBy) {
      filteredData.sort((a, b) => {
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
    const offsetValue = offsetParam !== undefined ? parseInt(offsetParam) : (page && perPage ? (parseInt(page) - 1) * parseInt(perPage) : 0)
    
    if (limitValue) {
      filteredData = filteredData.slice(offsetValue, offsetValue + parseInt(limitValue))
    }
    
    const safeData = JSON.parse(JSON.stringify(filteredData, dateReplacer))
    
    return res.status(200).json({
      success: true,
      data: safeData,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('Static collection fetch error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch data',
      timestamp: Date.now()
    })
  }
}
`
}

// tslint:disable-next-line:variable-name
export const generateStaticCollectionCountFetcher = (_config: any): string => {
  return `
async function getCount(req, res) {
  try {
    const { query, queryColumns, filters } = req.query
    const fakeReq = { query: { query, queryColumns, filters }, method: 'GET' }
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
