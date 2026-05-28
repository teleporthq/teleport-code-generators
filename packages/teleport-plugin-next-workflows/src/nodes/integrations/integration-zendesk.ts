import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_zendesk(config: any, context: Record<string, unknown>) {
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
  const email = config.email
  const apiToken = config.apiToken
  const subdomain = config.subdomain
  const action = config.action
  const baseUrl = 'https://' + subdomain + '.zendesk.com/api/v2/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Basic ' + btoa(email + '/token:' + apiToken),
  }

  switch (action) {
    case 'create-ticket': {
      const ticket: Record<string, any> = {
        subject: config.subject,
        description: config.description,
      }
      if (config.priority) {
        ticket.priority = config.priority
      }
      if (config.status) {
        ticket.status = config.status
      }
      if (config.type) {
        ticket.type = config.type
      }
      if (config.assigneeId) {
        ticket.assignee_id = config.assigneeId
      }
      if (config.requesterId) {
        ticket.requester_id = config.requesterId
      }
      if (config.groupId) {
        ticket.group_id = config.groupId
      }
      if (config.tags) {
        ticket.tags = config.tags
      }
      if (config.customFields) {
        ticket.custom_fields = config.customFields
      }
      const response = await fetch(baseUrl + 'tickets.json', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ticket }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: data.error || data.description || 'Failed to create ticket',
        }
      }
      return { success: true, ticket: data.ticket }
    }
    case 'get-ticket': {
      const response = await fetch(baseUrl + 'tickets/' + config.ticketId + '.json', {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to get ticket' }
      }
      return { success: true, ticket: data.ticket }
    }
    case 'list-tickets': {
      let url = baseUrl + 'tickets.json'
      const params = []
      if (config.sortBy) {
        params.push('sort_by=' + config.sortBy)
      }
      if (config.sortOrder) {
        params.push('sort_order=' + config.sortOrder)
      }
      if (config.perPage) {
        params.push('per_page=' + config.perPage)
      }
      if (config.page) {
        params.push('page=' + config.page)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to list tickets' }
      }
      return {
        success: true,
        tickets: data.tickets || [],
        count: data.count,
        nextPage: data.next_page,
      }
    }
    case 'update-ticket': {
      const ticket: Record<string, any> = {}
      if (config.subject !== undefined) {
        ticket.subject = config.subject
      }
      if (config.description !== undefined) {
        ticket.description = config.description
      }
      if (config.priority !== undefined) {
        ticket.priority = config.priority
      }
      if (config.status !== undefined) {
        ticket.status = config.status
      }
      if (config.assigneeId !== undefined) {
        ticket.assignee_id = config.assigneeId
      }
      const response = await fetch(baseUrl + 'tickets/' + config.ticketId + '.json', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ ticket }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.error && data.error.message) || data.description || 'Failed to update ticket',
        }
      }
      return { success: true, ticket: data.ticket }
    }
    case 'delete-ticket': {
      const response = await fetch(baseUrl + 'tickets/' + config.ticketId + '.json', {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to delete ticket',
        }
      }
      return { success: true }
    }
    case 'search-tickets': {
      const query = config.query || 'type:ticket'
      const response = await fetch(
        baseUrl +
          'search.json?query=' +
          encodeURIComponent(query) +
          (config.sortBy ? '&sort_by=' + config.sortBy : '') +
          (config.sortOrder ? '&sort_order=' + config.sortOrder : ''),
        {
          method: 'GET',
          headers,
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to search tickets',
        }
      }
      return { success: true, results: data.results || [], count: data.count }
    }
    case 'add-comment': {
      const response = await fetch(baseUrl + 'tickets/' + config.ticketId + '.json', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          ticket: {
            comment: {
              body: config.comment,
              public: config.public !== false,
            },
          },
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to add comment',
        }
      }
      return { success: true, ticket: data.ticket }
    }
    case 'create-user': {
      const user: Record<string, any> = { name: config.name, email: config.email }
      if (config.verified) {
        user.verified = config.verified
      }
      if (config.phone) {
        user.phone = config.phone
      }
      const response = await fetch(baseUrl + 'users.json', {
        method: 'POST',
        headers,
        body: JSON.stringify({ user }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create user',
        }
      }
      return { success: true, user: data.user }
    }
    case 'get-user': {
      const response = await fetch(baseUrl + 'users/' + config.userId + '.json', {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data.error && data.error.message) || 'Failed to get user' }
      }
      return { success: true, user: data.user }
    }
    case 'update-user': {
      const user: Record<string, any> = {}
      if (config.name !== undefined) {
        user.name = config.name
      }
      if (config.email !== undefined) {
        user.email = config.email
      }
      const response = await fetch(baseUrl + 'users/' + config.userId + '.json', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ user }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to update user',
        }
      }
      return { success: true, user: data.user }
    }
    case 'create-organization': {
      const response = await fetch(baseUrl + 'organizations.json', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          organization: {
            name: config.name,
            details: config.details || '',
            notes: config.notes || '',
          },
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create organization',
        }
      }
      return { success: true, organization: data.organization }
    }
    case 'get-organization': {
      // Schema canonical name is `organizationId`; older workflows used `orgId`. Accept either.
      const zendeskOrgId = config.organizationId || config.orgId
      const response = await fetch(baseUrl + 'organizations/' + zendeskOrgId + '.json', {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get organization',
        }
      }
      return { success: true, organization: data.organization }
    }
    default:
      throw new Error('Unknown integration-zendesk action: ' + action)
  }
}
export const integrationZendesk: IntegrationHandlerGenerator = {
  nodeType: 'integration-zendesk',
  executionEnv: 'server',
  secretFields: ['email', 'apiToken', 'subdomain'],
  generateHandler(): string {
    return handlerToString(integration_zendesk)
  },
}
