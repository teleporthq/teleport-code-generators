import {
  UIDLGlobalStateDefinition,
  UIDLDataSource,
  UIDLFilterConfigEntry,
} from '@teleporthq/teleport-types'
import {
  generateSafeFileName,
  validateDataSourceConfig,
  generateRawQueryFetcher,
  parseQueryTemplateVariables,
} from '@teleporthq/teleport-plugin-next-data-source'
import { StringUtils } from '@teleporthq/teleport-shared'

const CURRENT_USER_TEMPLATE_RE = /\{\{Current User\.(\w+)\}\}/g

/**
 * Checks whether a query string references {{Current User.*}} dynamic variables.
 */
export const queryReferencesCurrentUser = (query: string): boolean => {
  return CURRENT_USER_TEMPLATE_RE.test(query)
}

/**
 * Extracts {{Current User.*}} variable fields from a query string.
 * Returns a list of field names (e.g., ['id', 'email']).
 */
export const extractCurrentUserFields = (query: string): string[] => {
  const fields: string[] = []
  const re = new RegExp(CURRENT_USER_TEMPLATE_RE.source, 'g')
  let match = re.exec(query)
  while (match !== null) {
    if (!fields.includes(match[1])) {
      fields.push(match[1])
    }
    match = re.exec(query)
  }
  return fields
}

/**
 * Validates a raw SQL query is SELECT-only.
 */
export const isSelectOnlyQuery = (query: string): boolean => {
  const trimmed = query.trim().toUpperCase()
  const forbidden = ['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME', 'GRANT', 'REVOKE']
  for (const keyword of forbidden) {
    if (trimmed.startsWith(keyword)) {
      return false
    }
  }
  return true
}

export interface CsvColumnLabel {
  id: string
  label: string
}

/**
 * The columns that turn a CSV source's rows into the shape the editor reads.
 * The generated CSV fetcher keys every row by column id (`col_0`), while the
 * editor keys the same rows by column label — so every field of a state bound
 * to the file was designed against the label. Null for any other source, or a
 * file without column metadata (whose rows the editor reads as parsed).
 */
export const getCsvColumnLabels = (dataSource: UIDLDataSource): CsvColumnLabel[] | null => {
  if (dataSource.type !== 'csv-file') {
    return null
  }
  const columns = (dataSource.config as { columns?: unknown } | undefined)?.columns
  if (!Array.isArray(columns)) {
    return null
  }
  const labels = columns.filter(
    (column): column is CsvColumnLabel =>
      !!column &&
      typeof column.id === 'string' &&
      column.id.length > 0 &&
      typeof column.label === 'string' &&
      column.label.length > 0
  )
  return labels.length > 0 ? labels : null
}

/**
 * Code that re-keys `rowsVar`'s rows from column id to column label, leaving
 * anything that is not a list untouched.
 */
export const buildCsvRelabelCode = (rowsVar: string, columns: CsvColumnLabel[]): string => {
  const fields = columns
    .map(({ id, label }) => `${JSON.stringify(label)}: __row?.[${JSON.stringify(id)}]`)
    .join(', ')
  return `Array.isArray(${rowsVar}) ? ${rowsVar}.map((__row) => ({ ${fields} })) : ${rowsVar}`
}

/**
 * Separates static and dynamic filters from a filterConfig array.
 */
export const separateFilters = (
  filterConfig: UIDLFilterConfigEntry[]
): { staticFilters: UIDLFilterConfigEntry[]; dynamicFilters: UIDLFilterConfigEntry[] } => {
  const staticFilters: UIDLFilterConfigEntry[] = []
  const dynamicFilters: UIDLFilterConfigEntry[] = []

  for (const filter of filterConfig) {
    if (filter.isDynamic && filter.dynamicRef) {
      dynamicFilters.push(filter)
    } else {
      staticFilters.push(filter)
    }
  }

  return { staticFilters, dynamicFilters }
}

/**
 * Gets the table name from a refPath (first element).
 */
export const getTableNameFromRefPath = (refPath: Array<string | number>): string | null => {
  if (!refPath || refPath.length === 0) {
    return null
  }
  const first = refPath[0]
  return typeof first === 'string' ? first : null
}

