import { generateDateFormatterCode } from '../utils'

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

${generateDateFormatterCode()}

export default async function handler(req, res) {
  try {
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, sorts, offset: offsetParam } = req.query
    
    let filteredData = [...data]
    
    if (query) {
      const searchQuery = query.toLowerCase()
      
      if (queryColumns) {
        const columns = JSON.parse(queryColumns)
        filteredData = filteredData.filter((item) => {
          return columns.some((col) => {
            const value = item[col]
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
      const parsedFilters = JSON.parse(filters)
      
      if (Array.isArray(parsedFilters)) {
        filteredData = filteredData.filter((item) => {
          return parsedFilters.every((filter) => {
            if (!filter.source || filter.destination === undefined) return true
            
            const field = filter.source
            const value = filter.destination
            const operand = filter.operand || '='
            const itemValue = item[field]
            
            if (Array.isArray(value)) {
              if (operand === '!=') {
                return !value.includes(itemValue)
              }
              return value.includes(itemValue)
            }
            
            switch (operand) {
              case '=':
                return itemValue === value
              case '!=':
                return itemValue !== value
              case '>':
                return itemValue > value
              case '<':
                return itemValue < value
              case '>=':
                return itemValue >= value
              case '<=':
                return itemValue <= value
              default:
                return itemValue === value
            }
          })
        })
      } else {
        filteredData = filteredData.filter((item) => {
          return Object.entries(parsedFilters).every(([key, value]) => {
            if (Array.isArray(value)) {
              return value.includes(item[key])
            }
            return item[key] === value
          })
        })
      }
    }
    
    // Handle sorts - new array format
    if (sorts) {
      const parsedSorts = JSON.parse(sorts)
      if (Array.isArray(parsedSorts) && parsedSorts.length > 0) {
        filteredData.sort((a, b) => {
          for (const sort of parsedSorts) {
            if (!sort.field) continue
            const aVal = a[sort.field]
            const bVal = b[sort.field]
            const sortOrderValue = sort.order?.toLowerCase() === 'desc' ? -1 : 1
            
            if (aVal < bVal) return -sortOrderValue
            if (aVal > bVal) return sortOrderValue
          }
          return 0
        })
      }
    } else if (sortBy) {
      filteredData.sort((a, b) => {
        const aVal = a[sortBy]
        const bVal = b[sortBy]
        const sortOrderValue = sortOrder?.toLowerCase() === 'desc' ? -1 : 1
        if (aVal < bVal) return -sortOrderValue
        if (aVal > bVal) return sortOrderValue
        return 0
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
