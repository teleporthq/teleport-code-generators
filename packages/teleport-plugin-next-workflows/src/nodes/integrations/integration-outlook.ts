import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_outlook(config: any, context: Record<string, unknown>) {
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
  const baseUrl = 'https://graph.microsoft.com/v1.0/me/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + accessToken,
  }

  switch (action) {
    case 'send-email': {
      const message: Record<string, any> = {
        subject: config.subject,
        body: { contentType: config.contentType || 'Text', content: config.body },
        toRecipients: (config.to || []).map(function (email) {
          return { emailAddress: { address: email } }
        }),
      }
      if (config.cc) {
        message.ccRecipients = config.cc.map(function (email) {
          return { emailAddress: { address: email } }
        })
      }
      if (config.bcc) {
        message.bccRecipients = config.bcc.map(function (email) {
          return { emailAddress: { address: email } }
        })
      }
      const response = await fetch(baseUrl + 'sendMail', {
        method: 'POST',
        headers,
        body: JSON.stringify({ message, saveToSentItems: config.saveToSent !== false }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to send email',
        }
      }
      return { success: true }
    }
    case 'get-email': {
      const response = await fetch(baseUrl + 'messages/' + config.messageId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get email',
        }
      }
      return { success: true, message: data }
    }
    case 'list-emails': {
      let url = baseUrl + 'messages'
      const params = []
      if (config.top) {
        params.push('$top=' + config.top)
      }
      if (config.filter) {
        params.push('$filter=' + encodeURIComponent(config.filter))
      }
      if (config.orderBy) {
        params.push('$orderby=' + encodeURIComponent(config.orderBy))
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to list emails',
        }
      }
      return { success: true, messages: data.value || [] }
    }
    case 'delete-email': {
      const response = await fetch(baseUrl + 'messages/' + config.messageId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to delete email',
        }
      }
      return { success: true }
    }
    case 'reply-to-email': {
      const replyBody = config.body || config.comment || ''
      const response = await fetch(baseUrl + 'messages/' + config.messageId + '/reply', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: {
            body: { contentType: config.contentType || 'Text', content: replyBody },
          },
        }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: (data.error && data.error.message) || 'Failed to reply' }
      }
      return { success: true }
    }
    case 'create-event': {
      const event: Record<string, any> = {
        subject: config.subject,
        body: { contentType: config.contentType || 'HTML', content: config.body || '' },
        start: { dateTime: config.start, timeZone: config.timeZone || 'UTC' },
        end: { dateTime: config.end, timeZone: config.timeZone || 'UTC' },
      }
      if (config.attendees) {
        event.attendees = config.attendees.map(function (e: string) {
          return { emailAddress: { address: e } }
        })
      }
      if (config.location) {
        event.location = { displayName: config.location }
      }
      const response = await fetch(baseUrl + 'events', {
        method: 'POST',
        headers,
        body: JSON.stringify(event),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create event',
        }
      }
      return { success: true, event: data }
    }
    case 'get-event': {
      const response = await fetch(baseUrl + 'events/' + config.eventId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get event',
        }
      }
      return { success: true, event: data }
    }
    case 'list-events': {
      let url = baseUrl + 'events'
      const params = []
      if (config.top) {
        params.push('$top=' + config.top)
      }
      if (config.filter) {
        params.push('$filter=' + encodeURIComponent(config.filter))
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to list events',
        }
      }
      return { success: true, events: data.value || [] }
    }
    case 'delete-event': {
      const response = await fetch(baseUrl + 'events/' + config.eventId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to delete event',
        }
      }
      return { success: true }
    }
    case 'create-contact': {
      const contact: Record<string, any> = {
        givenName: config.givenName || '',
        surname: config.surname || '',
        emailAddresses: [{ address: config.email }],
      }
      if (config.phone) {
        contact.businessPhones = [config.phone]
      }
      const response = await fetch(baseUrl + 'contacts', {
        method: 'POST',
        headers,
        body: JSON.stringify(contact),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create contact',
        }
      }
      return { success: true, contact: data }
    }
    case 'list-contacts': {
      let url = baseUrl + 'contacts'
      const params = []
      if (config.top) {
        params.push('$top=' + config.top)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to list contacts',
        }
      }
      return { success: true, contacts: data.value || [] }
    }
    default:
      throw new Error('Unknown integration-outlook action: ' + action)
  }
}
export const integrationOutlook: IntegrationHandlerGenerator = {
  nodeType: 'integration-outlook',
  executionEnv: 'server',
  secretFields: ['accessToken'],
  generateHandler(): string {
    return handlerToString(integration_outlook)
  },
}
