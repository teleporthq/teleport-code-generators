export const validateGoogleSheetsConfig = (
  config: Record<string, unknown>
): { isValid: boolean; error?: string } => {
  if (!config || typeof config !== 'object') {
    return { isValid: false, error: 'Config must be a valid object' }
  }

  if (!config.sheetId && !config.sheetUrl) {
    return { isValid: false, error: 'Google Sheets ID or URL is required' }
  }

  if (config.sheetId && typeof config.sheetId !== 'string') {
    return { isValid: false, error: 'Sheet ID must be a string' }
  }

  if (config.sheetUrl) {
    if (typeof config.sheetUrl !== 'string') {
      return { isValid: false, error: 'Sheet URL must be a string' }
    }

    if (!config.sheetUrl.includes('docs.google.com/spreadsheets')) {
      return { isValid: false, error: 'Invalid Google Sheets URL format' }
    }
  }

  return { isValid: true }
}

interface GoogleSheetsConfig {
  sheetId?: string
  sheetUrl?: string
  apiKey?: string
  sheetName?: string
  range?: string
  maxRows?: number
}

export const generateGoogleSheetsFetcher = (config: Record<string, unknown>): string => {
  const sheetsConfig = config as GoogleSheetsConfig
  return `import fetch from 'node-fetch'

export default async function handler(req, res) {
  try {
    const sheetUrl = ${JSON.stringify(sheetsConfig.sheetUrl)}
    let sheetId = ${JSON.stringify(sheetsConfig.sheetId)}
    const range = ${JSON.stringify(sheetsConfig.range || 'A1:Z1000')}
    const maxRows = ${sheetsConfig.maxRows || 0}
    
    if (!sheetId && sheetUrl) {
      const match = sheetUrl.match(/\\/d\\/([a-zA-Z0-9-_]+)/)
      sheetId = match ? match[1] : undefined
    }
    
    if (!sheetId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Google Sheets URL or Sheet ID',
        timestamp: Date.now()
      })
    }
    
    let url = \`https://docs.google.com/spreadsheets/d/\${sheetId}/gviz/tq?tqx=out:json&range=\${range}\`
    
    if (maxRows && maxRows > 0) {
      url += \`&tq=limit \${maxRows}\`
    }
    
    const response = await fetch(url)
    
    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: \`HTTP \${response.status}: \${response.statusText}\`,
        timestamp: Date.now()
      })
    }
    
    const text = await response.text()
    const jsonMatch = text.match(/google\\.visualization\\.Query\\.setResponse\\((.*)\\);/)
    
    if (!jsonMatch) {
      return res.status(500).json({
        success: false,
        error: 'Unable to parse Google Sheets response',
        timestamp: Date.now()
      })
    }
    
    const data = JSON.parse(jsonMatch[1])
    
    if (data.status === 'error') {
      return res.status(500).json({
        success: false,
        error: data.errors?.[0]?.detailed_message || 'Failed to fetch Google Sheets data',
        timestamp: Date.now()
      })
    }
    
    const table = data.table
    const columns = table.cols.map((col, index) => ({
      id: col.id || \`col_\${index}\`,
      label: col.label || \`Column \${index + 1}\`,
      type: col.type || 'string'
    }))
    
    const rows = table.rows.map((row) => {
      const rowData = {}
      row.c.forEach((cell, index) => {
        const columnId = columns[index].id
        rowData[columnId] = cell?.v ?? null
      })
      return rowData
    })
    
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, offset: offsetParam } = req.query
    
    let filteredData = [...rows]
    
    if (query) {
      const searchQuery = query.toLowerCase()
      
      if (queryColumns) {
        const searchColumns = JSON.parse(queryColumns)
        filteredData = filteredData.filter((item) => {
          return searchColumns.some((col) => {
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
    console.error('Google Sheets fetch error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch data',
      timestamp: Date.now()
    })
  }
}
`
}
