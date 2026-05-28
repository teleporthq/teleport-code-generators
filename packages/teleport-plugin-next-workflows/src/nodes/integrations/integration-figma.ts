import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_figma(config: any, context: Record<string, unknown>) {
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
  const baseUrl = 'https://api.figma.com/v1/'
  const headers = {
    'Content-Type': 'application/json',
    'X-Figma-Token': accessToken,
  }

  switch (action) {
    case 'get-file': {
      let url = baseUrl + 'files/' + config.fileKey
      const params = []
      if (config.version) {
        params.push('version=' + encodeURIComponent(config.version))
      }
      if (config.depth) {
        params.push('depth=' + config.depth)
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
        return { success: false, error: data.error || 'Failed to get file' }
      }
      return { success: true, file: data }
    }
    case 'get-comments': {
      const response = await fetch(baseUrl + 'files/' + config.fileKey + '/comments', {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to get comments' }
      }
      return { success: true, comments: data.comments }
    }
    case 'post-comment': {
      const body: Record<string, any> = {
        message: config.message || '',
      }
      if (config.clientMeta) {
        body.client_meta = config.clientMeta
      }
      if (config.commentId) {
        body.comment_id = config.commentId
      }
      const response = await fetch(baseUrl + 'files/' + config.fileKey + '/comments', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to post comment' }
      }
      return { success: true, comment: data }
    }
    case 'get-file-nodes': {
      const url =
        baseUrl + 'files/' + config.fileKey + '/nodes?ids=' + encodeURIComponent(config.ids)
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to get file nodes' }
      }
      return { success: true, nodes: data.nodes, name: data.name }
    }
    case 'get-images': {
      let url = baseUrl + 'images/' + config.fileKey + '?ids=' + encodeURIComponent(config.ids)
      if (config.format) {
        url += '&format=' + config.format
      }
      if (config.scale) {
        url += '&scale=' + config.scale
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to get images' }
      }
      return { success: true, images: data.images }
    }
    case 'get-team-projects': {
      const response = await fetch(baseUrl + 'teams/' + config.teamId + '/projects', {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to get team projects' }
      }
      return { success: true, projects: data.projects }
    }
    case 'get-project-files': {
      const response = await fetch(baseUrl + 'projects/' + config.projectId + '/files', {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to get project files' }
      }
      return { success: true, files: data.files }
    }
    case 'get-file-versions': {
      const response = await fetch(baseUrl + 'files/' + config.fileKey + '/versions', {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to get file versions' }
      }
      return { success: true, versions: data.versions }
    }
    default:
      throw new Error('Unknown integration-figma action: ' + action)
  }
}
export const integrationFigma: IntegrationHandlerGenerator = {
  nodeType: 'integration-figma',
  executionEnv: 'server',
  secretFields: ['accessToken'],
  generateHandler(): string {
    return handlerToString(integration_figma)
  },
}
