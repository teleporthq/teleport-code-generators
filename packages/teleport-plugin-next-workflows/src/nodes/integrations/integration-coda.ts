import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_coda(config: any, context: Record<string, unknown>) {
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
  const apiToken = config.apiToken
  const action = config.action
  const baseUrl = 'https://coda.io/apis/v1/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + apiToken,
  }

  switch (action) {
    case 'create-doc': {
      const response = await fetch(baseUrl + 'docs', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: config.title,
          sourceDoc: config.sourceDocId || undefined,
          folderId: config.folderId || undefined,
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create doc' }
      }
      return { success: true, doc: data }
    }
    case 'get-doc': {
      const response = await fetch(baseUrl + 'docs/' + config.docId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get doc' }
      }
      return { success: true, doc: data }
    }
    case 'list-docs': {
      let url = baseUrl + 'docs'
      const params = []
      if (config.query) {
        params.push('query=' + encodeURIComponent(config.query))
      }
      if (config.limit) {
        params.push('limit=' + config.limit)
      }
      if (config.pageToken) {
        params.push('pageToken=' + encodeURIComponent(config.pageToken))
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
        return { success: false, error: data.message || 'Failed to list docs' }
      }
      return { success: true, docs: data.items, nextPageToken: data.nextPageToken || null }
    }
    case 'create-page': {
      const response = await fetch(baseUrl + 'docs/' + config.docId + '/pages', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: config.name }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed' }
      }
      return { success: true, page: data }
    }
    case 'get-page': {
      const response = await fetch(
        baseUrl + 'docs/' + config.docId + '/pages/' + encodeURIComponent(config.pageIdOrName),
        { method: 'GET', headers }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed' }
      }
      return { success: true, page: data }
    }
    case 'delete-page': {
      const response = await fetch(
        baseUrl + 'docs/' + config.docId + '/pages/' + encodeURIComponent(config.pageIdOrName),
        { method: 'DELETE', headers }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed' }
      }
      return { success: true }
    }
    case 'insert-rows': {
      const response = await fetch(
        baseUrl +
          'docs/' +
          config.docId +
          '/tables/' +
          encodeURIComponent(config.tableIdOrName) +
          '/rows',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ rows: config.rows || [] }),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed' }
      }
      return { success: true, rows: data }
    }
    case 'get-rows': {
      let url =
        baseUrl +
        'docs/' +
        config.docId +
        '/tables/' +
        encodeURIComponent(config.tableIdOrName) +
        '/rows'
      if (config.limit) {
        url += '?limit=' + config.limit
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed' }
      }
      return { success: true, rows: data.items || [] }
    }
    case 'update-row': {
      const response = await fetch(
        baseUrl +
          'docs/' +
          config.docId +
          '/tables/' +
          encodeURIComponent(config.tableIdOrName) +
          '/rows/' +
          encodeURIComponent(config.rowIdOrName),
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ cells: config.cells || [] }),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed' }
      }
      return { success: true, row: data }
    }
    case 'delete-row': {
      const response = await fetch(
        baseUrl +
          'docs/' +
          config.docId +
          '/tables/' +
          encodeURIComponent(config.tableIdOrName) +
          '/rows/' +
          encodeURIComponent(config.rowIdOrName),
        { method: 'DELETE', headers }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed' }
      }
      return { success: true }
    }
    case 'get-tables': {
      const response = await fetch(baseUrl + 'docs/' + config.docId + '/tables', {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed' }
      }
      return { success: true, tables: data.items || [] }
    }
    default:
      throw new Error('Unknown integration-coda action: ' + action)
  }
}
export const integrationCoda: IntegrationHandlerGenerator = {
  nodeType: 'integration-coda',
  executionEnv: 'server',
  secretFields: ['apiToken'],
  generateHandler(): string {
    return handlerToString(integration_coda)
  },
}
