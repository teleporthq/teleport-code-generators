import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_bannerbear(config: any, context: Record<string, unknown>) {
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
  const baseUrl = 'https://api.bannerbear.com/v2/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + apiKey,
  }

  switch (action) {
    case 'generate-image': {
      const response = await fetch(baseUrl + 'images', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          template: config.templateId,
          modifications: config.modifications || [],
          webhook_url: config.webhookUrl || null,
          transparent: config.transparent || false,
          metadata: config.metadata || null,
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to generate image' }
      }
      return { success: true, image: data }
    }
    case 'get-image': {
      const response = await fetch(baseUrl + 'images/' + config.imageId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get image' }
      }
      return { success: true, image: data }
    }
    case 'list-templates': {
      let url = baseUrl + 'templates'
      if (config.page) {
        url = url + '?page=' + config.page
      }
      const response = await fetch(url, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list templates' }
      }
      return { success: true, templates: data }
    }
    case 'list-images': {
      let url = baseUrl + 'images'
      if (config.page) {
        url += '?page=' + config.page
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed' }
      }
      return { success: true, images: data }
    }
    case 'create-video': {
      const response = await fetch(baseUrl + 'videos', {
        method: 'POST',
        headers,
        body: JSON.stringify(
          config.video || { template: config.templateId, modifications: config.modifications || [] }
        ),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed' }
      }
      return { success: true, video: data }
    }
    case 'get-video': {
      const response = await fetch(baseUrl + 'videos/' + config.videoId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed' }
      }
      return { success: true, video: data }
    }
    case 'create-collection': {
      const response = await fetch(baseUrl + 'collections', {
        method: 'POST',
        headers,
        body: JSON.stringify(
          config.collection || { template: config.templateId, templates: config.templates || [] }
        ),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed' }
      }
      return { success: true, collection: data }
    }
    case 'approve-image': {
      const response = await fetch(baseUrl + 'images/' + config.imageId, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'approved' }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed' }
      }
      return { success: true, image: data }
    }
    case 'get-template': {
      const response = await fetch(baseUrl + 'templates/' + config.templateId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed' }
      }
      return { success: true, template: data }
    }
    default:
      throw new Error('Unknown integration-bannerbear action: ' + action)
  }
}
export const integrationBannerbear: IntegrationHandlerGenerator = {
  nodeType: 'integration-bannerbear',
  executionEnv: 'server',
  secretFields: ['apiKey'],
  generateHandler(): string {
    return handlerToString(integration_bannerbear)
  },
}
