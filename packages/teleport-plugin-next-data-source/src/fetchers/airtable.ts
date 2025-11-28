import { replaceSecretReference } from '../utils'

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

export default async function handler(req, res) {
  try {
    const { query, view, limit, page, perPage, sortBy, sortOrder, filters, offset: offsetParam } = req.query
    
    const queryParams = new URLSearchParams()
    
    if (view) {
      queryParams.append('view', view)
    }
    
    if (sortBy) {
      queryParams.append('sort[0][field]', sortBy)
      queryParams.append('sort[0][direction]', sortOrder || 'asc')
    }
    
    const perPageValue = limit || perPage || 100
    queryParams.append('pageSize', Math.min(parseInt(perPageValue), 100).toString())
    
    if (filters) {
      const parsedFilters = JSON.parse(filters)
      const conditions = Object.entries(parsedFilters).map(([field, value]) => {
        if (Array.isArray(value)) {
          const arrayConditions = value.map((v) => {
            if (typeof v === 'string') {
              return \`{\${field}}='\${v.replace(/'/g, "\\\\'")}'\`
            } else if (typeof v === 'number') {
              return \`{\${field}}=\${v}\`
            } else if (typeof v === 'boolean') {
              return \`{\${field}}=\${v ? 'TRUE()' : 'FALSE()'}\`
            }
            return \`{\${field}}='\${String(v)}'\`
          })
          return arrayConditions.length > 1
            ? \`OR(\${arrayConditions.join(',')})\`
            : arrayConditions[0]
        } else if (typeof value === 'string') {
          return \`{\${field}}='\${value.replace(/'/g, "\\\\'")}'\`
        } else if (typeof value === 'number') {
          return \`{\${field}}=\${value}\`
        } else if (typeof value === 'boolean') {
          return \`{\${field}}=\${value ? 'TRUE()' : 'FALSE()'}\`
        }
        return \`{\${field}}='\${String(value)}'\`
      })
      
      const filterFormula = conditions.length > 1 ? \`AND(\${conditions.join(',')})\` : conditions[0]
      if (filterFormula) {
        queryParams.append('filterByFormula', filterFormula)
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
    
    const safeData = JSON.parse(JSON.stringify(formattedRecords))
    
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
