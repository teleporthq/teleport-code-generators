import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_intercom(config: any, context: Record<string, unknown>) {
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
  const baseUrl = 'https://api.intercom.io/'
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: 'Bearer ' + accessToken,
  }

  switch (action) {
    case 'create-contact': {
      const body: Record<string, any> = {
        role: config.role || 'user',
      }
      if (config.email) {
        body.email = config.email
      }
      if (config.name) {
        body.name = config.name
      }
      if (config.externalId) {
        body.external_id = config.externalId
      }
      if (config.phone) {
        body.phone = config.phone
      }
      if (config.customAttributes) {
        body.custom_attributes = config.customAttributes
      }
      const response = await fetch(baseUrl + 'contacts', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to create contact',
        }
      }
      return { success: true, contact: data }
    }
    case 'get-contact': {
      const response = await fetch(baseUrl + 'contacts/' + config.contactId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to get contact',
        }
      }
      return { success: true, contact: data }
    }
    case 'send-message': {
      const body = {
        message_type: config.messageType || 'inapp',
        subject: config.subject || '',
        body: config.body || '',
        from: { type: 'admin', id: config.adminId },
        to: { type: 'user', id: config.contactId },
      }
      const response = await fetch(baseUrl + 'messages', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to send message',
        }
      }
      return { success: true, message: data }
    }
    case 'update-contact': {
      const body: Record<string, any> = {}
      if (config.email !== undefined) {
        body.email = config.email
      }
      if (config.name !== undefined) {
        body.name = config.name
      }
      if (config.phone !== undefined) {
        body.phone = config.phone
      }
      if (config.customAttributes) {
        body.custom_attributes = config.customAttributes
      }
      const response = await fetch(baseUrl + 'contacts/' + config.contactId, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to update contact',
        }
      }
      return { success: true, contact: data }
    }
    case 'delete-contact': {
      const response = await fetch(baseUrl + 'contacts/' + config.contactId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to delete contact',
        }
      }
      return { success: true }
    }
    case 'search-contacts': {
      const response = await fetch(baseUrl + 'contacts/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: {
            field: config.field || 'email',
            operator: config.operator || '=',
            value: config.value,
          },
          pagination: { per_page: config.perPage || 50, starting_after: config.startingAfter },
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) ||
            'Failed to search contacts',
        }
      }
      return { success: true, contacts: data.data || [], total_count: data.total_count }
    }
    case 'list-contacts': {
      let url = baseUrl + 'contacts'
      const params = []
      if (config.perPage) {
        params.push('per_page=' + config.perPage)
      }
      if (config.page) {
        params.push('page=' + config.page)
      }
      if (params.length > 0) {
        url += '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to list contacts',
        }
      }
      return { success: true, contacts: data.data || [], pages: data.pages }
    }
    case 'create-conversation': {
      const body: Record<string, any> = {
        from: { type: 'admin', id: config.adminId },
        body: config.body || '',
      }
      if (config.contactId) {
        body.owner = { type: 'contact', id: config.contactId }
      }
      const response = await fetch(baseUrl + 'conversations', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) ||
            'Failed to create conversation',
        }
      }
      return { success: true, conversation: data }
    }
    case 'reply-to-conversation': {
      const response = await fetch(baseUrl + 'conversations/' + config.conversationId + '/reply', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message_type: config.messageType || 'comment',
          body: config.body || '',
          admin_id: config.adminId,
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to reply',
        }
      }
      return { success: true, conversation: data }
    }
    case 'tag-contact': {
      const response = await fetch(baseUrl + 'contacts/' + config.contactId + '/tags', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: config.tag }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to tag contact',
        }
      }
      return { success: true, contact: data }
    }
    case 'create-note': {
      const response = await fetch(baseUrl + 'contacts/' + config.contactId + '/notes', {
        method: 'POST',
        headers,
        body: JSON.stringify({ body: config.body || config.note }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to create note',
        }
      }
      return { success: true, note: data }
    }
    case 'list-conversations': {
      let url = baseUrl + 'conversations'
      const params = []
      if (config.perPage) {
        params.push('per_page=' + config.perPage)
      }
      if (config.page) {
        params.push('page=' + config.page)
      }
      if (params.length > 0) {
        url += '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) ||
            'Failed to list conversations',
        }
      }
      return { success: true, conversations: data.conversations || [], pages: data.pages }
    }
    default:
      throw new Error('Unknown integration-intercom action: ' + action)
  }
}
export const integrationIntercom: IntegrationHandlerGenerator = {
  nodeType: 'integration-intercom',
  executionEnv: 'server',
  secretFields: ['accessToken'],
  generateHandler(): string {
    return handlerToString(integration_intercom)
  },
}
