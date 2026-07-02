import { NodeHandlerGenerator, handlerToString } from '../types'

async function data_update_item(config: any, context: any) {
  const dataSourceId = config.dataSourceId
  const tableName = config.tableName
  const filters = config.filters || []
  const columnMappings = config.columnMappings || {}
  const baseUrl = (context && context.__baseUrl) || ''
  const __env = (globalThis as any).process && (globalThis as any).process.env

  // Unresolved route-param sentinel (see resolveTemplateTokenString in
  // runtime-utils): in a filter it is a validation error — an UPDATE keyed on
  // it would match 0 rows and report failure with no hint why. In a
  // columnMapping it degrades to null so the write itself survives.
  for (let __fi = 0; __fi < filters.length; __fi++) {
    const __f: any = filters[__fi]
    if (
      __f &&
      (__f.value === '__TQ_UNRESOLVED_ROUTE_PARAM__' ||
        __f.destination === '__TQ_UNRESOLVED_ROUTE_PARAM__')
    ) {
      const __col = __f.column || __f.source || __f.field || 'unknown'
      return {
        id: null,
        updatedCount: 0,
        error:
          'Filter on "' +
          __col +
          '" requires the page route parameter, which is not available in this context',
      }
    }
  }
  if (Array.isArray(columnMappings)) {
    for (let __mi = 0; __mi < columnMappings.length; __mi++) {
      const __m: any = columnMappings[__mi]
      if (__m && __m.value === '__TQ_UNRESOLVED_ROUTE_PARAM__') {
        __m.value = null
      }
    }
  } else if (columnMappings && typeof columnMappings === 'object') {
    const __mKeys = Object.keys(columnMappings)
    for (let __mi = 0; __mi < __mKeys.length; __mi++) {
      if ((columnMappings as any)[__mKeys[__mi]] === '__TQ_UNRESOLVED_ROUTE_PARAM__') {
        ;(columnMappings as any)[__mKeys[__mi]] = null
      }
    }
  }

  // Same anonymous-user hint as data-create-item — a workflow that
  // updates a row written by a guest must be able to re-stamp its
  // ownership column with the same anon UUID rather than NULL.
  // Without this, a webhook that updates an order post-payment
  // would clobber `user_id` back to NULL and orphan the row.
  let __anonymousUserId = ''
  if (context && typeof context === 'object') {
    const __ctxKeys = Object.keys(context)
    for (let __ki = 0; __ki < __ctxKeys.length; __ki++) {
      const __cv: any = context[__ctxKeys[__ki]]
      if (
        __cv &&
        typeof __cv === 'object' &&
        typeof __cv.anonymousUserId === 'string' &&
        __cv.anonymousUserId.length > 0
      ) {
        __anonymousUserId = __cv.anonymousUserId
        break
      }
    }
  }

  try {
    const reqBody: any = { tableName, filters, columnMappings, returnUpdated: true }
    if (__anonymousUserId) {
      reqBody.__anonymousUserId = __anonymousUserId
    }
    const response = await fetch(baseUrl + '/api/data/' + dataSourceId + '/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Trusted internal server-side call — lets the /api/data guard distinguish
        // this from a direct browser request (see assertSessionOwnsUsersRow).
        'x-internal-data-secret': (__env && __env.NEXTAUTH_SECRET) || '',
      },
      body: JSON.stringify(reqBody),
    })

    const data = await response.json()

    if (!response.ok) {
      return { id: null, updatedCount: 0, error: data.error || 'Update item failed' }
    }
    return { id: data.id || null, ...(data.item || {}), updatedCount: data.updatedCount || 0 }
  } catch (err: unknown) {
    return { id: null, updatedCount: 0, error: (err as Error).message }
  }
}
export const dataUpdateItem: NodeHandlerGenerator = {
  nodeType: 'data-update-item',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(data_update_item)
  },
}
