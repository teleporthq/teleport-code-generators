import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_copper(config: any, context: Record<string, unknown>) {
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
  const email = config.email
  const action = config.action
  const baseUrl = 'https://api.copper.com/developer_api/v1/'
  const headers = {
    'Content-Type': 'application/json',
    'X-PW-AccessToken': apiKey,
    'X-PW-Application': 'developer_api',
    'X-PW-UserEmail': email,
  }

  switch (action) {
    case 'create-person': {
      const response = await fetch(baseUrl + 'people', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: config.name,
          emails: config.personEmail ? [{ email: config.personEmail, category: 'work' }] : [],
          phone_numbers: config.phone ? [{ number: config.phone, category: 'work' }] : [],
          company_id: config.companyId || null,
          title: config.title || '',
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create person' }
      }
      return { success: true, person: data }
    }
    case 'get-person': {
      const response = await fetch(baseUrl + 'people/' + config.personId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get person' }
      }
      return { success: true, person: data }
    }
    case 'list-people': {
      const response = await fetch(baseUrl + 'people/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          page_number: config.page || 1,
          page_size: config.pageSize || 20,
          sort_by: config.sortBy || 'name',
          sort_direction: config.sortDirection || 'asc',
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list people' }
      }
      return { success: true, people: data }
    }
    case 'update-person': {
      const body: Record<string, any> = config.updates || {}
      if (config.name !== undefined) {
        body.name = config.name
      }
      const response = await fetch(baseUrl + 'people/' + config.personId, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update person' }
      }
      return { success: true, person: data }
    }
    case 'delete-person': {
      const response = await fetch(baseUrl + 'people/' + config.personId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to delete person' }
      }
      return { success: true }
    }
    case 'create-company': {
      const response = await fetch(baseUrl + 'companies', {
        method: 'POST',
        headers,
        body: JSON.stringify(config.company || { name: config.name }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create company' }
      }
      return { success: true, company: data }
    }
    case 'create-opportunity': {
      const response = await fetch(baseUrl + 'opportunities', {
        method: 'POST',
        headers,
        body: JSON.stringify(
          config.opportunity || {
            name: config.name,
            primary_contact_id: config.contactId,
            pipeline_id: config.pipelineId,
            pipeline_stage_id: config.stageId,
          }
        ),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create opportunity' }
      }
      return { success: true, opportunity: data }
    }
    case 'list-opportunities': {
      const response = await fetch(baseUrl + 'opportunities/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({ page_number: config.page || 1, page_size: config.pageSize || 20 }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list opportunities' }
      }
      return { success: true, opportunities: data }
    }
    default:
      throw new Error('Unknown integration-copper action: ' + action)
  }
}
export const integrationCopper: IntegrationHandlerGenerator = {
  nodeType: 'integration-copper',
  executionEnv: 'server',
  secretFields: ['apiKey', 'email'],
  generateHandler(): string {
    return handlerToString(integration_copper)
  },
}
