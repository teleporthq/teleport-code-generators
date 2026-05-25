import { NodeHandlerGenerator, handlerToString } from '../types'

async function data_select(config: any, context: any) {
  const dataSourceId = config.dataSourceId
  const tableName = config.tableName
  const filters = config.filters || []
  const sorts = config.sorts || []
  const selectedColumns = config.selectedColumns || []
  const limit = config.limit
  const skip = config.skip
  const rawQueryUserPart = config.rawQueryUserPart
  const baseUrl = (context && context.__baseUrl) || ''

  try {
    const payload: any = { tableName, filters, sorts, selectedColumns }
    if (limit !== undefined && limit !== null) {
      payload.limit = limit
    }
    if (skip !== undefined && skip !== null) {
      payload.skip = skip
    }
    if (rawQueryUserPart) {
      payload.rawQueryUserPart = rawQueryUserPart
    }

    const response = await fetch(baseUrl + '/api/data/' + dataSourceId + '/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (!response.ok) {
      return { rows: [], count: 0, error: data.error || 'Select query failed' }
    }
    return { rows: data.rows || [], count: data.count || 0 }
  } catch (err: unknown) {
    return { rows: [], count: 0, error: (err as Error).message }
  }
}
export const dataSelect: NodeHandlerGenerator = {
  nodeType: 'data-select',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(data_select)
  },
}
