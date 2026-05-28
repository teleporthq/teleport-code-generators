import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_hubspot(config: any, context: Record<string, unknown>) {
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
  const baseUrl = 'https://api.hubapi.com/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + apiKey,
  }

  switch (action) {
    case 'create-contact': {
      const response = await fetch(baseUrl + 'crm/v3/objects/contacts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: config.properties || {},
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create contact' }
      }
      return { success: true, contact: data }
    }
    case 'get-contact': {
      let url = baseUrl + 'crm/v3/objects/contacts/' + config.contactId
      const params = []
      if (config.properties) {
        params.push('properties=' + encodeURIComponent(config.properties.join(',')))
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
        return { success: false, error: data.message || 'Failed to get contact' }
      }
      return { success: true, contact: data }
    }
    case 'create-deal': {
      const response = await fetch(baseUrl + 'crm/v3/objects/deals', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: config.properties || {},
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create deal' }
      }
      return { success: true, deal: data }
    }
    case 'update-contact': {
      const response = await fetch(baseUrl + 'crm/v3/objects/contacts/' + config.contactId, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties: config.properties || {} }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update contact' }
      }
      return { success: true, contact: data }
    }
    case 'delete-contact': {
      const response = await fetch(baseUrl + 'crm/v3/objects/contacts/' + config.contactId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to delete contact' }
      }
      return { success: true }
    }
    case 'search-contacts': {
      const response = await fetch(baseUrl + 'crm/v3/objects/contacts/search', {
        method: 'POST',
        headers,
        body: JSON.stringify(
          config.body || { filterGroups: [], sorts: [], properties: [], limit: 10 }
        ),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to search contacts' }
      }
      return { success: true, results: data.results, total: data.total }
    }
    case 'list-contacts': {
      let url = baseUrl + 'crm/v3/objects/contacts?limit=' + (config.limit || 10)
      if (config.after) {
        url += '&after=' + config.after
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list contacts' }
      }
      return { success: true, results: data.results, paging: data.paging }
    }
    case 'update-deal': {
      const response = await fetch(baseUrl + 'crm/v3/objects/deals/' + config.dealId, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties: config.properties || {} }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update deal' }
      }
      return { success: true, deal: data }
    }
    case 'get-deal': {
      const response = await fetch(baseUrl + 'crm/v3/objects/deals/' + config.dealId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get deal' }
      }
      return { success: true, deal: data }
    }
    case 'delete-deal': {
      const response = await fetch(baseUrl + 'crm/v3/objects/deals/' + config.dealId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to delete deal' }
      }
      return { success: true }
    }
    case 'list-deals': {
      let url = baseUrl + 'crm/v3/objects/deals?limit=' + (config.limit || 10)
      if (config.after) {
        url += '&after=' + config.after
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list deals' }
      }
      return { success: true, results: data.results, paging: data.paging }
    }
    case 'create-company': {
      const response = await fetch(baseUrl + 'crm/v3/objects/companies', {
        method: 'POST',
        headers,
        body: JSON.stringify({ properties: config.properties || {} }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create company' }
      }
      return { success: true, company: data }
    }
    case 'update-company': {
      const response = await fetch(baseUrl + 'crm/v3/objects/companies/' + config.companyId, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties: config.properties || {} }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update company' }
      }
      return { success: true, company: data }
    }
    case 'get-company': {
      const response = await fetch(baseUrl + 'crm/v3/objects/companies/' + config.companyId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get company' }
      }
      return { success: true, company: data }
    }
    case 'delete-company': {
      const response = await fetch(baseUrl + 'crm/v3/objects/companies/' + config.companyId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to delete company' }
      }
      return { success: true }
    }
    case 'list-companies': {
      let url = baseUrl + 'crm/v3/objects/companies?limit=' + (config.limit || 10)
      if (config.after) {
        url += '&after=' + config.after
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list companies' }
      }
      return { success: true, results: data.results, paging: data.paging }
    }
    case 'create-ticket': {
      const response = await fetch(baseUrl + 'crm/v3/objects/tickets', {
        method: 'POST',
        headers,
        body: JSON.stringify({ properties: config.properties || {} }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create ticket' }
      }
      return { success: true, ticket: data }
    }
    case 'update-ticket': {
      const response = await fetch(baseUrl + 'crm/v3/objects/tickets/' + config.ticketId, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties: config.properties || {} }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update ticket' }
      }
      return { success: true, ticket: data }
    }
    case 'get-ticket': {
      const response = await fetch(baseUrl + 'crm/v3/objects/tickets/' + config.ticketId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get ticket' }
      }
      return { success: true, ticket: data }
    }
    case 'delete-ticket': {
      const response = await fetch(baseUrl + 'crm/v3/objects/tickets/' + config.ticketId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to delete ticket' }
      }
      return { success: true }
    }
    case 'list-tickets': {
      let url = baseUrl + 'crm/v3/objects/tickets?limit=' + (config.limit || 10)
      if (config.after) {
        url += '&after=' + config.after
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list tickets' }
      }
      return { success: true, results: data.results, paging: data.paging }
    }
    case 'create-note': {
      const response = await fetch(baseUrl + 'crm/v3/objects/notes', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: config.properties || {},
          associations: config.associations || [],
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create note' }
      }
      return { success: true, note: data }
    }
    case 'create-task': {
      const response = await fetch(baseUrl + 'crm/v3/objects/tasks', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: config.properties || {},
          associations: config.associations || [],
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create task' }
      }
      return { success: true, task: data }
    }
    case 'associate-objects': {
      const response = await fetch(
        baseUrl +
          'crm/v3/objects/' +
          config.objectType +
          '/' +
          config.objectId +
          '/associations/' +
          config.toObjectType +
          '/' +
          config.toObjectId +
          '/' +
          config.associationType,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify(config.association || []),
        }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to associate' }
      }
      return { success: true }
    }
    case 'remove-association': {
      const response = await fetch(
        baseUrl +
          'crm/v3/objects/' +
          config.objectType +
          '/' +
          config.objectId +
          '/associations/' +
          config.toObjectType +
          '/' +
          config.toObjectId +
          '/' +
          config.associationType,
        { method: 'DELETE', headers }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to remove association' }
      }
      return { success: true }
    }
    default:
      throw new Error('Unknown integration-hubspot action: ' + action)
  }
}
export const integrationHubspot: IntegrationHandlerGenerator = {
  nodeType: 'integration-hubspot',
  executionEnv: 'server',
  secretFields: ['apiKey'],
  generateHandler(): string {
    return handlerToString(integration_hubspot)
  },
}
