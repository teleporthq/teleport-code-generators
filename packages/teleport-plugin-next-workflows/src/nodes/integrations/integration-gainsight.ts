import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_gainsight(config: any, context: Record<string, unknown>) {
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
  const baseUrl = (config.domain || 'https://api.gainsight.com') + '/v1/'
  const headers = {
    'Content-Type': 'application/json',
    Accesskey: apiKey,
  }

  switch (action) {
    case 'create-company': {
      const response = await fetch(baseUrl + 'data/objects/Company', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          records: [config.record || {}],
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errorMessage || 'Failed to create company' }
      }
      return { success: true, result: data }
    }
    case 'get-company': {
      const response = await fetch(
        baseUrl +
          'data/objects/Company?select=' +
          encodeURIComponent(config.fields || '*') +
          '&where=' +
          encodeURIComponent('Gsid eq ' + config.companyId),
        {
          method: 'GET',
          headers,
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errorMessage || 'Failed to get company' }
      }
      return {
        success: true,
        company: data.data && data.data.records ? data.data.records[0] : null,
      }
    }
    case 'update-company': {
      const response = await fetch(baseUrl + 'data/objects/Company', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          records: [{ Gsid: config.companyId, ...(config.record || {}) }],
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errorMessage || 'Failed to update company' }
      }
      return { success: true, result: data }
    }
    case 'delete-company': {
      const response = await fetch(baseUrl + 'data/objects/Company/' + config.companyId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.errorMessage || 'Failed to delete' }
      }
      return { success: true }
    }
    case 'create-cta': {
      const response = await fetch(baseUrl + 'cta', {
        method: 'POST',
        headers,
        body: JSON.stringify(config.cta || {}),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errorMessage || 'Failed to create CTA' }
      }
      return { success: true, cta: data }
    }
    case 'update-cta': {
      const response = await fetch(baseUrl + 'cta/' + config.ctaId, {
        method: 'PUT',
        headers,
        body: JSON.stringify(config.updates || {}),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errorMessage || 'Failed to update CTA' }
      }
      return { success: true, cta: data }
    }
    case 'close-cta': {
      const response = await fetch(baseUrl + 'cta/' + config.ctaId + '/close', {
        method: 'PUT',
        headers,
        body: JSON.stringify(config.reason || {}),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.errorMessage || 'Failed to close' }
      }
      return { success: true }
    }
    case 'create-timeline-event': {
      const response = await fetch(baseUrl + 'timeline', {
        method: 'POST',
        headers,
        body: JSON.stringify(config.event || {}),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errorMessage || 'Failed to create event' }
      }
      return { success: true, event: data }
    }
    case 'query-data': {
      const response = await fetch(baseUrl + 'data/objects/query/' + config.objectName, {
        method: 'POST',
        headers,
        body: JSON.stringify(config.query || {}),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errorMessage || 'Failed to query' }
      }
      return { success: true, data }
    }
    default:
      throw new Error('Unknown integration-gainsight action: ' + action)
  }
}
export const integrationGainsight: IntegrationHandlerGenerator = {
  nodeType: 'integration-gainsight',
  executionEnv: 'server',
  secretFields: ['apiKey'],
  generateHandler(): string {
    return handlerToString(integration_gainsight)
  },
}
