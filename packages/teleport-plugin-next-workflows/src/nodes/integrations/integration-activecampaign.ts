import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_activecampaign(config: any, context: Record<string, unknown>) {
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
  const apiUrl = config.apiUrl
  const action = config.action
  const baseUrl = apiUrl + '/api/3/'
  const headers = {
    'Content-Type': 'application/json',
    'Api-Token': apiKey,
  }

  switch (action) {
    case 'create-contact': {
      const response = await fetch(baseUrl + 'contacts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contact: {
            email: config.email,
            firstName: config.firstName || '',
            lastName: config.lastName || '',
            phone: config.phone || '',
          },
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create contact' }
      }
      return { success: true, contact: data.contact }
    }
    case 'get-contact': {
      const response = await fetch(baseUrl + 'contacts/' + config.contactId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get contact' }
      }
      return { success: true, contact: data.contact }
    }
    case 'update-contact': {
      const response = await fetch(baseUrl + 'contacts/' + config.contactId, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          contact: {
            email: config.email,
            firstName: config.firstName || '',
            lastName: config.lastName || '',
            phone: config.phone || '',
          },
        }),
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
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to delete contact' }
      }
      return { success: true }
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
      if (config.search) {
        params.push('search=' + encodeURIComponent(config.search))
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list contacts' }
      }
      return { success: true, contacts: data.contacts || [], meta: data.meta }
    }
    case 'add-tag': {
      const response = await fetch(baseUrl + 'contactTags', {
        method: 'POST',
        headers,
        body: JSON.stringify({ contactTag: { contact: config.contactId, tag: config.tagId } }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to add tag' }
      }
      return { success: true, contactTag: data.contactTag }
    }
    case 'remove-tag': {
      const response = await fetch(baseUrl + 'contactTags/' + config.contactTagId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to remove tag' }
      }
      return { success: true }
    }
    case 'subscribe-to-list': {
      const body: Record<string, any> = {
        contact: config.contactId,
        list: config.listId,
        status: config.status || 1,
      }
      if (config.source !== undefined) {
        body.source = config.source
      }
      const response = await fetch(baseUrl + 'contactLists', {
        method: 'POST',
        headers,
        body: JSON.stringify({ contactList: body }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to subscribe to list' }
      }
      return { success: true, contactList: data.contactList }
    }
    case 'create-deal': {
      const body: Record<string, any> = {
        title: config.title,
        value: config.value || 0,
        currency: config.currency || 'usd',
      }
      if (config.contact) {
        body.contact = config.contact
      }
      if (config.stage) {
        body.stage = config.stage
      }
      if (config.pipeline) {
        body.pipeline = config.pipeline
      }
      if (config.description) {
        body.description = config.description
      }
      const response = await fetch(baseUrl + 'deals', {
        method: 'POST',
        headers,
        body: JSON.stringify({ deal: body }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create deal' }
      }
      return { success: true, deal: data.deal }
    }
    case 'update-deal': {
      const body: Record<string, any> = {}
      if (config.title !== undefined) {
        body.title = config.title
      }
      if (config.value !== undefined) {
        body.value = config.value
      }
      if (config.stage !== undefined) {
        body.stage = config.stage
      }
      if (config.status !== undefined) {
        body.status = config.status
      }
      const response = await fetch(baseUrl + 'deals/' + config.dealId, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ deal: body }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update deal' }
      }
      return { success: true, deal: data.deal }
    }
    case 'create-note': {
      const response = await fetch(baseUrl + 'notes', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          note: {
            note: config.note,
            relid: config.relId,
            reltype: config.relType || 'Deal',
            user: config.userId,
          },
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create note' }
      }
      return { success: true, note: data.note }
    }
    default:
      throw new Error('Unknown integration-activecampaign action: ' + action)
  }
}
export const integrationActivecampaign: IntegrationHandlerGenerator = {
  nodeType: 'integration-activecampaign',
  executionEnv: 'server',
  secretFields: ['apiKey', 'apiUrl'],
  generateHandler(): string {
    return handlerToString(integration_activecampaign)
  },
}
