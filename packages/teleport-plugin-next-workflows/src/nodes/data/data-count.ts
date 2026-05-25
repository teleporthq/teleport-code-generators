import { NodeHandlerGenerator, handlerToString } from '../types'

async function data_count(config: any, context: any) {
  const dataSourceId = config.dataSourceId
  const tableName = config.tableName
  const filters = config.filters || []
  const baseUrl = (context && context.__baseUrl) || ''

  try {
    const response = await fetch(baseUrl + '/api/data/' + dataSourceId + '/count', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableName, filters }),
    })

    const data = await response.json()

    if (!response.ok) {
      return { count: 0, error: data.error || 'Count query failed' }
    }
    return { count: data.count || 0 }
  } catch (err: unknown) {
    return { count: 0, error: (err as Error).message }
  }
}
export const dataCount: NodeHandlerGenerator = {
  nodeType: 'data-count',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(data_count)
  },
}
