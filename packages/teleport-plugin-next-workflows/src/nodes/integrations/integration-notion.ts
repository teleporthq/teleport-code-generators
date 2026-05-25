import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_notion(config: any, context: Record<string, unknown>) {
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
  const baseUrl = 'https://api.notion.com/v1/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + apiKey,
    'Notion-Version': '2022-06-28',
  }

  switch (action) {
    case 'create-page': {
      const body: Record<string, any> = {
        parent:
          config.parentType === 'database'
            ? { database_id: config.parentId }
            : { page_id: config.parentId },
        properties: config.properties || {},
      }
      if (config.children) {
        body.children = config.children
      }
      if (config.icon) {
        body.icon = config.icon
      }
      if (config.cover) {
        body.cover = config.cover
      }
      const response = await fetch(baseUrl + 'pages', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create page' }
      }
      return { success: true, page: data }
    }
    case 'query-database': {
      const databaseId = config.databaseId
      const body: Record<string, any> = {}
      if (config.filter) {
        body.filter = config.filter
      }
      if (config.sorts) {
        body.sorts = config.sorts
      }
      if (config.startCursor) {
        body.start_cursor = config.startCursor
      }
      body.page_size = config.pageSize || 100
      const response = await fetch(baseUrl + 'databases/' + databaseId + '/query', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to query database' }
      }
      return {
        success: true,
        results: data.results,
        hasMore: data.has_more,
        nextCursor: data.next_cursor,
      }
    }
    case 'search': {
      const body: Record<string, any> = {}
      if (config.query) {
        body.query = config.query
      }
      if (config.filter) {
        body.filter = config.filter
      }
      if (config.sort) {
        body.sort = config.sort
      }
      if (config.startCursor) {
        body.start_cursor = config.startCursor
      }
      body.page_size = config.pageSize || 100
      const response = await fetch(baseUrl + 'search', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to search' }
      }
      return {
        success: true,
        results: data.results,
        hasMore: data.has_more,
        nextCursor: data.next_cursor,
      }
    }
    case 'get-page': {
      const response = await fetch(baseUrl + 'pages/' + config.pageId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get page' }
      }
      return { success: true, page: data }
    }
    case 'update-page': {
      const body: Record<string, any> = {}
      if (config.properties) {
        body.properties = config.properties
      }
      if (config.archived !== undefined) {
        body.archived = config.archived
      }
      const response = await fetch(baseUrl + 'pages/' + config.pageId, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update page' }
      }
      return { success: true, page: data }
    }
    case 'delete-page': {
      const response = await fetch(baseUrl + 'pages/' + config.pageId, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ archived: true }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to delete page' }
      }
      return { success: true, page: data }
    }
    case 'append-blocks': {
      const response = await fetch(baseUrl + 'blocks/' + config.blockId + '/children', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ children: config.children || [] }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to append blocks' }
      }
      return { success: true, blocks: data.results }
    }
    case 'get-blocks': {
      let url = baseUrl + 'blocks/' + config.blockId + '/children'
      if (config.pageSize) {
        url += '?page_size=' + config.pageSize
      }
      if (config.startCursor) {
        url += (url.indexOf('?') >= 0 ? '&' : '?') + 'start_cursor=' + config.startCursor
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get blocks' }
      }
      return {
        success: true,
        blocks: data.results,
        hasMore: data.has_more,
        nextCursor: data.next_cursor,
      }
    }
    case 'create-database': {
      const body: Record<string, any> = {
        parent: { page_id: config.parentId },
        title: [{ type: 'text', text: { content: config.title } }],
        properties: config.properties || {},
      }
      const response = await fetch(baseUrl + 'databases', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create database' }
      }
      return { success: true, database: data }
    }
    case 'get-database': {
      const response = await fetch(baseUrl + 'databases/' + config.databaseId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get database' }
      }
      return { success: true, database: data }
    }
    case 'update-database': {
      const body: Record<string, any> = {}
      if (config.title) {
        body.title = [{ type: 'text', text: { content: config.title } }]
      }
      if (config.properties) {
        body.properties = config.properties
      }
      const response = await fetch(baseUrl + 'databases/' + config.databaseId, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update database' }
      }
      return { success: true, database: data }
    }
    case 'create-database-entry': {
      const body: Record<string, any> = {
        parent: { database_id: config.databaseId },
        properties: config.properties || {},
      }
      if (config.children) {
        body.children = config.children
      }
      const response = await fetch(baseUrl + 'pages', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create database entry' }
      }
      return { success: true, page: data }
    }
    case 'update-database-entry': {
      const body: Record<string, any> = {}
      if (config.properties) {
        body.properties = config.properties
      }
      const response = await fetch(baseUrl + 'pages/' + config.pageId, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update database entry' }
      }
      return { success: true, page: data }
    }
    case 'add-comment': {
      const response = await fetch(baseUrl + 'comments', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          parent: { page_id: config.pageId },
          rich_text: [{ type: 'text', text: { content: config.comment } }],
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to add comment' }
      }
      return { success: true, comment: data }
    }
    case 'get-users': {
      let url = baseUrl + 'users'
      if (config.pageSize) {
        url += '?page_size=' + config.pageSize
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get users' }
      }
      return { success: true, users: data.results }
    }
    default:
      throw new Error('Unknown integration-notion action: ' + action)
  }
}
export const integrationNotion: IntegrationHandlerGenerator = {
  nodeType: 'integration-notion',
  executionEnv: 'server',
  secretFields: ['apiKey'],
  generateHandler(): string {
    return handlerToString(integration_notion)
  },
}
