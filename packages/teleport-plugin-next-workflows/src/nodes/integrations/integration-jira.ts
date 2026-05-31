import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_jira(config: any, context: Record<string, unknown>) {
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
  const domain = config.domain
  const email = config.email
  const apiToken = config.apiToken
  const action = config.action
  const baseUrl = 'https://' + domain + '.atlassian.net/rest/api/3/'
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: 'Basic ' + btoa(email + ':' + apiToken),
  }

  switch (action) {
    case 'create-issue': {
      const fields: Record<string, any> = {
        project: { key: config.projectKey },
        summary: config.summary,
        issuetype: { name: config.issueType || 'Task' },
      }
      if (config.description) {
        fields.description = {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: config.description }],
            },
          ],
        }
      }
      if (config.assignee) {
        fields.assignee = { accountId: config.assignee }
      }
      if (config.priority) {
        fields.priority = { name: config.priority }
      }
      if (config.labels) {
        fields.labels = config.labels
      }
      if (config.components) {
        fields.components = config.components.map(function (c) {
          return { name: c }
        })
      }
      const response = await fetch(baseUrl + 'issue', {
        method: 'POST',
        headers,
        body: JSON.stringify({ fields }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errors && JSON.stringify(data.errors)) ||
            (data.errorMessages && data.errorMessages[0]) ||
            'Failed to create issue',
        }
      }
      return { success: true, issue: data }
    }
    case 'get-issue': {
      let url = baseUrl + 'issue/' + config.issueIdOrKey
      const params = []
      if (config.fields) {
        params.push('fields=' + encodeURIComponent(config.fields.join(',')))
      }
      if (config.expand) {
        params.push('expand=' + encodeURIComponent(config.expand))
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
        return {
          success: false,
          error: (data.errorMessages && data.errorMessages[0]) || 'Failed to get issue',
        }
      }
      return { success: true, issue: data }
    }
    case 'search-issues': {
      const body: Record<string, any> = {
        jql: config.jql || '',
        maxResults: config.maxResults || 50,
        startAt: config.startAt || 0,
      }
      if (config.fields) {
        body.fields = config.fields
      }
      const response = await fetch(baseUrl + 'search', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errorMessages && data.errorMessages[0]) || 'Failed to search issues',
        }
      }
      return {
        success: true,
        issues: data.issues || [],
        total: data.total,
        startAt: data.startAt,
        maxResults: data.maxResults,
      }
    }
    case 'update-issue': {
      const fields: Record<string, any> = {}
      if (config.summary !== undefined) {
        fields.summary = config.summary
      }
      if (config.description !== undefined) {
        fields.description = {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: config.description }] }],
        }
      }
      if (config.assignee !== undefined) {
        fields.assignee = { accountId: config.assignee }
      }
      const response = await fetch(baseUrl + 'issue/' + config.issueIdOrKey, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ fields }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errorMessages && data.errorMessages[0]) ||
            (data.errors && JSON.stringify(data.errors)) ||
            'Failed to update issue',
        }
      }
      return { success: true, issue: data }
    }
    case 'delete-issue': {
      const response = await fetch(baseUrl + 'issue/' + config.issueIdOrKey, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.errorMessages && data.errorMessages[0]) || 'Failed to delete issue',
        }
      }
      return { success: true }
    }
    case 'transition-issue': {
      const response = await fetch(baseUrl + 'issue/' + config.issueIdOrKey + '/transitions', {
        method: 'POST',
        headers,
        body: JSON.stringify({ transition: { id: config.transitionId } }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.errorMessages && data.errorMessages[0]) || 'Failed to transition issue',
        }
      }
      return { success: true }
    }
    case 'assign-issue': {
      const response = await fetch(baseUrl + 'issue/' + config.issueIdOrKey + '/assignee', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ accountId: config.accountId || null }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.errorMessages && data.errorMessages[0]) || 'Failed to assign issue',
        }
      }
      return { success: true }
    }
    case 'add-comment': {
      const response = await fetch(baseUrl + 'issue/' + config.issueIdOrKey + '/comment', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          body: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: config.body || config.comment }],
              },
            ],
          },
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errorMessages && data.errorMessages[0]) || 'Failed to add comment',
        }
      }
      return { success: true, comment: data }
    }
    case 'update-comment': {
      const response = await fetch(
        baseUrl + 'issue/' + config.issueIdOrKey + '/comment/' + config.commentId,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            body: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: config.body || config.comment }],
                },
              ],
            },
          }),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errorMessages && data.errorMessages[0]) || 'Failed to update comment',
        }
      }
      return { success: true, comment: data }
    }
    case 'delete-comment': {
      const response = await fetch(
        baseUrl + 'issue/' + config.issueIdOrKey + '/comment/' + config.commentId,
        { method: 'DELETE', headers }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.errorMessages && data.errorMessages[0]) || 'Failed to delete comment',
        }
      }
      return { success: true }
    }
    case 'create-subtask': {
      const fields: Record<string, any> = {
        project: { key: config.projectKey },
        summary: config.summary,
        issuetype: { name: 'Subtask' },
        parent: { key: config.parentKey },
      }
      if (config.description) {
        fields.description = {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: config.description }] }],
        }
      }
      const response = await fetch(baseUrl + 'issue', {
        method: 'POST',
        headers,
        body: JSON.stringify({ fields }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error:
            (data.errorMessages && data.errorMessages[0]) ||
            (data.errors && JSON.stringify(data.errors)) ||
            'Failed to create subtask',
        }
      }
      return { success: true, issue: data }
    }
    case 'add-watcher': {
      const response = await fetch(baseUrl + 'issue/' + config.issueIdOrKey + '/watchers', {
        method: 'POST',
        headers,
        body: JSON.stringify('' + config.accountId),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.errorMessages && data.errorMessages[0]) || 'Failed to add watcher',
        }
      }
      return { success: true }
    }
    case 'remove-watcher': {
      const response = await fetch(
        baseUrl +
          'issue/' +
          config.issueIdOrKey +
          '/watchers?accountId=' +
          encodeURIComponent(config.accountId),
        { method: 'DELETE', headers }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.errorMessages && data.errorMessages[0]) || 'Failed to remove watcher',
        }
      }
      return { success: true }
    }
    case 'add-label': {
      const response = await fetch(baseUrl + 'issue/' + config.issueIdOrKey, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          update: {
            labels: [{ add: config.label }],
          },
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errorMessages && data.errorMessages[0]) || 'Failed to add label',
        }
      }
      return { success: true, issue: data }
    }
    case 'link-issues': {
      const response = await fetch(baseUrl + 'issueLink', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: { name: config.linkType || 'Duplicate' },
          inwardIssue: { key: config.inwardIssue },
          outwardIssue: { key: config.outwardIssue },
        }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data.errorMessages && data.errorMessages[0]) || 'Failed to link issues',
        }
      }
      return { success: true }
    }
    case 'attach-file': {
      const formData = new FormData()
      const fileContent = config.fileContent || config.content
      const fileName = config.fileName || config.filename || 'file'
      if (fileContent) {
        let blob: Blob
        if (typeof fileContent === 'string' && fileContent.startsWith('data:')) {
          blob = await (await fetch(fileContent)).blob()
        } else if (typeof fileContent === 'string') {
          const bin =
            typeof (globalThis as any).Buffer !== 'undefined'
              ? (globalThis as any).Buffer.from(fileContent, 'base64')
              : Uint8Array.from(atob(fileContent), (c: string) => c.charCodeAt(0))
          blob = new Blob([bin], { type: config.contentType || 'application/octet-stream' })
        } else {
          blob = new Blob([fileContent], { type: config.contentType || 'application/octet-stream' })
        }
        formData.append('file', blob, fileName)
      }
      const attachHeaders: Record<string, string> = { 'X-Atlassian-Token': 'no-check' }
      if (headers.Authorization) {
        attachHeaders.Authorization = headers.Authorization
      }
      const response = await fetch(baseUrl + 'issue/' + config.issueIdOrKey + '/attachments', {
        method: 'POST',
        headers: attachHeaders,
        body: formData,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errorMessages && data.errorMessages[0]) || 'Failed to attach file',
        }
      }
      return { success: true, attachments: data }
    }
    default:
      throw new Error('Unknown integration-jira action: ' + action)
  }
}
export const integrationJira: IntegrationHandlerGenerator = {
  nodeType: 'integration-jira',
  executionEnv: 'server',
  secretFields: ['domain', 'email', 'apiToken'],
  generateHandler(): string {
    return handlerToString(integration_jira)
  },
}
