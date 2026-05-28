import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_pipedrive(config: any, context: Record<string, unknown>) {
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
  const baseUrl = 'https://api.pipedrive.com/v1/'
  const headers = {
    'Content-Type': 'application/json',
  }

  function withToken(url: string) {
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'api_token=' + apiToken
  }

  switch (action) {
    case 'create-deal': {
      const response = await fetch(withToken(baseUrl + 'deals'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: config.title,
          value: config.value,
          currency: config.currency || 'USD',
          person_id: config.personId,
          org_id: config.orgId,
          stage_id: config.stageId,
        }),
      })
      const data = await __readJson(response)
      if (!data.success) {
        return { success: false, error: data.error || 'Failed to create deal' }
      }
      return { success: true, deal: data.data }
    }
    case 'get-deal': {
      const response = await fetch(withToken(baseUrl + 'deals/' + config.dealId), {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!data.success) {
        return { success: false, error: data.error || 'Failed to get deal' }
      }
      return { success: true, deal: data.data }
    }
    case 'list-deals': {
      let url = baseUrl + 'deals'
      const params = []
      if (config.limit) {
        params.push('limit=' + config.limit)
      }
      if (config.start) {
        params.push('start=' + config.start)
      }
      if (config.status) {
        params.push('status=' + config.status)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(withToken(url), { method: 'GET', headers })
      const data = await __readJson(response)
      if (!data.success) {
        return { success: false, error: data.error || 'Failed to list deals' }
      }
      return { success: true, deals: data.data || [] }
    }
    case 'update-deal': {
      const response = await fetch(withToken(baseUrl + 'deals/' + config.dealId), {
        method: 'PUT',
        headers,
        body: JSON.stringify(config.updates || {}),
      })
      const data = await __readJson(response)
      if (!data.success) {
        return { success: false, error: data.error || 'Failed' }
      }
      return { success: true, deal: data.data }
    }
    case 'delete-deal': {
      const response = await fetch(withToken(baseUrl + 'deals/' + config.dealId), {
        method: 'DELETE',
        headers,
      })
      const data = await __readJson(response)
      if (!data.success) {
        return { success: false, error: data.error || 'Failed' }
      }
      return { success: true }
    }
    case 'create-person': {
      const response = await fetch(withToken(baseUrl + 'persons'), {
        method: 'POST',
        headers,
        body: JSON.stringify(config.person || { name: config.name, email: config.email }),
      })
      const data = await __readJson(response)
      if (!data.success) {
        return { success: false, error: data.error || 'Failed' }
      }
      return { success: true, person: data.data }
    }
    case 'get-person': {
      const response = await fetch(withToken(baseUrl + 'persons/' + config.personId), {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!data.success) {
        return { success: false, error: data.error || 'Failed' }
      }
      return { success: true, person: data.data }
    }
    case 'update-person': {
      const response = await fetch(withToken(baseUrl + 'persons/' + config.personId), {
        method: 'PUT',
        headers,
        body: JSON.stringify(config.updates || {}),
      })
      const data = await __readJson(response)
      if (!data.success) {
        return { success: false, error: data.error || 'Failed' }
      }
      return { success: true, person: data.data }
    }
    case 'delete-person': {
      const response = await fetch(withToken(baseUrl + 'persons/' + config.personId), {
        method: 'DELETE',
        headers,
      })
      const data = await __readJson(response)
      if (!data.success) {
        return { success: false, error: data.error || 'Failed' }
      }
      return { success: true }
    }
    case 'create-organization': {
      const response = await fetch(withToken(baseUrl + 'organizations'), {
        method: 'POST',
        headers,
        body: JSON.stringify(config.org || { name: config.name }),
      })
      const data = await __readJson(response)
      if (!data.success) {
        return { success: false, error: data.error || 'Failed' }
      }
      return { success: true, organization: data.data }
    }
    case 'get-organization': {
      const response = await fetch(withToken(baseUrl + 'organizations/' + config.orgId), {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!data.success) {
        return { success: false, error: data.error || 'Failed' }
      }
      return { success: true, organization: data.data }
    }
    case 'create-activity': {
      const response = await fetch(withToken(baseUrl + 'activities'), {
        method: 'POST',
        headers,
        body: JSON.stringify(
          config.activity || {
            type: config.type,
            subject: config.subject,
            due_date: config.dueDate,
          }
        ),
      })
      const data = await __readJson(response)
      if (!data.success) {
        return { success: false, error: data.error || 'Failed' }
      }
      return { success: true, activity: data.data }
    }
    case 'list-activities': {
      let url = baseUrl + 'activities'
      if (config.limit) {
        url += '?limit=' + config.limit
      }
      const response = await fetch(withToken(url), { method: 'GET', headers })
      const data = await __readJson(response)
      if (!data.success) {
        return { success: false, error: data.error || 'Failed' }
      }
      return { success: true, activities: data.data || [] }
    }
    default:
      throw new Error('Unknown integration-pipedrive action: ' + action)
  }
}
export const integrationPipedrive: IntegrationHandlerGenerator = {
  nodeType: 'integration-pipedrive',
  executionEnv: 'server',
  secretFields: ['apiToken'],
  generateHandler(): string {
    return handlerToString(integration_pipedrive)
  },
}
