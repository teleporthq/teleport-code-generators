import { NodeHandlerGenerator, handlerToString } from '../types'

async function data_count(config: any, context: any) {
  const dataSourceId = config.dataSourceId
  const tableName = config.tableName
  const filters = config.filters || []
  const baseUrl = (context && context.__baseUrl) || ''
  // Credentials for calling this deployment's own API routes — see
  // internalRequestHeaders in runtime-utils. Without them a deployment behind
  // Vercel Deployment Protection 401s its own request and this node silently
  // returns nothing.
  const __internalHeaders = (context && context.__internalHeaders) || {}

  // Unresolved route-param sentinel in a filter (see resolveTemplateTokenString
  // in runtime-utils). DEGRADE: return count:0 WITHOUT an `error` so the executor
  // does not throw and abort the whole workflow.
  for (let __fi = 0; __fi < filters.length; __fi++) {
    const __f: any = filters[__fi]
    if (
      __f &&
      (__f.value === '__TQ_UNRESOLVED_ROUTE_PARAM__' ||
        __f.destination === '__TQ_UNRESOLVED_ROUTE_PARAM__')
    ) {
      const __col = __f.column || __f.source || __f.field || 'unknown'
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(
          '[workflow] data-count skipped — filter on "' +
            __col +
            '" needs a page route param not available here; count 0 (workflow continues)'
        )
      }
      return { count: 0, __skippedUnavailableFilter: true }
    }
  }

  try {
    const response = await fetch(baseUrl + '/api/data/' + dataSourceId + '/count', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...__internalHeaders },
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
