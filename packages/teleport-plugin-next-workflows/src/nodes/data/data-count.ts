import { NodeHandlerGenerator, handlerToString } from '../types'

async function data_count(config: any, context: any) {
  const dataSourceId = config.dataSourceId
  const tableName = config.tableName
  const filters = config.filters || []
  const baseUrl = (context && context.__baseUrl) || ''

  // Unresolved route-param sentinel in a filter → validation error (see
  // resolveTemplateTokenString in runtime-utils) instead of counting nothing.
  for (let __fi = 0; __fi < filters.length; __fi++) {
    const __f: any = filters[__fi]
    if (
      __f &&
      (__f.value === '__TQ_UNRESOLVED_ROUTE_PARAM__' ||
        __f.destination === '__TQ_UNRESOLVED_ROUTE_PARAM__')
    ) {
      const __col = __f.column || __f.source || __f.field || 'unknown'
      return {
        count: 0,
        error:
          'Filter on "' +
          __col +
          '" requires the page route parameter, which is not available in this context',
      }
    }
  }

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
