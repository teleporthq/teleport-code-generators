import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_mailchimp(config: any, context: Record<string, unknown>) {
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
  if (!apiKey || typeof apiKey !== 'string') {
    return { success: false, error: 'Mailchimp API key is not configured' }
  }
  const dc = apiKey.split('-').pop()
  const baseUrl = 'https://' + dc + '.api.mailchimp.com/3.0/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Basic ' + btoa('anystring:' + apiKey),
  }

  switch (action) {
    case 'add-subscriber': {
      const listId = config.listId
      const response = await fetch(baseUrl + 'lists/' + listId + '/members', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email_address: config.email,
          status: config.status || 'subscribed',
          merge_fields: config.mergeFields || {},
          tags: config.tags || [],
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.detail || 'Failed to add subscriber' }
      }
      return { success: true, subscriber: data }
    }
    case 'get-subscriber': {
      const listId = config.listId
      const subscriberHash = config.subscriberHash || config.email
      const response = await fetch(baseUrl + 'lists/' + listId + '/members/' + subscriberHash, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.detail || 'Failed to get subscriber' }
      }
      return { success: true, subscriber: data }
    }
    case 'unsubscribe': {
      const listId = config.listId
      const subscriberHash = config.subscriberHash || config.email
      const response = await fetch(baseUrl + 'lists/' + listId + '/members/' + subscriberHash, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'unsubscribed' }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.detail || 'Failed to unsubscribe' }
      }
      return { success: true, subscriber: data }
    }
    case 'update-subscriber': {
      const subscriberHash = config.subscriberHash || config.email
      const body: Record<string, any> = {}
      if (config.mergeFields) {
        body.merge_fields = config.mergeFields
      }
      if (config.status) {
        body.status = config.status
      }
      const response = await fetch(
        baseUrl + 'lists/' + config.listId + '/members/' + subscriberHash,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify(body),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.detail || 'Failed to update subscriber' }
      }
      return { success: true, subscriber: data }
    }
    case 'add-tag': {
      const subscriberHash = config.subscriberHash || config.email
      const response = await fetch(
        baseUrl + 'lists/' + config.listId + '/members/' + subscriberHash + '/tags',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ tags: [{ name: config.tag, status: 'active' }] }),
        }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.detail || 'Failed to add tag' }
      }
      return { success: true }
    }
    case 'create-campaign': {
      const body = config.campaign || {
        type: 'regular',
        recipients: { list_id: config.listId },
        settings: config.settings || {},
      }
      const response = await fetch(baseUrl + 'campaigns', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.detail || 'Failed to create campaign' }
      }
      return { success: true, campaign: data }
    }
    case 'get-campaign': {
      const response = await fetch(baseUrl + 'campaigns/' + config.campaignId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.detail || 'Failed to get campaign' }
      }
      return { success: true, campaign: data }
    }
    case 'send-campaign': {
      const response = await fetch(baseUrl + 'campaigns/' + config.campaignId + '/actions/send', {
        method: 'POST',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.detail || 'Failed to send campaign' }
      }
      return { success: true }
    }
    case 'schedule-campaign': {
      const response = await fetch(
        baseUrl + 'campaigns/' + config.campaignId + '/actions/schedule',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ schedule_time: config.scheduleTime, timewarp: config.timewarp }),
        }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.detail || 'Failed to schedule campaign' }
      }
      return { success: true }
    }
    case 'create-list': {
      const body = {
        name: config.name,
        contact: config.contact || {
          company: '',
          address1: '',
          city: '',
          state: '',
          zip: '',
          country: '',
        },
        permission_reminder: config.permissionReminder || 'You signed up for our list',
        campaign_defaults: config.campaignDefaults || {
          from_name: '',
          from_email: '',
          subject: '',
          language: 'en',
        },
        email_type_option: config.emailTypeOption !== false,
      }
      const response = await fetch(baseUrl + 'lists', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.detail || 'Failed to create list' }
      }
      return { success: true, list: data }
    }
    default:
      throw new Error('Unknown integration-mailchimp action: ' + action)
  }
}
export const integrationMailchimp: IntegrationHandlerGenerator = {
  nodeType: 'integration-mailchimp',
  executionEnv: 'server',
  secretFields: ['apiKey'],
  generateHandler(): string {
    return handlerToString(integration_mailchimp)
  },
}
