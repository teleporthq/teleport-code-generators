import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_clickup(config: any, context: Record<string, unknown>) {
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
  const apiToken = config.apiToken
  const action = config.action
  const baseUrl = 'https://api.clickup.com/api/v2/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: apiToken,
  }

  switch (action) {
    case 'create-task': {
      const response = await fetch(baseUrl + 'list/' + config.listId + '/task', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: config.name,
          description: config.description || '',
          assignees: config.assignees || [],
          tags: config.tags || [],
          status: config.status || null,
          priority: config.priority || null,
          due_date: config.dueDate || null,
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to create task' }
      }
      return { success: true, task: data }
    }
    case 'get-task': {
      const response = await fetch(baseUrl + 'task/' + config.taskId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to get task' }
      }
      return { success: true, task: data }
    }
    case 'update-task': {
      const body: Record<string, any> = {}
      if (config.name !== undefined) {
        body.name = config.name
      }
      if (config.description !== undefined) {
        body.description = config.description
      }
      if (config.status !== undefined) {
        body.status = config.status
      }
      if (config.priority !== undefined) {
        body.priority = config.priority
      }
      if (config.dueDate !== undefined) {
        body.due_date = config.dueDate
      }
      if (config.assignees !== undefined) {
        body.assignees = config.assignees
      }
      const response = await fetch(baseUrl + 'task/' + config.taskId, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to update task' }
      }
      return { success: true, task: data }
    }
    case 'delete-task': {
      const response = await fetch(baseUrl + 'task/' + config.taskId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.error || 'Failed to delete task' }
      }
      return { success: true }
    }
    case 'list-tasks': {
      let url = baseUrl + 'list/' + config.listId + '/task'
      if (config.archived) {
        url += '?archived=' + config.archived
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to list tasks' }
      }
      return { success: true, tasks: data.tasks || [] }
    }
    case 'create-list': {
      const response = await fetch(baseUrl + 'folder/' + config.folderId + '/list', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: config.name }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to create list' }
      }
      return { success: true, list: data }
    }
    case 'add-comment': {
      const response = await fetch(baseUrl + 'task/' + config.taskId + '/comment', {
        method: 'POST',
        headers,
        body: JSON.stringify({ comment_text: config.comment }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to add comment' }
      }
      return { success: true, comment: data }
    }
    case 'get-spaces': {
      const response = await fetch(baseUrl + 'team/' + config.teamId + '/space', {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to get spaces' }
      }
      return { success: true, spaces: data.spaces || [] }
    }
    default:
      throw new Error('Unknown integration-clickup action: ' + action)
  }
}
export const integrationClickup: IntegrationHandlerGenerator = {
  nodeType: 'integration-clickup',
  executionEnv: 'server',
  secretFields: ['apiToken'],
  generateHandler(): string {
    return handlerToString(integration_clickup)
  },
}
