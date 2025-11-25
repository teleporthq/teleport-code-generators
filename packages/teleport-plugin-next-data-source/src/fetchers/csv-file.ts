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

export default async function handler(req, res) {
  try {
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, offset: offsetParam } = req.query
    
    let filteredData = [...data]
    
    if (query && queryColumns) {
      const columns = JSON.parse(queryColumns)
      filteredData = filteredData.filter((item) => {
        return columns.some((col) => {
          const value = item[col]
          return value && String(value).toLowerCase().includes(query.toLowerCase())
        })
      })
    }
    
    if (filters) {
      const parsedFilters = JSON.parse(filters)
      filteredData = filteredData.filter((item) => {
        return Object.entries(parsedFilters).every(([key, value]) => {
          if (Array.isArray(value)) {
            return value.includes(item[key])
          }
          return item[key] === value
        })
      })
    }
    
    if (sortBy) {
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
    
    const safeData = JSON.parse(JSON.stringify(filteredData))
    
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
