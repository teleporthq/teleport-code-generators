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

// Escape a string literal for Airtable formula grammar. Strings use
// single quotes; embedded single-quote must be backslash-escaped.
// Backslash itself also escapes.
const escapeAirtableString = (s) => {
  return "'" + String(s).replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'") + "'"
}

// Escape an Airtable field reference name for use inside curly braces.
// Only close-brace and backslash are special inside the braces.
const escapeAirtableFieldRef = (name) => {
  return String(name).replace(/\\\\/g, '\\\\\\\\').replace(/}/g, '\\\\}')
}

const buildAirtableSearchFormula = (rawQuery, rawQueryColumns) => {
  if (typeof rawQuery !== 'string' || rawQuery.trim() === '') return ''
  let cols = []
  if (rawQueryColumns) {
    const parsed = safeJSONParse(rawQueryColumns)
    cols = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : [])
  }
  const validCols = cols.filter((c) => typeof c === 'string' && c.length > 0)
  if (validCols.length === 0) return ''
  const literal = escapeAirtableString(rawQuery)
  const parts = validCols.map(
    (col) => 'SEARCH(' + literal + ', {' + escapeAirtableFieldRef(col) + '})'
  )
  return parts.length === 1 ? parts[0] : 'OR(' + parts.join(',') + ')'
}

export default async function handler(req, res) {
  try {
    const { query, queryColumns, view, limit, page, perPage, sortBy, sortOrder, filters, sorts, offset: offsetParam } = req.query

    const queryParams = new URLSearchParams()
    const formulaParts = []

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
          queryParams.append(\`sort[\${index}][direction]\`, (sort.order || '').toLowerCase().startsWith('desc') ? 'desc' : 'asc')
        })
      }
    } else if (sortBy) {
      queryParams.append('sort[0][field]', sortBy)
      queryParams.append('sort[0][direction]', (sortOrder || '').toLowerCase().startsWith('desc') ? 'desc' : 'asc')
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
          formulaParts.push(filterFormula)
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
          formulaParts.push(filterFormula)
        }
      }
    }

    // Apply the { query, queryColumns } search contract via the
    // Airtable SEARCH() function. Search-term string literal escaping
    // protects against single-quote injection; field-ref escaping
    // protects against close-brace or backslash breaking out of the
    // {field} reference.
    const searchFormula = buildAirtableSearchFormula(query, queryColumns)
    if (searchFormula) {
      formulaParts.push(searchFormula)
    }

    if (formulaParts.length === 1) {
      queryParams.append('filterByFormula', formulaParts[0])
    } else if (formulaParts.length > 1) {
      queryParams.append('filterByFormula', 'AND(' + formulaParts.join(',') + ')')
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
