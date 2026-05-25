import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_calendly(config: any, context: Record<string, unknown>) {
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
  const accessToken = config.accessToken || config.apiKey
  const action = config.action
  const baseUrl = 'https://api.calendly.com/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + accessToken,
  }

  switch (action) {
    case 'get-user': {
      const response = await fetch(baseUrl + 'users/me', {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get user' }
      }
      return { success: true, user: data.resource }
    }
    case 'list-event-types': {
      let url = baseUrl + 'event_types?user=' + encodeURIComponent(config.userUri)
      if (config.count) {
        url = url + '&count=' + config.count
      }
      if (config.pageToken) {
        url = url + '&page_token=' + encodeURIComponent(config.pageToken)
      }
      const response = await fetch(url, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list event types' }
      }
      return { success: true, eventTypes: data.collection, pagination: data.pagination }
    }
    case 'list-scheduled-events': {
      let url = baseUrl + 'scheduled_events?user=' + encodeURIComponent(config.userUri)
      if (config.minStartTime) {
        url = url + '&min_start_time=' + encodeURIComponent(config.minStartTime)
      }
      if (config.maxStartTime) {
        url = url + '&max_start_time=' + encodeURIComponent(config.maxStartTime)
      }
      if (config.count) {
        url = url + '&count=' + config.count
      }
      if (config.status) {
        url = url + '&status=' + config.status
      }
      const response = await fetch(url, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list scheduled events' }
      }
      return { success: true, events: data.collection, pagination: data.pagination }
    }
    case 'get-event': {
      const response = await fetch(baseUrl + 'scheduled_events/' + config.eventUuid, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get event' }
      }
      return { success: true, event: data.resource }
    }
    case 'cancel-event': {
      const response = await fetch(
        baseUrl + 'scheduled_events/' + config.eventUuid + '/cancellation',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ reason: config.reason || '' }),
        }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to cancel' }
      }
      return { success: true }
    }
    case 'list-invitees': {
      let url = baseUrl + 'scheduled_events/' + config.eventUuid + '/invitees'
      if (config.count) {
        url += '?count=' + config.count
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list invitees' }
      }
      return { success: true, invitees: data.collection }
    }
    case 'get-invitee': {
      const response = await fetch(
        baseUrl + 'scheduled_events/' + config.eventUuid + '/invitees/' + config.inviteeUuid,
        { method: 'GET', headers }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get invitee' }
      }
      return { success: true, invitee: data.resource }
    }
    case 'create-scheduling-link': {
      const body = {
        max_event_count: config.maxEventCount || 1,
        owner: config.ownerUri,
        owner_type: config.ownerType || 'EventType',
      }
      const response = await fetch(baseUrl + 'scheduling_links', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create scheduling link' }
      }
      return { success: true, schedulingLink: data.resource }
    }
    default:
      throw new Error('Unknown integration-calendly action: ' + action)
  }
}
export const integrationCalendly: IntegrationHandlerGenerator = {
  nodeType: 'integration-calendly',
  executionEnv: 'server',
  secretFields: ['accessToken', 'apiKey'],
  generateHandler(): string {
    return handlerToString(integration_calendly)
  },
}
