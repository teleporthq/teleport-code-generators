import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_gong(config: any, context: Record<string, unknown>) {
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
  const accessKey = config.accessKey
  const accessKeySecret = config.accessKeySecret
  const accessToken =
    accessKey && accessKeySecret
      ? 'Basic ' + btoa(accessKey + ':' + accessKeySecret)
      : 'Bearer ' + (config.accessToken || '')
  const action = config.action
  const baseUrl = 'https://api.gong.io/v2/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: accessToken,
  }

  switch (action) {
    case 'list-calls': {
      const body: Record<string, any> = {}
      if (config.fromDateTime) {
        body.filter = body.filter || {}
        body.filter.fromDateTime = config.fromDateTime
      }
      if (config.toDateTime) {
        body.filter = body.filter || {}
        body.filter.toDateTime = config.toDateTime
      }
      if (config.workspaceId) {
        body.filter = body.filter || {}
        body.filter.workspaceId = config.workspaceId
      }
      if (config.cursor) {
        body.cursor = config.cursor
      }
      const response = await fetch(baseUrl + 'calls', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors ? data.errors[0] : 'Failed to list calls' }
      }
      return {
        success: true,
        calls: data.calls || [],
        cursor: (data.records && data.records.cursor) || null,
      }
    }
    case 'get-call': {
      const response = await fetch(baseUrl + 'calls/' + config.callId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors ? data.errors[0] : 'Failed to get call' }
      }
      return { success: true, call: data }
    }
    case 'get-call-transcript': {
      const response = await fetch(baseUrl + 'calls/transcript', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filter: { callIds: [config.callId] },
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors ? data.errors[0] : 'Failed to get transcript' }
      }
      return { success: true, transcripts: data.callTranscripts || [] }
    }
    case 'list-users': {
      const response = await fetch(baseUrl + 'users', { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors ? data.errors[0] : 'Failed' }
      }
      return { success: true, users: data.users || [] }
    }
    case 'get-user': {
      const response = await fetch(baseUrl + 'users/' + config.userId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors ? data.errors[0] : 'Failed' }
      }
      return { success: true, user: data }
    }
    case 'get-call-stats': {
      const response = await fetch(baseUrl + 'stats/activity/detailed', {
        method: 'POST',
        headers,
        body: JSON.stringify(config.body || { filter: config.filter }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors ? data.errors[0] : 'Failed' }
      }
      return { success: true, stats: data }
    }
    case 'list-scorecards': {
      const response = await fetch(baseUrl + 'settings/scorecards', {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors ? data.errors[0] : 'Failed' }
      }
      return { success: true, scorecards: data.scorecards || [] }
    }
    case 'get-answered-scorecards': {
      const response = await fetch(baseUrl + 'stats/activity/scorecards', {
        method: 'POST',
        headers,
        body: JSON.stringify(config.body || {}),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors ? data.errors[0] : 'Failed' }
      }
      return { success: true, scorecards: data }
    }
    case 'list-deals': {
      const response = await fetch(baseUrl + 'deals', {
        method: 'POST',
        headers,
        body: JSON.stringify(config.body || { filter: config.filter }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors ? data.errors[0] : 'Failed' }
      }
      return { success: true, deals: data.deals || [] }
    }
    case 'get-deal': {
      const response = await fetch(baseUrl + 'deals/' + config.dealId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors ? data.errors[0] : 'Failed' }
      }
      return { success: true, deal: data }
    }
    case 'list-meetings': {
      const response = await fetch(baseUrl + 'meetings', {
        method: 'POST',
        headers,
        body: JSON.stringify(config.body || { filter: config.filter }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors ? data.errors[0] : 'Failed' }
      }
      return { success: true, meetings: data.meetings || [] }
    }
    default:
      throw new Error('Unknown integration-gong action: ' + action)
  }
}
export const integrationGong: IntegrationHandlerGenerator = {
  nodeType: 'integration-gong',
  executionEnv: 'server',
  secretFields: ['accessKey', 'accessKeySecret', 'accessToken'],
  generateHandler(): string {
    return handlerToString(integration_gong)
  },
}
