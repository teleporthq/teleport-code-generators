import { NodeHandlerGenerator, handlerToString } from '../types'

async function data_delete_item(config: any, context: any) {
  const dataSourceId = config.dataSourceId
  const tableName = config.tableName
  const filters = config.filters || []
  const baseUrl = (context && context.__baseUrl) || ''
  const __env = (globalThis as any).process && (globalThis as any).process.env

  // Unresolved route-param sentinel in a filter → validation error (see
  // resolveTemplateTokenString in runtime-utils). A DELETE must never run
  // with a filter that silently matches nothing (or worse, gets dropped).
  for (let __fi = 0; __fi < filters.length; __fi++) {
    const __f: any = filters[__fi]
    if (
      __f &&
      (__f.value === '__TQ_UNRESOLVED_ROUTE_PARAM__' ||
        __f.destination === '__TQ_UNRESOLVED_ROUTE_PARAM__')
    ) {
      const __col = __f.column || __f.source || __f.field || 'unknown'
      return {
        deletedId: null,
        success: false,
        deletedCount: 0,
        error:
          'Filter on "' +
          __col +
          '" requires the page route parameter, which is not available in this context',
      }
    }
  }

  try {
    const response = await fetch(baseUrl + '/api/data/' + dataSourceId + '/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Trusted internal server-side call — lets the /api/data guard distinguish
        // this from a direct browser request (see assertSessionOwnsUsersRow).
        'x-internal-data-secret': (__env && __env.NEXTAUTH_SECRET) || '',
      },
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
