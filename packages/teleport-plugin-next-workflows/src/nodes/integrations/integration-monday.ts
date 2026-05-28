import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_monday(config: any, context: Record<string, unknown>) {
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
  const apiUrl = 'https://api.monday.com/v2'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: apiToken,
  }

  async function mondayQuery(query, variables) {
    const body: Record<string, any> = { query }
    if (variables) {
      body.variables = variables
    }
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const data = await __readJson(response)
    if (data.errors && data.errors.length > 0) {
      return { success: false, error: data.errors[0].message }
    }
    return { success: true, data: data.data }
  }

  switch (action) {
    case 'create-item': {
      const query =
        'mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON) { create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) { id name } }'
      const variables = {
        boardId: String(config.boardId),
        itemName: config.itemName,
        columnValues: config.columnValues ? JSON.stringify(config.columnValues) : undefined,
      }
      return mondayQuery(query, variables)
    }
    case 'get-item': {
      const query =
        'query ($itemId: [ID!]) { items(ids: $itemId) { id name column_values { id title text value } group { id title } board { id name } } }'
      const variables = { itemId: [String(config.itemId)] }
      return mondayQuery(query, variables)
    }
    case 'query-items': {
      const query =
        'query ($boardId: [ID!], $limit: Int) { boards(ids: $boardId) { items_page(limit: $limit) { items { id name column_values { id title text value } } } } }'
      const variables = { boardId: [String(config.boardId)], limit: config.limit || 50 }
      return mondayQuery(query, variables)
    }
    case 'create-board': {
      const query =
        'mutation ($boardName: String!, $boardKind: BoardKind, $folderId: Int) { create_board(board_name: $boardName, board_kind: $boardKind, folder_id: $folderId) { id name } }'
      return mondayQuery(query, {
        boardName: config.boardName,
        boardKind: config.boardKind || 'public',
        folderId: config.folderId,
      })
    }
    case 'get-board': {
      const query =
        'query ($boardIds: [ID!]) { boards(ids: $boardIds) { id name state groups { id title } } }'
      return mondayQuery(query, { boardIds: [String(config.boardId)] })
    }
    case 'update-board': {
      const query =
        'mutation ($boardId: ID!, $boardAttribute: BoardAttribute!, $newValue: String!) { update_board(board_id: $boardId, board_attribute: $boardAttribute, new_value: $newValue) { id } }'
      return mondayQuery(query, {
        boardId: String(config.boardId),
        boardAttribute: config.attribute || 'name',
        newValue: config.value,
      })
    }
    case 'delete-board': {
      const query = 'mutation ($boardId: ID!) { delete_board(board_id: $boardId) { id } }'
      return mondayQuery(query, { boardId: String(config.boardId) })
    }
    case 'update-item': {
      const query =
        'mutation ($itemId: ID!, $boardId: ID!, $columnValues: JSON!) { change_multiple_column_values(item_id: $itemId, board_id: $boardId, column_values: $columnValues) { id } }'
      return mondayQuery(query, {
        itemId: String(config.itemId),
        boardId: String(config.boardId),
        columnValues: JSON.stringify(config.columnValues || {}),
      })
    }
    case 'delete-item': {
      const query = 'mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }'
      return mondayQuery(query, { itemId: String(config.itemId) })
    }
    case 'move-item': {
      const query =
        'mutation ($itemId: ID!, $groupId: String!) { move_item_to_group(item_id: $itemId, group_id: $groupId) { id } }'
      return mondayQuery(query, { itemId: String(config.itemId), groupId: config.groupId })
    }
    case 'create-column': {
      const query =
        'mutation ($boardId: ID!, $title: String!, $columnType: ColumnType!, $defaults: JSON) { create_column(board_id: $boardId, title: $title, column_type: $columnType, defaults: $defaults) { id title } }'
      return mondayQuery(query, {
        boardId: String(config.boardId),
        title: config.title,
        columnType: config.columnType || 'text',
        defaults: config.defaults ? JSON.stringify(config.defaults) : undefined,
      })
    }
    case 'update-column': {
      const query =
        'mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) { change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id } }'
      return mondayQuery(query, {
        boardId: String(config.boardId),
        itemId: String(config.itemId),
        columnId: config.columnId,
        value: JSON.stringify(config.value),
      })
    }
    case 'create-group': {
      const query =
        'mutation ($boardId: ID!, $groupName: String!) { create_group(board_id: $boardId, group_name: $groupName) { id title } }'
      return mondayQuery(query, {
        boardId: String(config.boardId),
        groupName: config.groupName,
      })
    }
    default:
      throw new Error('Unknown integration-monday action: ' + action)
  }
}
export const integrationMonday: IntegrationHandlerGenerator = {
  nodeType: 'integration-monday',
  executionEnv: 'server',
  secretFields: ['apiToken'],
  generateHandler(): string {
    return handlerToString(integration_monday)
  },
}
