import { NodeHandlerGenerator, handlerToString } from '../types'

async function data_raw_query(config: any, context: any) {
  const dataSourceId = config.dataSourceId
  const query = config.query
  const baseUrl = (context && context.__baseUrl) || ''

  try {
    const response = await fetch(baseUrl + '/api/data/' + dataSourceId + '/raw-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })

    const data = await response.json()

    if (!response.ok) {
      return { rows: [], result: [], error: data.error || 'Raw query failed' }
    }
    const rows = data.rows || []
    return { rows, result: rows }
  } catch (err: unknown) {
    return { rows: [], result: [], error: (err as Error).message }
  }
}
export const dataRawQuery: NodeHandlerGenerator = {
  nodeType: 'data-raw-query',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(data_raw_query)
  },
}
