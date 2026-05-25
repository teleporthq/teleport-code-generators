import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_insightly(config: any, context: Record<string, unknown>) {
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
  const baseUrl = 'https://api.insightly.com/v3.1/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Basic ' + btoa(apiKey + ':'),
  }

  switch (action) {
    case 'list-contacts': {
      let url = baseUrl + 'Contacts'
      const params = []
      if (config.top) {
        params.push('top=' + config.top)
      }
      if (config.skip) {
        params.push('skip=' + config.skip)
      }
      if (config.orderby) {
        params.push('orderby=' + encodeURIComponent(config.orderby))
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
        return { success: false, error: data.Message || 'Failed to list contacts' }
      }
      return { success: true, contacts: data }
    }
    case 'get-contact': {
      const response = await fetch(baseUrl + 'Contacts/' + config.contactId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.Message || 'Failed to get contact' }
      }
      return { success: true, contact: data }
    }
    case 'create-contact': {
      const body: Record<string, any> = {}
      if (config.firstName) {
        body.FIRST_NAME = config.firstName
      }
      if (config.lastName) {
        body.LAST_NAME = config.lastName
      }
      if (config.email) {
        body.EMAIL_ADDRESS = config.email
      }
      if (config.phone) {
        body.PHONE = config.phone
      }
      if (config.organisationId) {
        body.ORGANISATION_ID = config.organisationId
      }
      const response = await fetch(baseUrl + 'Contacts', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.Message || 'Failed to create contact' }
      }
      return { success: true, contact: data }
    }
    case 'update-contact': {
      const body: Record<string, any> = config.fields || {}
      if (config.firstName !== undefined) {
        body.FIRST_NAME = config.firstName
      }
      if (config.lastName !== undefined) {
        body.LAST_NAME = config.lastName
      }
      if (config.email !== undefined) {
        body.EMAIL_ADDRESS = config.email
      }
      const response = await fetch(baseUrl + 'Contacts', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ CONTACT_ID: config.contactId, ...body }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.Message || 'Failed to update contact' }
      }
      return { success: true, contact: data }
    }
    case 'delete-contact': {
      const response = await fetch(baseUrl + 'Contacts/' + config.contactId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.Message || 'Failed to delete contact' }
      }
      return { success: true }
    }
    case 'list-opportunities': {
      let url = baseUrl + 'Opportunities'
      if (config.top) {
        url += '?top=' + config.top
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.Message || 'Failed to list opportunities' }
      }
      return { success: true, opportunities: data }
    }
    case 'create-opportunity': {
      const body: Record<string, any> = config.fields || {}
      if (config.opportunityName) {
        body.OPPORTUNITY_NAME = config.opportunityName
      }
      if (config.stageId) {
        body.PIPELINE_STAGE_ID = config.stageId
      }
      const response = await fetch(baseUrl + 'Opportunities', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.Message || 'Failed to create opportunity' }
      }
      return { success: true, opportunity: data }
    }
    case 'list-organisations': {
      let url = baseUrl + 'Organisations'
      if (config.top) {
        url += '?top=' + config.top
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.Message || 'Failed to list organisations' }
      }
      return { success: true, organisations: data }
    }
    default:
      throw new Error('Unknown integration-insightly action: ' + action)
  }
}
export const integrationInsightly: IntegrationHandlerGenerator = {
  nodeType: 'integration-insightly',
  executionEnv: 'server',
  secretFields: ['apiKey'],
  generateHandler(): string {
    return handlerToString(integration_insightly)
  },
}
