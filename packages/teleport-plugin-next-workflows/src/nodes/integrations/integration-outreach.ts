import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_outreach(config: any, context: Record<string, unknown>) {
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
  const accessToken = config.accessToken || config.apiKey
  const action = config.action
  const baseUrl = 'https://api.outreach.io/api/v2/'
  const headers = {
    'Content-Type': 'application/vnd.api+json',
    Authorization: 'Bearer ' + accessToken,
  }

  switch (action) {
    case 'create-prospect': {
      const response = await fetch(baseUrl + 'prospects', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          data: {
            type: 'prospect',
            attributes: config.attributes || {},
          },
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].detail) || 'Failed to create prospect',
        }
      }
      return { success: true, prospect: data.data }
    }
    case 'get-prospect': {
      const response = await fetch(baseUrl + 'prospects/' + config.prospectId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].detail) || 'Failed to get prospect',
        }
      }
      return { success: true, prospect: data.data }
    }
    case 'list-prospects': {
      let url = baseUrl + 'prospects'
      const params = []
      if (config.pageSize) {
        params.push('page[size]=' + config.pageSize)
      }
      if (config.pageNumber) {
        params.push('page[number]=' + config.pageNumber)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].detail) || 'Failed to list prospects',
        }
      }
      return { success: true, prospects: data.data || [] }
    }
    case 'update-prospect': {
      const response = await fetch(baseUrl + 'prospects/' + config.prospectId, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          data: { type: 'prospect', id: config.prospectId, attributes: config.attributes || {} },
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errors && data.errors[0] && data.errors[0].detail) || 'Failed',
        }
      }
      return { success: true, prospect: data.data }
    }
    case 'delete-prospect': {
      const response = await fetch(baseUrl + 'prospects/' + config.prospectId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.errors && data.errors[0] && data.errors[0].detail) || 'Failed',
        }
      }
      return { success: true }
    }
    case 'create-sequence': {
      const response = await fetch(baseUrl + 'sequences', {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: { type: 'sequence', attributes: config.attributes || {} } }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errors && data.errors[0] && data.errors[0].detail) || 'Failed',
        }
      }
      return { success: true, sequence: data.data }
    }
    case 'get-sequence': {
      const response = await fetch(baseUrl + 'sequences/' + config.sequenceId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errors && data.errors[0] && data.errors[0].detail) || 'Failed',
        }
      }
      return { success: true, sequence: data.data }
    }
    case 'add-to-sequence': {
      const response = await fetch(baseUrl + 'sequenceStates', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          data: {
            type: 'sequenceState',
            attributes: { prospectId: config.prospectId, sequenceId: config.sequenceId },
          },
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errors && data.errors[0] && data.errors[0].detail) || 'Failed',
        }
      }
      return { success: true, sequenceState: data.data }
    }
    case 'create-email': {
      const response = await fetch(baseUrl + 'mailings', {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: { type: 'mailing', attributes: config.attributes || {} } }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errors && data.errors[0] && data.errors[0].detail) || 'Failed',
        }
      }
      return { success: true, email: data.data }
    }
    case 'send-email': {
      const response = await fetch(baseUrl + 'mailings', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          data: {
            type: 'mailing',
            attributes: { ...(config.attributes || {}), status: 'scheduled' },
          },
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errors && data.errors[0] && data.errors[0].detail) || 'Failed',
        }
      }
      return { success: true, email: data.data }
    }
    case 'create-task': {
      const response = await fetch(baseUrl + 'tasks', {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: { type: 'task', attributes: config.attributes || {} } }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errors && data.errors[0] && data.errors[0].detail) || 'Failed',
        }
      }
      return { success: true, task: data.data }
    }
    case 'get-task': {
      const response = await fetch(baseUrl + 'tasks/' + config.taskId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errors && data.errors[0] && data.errors[0].detail) || 'Failed',
        }
      }
      return { success: true, task: data.data }
    }
    case 'list-tasks': {
      let url = baseUrl + 'tasks'
      if (config.pageSize) {
        url += '?page[size]=' + config.pageSize
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errors && data.errors[0] && data.errors[0].detail) || 'Failed',
        }
      }
      return { success: true, tasks: data.data || [] }
    }
    default:
      throw new Error('Unknown integration-outreach action: ' + action)
  }
}
export const integrationOutreach: IntegrationHandlerGenerator = {
  nodeType: 'integration-outreach',
  executionEnv: 'server',
  secretFields: ['accessToken', 'apiKey'],
  generateHandler(): string {
    return handlerToString(integration_outreach)
  },
}
