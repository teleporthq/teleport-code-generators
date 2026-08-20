import { NodeHandlerGenerator, handlerToString } from '../types'

async function data_delete_item(config: any, context: any) {
  const dataSourceId = config.dataSourceId
  const tableName = config.tableName
  const filters = config.filters || []
  const baseUrl = (context && context.__baseUrl) || ''
  // Credentials for calling this deployment's own API routes — see
  // internalRequestHeaders in runtime-utils. Without them a deployment behind
  // Vercel Deployment Protection 401s its own request and this node silently
  // returns nothing.
  const __internalHeaders = (context && context.__internalHeaders) || {}
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
      // DEGRADE to a NO-OP: return deletedCount:0 WITHOUT `error` and WITHOUT
      // success:false so the executor does not throw and abort the whole
      // workflow. A DELETE must NEVER drop the filter and run unscoped (that
      // would delete every row) — no-op is the only safe degrade.
      const __col = __f.column || __f.source || __f.field || 'unknown'
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(
          '[workflow] data-delete-item skipped (no-op) — filter on "' +
            __col +
            '" needs a page route param not available here; nothing deleted (workflow continues)'
        )
      }
      return {
        deletedId: null,
        success: true,
        deletedCount: 0,
        affected: 0,
        __skippedUnavailableFilter: true,
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
        ...__internalHeaders,
      },
      body: JSON.stringify({ tableName, filters }),
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        deletedId: null,
        success: false,
        deletedCount: 0,
        affected: 0,
        error: data.error || 'Delete item failed',
      }
    }
    // `affected` mirrors `deletedCount` so a success gate authored against either
    // synonym resolves (the AI schema historically advertised `affected`).
    const __deleted = data.deletedCount || 0
    return {
      deletedId: data.deletedId || null,
      success: __deleted > 0,
      deletedCount: __deleted,
      affected: __deleted,
    }
  } catch (err: unknown) {
    return { deletedId: null, success: false, affected: 0, error: (err as Error).message }
  }
}
export const dataDeleteItem: NodeHandlerGenerator = {
  nodeType: 'data-delete-item',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(data_delete_item)
  },
}
