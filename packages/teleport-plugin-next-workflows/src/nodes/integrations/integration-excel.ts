import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_excel(config: any, context: Record<string, unknown>) {
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
  const accessToken = config.accessToken
  const action = config.action
  const baseUrl = 'https://graph.microsoft.com/v1.0/me/drive/items/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + accessToken,
  }

  switch (action) {
    case 'create-workbook': {
      const response = await fetch(
        'https://graph.microsoft.com/v1.0/me/drive/root:/' +
          encodeURIComponent(config.fileName || 'Workbook.xlsx') +
          ':/content',
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            Authorization: 'Bearer ' + accessToken,
          },
          body: config.content || '',
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create workbook',
        }
      }
      return { success: true, workbook: data }
    }
    case 'get-workbook': {
      const response = await fetch(baseUrl + config.workbookId + '/workbook/worksheets', {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get workbook',
        }
      }
      return { success: true, worksheets: data.value }
    }
    case 'add-row': {
      const worksheetName = config.worksheetName || 'Sheet1'
      const response = await fetch(
        baseUrl +
          config.workbookId +
          '/workbook/worksheets/' +
          encodeURIComponent(worksheetName) +
          '/tables/' +
          config.tableId +
          '/rows',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            values: [config.values || []],
          }),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data.error && data.error.message) || 'Failed to add row' }
      }
      return { success: true, row: data }
    }
    case 'create-worksheet': {
      const response = await fetch(baseUrl + config.workbookId + '/workbook/worksheets/add', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: config.name }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create worksheet',
        }
      }
      return { success: true, worksheet: data }
    }
    case 'update-range': {
      const response = await fetch(
        baseUrl +
          config.workbookId +
          '/workbook/worksheets/' +
          encodeURIComponent(config.worksheetName || 'Sheet1') +
          "/range(address='" +
          config.range +
          "')",
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ values: config.values }),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to update range',
        }
      }
      return { success: true, range: data }
    }
    case 'get-range': {
      const response = await fetch(
        baseUrl +
          config.workbookId +
          '/workbook/worksheets/' +
          encodeURIComponent(config.worksheetName || 'Sheet1') +
          "/range(address='" +
          config.range +
          "')",
        { method: 'GET', headers }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get range',
        }
      }
      return { success: true, range: data }
    }
    case 'get-rows': {
      const response = await fetch(
        baseUrl +
          config.workbookId +
          '/workbook/worksheets/' +
          encodeURIComponent(config.worksheetName || 'Sheet1') +
          '/tables/' +
          config.tableId +
          '/rows',
        { method: 'GET', headers }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data.error && data.error.message) || 'Failed to get rows' }
      }
      return { success: true, rows: data.value }
    }
    case 'create-table': {
      const response = await fetch(
        baseUrl +
          config.workbookId +
          '/workbook/worksheets/' +
          encodeURIComponent(config.worksheetName || 'Sheet1') +
          '/tables/add',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            address: config.range || 'A1',
            hasHeaders: config.hasHeaders !== false,
          }),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create table',
        }
      }
      return { success: true, table: data }
    }
    default:
      throw new Error('Unknown integration-excel action: ' + action)
  }
}
export const integrationExcel: IntegrationHandlerGenerator = {
  nodeType: 'integration-excel',
  executionEnv: 'server',
  secretFields: ['accessToken'],
  generateHandler(): string {
    return handlerToString(integration_excel)
  },
}
