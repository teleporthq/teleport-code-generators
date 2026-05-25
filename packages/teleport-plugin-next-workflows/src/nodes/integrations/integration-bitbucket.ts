import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_bitbucket(config: any, context: Record<string, unknown>) {
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
  const username = config.username
  const appPassword = config.appPassword
  const action = config.action
  const baseUrl = 'https://api.bitbucket.org/2.0/'
  const authHeader = 'Basic ' + btoa(username + ':' + appPassword)
  const headers = {
    'Content-Type': 'application/json',
    Authorization: authHeader,
  }

  switch (action) {
    case 'create-repo': {
      const workspace = config.workspace
      const response = await fetch(baseUrl + 'repositories/' + workspace + '/' + config.repoSlug, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          scm: 'git',
          is_private: config.isPrivate !== false,
          name: config.repoName || config.repoSlug,
          description: config.description || '',
          language: config.language || '',
          has_issues: config.hasIssues !== false,
          has_wiki: config.hasWiki !== false,
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create repository',
        }
      }
      return { success: true, repository: data }
    }
    case 'get-repo': {
      const workspace = config.workspace
      const response = await fetch(baseUrl + 'repositories/' + workspace + '/' + config.repoSlug, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get repository',
        }
      }
      return { success: true, repository: data }
    }
    case 'create-pull-request': {
      const workspace = config.workspace
      const response = await fetch(
        baseUrl + 'repositories/' + workspace + '/' + config.repoSlug + '/pullrequests',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            title: config.title,
            description: config.description || '',
            source: { branch: { name: config.sourceBranch } },
            destination: { branch: { name: config.destinationBranch || 'main' } },
            close_source_branch: config.closeSourceBranch || false,
          }),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create pull request',
        }
      }
      return { success: true, pullRequest: data }
    }
    case 'list-repos': {
      let url = baseUrl + 'repositories/' + config.workspace
      if (config.pageLen) {
        url += '?pagelen=' + config.pageLen
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to list repos',
        }
      }
      return { success: true, repositories: data.values || [] }
    }
    case 'get-pull-request': {
      const response = await fetch(
        baseUrl +
          'repositories/' +
          config.workspace +
          '/' +
          config.repoSlug +
          '/pullrequests/' +
          config.pullRequestId,
        { method: 'GET', headers }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get pull request',
        }
      }
      return { success: true, pullRequest: data }
    }
    case 'merge-pull-request': {
      const response = await fetch(
        baseUrl +
          'repositories/' +
          config.workspace +
          '/' +
          config.repoSlug +
          '/pullrequests/' +
          config.pullRequestId +
          '/merge',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({}),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data.error && data.error.message) || 'Failed to merge' }
      }
      return { success: true, merge: data }
    }
    case 'create-branch': {
      const response = await fetch(
        baseUrl + 'repositories/' + config.workspace + '/' + config.repoSlug + '/refs/branches',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: config.branchName,
            target: { hash: config.targetCommit || config.target },
          }),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create branch',
        }
      }
      return { success: true, branch: data }
    }
    case 'list-branches': {
      let url =
        baseUrl + 'repositories/' + config.workspace + '/' + config.repoSlug + '/refs/branches'
      if (config.pagelen) {
        url += '?pagelen=' + config.pagelen
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to list branches',
        }
      }
      return { success: true, branches: data.values || [] }
    }
    default:
      throw new Error('Unknown integration-bitbucket action: ' + action)
  }
}
export const integrationBitbucket: IntegrationHandlerGenerator = {
  nodeType: 'integration-bitbucket',
  executionEnv: 'server',
  secretFields: ['username', 'appPassword'],
  generateHandler(): string {
    return handlerToString(integration_bitbucket)
  },
}
