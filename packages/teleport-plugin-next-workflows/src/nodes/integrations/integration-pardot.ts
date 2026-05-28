import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_pardot(config: any, context: Record<string, unknown>) {
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
  const apiKey = config.apiKey || config.accessToken
  const businessUnitId = config.businessUnitId
  const action = config.action
  const baseUrl = 'https://pi.pardot.com/api/v5/objects/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + apiKey,
    'Pardot-Business-Unit-Id': businessUnitId,
  }

  switch (action) {
    case 'create-prospect': {
      const response = await fetch(baseUrl + 'prospects', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: config.email,
          firstName: config.firstName,
          lastName: config.lastName,
          company: config.company,
          fields: config.fields || {},
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to create prospect' }
      }
      return { success: true, prospect: data }
    }
    case 'get-prospect': {
      const response = await fetch(baseUrl + 'prospects/' + config.prospectId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to get prospect' }
      }
      return { success: true, prospect: data }
    }
    case 'query-prospects': {
      let url = baseUrl + 'prospects'
      const params = []
      if (config.fields) {
        params.push('fields=' + encodeURIComponent(config.fields.join(',')))
      }
      if (config.orderBy) {
        params.push('orderBy=' + config.orderBy)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to query prospects' }
      }
      return { success: true, prospects: data.values || [] }
    }
    case 'update-prospect': {
      const body: Record<string, any> = config.updates || {}
      if (config.firstName !== undefined) {
        body.firstName = config.firstName
      }
      if (config.lastName !== undefined) {
        body.lastName = config.lastName
      }
      const response = await fetch(baseUrl + 'prospects/' + config.prospectId, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to update prospect' }
      }
      return { success: true, prospect: data }
    }
    case 'create-list': {
      const response = await fetch(baseUrl + 'lists', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: config.name }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to create list' }
      }
      return { success: true, list: data }
    }
    case 'add-to-list': {
      const response = await fetch(baseUrl + 'listMemberships', {
        method: 'POST',
        headers,
        body: JSON.stringify({ listId: config.listId, prospectId: config.prospectId }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to add to list' }
      }
      return { success: true }
    }
    case 'send-email': {
      const response = await fetch(baseUrl + 'emails', {
        method: 'POST',
        headers,
        body: JSON.stringify(
          config.email || { emailTemplateId: config.templateId, prospectIds: [config.prospectId] }
        ),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to send email' }
      }
      return { success: true, result: data }
    }
    case 'get-campaign': {
      const response = await fetch(baseUrl + 'campaigns/' + config.campaignId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to get campaign' }
      }
      return { success: true, campaign: data }
    }
    default:
      throw new Error('Unknown integration-pardot action: ' + action)
  }
}
export const integrationPardot: IntegrationHandlerGenerator = {
  nodeType: 'integration-pardot',
  executionEnv: 'server',
  secretFields: ['apiKey', 'accessToken'],
  generateHandler(): string {
    return handlerToString(integration_pardot)
  },
}
