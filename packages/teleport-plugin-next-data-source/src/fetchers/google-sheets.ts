import { generateSortFilterHelperCode, generateSafeJSONParseCode } from '../utils'

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

${generateSafeJSONParseCode()}

${generateSortFilterHelperCode()}

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
    
    let gid = undefined
    if (sheetUrl) {
      const gidMatch = sheetUrl.match(/[#&]gid=([0-9]+)/)
      gid = gidMatch ? gidMatch[1] : undefined
    }
    
    let url = \`https://docs.google.com/spreadsheets/d/\${sheetId}/gviz/tq?tqx=out:json&range=\${range}\`
    
    if (gid) {
      url += \`&gid=\${gid}\`
    }
    
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
    
    const formatDateValue = (date) => {
      const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }
      
      const timeOptions = {
        hour: '2-digit',
        minute: '2-digit',
      }
      
      const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0 || date.getSeconds() !== 0
      
      if (hasTime) {
        return date.toLocaleString('en-US', { ...options, ...timeOptions })
      }
      
      return date.toLocaleDateString('en-US', options)
    }
    
    const parseGoogleSheetsValue = (value) => {
      if (typeof value === 'string') {
        const dateMatch = value.match(/^Date\\((\\d+),(\\d+),(\\d+)(?:,(\\d+),(\\d+),(\\d+))?\\)$/)
        if (dateMatch) {
          const year = parseInt(dateMatch[1], 10)
          const month = parseInt(dateMatch[2], 10)
          const day = parseInt(dateMatch[3], 10)
          const hour = dateMatch[4] ? parseInt(dateMatch[4], 10) : 0
          const minute = dateMatch[5] ? parseInt(dateMatch[5], 10) : 0
          const second = dateMatch[6] ? parseInt(dateMatch[6], 10) : 0
          const date = new Date(year, month, day, hour, minute, second)
          return formatDateValue(date)
        }
      }
      return value
    }
    
    const table = data.table
    const rawRows = table.rows || []
    
    if (rawRows.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        timestamp: Date.now()
      })
    }
    
    const firstRow = rawRows[0]
    const firstRowValues = firstRow.c.map((cell) => cell?.v ?? cell?.f ?? null)
    
    const hasHeaderRow = firstRowValues.every((val) => 
      val !== null && val !== undefined && val !== '' && typeof val === 'string'
    )
    
    let columns
    let dataRows
    
    if (hasHeaderRow && rawRows.length > 1) {
      columns = firstRowValues.map((headerValue, index) => ({
        id: \`col_\${index}\`,
        label: String(headerValue),
        type: 'string'
      }))
      dataRows = rawRows.slice(1)
    } else {
      columns = table.cols.map((col, index) => ({
        id: col.id || \`col_\${index}\`,
        label: col.label || \`Column \${index + 1}\`,
        type: col.type || 'string'
      }))
      dataRows = rawRows
    }
    
    if (maxRows && dataRows.length > maxRows) {
      dataRows = dataRows.slice(0, maxRows)
    }
    
    const rows = dataRows.map((row) => {
      const rowData = {}
      row.c.forEach((cell, index) => {
        const columnId = columns[index]?.id || \`col_\${index}\`
        const rawValue = cell?.v ?? cell?.f ?? null
        rowData[columnId] = parseGoogleSheetsValue(rawValue)
      })
      return rowData
    })
    
    const columnsWithData = columns.filter((col, index) => {
      const hasHeaderData = col.label && col.label !== \`Column \${index + 1}\`
      const hasDataInColumn = rows.some((row) => {
        const value = row[col.id]
        return value !== null && value !== undefined && value !== ''
      })
      return hasHeaderData || hasDataInColumn
    })
    
    const filteredRows = rows.map((row) => {
      const filteredRow = {}
      columnsWithData.forEach((col) => {
        filteredRow[col.id] = row[col.id]
      })
      return filteredRow
    })
    
    const { query, queryColumns, limit, page, perPage, sortBy, sortOrder, filters, sorts, offset: offsetParam } = req.query
    
    // Create label-to-ID mapping for filters and sorts
    const labelToIdMap = {}
    columnsWithData.forEach((col) => {
      labelToIdMap[col.label] = col.id
    })
    
    let filteredData = [...filteredRows]
    
    if (query) {
      const searchQuery = query.toLowerCase()
      
      if (queryColumns) {
        const searchColumns = safeJSONParse(queryColumns)
        filteredData = filteredData.filter((item) => {
          return searchColumns.some((col) => {
            // Map label to column ID
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
            
            // Map label to column ID
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
            // Map label to column ID
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
            // Map label to column ID
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
      filteredData.sort((a, b) => {
        // Map label to column ID
        const field = labelToIdMap[sortBy] || sortBy
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
