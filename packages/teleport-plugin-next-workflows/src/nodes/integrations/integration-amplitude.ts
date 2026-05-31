import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_amplitude(config: any, context: Record<string, unknown>) {
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
  const headers = {
    'Content-Type': 'application/json',
  }

  switch (action) {
    case 'track': {
      const response = await fetch('https://api2.amplitude.com/2/httpapi', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          api_key: apiKey,
          events: [
            {
              user_id: config.userId,
              device_id: config.deviceId || undefined,
              event_type: config.eventType,
              event_properties: config.eventProperties || {},
              user_properties: config.userProperties || {},
              time: config.time || Date.now(),
            },
          ],
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to track event' }
      }
      return { success: true, code: data.code }
    }
    case 'identify': {
      const response = await fetch('https://api2.amplitude.com/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:
          'api_key=' +
          encodeURIComponent(apiKey) +
          '&identification=' +
          encodeURIComponent(
            JSON.stringify([
              {
                user_id: config.userId,
                user_properties: config.userProperties || {},
              },
            ])
          ),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to identify user' }
      }
      return { success: true, code: data.code }
    }
    case 'track-revenue': {
      const response = await fetch('https://api2.amplitude.com/2/httpapi', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          api_key: apiKey,
          events: [
            {
              user_id: config.userId,
              event_type: 'revenue_amount',
              event_properties: {
                productId: config.productId || '',
                quantity: config.quantity || 1,
                price: config.price,
                revenueType: config.revenueType || 'purchase',
              },
              revenue: config.price * (config.quantity || 1),
            },
          ],
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to track revenue' }
      }
      return { success: true, code: data.code }
    }
    case 'set-group': {
      const groupProps: Record<string, any> = {}
      groupProps.$set = {}
      groupProps.$set.$group_type = config.groupType || 'organization'
      groupProps.$set.$group_value = config.groupValue
      const response = await fetch('https://api2.amplitude.com/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:
          'api_key=' +
          encodeURIComponent(apiKey) +
          '&identification=' +
          encodeURIComponent(
            JSON.stringify([
              {
                user_id: config.userId,
                user_properties: groupProps,
              },
            ])
          ),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to set group' }
      }
      return { success: true, code: data.code }
    }
    case 'flush': {
      const events = config.events || []
      const batches = []
      for (let i = 0; i < events.length; i += 100) {
        batches.push(events.slice(i, i + 100))
      }
      const results = []
      for (let b = 0; b < batches.length; b++) {
        const response = await fetch('https://api2.amplitude.com/2/httpapi', {
          method: 'POST',
          headers,
          body: JSON.stringify({ api_key: apiKey, events: batches[b] }),
        })
        const data = await __readJson(response)
        results.push({ batch: b, code: data.code, error: data.error })
      }
      return { success: true, batches: results }
    }
    case 'set-user-properties': {
      const userProps: Record<string, any> = {}
      if (config.$set) {
        userProps.$set = config.$set
      }
      if (config.$unset) {
        userProps.$unset = config.$unset
      }
      const response = await fetch('https://api2.amplitude.com/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:
          'api_key=' +
          encodeURIComponent(apiKey) +
          '&identification=' +
          encodeURIComponent(
            JSON.stringify([
              {
                user_id: config.userId,
                user_properties: Object.keys(userProps).length
                  ? userProps
                  : config.userProperties || {},
              },
            ])
          ),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to set user properties' }
      }
      return { success: true, code: data.code }
    }
    case 'get-user': {
      if (!config.secretKey) {
        return { success: false, error: 'secretKey required for Dashboard API' }
      }
      let url =
        'https://amplitude.com/api/2/useractivity?user=' +
        encodeURIComponent(config.userId || config.user)
      if (config.start) {
        url += '&start=' + config.start
      }
      if (config.end) {
        url += '&end=' + config.end
      }
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization:
            'Basic ' +
            (typeof (globalThis as any).Buffer !== 'undefined'
              ? (globalThis as any).Buffer.from(apiKey + ':' + config.secretKey).toString('base64')
              : btoa(apiKey + ':' + config.secretKey)),
        },
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to get user' }
      }
      return { success: true, data }
    }
    case 'get-event': {
      if (!config.secretKey) {
        return { success: false, error: 'secretKey required for Dashboard API' }
      }
      const response = await fetch('https://amplitude.com/api/2/events/segmentation', {
        method: 'GET',
        headers: {
          Authorization:
            'Basic ' +
            (typeof (globalThis as any).Buffer !== 'undefined'
              ? (globalThis as any).Buffer.from(apiKey + ':' + config.secretKey).toString('base64')
              : btoa(apiKey + ':' + config.secretKey)),
          'Content-Type': 'application/json',
        },
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to get event' }
      }
      return { success: true, data }
    }
    case 'create-cohort': {
      if (!config.secretKey) {
        return { success: false, error: 'secretKey required' }
      }
      const response = await fetch('https://amplitude.com/api/2/cohorts', {
        method: 'POST',
        headers: {
          Authorization:
            'Basic ' +
            (typeof (globalThis as any).Buffer !== 'undefined'
              ? (globalThis as any).Buffer.from(apiKey + ':' + config.secretKey).toString('base64')
              : btoa(apiKey + ':' + config.secretKey)),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: config.name, definition: config.definition || {} }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to create cohort' }
      }
      return { success: true, cohort: data }
    }
    case 'export-events': {
      if (!config.secretKey) {
        return { success: false, error: 'secretKey required for Export API' }
      }
      let url = 'https://amplitude.com/api/2/export?start=' + config.start + '&end=' + config.end
      if (config.eventType) {
        url += '&event_type=' + encodeURIComponent(config.eventType)
      }
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization:
            'Basic ' +
            (typeof (globalThis as any).Buffer !== 'undefined'
              ? (globalThis as any).Buffer.from(apiKey + ':' + config.secretKey).toString('base64')
              : btoa(apiKey + ':' + config.secretKey)),
        },
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: (data.error && data.message) || 'Failed to export events' }
      }
      const text = await response.text()
      return { success: true, data: text }
    }
    case 'get-sessions': {
      if (!config.secretKey) {
        return { success: false, error: 'secretKey required for Dashboard API' }
      }
      let url =
        'https://amplitude.com/api/2/sessions?user=' +
        encodeURIComponent(config.userId || config.user)
      if (config.start) {
        url += '&start=' + config.start
      }
      if (config.end) {
        url += '&end=' + config.end
      }
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization:
            'Basic ' +
            (typeof (globalThis as any).Buffer !== 'undefined'
              ? (globalThis as any).Buffer.from(apiKey + ':' + config.secretKey).toString('base64')
              : btoa(apiKey + ':' + config.secretKey)),
        },
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to get sessions' }
      }
      return { success: true, data }
    }
    default:
      throw new Error('Unknown integration-amplitude action: ' + action)
  }
}
export const integrationAmplitude: IntegrationHandlerGenerator = {
  nodeType: 'integration-amplitude',
  executionEnv: 'server',
  secretFields: ['apiKey'],
  generateHandler(): string {
    return handlerToString(integration_amplitude)
  },
}
