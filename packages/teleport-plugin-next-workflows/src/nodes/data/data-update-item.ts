import { NodeHandlerGenerator, handlerToString } from '../types'

async function data_update_item(config: any, context: any) {
  const dataSourceId = config.dataSourceId
  const tableName = config.tableName
  const filters = config.filters || []
  const columnMappings = config.columnMappings || {}
  const baseUrl = (context && context.__baseUrl) || ''
  const __env = (globalThis as any).process && (globalThis as any).process.env

  // Unresolved route-param sentinel (see resolveTemplateTokenString in
  // runtime-utils): in a filter, an UPDATE keyed on it cannot identify its row.
  // DEGRADE to a NO-OP — return updatedCount:0 WITHOUT an `error` so the executor
  // does not throw and abort the whole workflow. CRITICAL: never drop the filter
  // and run an UNSCOPED update (that would rewrite every row); no-op is the only
  // safe degrade. (A columnMapping sentinel still degrades to null below so the
  // write's VALUES survive.) Observable via the warn + __skippedUnavailableFilter.
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
          '[workflow] data-update-item skipped (no-op) — filter on "' +
            __col +
            '" needs a page route param not available here; no rows updated (workflow continues)'
        )
      }
      return {
        id: null,
        updatedCount: 0,
        affected: 0,
        success: true,
        __skippedUnavailableFilter: true,
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

  // A columnMapping whose resolved value is `undefined` means its binding never
  // produced a value: an unread page-entity column, or (most commonly) an empty
  // form field that general-extract-form-data omits by default. Sending it would
  // write NULL and break a NOT NULL column — run d9a24741 blanked
  // guests.full_name from an un-prefilled guest_name input. OMIT such mappings so
  // the column keeps its stored value. (An intentional null — e.g. a route-param
  // sentinel degraded above — is preserved: only `undefined` is dropped.)
  let effectiveColumnMappings: any = columnMappings
  if (Array.isArray(columnMappings)) {
    effectiveColumnMappings = columnMappings.filter(function (__m: any) {
      return !(__m && typeof __m === 'object' && __m.value === undefined)
    })
  } else if (columnMappings && typeof columnMappings === 'object') {
    effectiveColumnMappings = {}
    const __ck = Object.keys(columnMappings)
    for (let __ci = 0; __ci < __ck.length; __ci++) {
      if ((columnMappings as any)[__ck[__ci]] !== undefined) {
        ;(effectiveColumnMappings as any)[__ck[__ci]] = (columnMappings as any)[__ck[__ci]]
      }
    }
  }
  const __hasWrites = Array.isArray(effectiveColumnMappings)
    ? effectiveColumnMappings.length > 0
    : !!effectiveColumnMappings && Object.keys(effectiveColumnMappings).length > 0
  if (!__hasWrites) {
    // Nothing resolvable to write — never send an empty UPDATE (the DB would
    // reject it / touch nothing). Report a clean zero-row no-op so a downstream
    // updatedCount/affected gate takes its "no change" branch.
    return {
      id: null,
      updatedCount: 0,
      affected: 0,
      success: true,
      __skippedEmptyUpdate: true,
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
    const reqBody: any = {
      tableName,
      filters,
      columnMappings: effectiveColumnMappings,
      returnUpdated: true,
    }
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
      return { id: null, updatedCount: 0, affected: 0, error: data.error || 'Update item failed' }
    }
    // `affected` mirrors `updatedCount` — a success gate authored against either
    // synonym (the AI schema historically advertised `affected`) must resolve.
    // Placed after the row spread so it can't be shadowed by a table column.
    const __updated = data.updatedCount || 0
    return {
      id: data.id || null,
      ...(data.item || {}),
      updatedCount: __updated,
      affected: __updated,
    }
  } catch (err: unknown) {
    return { id: null, updatedCount: 0, affected: 0, error: (err as Error).message }
  }
}
export const dataUpdateItem: NodeHandlerGenerator = {
  nodeType: 'data-update-item',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(data_update_item)
  },
}
