import {
  generateDateFormatterCode,
  generateSortFilterHelperCode,
  generateSafeJSONParseCode,
} from '../utils'

export const validateCSVConfig = (
  config: Record<string, unknown>
): { isValid: boolean; error?: string } => {
  if (!config || typeof config !== 'object') {
    return { isValid: false, error: 'Config must be a valid object' }
  }

  if (!config.parsedData || !Array.isArray(config.parsedData)) {
    return { isValid: false, error: 'Parsed data must be an array' }
  }

  // Columns are optional - if not provided, we'll infer them from parsedData
  if (config.columns !== undefined) {
    if (!Array.isArray(config.columns)) {
      return { isValid: false, error: 'Columns definition must be an array' }
    }

    for (const column of config.columns) {
      if (!column || typeof column !== 'object' || !column.id || typeof column.id !== 'string') {
        return { isValid: false, error: 'Each column must have a valid id' }
      }
    }
  }

  return { isValid: true }
}

interface CSVFileConfig {
  parsedData?: unknown[]
  columns?: Array<{ id: string; [key: string]: unknown }>
}

export const generateCSVFileFetcher = (config: Record<string, unknown>): string => {
  const csvConfig = config as CSVFileConfig
  return `const data = ${JSON.stringify(csvConfig.parsedData || [])}
const columns = ${JSON.stringify(csvConfig.columns || [])}

${generateSafeJSONParseCode()}

${generateDateFormatterCode()}

${generateSortFilterHelperCode()}

export default async function handler(req, res) {
  try {
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, sorts, offset: offsetParam } = req.query
    
    const labelToIdMap = {}
    columns.forEach((col) => {
      if (col.label && col.id) {
        labelToIdMap[col.label] = col.id
      }
    })
    
    let filteredData = [...data]
    
    if (query) {
      const searchQuery = query.toLowerCase()
      
      if (queryColumns) {
        const searchColumns = safeJSONParse(queryColumns)
        filteredData = filteredData.filter((item) => {
          return searchColumns.some((col) => {
            const field = labelToIdMap[col] || col
            const value = getNestedValue(item, field)
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
            
            const field = labelToIdMap[filter.source] || filter.source
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
            const field = labelToIdMap[key] || key
            const itemValue = getNestedValue(item, field)
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
            const field = labelToIdMap[sort.field] || sort.field
            const aVal = getNestedValue(a, field)
            const bVal = getNestedValue(b, field)
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
      const field = labelToIdMap[sortBy] || sortBy
      filteredData.sort((a, b) => {
        const aVal = getNestedValue(a, field)
        const bVal = getNestedValue(b, field)
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
    console.error('CSV fetch error:', error)
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
export const generateCSVCountFetcher = (_config: any): string => {
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
