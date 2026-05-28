import { NodeHandlerGenerator, handlerToString } from '../types'

async function data_delete_item(config: any, context: any) {
  const dataSourceId = config.dataSourceId
  const tableName = config.tableName
  const filters = config.filters || []
  const baseUrl = (context && context.__baseUrl) || ''

  try {
    const response = await fetch(baseUrl + '/api/data/' + dataSourceId + '/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableName, filters }),
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        deletedId: null,
        success: false,
        deletedCount: 0,
        error: data.error || 'Delete item failed',
      }
    }
    return {
      deletedId: data.deletedId || null,
      success: (data.deletedCount || 0) > 0,
      deletedCount: data.deletedCount || 0,
    }
  } catch (err: unknown) {
    return { deletedId: null, success: false, error: (err as Error).message }
  }
}
export const dataDeleteItem: NodeHandlerGenerator = {
  nodeType: 'data-delete-item',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(data_delete_item)
  },
}
