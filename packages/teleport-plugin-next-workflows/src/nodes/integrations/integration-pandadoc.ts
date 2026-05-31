import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_pandadoc(config: any, context: Record<string, unknown>) {
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
  const baseUrl = 'https://api.pandadoc.com/public/v1/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'API-Key ' + apiKey,
  }

  switch (action) {
    case 'create-document': {
      const body: Record<string, any> = {
        name: config.name,
        recipients: config.recipients || [],
        template_uuid: config.templateId,
      }
      if (config.tokens) {
        body.tokens = config.tokens
      }
      if (config.fields) {
        body.fields = config.fields
      }
      const response = await fetch(baseUrl + 'documents', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.detail || 'Failed to create document' }
      }
      return { success: true, document: data }
    }
    case 'get-document': {
      const response = await fetch(baseUrl + 'documents/' + config.documentId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.detail || 'Failed to get document' }
      }
      return { success: true, document: data }
    }
    case 'list-documents': {
      let url = baseUrl + 'documents'
      const params = []
      if (config.count) {
        params.push('count=' + config.count)
      }
      if (config.page) {
        params.push('page=' + config.page)
      }
      if (config.status) {
        params.push('status=' + config.status)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.detail || 'Failed to list documents' }
      }
      return { success: true, documents: data.results || [] }
    }
    case 'send-document': {
      const response = await fetch(baseUrl + 'documents/' + config.documentId + '/send', {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: config.message || 'Please sign this document' }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.detail || 'Failed to send document' }
      }
      return { success: true }
    }
    case 'download-document': {
      const response = await fetch(baseUrl + 'documents/' + config.documentId + '/download', {
        method: 'GET',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.detail && data.detail) || 'Failed to download document',
        }
      }
      const blob = await response.blob()
      const buffer = await blob.arrayBuffer()
      const base64 =
        typeof (globalThis as any).Buffer !== 'undefined'
          ? (globalThis as any).Buffer.from(buffer).toString('base64')
          : btoa(String.fromCharCode.apply(null, new Uint8Array(buffer)))
      return { success: true, content: base64, contentType: response.headers.get('content-type') }
    }
    case 'create-template': {
      const template: Record<string, any> = { name: config.name }
      if (config.tokens) {
        template.tokens = config.tokens
      }
      if (config.fields) {
        template.fields = config.fields
      }
      const response = await fetch(baseUrl + 'templates', {
        method: 'POST',
        headers,
        body: JSON.stringify(template),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.detail || 'Failed to create template' }
      }
      return { success: true, template: data }
    }
    case 'get-template': {
      const response = await fetch(baseUrl + 'templates/' + config.templateId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.detail || 'Failed to get template' }
      }
      return { success: true, template: data }
    }
    case 'list-templates': {
      let url = baseUrl + 'templates'
      const params = []
      if (config.count) {
        params.push('count=' + config.count)
      }
      if (config.page) {
        params.push('page=' + config.page)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.detail || 'Failed to list templates' }
      }
      return { success: true, templates: data.results || [] }
    }
    default:
      throw new Error('Unknown integration-pandadoc action: ' + action)
  }
}
export const integrationPandadoc: IntegrationHandlerGenerator = {
  nodeType: 'integration-pandadoc',
  executionEnv: 'server',
  secretFields: ['apiKey'],
  generateHandler(): string {
    return handlerToString(integration_pandadoc)
  },
}
