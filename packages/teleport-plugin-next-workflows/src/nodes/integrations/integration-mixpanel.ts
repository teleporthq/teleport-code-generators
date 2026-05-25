import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_mixpanel(config: any, context: Record<string, unknown>) {
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
  const token = config.token || config.projectToken
  const action = config.action

  switch (action) {
    case 'track-event': {
      const response = await fetch('https://api.mixpanel.com/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/plain' },
        body: JSON.stringify([
          {
            event: config.eventName,
            properties: {
              ...(config.properties || {}),
              token,
              distinct_id: config.distinctId,
              time: config.timestamp || Date.now(),
            },
          },
        ]),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: 'Failed to track event' }
      }
      return { success: true, result: data }
    }
    case 'import-events': {
      const events = (config.events || []).map(function (evt) {
        return {
          event: evt.event,
          properties: {
            ...(evt.properties || {}),
            token,
            distinct_id: evt.distinctId,
            time: evt.timestamp || Date.now(),
          },
        }
      })
      const response = await fetch('https://api.mixpanel.com/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + btoa(config.apiSecret + ':'),
        },
        body: JSON.stringify(events),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to import events' }
      }
      return { success: true, result: data }
    }
    case 'get-profile': {
      const response = await fetch(
        'https://mixpanel.com/api/2.0/engage?distinct_id=' + encodeURIComponent(config.distinctId),
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: 'Basic ' + btoa(config.apiSecret + ':'),
          },
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to get profile' }
      }
      return { success: true, profile: data }
    }
    case 'set-profile': {
      const engageUrl = 'https://api.mixpanel.com/engage'
      const body = [
        { $token: token, $distinct_id: config.distinctId, $set: config.properties || {} },
      ]
      const response = await fetch(
        engageUrl + '?data=' + encodeURIComponent(btoa(JSON.stringify(body))),
        {
          method: 'GET',
          headers: { Authorization: 'Basic ' + btoa(config.apiSecret + ':') },
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to set profile' }
      }
      return { success: true }
    }
    case 'delete-profile': {
      const body = [{ $token: token, $distinct_id: config.distinctId, $delete: '' }]
      const response = await fetch(
        'https://api.mixpanel.com/engage?data=' + encodeURIComponent(btoa(JSON.stringify(body))),
        {
          method: 'GET',
          headers: { Authorization: 'Basic ' + btoa(config.apiSecret + ':') },
        }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.error || 'Failed to delete profile' }
      }
      return { success: true }
    }
    case 'query-jql': {
      const response = await fetch('https://mixpanel.com/api/2.0/jql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + btoa(config.apiSecret + ':'),
        },
        body: JSON.stringify({ script: config.script }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to query' }
      }
      return { success: true, result: data }
    }
    case 'get-funnel': {
      const response = await fetch('https://mixpanel.com/api/2.0/funnels/' + config.funnelId, {
        method: 'GET',
        headers: { Authorization: 'Basic ' + btoa(config.apiSecret + ':') },
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to get funnel' }
      }
      return { success: true, funnel: data }
    }
    case 'create-cohort': {
      const response = await fetch('https://mixpanel.com/api/2.0/cohorts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + btoa(config.apiSecret + ':'),
        },
        body: JSON.stringify({ name: config.name, formula: config.formula || '' }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to create cohort' }
      }
      return { success: true, cohort: data }
    }
    default:
      throw new Error('Unknown integration-mixpanel action: ' + action)
  }
}
export const integrationMixpanel: IntegrationHandlerGenerator = {
  nodeType: 'integration-mixpanel',
  executionEnv: 'server',
  secretFields: ['token', 'projectToken'],
  generateHandler(): string {
    return handlerToString(integration_mixpanel)
  },
}
