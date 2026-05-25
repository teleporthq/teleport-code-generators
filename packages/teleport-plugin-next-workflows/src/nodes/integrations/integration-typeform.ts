import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_typeform(config: any, context: Record<string, unknown>) {
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
  const baseUrl = 'https://api.typeform.com/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + accessToken,
  }

  switch (action) {
    case 'create-form': {
      const response = await fetch(baseUrl + 'forms', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: config.title,
          fields: config.fields || [],
          settings: config.settings || {},
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.description || 'Failed to create form' }
      }
      return { success: true, form: data }
    }
    case 'get-form': {
      const response = await fetch(baseUrl + 'forms/' + config.formId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.description || 'Failed to get form' }
      }
      return { success: true, form: data }
    }
    case 'get-responses': {
      let url = baseUrl + 'forms/' + config.formId + '/responses'
      const params = []
      if (config.pageSize) {
        params.push('page_size=' + config.pageSize)
      }
      if (config.since) {
        params.push('since=' + encodeURIComponent(config.since))
      }
      if (config.until) {
        params.push('until=' + encodeURIComponent(config.until))
      }
      if (config.after) {
        params.push('after=' + config.after)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.description || 'Failed to get responses' }
      }
      return {
        success: true,
        responses: data.items || [],
        totalItems: data.total_items,
        pageCount: data.page_count,
      }
    }
    case 'update-form': {
      const body: Record<string, any> = {}
      if (config.title !== undefined) {
        body.title = config.title
      }
      if (config.fields) {
        body.fields = config.fields
      }
      const response = await fetch(baseUrl + 'forms/' + config.formId, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.description || 'Failed to update form' }
      }
      return { success: true, form: data }
    }
    case 'delete-form': {
      const response = await fetch(baseUrl + 'forms/' + config.formId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.description || 'Failed to delete' }
      }
      return { success: true }
    }
    case 'list-forms': {
      let url = baseUrl + 'forms'
      if (config.pageSize) {
        url += '?page_size=' + config.pageSize
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.description || 'Failed to list forms' }
      }
      return { success: true, forms: data.items || [] }
    }
    case 'create-workspace': {
      const response = await fetch(baseUrl + 'workspaces', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: config.name }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.description || 'Failed to create workspace' }
      }
      return { success: true, workspace: data }
    }
    case 'list-workspaces': {
      const response = await fetch(baseUrl + 'workspaces', { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.description || 'Failed to list workspaces' }
      }
      return { success: true, workspaces: data.items || [] }
    }
    default:
      throw new Error('Unknown integration-typeform action: ' + action)
  }
}
export const integrationTypeform: IntegrationHandlerGenerator = {
  nodeType: 'integration-typeform',
  executionEnv: 'server',
  secretFields: ['accessToken'],
  generateHandler(): string {
    return handlerToString(integration_typeform)
  },
}
