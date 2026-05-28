import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_apollo(config: any, context: Record<string, unknown>) {
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
  const baseUrl = 'https://api.apollo.io/v1/'
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  }

  switch (action) {
    case 'create-contact': {
      const response = await fetch(baseUrl + 'contacts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          api_key: apiKey,
          first_name: config.firstName || '',
          last_name: config.lastName || '',
          email: config.email,
          organization_name: config.organizationName || '',
          title: config.title || '',
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create contact' }
      }
      return { success: true, contact: data.contact }
    }
    case 'get-contact': {
      const response = await fetch(
        baseUrl + 'contacts/' + config.contactId + '?api_key=' + encodeURIComponent(apiKey),
        {
          method: 'GET',
          headers,
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get contact' }
      }
      return { success: true, contact: data.contact }
    }
    case 'search-contacts': {
      const response = await fetch(baseUrl + 'contacts/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          api_key: apiKey,
          q_keywords: config.query || '',
          page: config.page || 1,
          per_page: config.perPage || 25,
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to search contacts' }
      }
      return { success: true, contacts: data.contacts, pagination: data.pagination }
    }
    case 'update-contact': {
      const body: Record<string, any> = { api_key: apiKey }
      if (config.firstName !== undefined) {
        body.first_name = config.firstName
      }
      if (config.lastName !== undefined) {
        body.last_name = config.lastName
      }
      if (config.email !== undefined) {
        body.email = config.email
      }
      if (config.organizationName !== undefined) {
        body.organization_name = config.organizationName
      }
      if (config.title !== undefined) {
        body.title = config.title
      }
      const response = await fetch(baseUrl + 'contacts/' + config.contactId, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update contact' }
      }
      return { success: true, contact: data.contact }
    }
    case 'delete-contact': {
      const response = await fetch(baseUrl + 'contacts/' + config.contactId, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ api_key: apiKey }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to delete contact' }
      }
      return { success: true }
    }
    case 'create-sequence': {
      const body: Record<string, any> = {
        api_key: apiKey,
        name: config.name,
        from_email: config.fromEmail,
        from_name: config.fromName,
        reply_to_email: config.replyToEmail || config.fromEmail,
        days_delay: config.daysDelay || 0,
        sequence_steps: config.steps || [],
      }
      if (config.campaignId) {
        body.campaign_id = config.campaignId
      }
      const response = await fetch(baseUrl + 'emailer_campaigns', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create sequence' }
      }
      return { success: true, campaign: data.emailer_campaign }
    }
    case 'add-to-sequence': {
      const response = await fetch(
        baseUrl + 'emailer_campaigns/' + config.campaignId + '/add_contact_ids',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            api_key: apiKey,
            contact_ids: config.contactIds || [config.contactId],
          }),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to add to sequence' }
      }
      return { success: true, data }
    }
    case 'get-sequence': {
      const response = await fetch(
        baseUrl +
          'emailer_campaigns/' +
          config.campaignId +
          '?api_key=' +
          encodeURIComponent(apiKey),
        {
          method: 'GET',
          headers,
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get sequence' }
      }
      return { success: true, campaign: data.emailer_campaign }
    }
    default:
      throw new Error('Unknown integration-apollo action: ' + action)
  }
}
export const integrationApollo: IntegrationHandlerGenerator = {
  nodeType: 'integration-apollo',
  executionEnv: 'server',
  secretFields: ['apiKey'],
  generateHandler(): string {
    return handlerToString(integration_apollo)
  },
}
