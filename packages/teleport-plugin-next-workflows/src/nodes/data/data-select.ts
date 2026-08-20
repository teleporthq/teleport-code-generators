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
  // SECURITY: bound values that back the raw override's $N placeholders. The
  // generation net emitted them alongside rawQueryUserPart; resolveConfig has
  // already substituted the {{…}} tokens to concrete values here.
  const rawQueryUserPartParams = Array.isArray(config.rawQueryUserPartParams)
    ? config.rawQueryUserPartParams
    : []
  const baseUrl = (context && context.__baseUrl) || ''
  // Credentials for calling this deployment's own API routes — see
  // internalRequestHeaders in runtime-utils. Without them a deployment behind
  // Vercel Deployment Protection 401s its own request and this node silently
  // returns nothing.
  const __internalHeaders = (context && context.__internalHeaders) || {}

  function isEmptyFilterValue(value: any) {
    if (value === undefined || value === null) return true
    if (typeof value === 'string' && value.trim() === '') return true
    if (Array.isArray(value) && value.length === 0) return true
    return false
  }

  function isAllSentinel(value: any, filter: any) {
    if (typeof value !== 'string') return false
    const normalized = value.trim().toLowerCase()
    const configured = filter && filter.treatAsAll
    if (typeof configured === 'string' && configured.trim().toLowerCase() === normalized) {
      return true
    }
    return (
      normalized === 'all' ||
      normalized === 'any' ||
      normalized === 'everything' ||
      normalized === '__all__'
    )
  }

  function shouldSkipOptionalFilter(filter: any) {
    if (!filter) return true
    const value = filter.destination !== undefined ? filter.destination : filter.value
    if (isEmptyFilterValue(value)) return true
    if (isAllSentinel(value, filter)) return true
    if (Array.isArray(filter.skipIfValue) && filter.skipIfValue.indexOf(value) !== -1) return true
    if (filter.skipIfEmpty === true && isEmptyFilterValue(value)) return true
    return false
  }

  const effectiveFilters = filters.filter(function (filter: any) {
    return !shouldSkipOptionalFilter(filter)
  })

  // A filter whose value is the unresolved route-param sentinel (see
  // resolveTemplateTokenString in runtime-utils) — e.g. a select scoped to
  // {{Current Page Entity.id}} that runs on a page with no such route param
  // (a create page, or a mis-generated filter). DEGRADE GRACEFULLY: return an
  // empty result WITHOUT an `error` so the executor does not throw and abort the
  // WHOLE workflow (a single unresolvable filter must never kill the note-create
  // submit). Never fall through to an unscoped query. Observable via the warn +
  // the __skippedUnavailableFilter marker.
  for (let __fi = 0; __fi < effectiveFilters.length; __fi++) {
    const __f: any = effectiveFilters[__fi]
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
    const payload: any = { tableName, filters: effectiveFilters, sorts, selectedColumns }
    if (limit !== undefined && limit !== null) {
      payload.limit = limit
    }
    if (skip !== undefined && skip !== null) {
      payload.skip = skip
    }
    if (rawQueryUserPart) {
      payload.rawQueryUserPart = rawQueryUserPart
      if (rawQueryUserPartParams.length > 0) {
        payload.rawQueryUserPartParams = rawQueryUserPartParams
      }
    }

    const response = await fetch(baseUrl + '/api/data/' + dataSourceId + '/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...__internalHeaders },
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
