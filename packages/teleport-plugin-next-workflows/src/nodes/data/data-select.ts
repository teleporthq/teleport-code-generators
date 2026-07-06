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

  // A filter whose value is the unresolved route-param sentinel (see
  // resolveTemplateTokenString in runtime-utils) — e.g. a select scoped to
  // {{Current Page Entity.id}} that runs on a page with no such route param
  // (a create page, or a mis-generated filter). DEGRADE GRACEFULLY: return an
  // empty result WITHOUT an `error` so the executor does not throw and abort the
  // WHOLE workflow (a single unresolvable filter must never kill the note-create
  // submit). Never fall through to an unscoped query. Observable via the warn +
  // the __skippedUnavailableFilter marker.
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
          '[workflow] data-select skipped — filter on "' +
            __col +
            '" needs a page route param not available here; returning empty rows (workflow continues)'
        )
      }
      return { rows: [], count: 0, __skippedUnavailableFilter: true }
    }
  }

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
