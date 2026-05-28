import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_github(config: any, context: Record<string, unknown>) {
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
  const baseUrl = 'https://api.github.com/'
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + accessToken,
    'X-GitHub-Api-Version': '2022-11-28',
  }

  switch (action) {
    case 'create-issue': {
      const body: Record<string, any> = {
        title: config.title,
        body: config.body || '',
      }
      if (config.labels) {
        body.labels = config.labels
      }
      if (config.assignees) {
        body.assignees = config.assignees
      }
      if (config.milestone) {
        body.milestone = config.milestone
      }
      const response = await fetch(
        baseUrl + 'repos/' + config.owner + '/' + config.repo + '/issues',
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create issue' }
      }
      return { success: true, issue: data }
    }
    case 'create-pr': {
      const body: Record<string, any> = {
        title: config.title,
        head: config.head,
        base: config.base || 'main',
        body: config.body || '',
      }
      if (config.draft !== undefined) {
        body.draft = config.draft
      }
      if (config.maintainerCanModify !== undefined) {
        body.maintainer_can_modify = config.maintainerCanModify
      }
      const response = await fetch(
        baseUrl + 'repos/' + config.owner + '/' + config.repo + '/pulls',
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create pull request' }
      }
      return { success: true, pullRequest: data }
    }
    case 'list-repos': {
      let url = baseUrl + 'user/repos'
      const params = []
      if (config.type) {
        params.push('type=' + config.type)
      }
      if (config.sort) {
        params.push('sort=' + config.sort)
      }
      if (config.direction) {
        params.push('direction=' + config.direction)
      }
      if (config.perPage) {
        params.push('per_page=' + config.perPage)
      }
      if (config.page) {
        params.push('page=' + config.page)
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
        return { success: false, error: data.message || 'Failed to list repos' }
      }
      return { success: true, repos: data }
    }
    case 'create-repo': {
      const body: Record<string, any> = { name: config.name, private: config.private || false }
      if (config.description) {
        body.description = config.description
      }
      if (config.autoInit) {
        body.auto_init = config.autoInit
      }
      const response = await fetch(baseUrl + 'user/repos', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create repo' }
      }
      return { success: true, repo: data }
    }
    case 'get-repo': {
      const response = await fetch(baseUrl + 'repos/' + config.owner + '/' + config.repo, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get repo' }
      }
      return { success: true, repo: data }
    }
    case 'update-repo': {
      const body: Record<string, any> = {}
      if (config.name !== undefined) {
        body.name = config.name
      }
      if (config.description !== undefined) {
        body.description = config.description
      }
      if (config.private !== undefined) {
        body.private = config.private
      }
      const response = await fetch(baseUrl + 'repos/' + config.owner + '/' + config.repo, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update repo' }
      }
      return { success: true, repo: data }
    }
    case 'delete-repo': {
      const response = await fetch(baseUrl + 'repos/' + config.owner + '/' + config.repo, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to delete repo' }
      }
      return { success: true }
    }
    case 'update-issue': {
      const body: Record<string, any> = {}
      if (config.title !== undefined) {
        body.title = config.title
      }
      if (config.body !== undefined) {
        body.body = config.body
      }
      if (config.state !== undefined) {
        body.state = config.state
      }
      if (config.labels) {
        body.labels = config.labels
      }
      const response = await fetch(
        baseUrl + 'repos/' + config.owner + '/' + config.repo + '/issues/' + config.issueNumber,
        { method: 'PATCH', headers, body: JSON.stringify(body) }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update issue' }
      }
      return { success: true, issue: data }
    }
    case 'close-issue': {
      const response = await fetch(
        baseUrl + 'repos/' + config.owner + '/' + config.repo + '/issues/' + config.issueNumber,
        { method: 'PATCH', headers, body: JSON.stringify({ state: 'closed' }) }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to close issue' }
      }
      return { success: true, issue: data }
    }
    case 'get-issue': {
      const response = await fetch(
        baseUrl + 'repos/' + config.owner + '/' + config.repo + '/issues/' + config.issueNumber,
        { method: 'GET', headers }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get issue' }
      }
      return { success: true, issue: data }
    }
    case 'list-issues': {
      let url = baseUrl + 'repos/' + config.owner + '/' + config.repo + '/issues'
      const params = []
      if (config.state) {
        params.push('state=' + config.state)
      }
      if (config.labels) {
        params.push('labels=' + encodeURIComponent(config.labels))
      }
      if (config.perPage) {
        params.push('per_page=' + config.perPage)
      }
      if (config.page) {
        params.push('page=' + config.page)
      }
      if (params.length > 0) {
        url += '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list issues' }
      }
      return { success: true, issues: data }
    }
    case 'add-issue-comment': {
      const response = await fetch(
        baseUrl +
          'repos/' +
          config.owner +
          '/' +
          config.repo +
          '/issues/' +
          config.issueNumber +
          '/comments',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ body: config.body }),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to add comment' }
      }
      return { success: true, comment: data }
    }
    case 'update-pr': {
      const body: Record<string, any> = {}
      if (config.title !== undefined) {
        body.title = config.title
      }
      if (config.body !== undefined) {
        body.body = config.body
      }
      if (config.state !== undefined) {
        body.state = config.state
      }
      const response = await fetch(
        baseUrl + 'repos/' + config.owner + '/' + config.repo + '/pulls/' + config.pullNumber,
        { method: 'PATCH', headers, body: JSON.stringify(body) }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update PR' }
      }
      return { success: true, pullRequest: data }
    }
    case 'merge-pr': {
      const body: Record<string, any> = {}
      if (config.mergeMethod) {
        body.merge_method = config.mergeMethod
      }
      const response = await fetch(
        baseUrl +
          'repos/' +
          config.owner +
          '/' +
          config.repo +
          '/pulls/' +
          config.pullNumber +
          '/merge',
        { method: 'PUT', headers, body: JSON.stringify(body) }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to merge PR' }
      }
      return { success: true, merge: data }
    }
    case 'get-pr': {
      const response = await fetch(
        baseUrl + 'repos/' + config.owner + '/' + config.repo + '/pulls/' + config.pullNumber,
        { method: 'GET', headers }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get PR' }
      }
      return { success: true, pullRequest: data }
    }
    case 'list-prs': {
      let url = baseUrl + 'repos/' + config.owner + '/' + config.repo + '/pulls'
      const params = []
      if (config.state) {
        params.push('state=' + config.state)
      }
      if (config.perPage) {
        params.push('per_page=' + config.perPage)
      }
      if (config.page) {
        params.push('page=' + config.page)
      }
      if (params.length > 0) {
        url += '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list PRs' }
      }
      return { success: true, pullRequests: data }
    }
    case 'create-file': {
      const content =
        typeof config.content === 'string' && !config.content.match(/^[A-Za-z0-9+/=]+$/)
          ? btoa(unescape(encodeURIComponent(config.content)))
          : config.content || ''
      const body: Record<string, any> = { message: config.message, content }
      if (config.branch) {
        body.branch = config.branch
      }
      const response = await fetch(
        baseUrl +
          'repos/' +
          config.owner +
          '/' +
          config.repo +
          '/contents/' +
          encodeURIComponent(config.path),
        { method: 'PUT', headers, body: JSON.stringify(body) }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create file' }
      }
      return { success: true, file: data }
    }
    case 'update-file': {
      const content =
        typeof config.content === 'string' && !config.content.match(/^[A-Za-z0-9+/=]+$/)
          ? btoa(unescape(encodeURIComponent(config.content)))
          : config.content || ''
      const body: Record<string, any> = {
        message: config.message,
        content,
        sha: config.sha,
      }
      if (config.branch) {
        body.branch = config.branch
      }
      const response = await fetch(
        baseUrl +
          'repos/' +
          config.owner +
          '/' +
          config.repo +
          '/contents/' +
          encodeURIComponent(config.path),
        { method: 'PUT', headers, body: JSON.stringify(body) }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update file' }
      }
      return { success: true, file: data }
    }
    case 'delete-file': {
      const body: Record<string, any> = { message: config.message }
      if (config.branch) {
        body.branch = config.branch
      }
      if (config.sha) {
        body.sha = config.sha
      }
      const response = await fetch(
        baseUrl +
          'repos/' +
          config.owner +
          '/' +
          config.repo +
          '/contents/' +
          encodeURIComponent(config.path),
        { method: 'DELETE', headers, body: JSON.stringify(body) }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to delete file' }
      }
      return { success: true }
    }
    case 'get-file': {
      let fileUrl =
        baseUrl +
        'repos/' +
        config.owner +
        '/' +
        config.repo +
        '/contents/' +
        encodeURIComponent(config.path)
      if (config.ref) {
        fileUrl += '?ref=' + encodeURIComponent(config.ref)
      }
      const response = await fetch(fileUrl, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get file' }
      }
      return { success: true, file: data }
    }
    case 'create-branch': {
      // Schema canonical name is `branchName`; older workflows used `branch`.
      // Accept either so the alias removal doesn't break saved workflows.
      const branchNameVal = config.branchName || config.branch
      const response = await fetch(
        baseUrl + 'repos/' + config.owner + '/' + config.repo + '/git/refs',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ ref: 'refs/heads/' + branchNameVal, sha: config.sha }),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create branch' }
      }
      return { success: true, ref: data }
    }
    case 'create-release': {
      const body: Record<string, any> = {
        tag_name: config.tagName,
        name: config.name || config.tagName,
      }
      if (config.body) {
        body.body = config.body
      }
      if (config.draft !== undefined) {
        body.draft = config.draft
      }
      const response = await fetch(
        baseUrl + 'repos/' + config.owner + '/' + config.repo + '/releases',
        { method: 'POST', headers, body: JSON.stringify(body) }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create release' }
      }
      return { success: true, release: data }
    }
    case 'list-releases': {
      let url = baseUrl + 'repos/' + config.owner + '/' + config.repo + '/releases'
      if (config.perPage) {
        url += '?per_page=' + config.perPage
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list releases' }
      }
      return { success: true, releases: data }
    }
    case 'add-collaborator': {
      const body: Record<string, any> = {}
      if (config.permission) {
        body.permission = config.permission
      }
      const response = await fetch(
        baseUrl + 'repos/' + config.owner + '/' + config.repo + '/collaborators/' + config.username,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify(body),
        }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to add collaborator' }
      }
      return { success: true }
    }
    default:
      throw new Error('Unknown integration-github action: ' + action)
  }
}
export const integrationGithub: IntegrationHandlerGenerator = {
  nodeType: 'integration-github',
  executionEnv: 'server',
  secretFields: ['accessToken'],
  generateHandler(): string {
    return handlerToString(integration_github)
  },
}
