import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_eventbrite(config: any, context: Record<string, unknown>) {
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
  const accessToken = config.accessToken || config.oauthToken
  const action = config.action
  const baseUrl = 'https://www.eventbriteapi.com/v3/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + accessToken,
  }

  switch (action) {
    case 'create-event': {
      const body: Record<string, any> = {
        event: {
          name: { html: config.name || '' },
          description: { html: config.description || '' },
          start: { timezone: config.timeZone || config.timezone || 'UTC', utc: config.startUtc },
          end: { timezone: config.timeZone || config.timezone || 'UTC', utc: config.endUtc },
          currency: config.currency || 'USD',
          online_event: config.onlineEvent || false,
        },
      }
      if (config.venueId) {
        body.event.venue_id = config.venueId
      }
      if (config.categoryId) {
        body.event.category_id = config.categoryId
      }
      const response = await fetch(
        baseUrl + 'organizations/' + config.organizationId + '/events/',
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error_description || 'Failed to create event' }
      }
      return { success: true, event: data }
    }
    case 'get-event': {
      const response = await fetch(baseUrl + 'events/' + config.eventId + '/', {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error_description || 'Failed to get event' }
      }
      return { success: true, event: data }
    }
    case 'get-attendees': {
      let url = baseUrl + 'events/' + config.eventId + '/attendees/'
      const params = []
      if (config.page) {
        params.push('page=' + config.page)
      }
      if (config.status) {
        params.push('status=' + encodeURIComponent(config.status))
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
        return { success: false, error: data.error_description || 'Failed to get attendees' }
      }
      return { success: true, attendees: data.attendees, pagination: data.pagination }
    }
    case 'update-event': {
      const body: Record<string, any> = {}
      if (config.name) {
        body.name = { html: config.name }
      }
      if (config.description) {
        body.description = { html: config.description }
      }
      const response = await fetch(baseUrl + 'events/' + config.eventId + '/', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error_description || 'Failed to update event' }
      }
      return { success: true, event: data }
    }
    case 'publish-event': {
      const response = await fetch(baseUrl + 'events/' + config.eventId + '/publish/', {
        method: 'POST',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error_description || 'Failed to publish event' }
      }
      return { success: true, event: data }
    }
    case 'cancel-event': {
      const response = await fetch(baseUrl + 'events/' + config.eventId + '/cancel/', {
        method: 'POST',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error_description || 'Failed to cancel event' }
      }
      return { success: true, event: data }
    }
    case 'create-ticket-class': {
      const body: Record<string, any> = {
        ticket_class: {
          name: config.name,
          free: config.free !== false,
          quantity_total: config.quantityTotal || 0,
        },
      }
      const response = await fetch(baseUrl + 'events/' + config.eventId + '/ticket_classes/', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error_description || 'Failed to create ticket class' }
      }
      return { success: true, ticketClass: data }
    }
    case 'list-events': {
      let url = baseUrl + 'organizations/' + config.organizationId + '/events/'
      if (config.page) {
        url += '?page=' + config.page
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error_description || 'Failed to list events' }
      }
      return { success: true, events: data.events || [], pagination: data.pagination }
    }
    default:
      throw new Error('Unknown integration-eventbrite action: ' + action)
  }
}
export const integrationEventbrite: IntegrationHandlerGenerator = {
  nodeType: 'integration-eventbrite',
  executionEnv: 'server',
  secretFields: ['accessToken', 'oauthToken'],
  generateHandler(): string {
    return handlerToString(integration_eventbrite)
  },
}