/**
 * Builds the refPath extraction code for accessing nested data.
 * E.g., refPath = ['table', 0, 'name'] → 'data?.[0]?.name'
 */
export const buildRefPathAccessCode = (
  dataVar: string,
  refPath: Array<string | number>
): string => {
  const accessPath = refPath.slice(1) // Skip table name
  if (accessPath.length === 0) {
    return dataVar
  }

  let code = dataVar
  for (const segment of accessPath) {
    if (typeof segment === 'number') {
      code = `${code}?.[${segment}]`
    } else {
      const isValid = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(segment)
      code = isValid ? `${code}?.${segment}` : `${code}?.[${JSON.stringify(segment)}]`
    }
  }
  return code
}

/**
 * Wraps mapping function execution with error handling.
 * Returns code that defines and calls the mapping function with fallback.
 */
export const buildMappingFunctionCode = (
  mappingFunction: string,
  inputVar: string,
  resultVar: string
): string => {
  return `      let ${resultVar} = ${inputVar}
      try {
        ${mappingFunction}
        ${resultVar} = mapData(${inputVar})
      } catch (__mapErr) {
        console.error('Mapping function error:', __mapErr)
      }`
}

export interface GlobalStateFetchConfig {
  name: string
  definition: UIDLGlobalStateDefinition
  dataSource: UIDLDataSource
  tableName: string
  fileName: string
  fetcherImportName: string
  hasQuery: boolean
  hasDynamicFilters: boolean
  needsCurrentUser: boolean
}

/**
 * Collects fetch configurations for all data-source-bound global state definitions.
 */
export const collectGlobalStateFetchConfigs = (
  definitions: Record<string, UIDLGlobalStateDefinition>,
  dataSources: Record<string, UIDLDataSource>
): GlobalStateFetchConfig[] => {
  const configs: GlobalStateFetchConfig[] = []

  for (const [, def] of Object.entries(definitions)) {
    if (!def.dataSourceBinding) {
      continue
    }

    const dataSource = dataSources[def.dataSourceBinding.dataSourceId]
    if (!dataSource) {
      continue
    }

    const validation = validateDataSourceConfig(dataSource)
    if (!validation.isValid) {
      continue
    }

    const hasQuery = !!(def.query && def.query.trim())
    const hasValidQuery = hasQuery && isSelectOnlyQuery(def.query)

    // Skip if query is present but invalid (destructive SQL)
    if (hasQuery && !hasValidQuery) {
      continue
    }

    const tableName = getTableNameFromRefPath(def.dataSourceBinding.refPath) || 'data'
    const fileName = generateSafeFileName(
      dataSource.type,
      tableName,
      def.dataSourceBinding.dataSourceId
    )
    const fetcherImportName = StringUtils.dashCaseToCamelCase(fileName)

    const filterResult = def.filterConfig
      ? separateFilters(def.filterConfig)
      : {
          staticFilters: [] as UIDLFilterConfigEntry[],
          dynamicFilters: [] as UIDLFilterConfigEntry[],
        }
    const dynamicFilters = filterResult.dynamicFilters

    const queryNeedsUser = hasValidQuery && queryReferencesCurrentUser(def.query)
    const dynamicFiltersNeedUser = dynamicFilters.some((f) => f.dynamicRef?.id === 'Current User')
    const needsCurrentUser = queryNeedsUser || dynamicFiltersNeedUser

    configs.push({
      name: def.name,
      definition: def,
      dataSource,
      tableName,
      fileName,
      fetcherImportName,
      hasQuery: hasValidQuery,
      hasDynamicFilters: dynamicFilters.length > 0,
      needsCurrentUser,
    })
  }

  return configs
}

/**
 * Generates the API route code for a raw SQL query data source.
 * Delegates to the shared raw query fetcher generator.
 */
export const generateRawQueryApiRoute = (dataSource: UIDLDataSource, query: string): string => {
  const { parameterizedQuery, paramFields } = parseQueryTemplateVariables(query)
  return generateRawQueryFetcher(
    dataSource.config as Record<string, unknown>,
    parameterizedQuery,
    paramFields
  )
}
