import { NodeHandlerGenerator, handlerToString } from '../types'

async function data_raw_query(config: any, context: any) {
  const dataSourceId = config.dataSourceId
  const query = config.query
  // SECURITY: values that back the query's $N placeholders ride here as bound
  // params, never interpolated into the SQL text. The generation net stored each
  // as a {{…}} token; resolveConfig has already substituted them to concrete
  // values by the time this handler runs. Empty/absent when the query is a static
  // literal (backward-compat: the API route then runs it unparameterized).
  const params = Array.isArray(config.params) ? config.params : []
  const baseUrl = (context && context.__baseUrl) || ''

  try {
    const response = await fetch(baseUrl + '/api/data/' + dataSourceId + '/raw-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, params }),
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
