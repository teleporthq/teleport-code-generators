import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_segment(config: any, context: Record<string, unknown>) {
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
  const writeKey = config.writeKey
  const action = config.action
  const baseUrl = 'https://api.segment.io/v1/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Basic ' + btoa(writeKey + ':'),
  }

  switch (action) {
    case 'identify': {
      const body: Record<string, any> = {
        userId: config.userId,
        traits: config.traits || {},
      }
      if (config.anonymousId) {
        body.anonymousId = config.anonymousId
      }
      if (config.context) {
        body.context = config.context
      }
      if (config.timestamp) {
        body.timestamp = config.timestamp
      }
      const response = await fetch(baseUrl + 'identify', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to identify' }
      }
      return { success: true }
    }
    case 'track': {
      const body: Record<string, any> = {
        userId: config.userId,
        event: config.event,
        properties: config.properties || {},
      }
      if (config.anonymousId) {
        body.anonymousId = config.anonymousId
      }
      if (config.context) {
        body.context = config.context
      }
      if (config.timestamp) {
        body.timestamp = config.timestamp
      }
      const response = await fetch(baseUrl + 'track', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to track' }
      }
      return { success: true }
    }
    case 'page': {
      const body: Record<string, any> = {
        userId: config.userId,
        name: config.name,
        properties: config.properties || {},
      }
      if (config.anonymousId) {
        body.anonymousId = config.anonymousId
      }
      const response = await fetch(baseUrl + 'page', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to track page' }
      }
      return { success: true }
    }
    case 'screen': {
      const body: Record<string, any> = {
        userId: config.userId,
        name: config.name,
        properties: config.properties || {},
      }
      if (config.anonymousId) {
        body.anonymousId = config.anonymousId
      }
      if (config.context) {
        body.context = config.context
      }
      if (config.timestamp) {
        body.timestamp = config.timestamp
      }
      const response = await fetch(baseUrl + 'screen', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to track screen' }
      }
      return { success: true }
    }
    case 'group': {
      const body: Record<string, any> = {
        userId: config.userId,
        groupId: config.groupId,
        traits: config.traits || {},
      }
      if (config.anonymousId) {
        body.anonymousId = config.anonymousId
      }
      if (config.context) {
        body.context = config.context
      }
      if (config.timestamp) {
        body.timestamp = config.timestamp
      }
      const response = await fetch(baseUrl + 'group', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to group' }
      }
      return { success: true }
    }
    case 'alias': {
      const body: Record<string, any> = {
        userId: config.userId,
        previousId: config.previousId || config.anonymousId,
      }
      if (config.timestamp) {
        body.timestamp = config.timestamp
      }
      const response = await fetch(baseUrl + 'alias', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to alias' }
      }
      return { success: true }
    }
    case 'batch': {
      const batch = config.batch || []
      const response = await fetch(baseUrl + 'batch', {
        method: 'POST',
        headers,
        body: JSON.stringify({ batch }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to batch' }
      }
      return { success: true }
    }
    case 'get-profile': {
      if (!config.personasSpaceId || !config.personasToken) {
        return {
          success: false,
          error: 'personasSpaceId and personasToken required for Profile API',
        }
      }
      const profileUrl =
        'https://profiles.segment.com/v1/spaces/' +
        config.personasSpaceId +
        '/collections/users/profiles/user_id:' +
        config.userId
      const response = await fetch(profileUrl, {
        method: 'GET',
        // Segment Profile API uses HTTP Basic auth: access token as the
        // username with an empty password (same scheme as the write-key above).
        headers: { Authorization: 'Basic ' + btoa(config.personasToken + ':') },
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to get profile' }
      }
      return { success: true, profile: data }
    }
    default:
      throw new Error('Unknown integration-segment action: ' + action)
  }
}
export const integrationSegment: IntegrationHandlerGenerator = {
  nodeType: 'integration-segment',
  executionEnv: 'server',
  secretFields: ['writeKey'],
  generateHandler(): string {
    return handlerToString(integration_segment)
  },
}
