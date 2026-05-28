import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_keap(config: any, context: Record<string, unknown>) {
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
  const action = config.action
  const baseUrl = 'https://api.infusionsoft.com/crm/rest/v1/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + apiKey,
  }

  switch (action) {
    case 'create-contact': {
      const body: Record<string, any> = {}
      if (config.email) {
        body.email_addresses = [{ email: config.email, field: 'EMAIL1' }]
      }
      if (config.givenName) {
        body.given_name = config.givenName
      }
      if (config.familyName) {
        body.family_name = config.familyName
      }
      if (config.phone) {
        body.phone_numbers = [{ number: config.phone, field: 'PHONE1' }]
      }
      if (config.customFields) {
        body.custom_fields = config.customFields
      }
      const response = await fetch(baseUrl + 'contacts', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create contact' }
      }
      return { success: true, contact: data }
    }
    case 'get-contact': {
      let url = baseUrl + 'contacts/' + config.contactId
      if (config.optionalProperties) {
        url =
          url + '?optional_properties=' + encodeURIComponent(config.optionalProperties.join(','))
      }
      const response = await fetch(url, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get contact' }
      }
      return { success: true, contact: data }
    }
    case 'list-contacts': {
      let url = baseUrl + 'contacts'
      const params = []
      if (config.limit) {
        params.push('limit=' + config.limit)
      }
      if (config.offset) {
        params.push('offset=' + config.offset)
      }
      if (config.email) {
        params.push('email=' + encodeURIComponent(config.email))
      }
      if (config.order) {
        params.push('order=' + config.order)
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
        return { success: false, error: data.message || 'Failed to list contacts' }
      }
      return { success: true, contacts: data.contacts || [], count: data.count || 0 }
    }
    case 'update-contact': {
      const body: Record<string, any> = config.updates || {}
      if (config.givenName !== undefined) {
        body.given_name = config.givenName
      }
      if (config.familyName !== undefined) {
        body.family_name = config.familyName
      }
      const response = await fetch(baseUrl + 'contacts/' + config.contactId, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to update contact' }
      }
      return { success: true }
    }
    case 'delete-contact': {
      const response = await fetch(baseUrl + 'contacts/' + config.contactId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to delete contact' }
      }
      return { success: true }
    }
    case 'create-opportunity': {
      const body = { contact_id: config.contactId, stage_id: config.stageId, title: config.title }
      if (config.value) {
        ;(body as any).value = config.value
      }
      const response = await fetch(baseUrl + 'opportunities', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create opportunity' }
      }
      return { success: true, opportunity: data }
    }
    case 'apply-tag': {
      const response = await fetch(baseUrl + 'contacts/' + config.contactId + '/tags', {
        method: 'POST',
        headers,
        body: JSON.stringify({ tag_ids: config.tagIds || [config.tagId] }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to apply tag' }
      }
      return { success: true }
    }
    case 'remove-tag': {
      const response = await fetch(
        baseUrl + 'contacts/' + config.contactId + '/tags/' + config.tagId,
        { method: 'DELETE', headers }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to remove tag' }
      }
      return { success: true }
    }
    default:
      throw new Error('Unknown integration-keap action: ' + action)
  }
}
export const integrationKeap: IntegrationHandlerGenerator = {
  nodeType: 'integration-keap',
  executionEnv: 'server',
  secretFields: ['apiKey', 'accessToken'],
  generateHandler(): string {
    return handlerToString(integration_keap)
  },
}
