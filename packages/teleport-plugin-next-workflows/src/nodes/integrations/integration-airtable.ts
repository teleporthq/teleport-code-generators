import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_airtable(config: any, context: Record<string, unknown>) {
  // Safely parse a fetch response: providers (Dropbox, Stripe legacy errors,
  // Slack rate-limit pages, …) sometimes return plain text on failure.
  // We read once as text and only parse JSON when it actually parses.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const __readJson = async (resp: any): Promise<any> => {
    const text = await resp.text()
    if (!text) {
      return {}
    }
    try {
      return JSON.parse(text)
    } catch (e: unknown) {
      void e
      return { error_summary: text, error: text, message: text, raw: text }
    }
  }
  const apiKey = config.apiKey
  const action = config.action
  const baseId = config.baseId
  const tableId = config.tableId
  const baseUrl = 'https://api.airtable.com/v0/' + baseId + '/' + tableId
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + apiKey,
  }

  switch (action) {
    case 'create-record': {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fields: config.fields || {},
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create record',
        }
      }
      return { success: true, record: data }
    }
    case 'get-record': {
      const response = await fetch(baseUrl + '/' + config.recordId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get record',
        }
      }
      return { success: true, record: data }
    }
    case 'list-records': {
      let url = baseUrl
      const params = []
      if (config.maxRecords) {
        params.push('maxRecords=' + config.maxRecords)
      }
      if (config.view) {
        params.push('view=' + encodeURIComponent(config.view))
      }
      if (config.pageSize) {
        params.push('pageSize=' + config.pageSize)
      }
      if (config.offset) {
        params.push('offset=' + encodeURIComponent(config.offset))
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to list records',
        }
      }
      return { success: true, records: data.records, offset: data.offset || null }
    }
    case 'create-multiple-records': {
      const records = (config.records || []).map(function (r: Record<string, any>) {
        return { fields: r.fields || r }
      })
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ records, typecast: config.typecast === true }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create records',
        }
      }
      return { success: true, records: data.records || [] }
    }
    case 'update-record': {
      const response = await fetch(baseUrl + '/' + config.recordId, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ fields: config.fields || {}, typecast: config.typecast === true }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to update record',
        }
      }
      return { success: true, record: data }
    }
    case 'update-multiple-records': {
      const records = (config.records || []).map(function (r: Record<string, any>) {
        return { id: r.id, fields: r.fields || {} }
      })
      const response = await fetch(baseUrl, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ records, typecast: config.typecast === true }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to update records',
        }
      }
      return { success: true, records: data.records || [] }
    }
    case 'delete-record': {
      const response = await fetch(baseUrl + '/' + config.recordId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to delete record',
        }
      }
      return { success: true }
    }
    case 'delete-multiple-records': {
      const ids = (config.recordIds || []).slice(0, 10)
      if (ids.length === 0) {
        return { success: false, error: 'No record IDs provided' }
      }
      const qs = ids
        .map(function (id: string) {
          return 'records[]=' + id
        })
        .join('&')
      const response = await fetch(baseUrl + '?' + qs, { method: 'DELETE', headers })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to delete records',
        }
      }
      return { success: true }
    }
    case 'search-records': {
      let url = baseUrl
      const params = []
      if (config.filterByFormula) {
        params.push('filterByFormula=' + encodeURIComponent(config.filterByFormula))
      }
      if (config.maxRecords) {
        params.push('maxRecords=' + config.maxRecords)
      }
      if (config.sort) {
        const sortArr = Array.isArray(config.sort) ? config.sort : [config.sort]
        sortArr.forEach(function (s: Record<string, any>) {
          params.push('sort[0][field]=' + encodeURIComponent(s.field || s))
          params.push('sort[0][direction]=' + (s.direction || 'asc'))
        })
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to search records',
        }
      }
      return { success: true, records: data.records || [], offset: data.offset || null }
    }
    default:
      throw new Error('Unknown integration-airtable action: ' + action)
  }
}
export const integrationAirtable: IntegrationHandlerGenerator = {
  nodeType: 'integration-airtable',
  executionEnv: 'server',
  secretFields: ['apiKey'],
  generateHandler(): string {
    return handlerToString(integration_airtable)
  },
}
