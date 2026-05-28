import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_tableau(config: any, context: Record<string, unknown>) {
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
  const accessToken = config.accessToken || config.tokenValue
  const siteId = config.siteId
  const action = config.action
  const serverUrl = config.serverUrl || 'https://10ax.online.tableau.com'
  const baseUrl = serverUrl + '/api/3.21/sites/' + siteId + '/'
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Tableau-Auth': accessToken,
  }

  switch (action) {
    case 'list-workbooks': {
      let url = baseUrl + 'workbooks'
      const params = []
      if (config.pageSize) {
        params.push('pageSize=' + config.pageSize)
      }
      if (config.pageNumber) {
        params.push('pageNumber=' + config.pageNumber)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.summary) || 'Failed to list workbooks',
        }
      }
      return { success: true, workbooks: (data.workbooks && data.workbooks.workbook) || [] }
    }
    case 'get-workbook': {
      const response = await fetch(baseUrl + 'workbooks/' + config.workbookId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.summary) || 'Failed to get workbook',
        }
      }
      return { success: true, workbook: data.workbook }
    }
    case 'list-views': {
      const url = config.workbookId
        ? baseUrl + 'workbooks/' + config.workbookId + '/views'
        : baseUrl + 'views'
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.summary) || 'Failed to list views',
        }
      }
      return { success: true, views: (data.views && data.views.view) || [] }
    }
    case 'publish-workbook': {
      const formData = new FormData()
      formData.append('workbookType', config.workbookType || 'Workbook')
      if (config.file) {
        formData.append('request_payload', new Blob([config.file]))
      }
      const response = await fetch(baseUrl + 'workbooks', {
        method: 'POST',
        headers: { 'X-Tableau-Auth': accessToken },
        body: formData,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data.error && data.error.summary) || 'Failed to publish' }
      }
      return { success: true, workbook: data.workbook }
    }
    case 'get-view': {
      const response = await fetch(baseUrl + 'views/' + config.viewId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data.error && data.error.summary) || 'Failed to get view' }
      }
      return { success: true, view: data.view }
    }
    case 'download-view': {
      const response = await fetch(baseUrl + 'views/' + config.viewId + '/image', {
        method: 'GET',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: (data.error && data.error.summary) || 'Failed to download' }
      }
      const buf = await response.arrayBuffer()
      return {
        success: true,
        content:
          typeof Buffer !== 'undefined'
            ? Buffer.from(buf).toString('base64')
            : btoa(String.fromCharCode.apply(null, new Uint8Array(buf) as any)),
      }
    }
    case 'list-datasources': {
      const response = await fetch(baseUrl + 'datasources', { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.summary) || 'Failed to list datasources',
        }
      }
      return { success: true, datasources: (data.datasources && data.datasources.datasource) || [] }
    }
    case 'refresh-datasource': {
      const response = await fetch(baseUrl + 'datasources/' + config.datasourceId + '/refresh', {
        method: 'POST',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: (data.error && data.error.summary) || 'Failed to refresh' }
      }
      return { success: true }
    }
    default:
      throw new Error('Unknown integration-tableau action: ' + action)
  }
}
export const integrationTableau: IntegrationHandlerGenerator = {
  nodeType: 'integration-tableau',
  executionEnv: 'server',
  secretFields: ['accessToken', 'tokenValue'],
  generateHandler(): string {
    return handlerToString(integration_tableau)
  },
}
