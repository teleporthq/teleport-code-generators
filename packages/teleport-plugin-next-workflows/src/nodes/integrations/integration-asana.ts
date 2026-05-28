import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_asana(config: any, context: Record<string, unknown>) {
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
  const baseUrl = 'https://app.asana.com/api/1.0/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + accessToken,
  }

  switch (action) {
    case 'create-task': {
      const response = await fetch(baseUrl + 'tasks', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          data: {
            name: config.name,
            notes: config.notes || '',
            projects: config.projectId ? [config.projectId] : [],
            assignee: config.assignee || null,
            due_on: config.dueDate || null,
            workspace: config.workspaceId,
          },
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to create task',
        }
      }
      return { success: true, task: data.data }
    }
    case 'get-task': {
      const response = await fetch(baseUrl + 'tasks/' + config.taskId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to get task',
        }
      }
      return { success: true, task: data.data }
    }
    case 'update-task': {
      const body: Record<string, any> = { data: {} }
      if (config.name !== undefined) {
        body.data.name = config.name
      }
      if (config.notes !== undefined) {
        body.data.notes = config.notes
      }
      if (config.assignee !== undefined) {
        body.data.assignee = config.assignee
      }
      if (config.dueDate !== undefined) {
        body.data.due_on = config.dueDate
      }
      if (config.completed !== undefined) {
        body.data.completed = config.completed
      }
      const response = await fetch(baseUrl + 'tasks/' + config.taskId, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to update task',
        }
      }
      return { success: true, task: data.data }
    }
    case 'delete-task': {
      const response = await fetch(baseUrl + 'tasks/' + config.taskId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to delete task',
        }
      }
      return { success: true }
    }
    case 'list-tasks': {
      let url = baseUrl + 'tasks'
      const params = []
      if (config.projectId) {
        params.push('project=' + config.projectId)
      }
      if (config.assignee) {
        params.push('assignee=' + config.assignee)
      }
      if (config.workspaceId) {
        params.push('workspace=' + config.workspaceId)
      }
      if (config.sectionId) {
        params.push('section=' + config.sectionId)
      }
      if (config.limit) {
        params.push('limit=' + config.limit)
      }
      if (config.offset) {
        params.push('offset=' + config.offset)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to list tasks',
        }
      }
      return { success: true, tasks: data.data || [], nextPage: data.next_page }
    }
    case 'create-project': {
      const response = await fetch(baseUrl + 'projects', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          data: {
            name: config.name,
            workspace: config.workspaceId,
            team: config.teamId || null,
            notes: config.notes || '',
          },
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to create project',
        }
      }
      return { success: true, project: data.data }
    }
    case 'get-project': {
      const response = await fetch(baseUrl + 'projects/' + config.projectId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to get project',
        }
      }
      return { success: true, project: data.data }
    }
    case 'update-project': {
      const body: Record<string, any> = { data: {} }
      if (config.name !== undefined) {
        body.data.name = config.name
      }
      if (config.notes !== undefined) {
        body.data.notes = config.notes
      }
      const response = await fetch(baseUrl + 'projects/' + config.projectId, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to update project',
        }
      }
      return { success: true, project: data.data }
    }
    case 'list-projects': {
      let url = baseUrl + 'projects'
      const params = []
      if (config.workspaceId) {
        params.push('workspace=' + config.workspaceId)
      }
      if (config.teamId) {
        params.push('team=' + config.teamId)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to list projects',
        }
      }
      return { success: true, projects: data.data || [] }
    }
    case 'add-comment': {
      const response = await fetch(baseUrl + 'tasks/' + config.taskId + '/stories', {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: { text: config.text } }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to add comment',
        }
      }
      return { success: true, story: data.data }
    }
    case 'create-section': {
      const response = await fetch(baseUrl + 'projects/' + config.projectId + '/sections', {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: { name: config.name } }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to create section',
        }
      }
      return { success: true, section: data.data }
    }
    case 'move-task': {
      const response = await fetch(baseUrl + 'sections/' + config.sectionId + '/addTask', {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: { task: config.taskId } }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to move task',
        }
      }
      return { success: true, data: data.data }
    }
    case 'assign-task': {
      const response = await fetch(baseUrl + 'tasks/' + config.taskId, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ data: { assignee: config.assignee } }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to assign task',
        }
      }
      return { success: true, task: data.data }
    }
    case 'add-tag': {
      const response = await fetch(baseUrl + 'tasks/' + config.taskId + '/addTag', {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: { tag: config.tagId } }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to add tag',
        }
      }
      return { success: true, data: data.data }
    }
    case 'set-due-date': {
      const response = await fetch(baseUrl + 'tasks/' + config.taskId, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ data: { due_on: config.dueDate } }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && data.errors[0] && data.errors[0].message) || 'Failed to set due date',
        }
      }
      return { success: true, task: data.data }
    }
    default:
      throw new Error('Unknown integration-asana action: ' + action)
  }
}
export const integrationAsana: IntegrationHandlerGenerator = {
  nodeType: 'integration-asana',
  executionEnv: 'server',
  secretFields: ['accessToken'],
  generateHandler(): string {
    return handlerToString(integration_asana)
  },
}
