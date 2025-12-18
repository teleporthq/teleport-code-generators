import {
  replaceSecretReference,
  generateDateFormatterCode,
  generateSafeJSONParseCode,
} from '../utils'

export const validateAirtableConfig = (
  config: Record<string, unknown>
): { isValid: boolean; error?: string } => {
  if (!config || typeof config !== 'object') {
    return { isValid: false, error: 'Config must be a valid object' }
  }

  if (!config.baseId || typeof config.baseId !== 'string' || config.baseId.trim() === '') {
    return { isValid: false, error: 'Airtable base ID is required' }
  }

  if (!config.personalAccessToken || typeof config.personalAccessToken !== 'string') {
    return { isValid: false, error: 'Airtable personal access token is required' }
  }

  return { isValid: true }
}

interface AirtableConfig {
  baseId?: string
  personalAccessToken?: string
  selectedTables?: Record<string, unknown>
}

export const generateAirtableFetcher = (
  config: Record<string, unknown>,
  tableName: string
): string => {
  const airtableConfig = config as AirtableConfig
  const baseId = airtableConfig.baseId
  const personalAccessToken = airtableConfig.personalAccessToken

  return `import fetch from 'node-fetch'

${generateSafeJSONParseCode()}

${generateDateFormatterCode()}

export default async function handler(req, res) {
  try {
    const { query, view, limit, page, perPage, sortBy, sortOrder, filters, sorts, offset: offsetParam } = req.query
    
    const queryParams = new URLSearchParams()
    
    if (view) {
      queryParams.append('view', view)
    }
    
    // Handle sorts - new array format
    if (sorts) {
      const parsedSorts = safeJSONParse(sorts)
      if (Array.isArray(parsedSorts) && parsedSorts.length > 0) {
        parsedSorts.forEach((sort, index) => {
          if (!sort.field) return
          queryParams.append(\`sort[\${index}][field]\`, sort.field)
          queryParams.append(\`sort[\${index}][direction]\`, sort.order?.toLowerCase() === 'desc' ? 'desc' : 'asc')
        })
      }
    } else if (sortBy) {
      queryParams.append('sort[0][field]', sortBy)
      queryParams.append('sort[0][direction]', sortOrder || 'asc')
    }
    
    const perPageValue = limit || perPage || 100
    queryParams.append('pageSize', Math.min(parseInt(perPageValue), 100).toString())
    
    const formatAirtableValue = (value) => {
      if (typeof value === 'string') {
        return \`'\${value.replace(/'/g, "\\\\'")}'\`
      } else if (typeof value === 'number') {
        return String(value)
      } else if (typeof value === 'boolean') {
        return value ? 'TRUE()' : 'FALSE()'
      }
      return \`'\${String(value)}'\`
    }
    
    if (filters) {
      const parsedFilters = safeJSONParse(filters)
      
      if (Array.isArray(parsedFilters)) {
        const conditions = parsedFilters.map((filter) => {
          if (!filter.source || filter.destination === undefined) return null
          
          const field = filter.source
          const value = filter.destination
          const operand = filter.operand || '='
          
          if (Array.isArray(value)) {
            if (value.length === 0) return null
            const arrayConditions = value.map((v) => \`{\${field}}=\${formatAirtableValue(v)}\`)
            return arrayConditions.length > 1
              ? \`OR(\${arrayConditions.join(',')})\`
              : arrayConditions[0]
          } else {
            const operatorMap = {
              '=': '=',
              '!=': '!=',
              '>': '>',
              '<': '<',
              '>=': '>=',
              '<=': '<=',
            }
            const airtableOp = operatorMap[operand] || '='
            return \`{\${field}}\${airtableOp}\${formatAirtableValue(value)}\`
          }
        }).filter(Boolean)
        
        if (conditions.length > 0) {
          const filterFormula = conditions.length > 1 ? \`AND(\${conditions.join(',')})\` : conditions[0]
          queryParams.append('filterByFormula', filterFormula)
        }
      } else {
        const conditions = Object.entries(parsedFilters).map(([field, value]) => {
          if (Array.isArray(value)) {
            const arrayConditions = value.map((v) => \`{\${field}}=\${formatAirtableValue(v)}\`)
            return arrayConditions.length > 1
              ? \`OR(\${arrayConditions.join(',')})\`
              : arrayConditions[0]
          } else {
            return \`{\${field}}=\${formatAirtableValue(value)}\`
          }
        })
        
        const filterFormula = conditions.length > 1 ? \`AND(\${conditions.join(',')})\` : conditions[0]
        if (filterFormula) {
          queryParams.append('filterByFormula', filterFormula)
        }
      }
    }
    
    let url = \`https://api.airtable.com/v0/${baseId}/\${encodeURIComponent('${tableName}')}\`
    if (queryParams.toString()) {
      url += \`?\${queryParams.toString()}\`
    }
    
    const allRecords = []
    let airtableOffset
    const skipValue = offsetParam !== undefined ? parseInt(offsetParam) : (page ? (parseInt(page) - 1) * parseInt(perPageValue) : 0)
    const totalRecordsNeeded = skipValue + parseInt(perPageValue)
    
    do {
      const fetchUrl = airtableOffset ? \`\${url}&offset=\${airtableOffset}\` : url
      const response = await fetch(fetchUrl, {
        method: 'GET',
        headers: {
          Authorization: \`Bearer ${replaceSecretReference(personalAccessToken, {
            templateLiteral: true,
          })}\`,
          'Content-Type': 'application/json'
        }
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return res.status(response.status).json({
          success: false,
          error: errorData.error?.message || \`HTTP \${response.status}: \${response.statusText}\`,
          timestamp: Date.now()
        })
      }
      
      const data = await response.json()
      allRecords.push(...data.records)
      airtableOffset = data.offset
      
      if (allRecords.length >= totalRecordsNeeded || !airtableOffset) {
        break
      }
    } while (airtableOffset)
    
    const paginatedRecords = allRecords.slice(skipValue, skipValue + parseInt(perPageValue))
    
    const formattedRecords = paginatedRecords.map((record) => ({
      id: record.id,
      ...record.fields,
      createdTime: record.createdTime
    }))
    
    const safeData = JSON.parse(JSON.stringify(formattedRecords, dateReplacer))
    
    return res.status(200).json({
      success: true,
      data: safeData,
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('Airtable fetch error:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch data',
      timestamp: Date.now()
    })
  }
}
`
}
