import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_wrike(config: any, context: Record<string, unknown>) {
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
  const baseUrl = 'https://www.wrike.com/api/v4/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + accessToken,
  }

  switch (action) {
    case 'create-task': {
      const body: Record<string, any> = {
        title: config.title,
      }
      if (config.description) {
        body.description = config.description
      }
      if (config.status) {
        body.status = config.status
      }
      if (config.importance) {
        body.importance = config.importance
      }
      if (config.dates) {
        body.dates = config.dates
      }
      if (config.responsibles) {
        body.responsibles = config.responsibles
      }
      const response = await fetch(baseUrl + 'folders/' + config.folderId + '/tasks', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errorDescription || 'Failed to create task' }
      }
      return { success: true, task: data.data && data.data[0] }
    }
    case 'get-task': {
      const response = await fetch(baseUrl + 'tasks/' + config.taskId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errorDescription || 'Failed to get task' }
      }
      return { success: true, task: data.data && data.data[0] }
    }
    case 'list-tasks': {
      let url = baseUrl + 'tasks'
      const params = []
      if (config.folderId) {
        url = baseUrl + 'folders/' + config.folderId + '/tasks'
      }
      if (config.limit) {
        params.push('limit=' + config.limit)
      }
      if (config.status) {
        params.push('status=' + config.status)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errorDescription || 'Failed to list tasks' }
      }
      return { success: true, tasks: data.data || [] }
    }
    case 'update-task': {
      const body: Record<string, any> = {}
      if (config.title !== undefined) {
        body.title = config.title
      }
      if (config.description !== undefined) {
        body.description = config.description
      }
      if (config.status !== undefined) {
        body.status = config.status
      }
      const response = await fetch(baseUrl + 'tasks/' + config.taskId, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errorDescription || 'Failed to update task' }
      }
      return { success: true, task: data.data && data.data[0] }
    }
    case 'delete-task': {
      const response = await fetch(baseUrl + 'tasks/' + config.taskId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.errorDescription || 'Failed to delete task' }
      }
      return { success: true }
    }
    case 'create-folder': {
      // Schema canonical name is `parentFolderId`; older workflows used `folderId`. Accept either.
      const parentFolderIdVal = config.parentFolderId || config.folderId
      const body: Record<string, any> = { title: config.title }
      if (config.project) {
        body.project = config.project
      }
      const response = await fetch(baseUrl + 'folders/' + parentFolderIdVal + '/folders', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errorDescription || 'Failed to create folder' }
      }
      return { success: true, folder: data.data && data.data[0] }
    }
    case 'get-folder': {
      const response = await fetch(baseUrl + 'folders/' + config.folderId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errorDescription || 'Failed to get folder' }
      }
      return { success: true, folder: data.data && data.data[0] }
    }
    case 'list-folders': {
      let url = baseUrl + 'folders'
      if (config.spaceId) {
        url = baseUrl + 'spaces/' + config.spaceId + '/folders'
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errorDescription || 'Failed to list folders' }
      }
      return { success: true, folders: data.data || [] }
    }
    default:
      throw new Error('Unknown integration-wrike action: ' + action)
  }
}
export const integrationWrike: IntegrationHandlerGenerator = {
  nodeType: 'integration-wrike',
  executionEnv: 'server',
  secretFields: ['accessToken'],
  generateHandler(): string {
    return handlerToString(integration_wrike)
  },
}
